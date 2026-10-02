// Homepage fingerprinting (CMS, analytics, frameworks, ...) using the shared StackGrade signatures.
// CPU budget: Workers Free allows ~10 ms CPU per invocation, and running ~160 regexes over a full 300 KB page costs
// 20-40 ms. So we first cut the page down to its tags (<script>, <link>, <meta>, <html>, <body>, ...) plus the start of
// inline scripts using indexOf (fast, native), and run the signatures on that much smaller "evidence" text.
import { SIGNATURES, IMPLIED_ONLY } from '../../assets/signatures.js';
import { safeFetch } from './ssrf.js';

const TAGS = ['<script', '<link', '<meta', '<html', '<body', '<iframe', '<form', '<noscript', '<div id="__', '<div id="root', '<img'];
export function evidence(raw, maxLen = 30000) {
    const out = []; let len = 0;
    for (const tag of TAGS) {
        let p = 0; let n = 0;
        const cap = tag === '<img' ? 40 : 300;
        while ((p = raw.indexOf(tag, p)) !== -1 && n++ < cap && len < maxLen) {
            const e = raw.indexOf('>', p);
            if (e === -1) break;
            const t = raw.slice(p, Math.min(e + 1, p + 600));
            out.push(t); len += t.length;
            if (tag === '<script' && !t.includes('src=')) { const body = raw.slice(e + 1, Math.min(e + 400, raw.length)); out.push(body); len += body.length; }
            p = e + 1;
        }
    }
    return out.join('\n');
}
function extract(re, s, cap = 300) { const out = []; let m; const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = r.exec(s)) && out.length < cap) out.push(m[1]); return out; }

export function analyzePage({ html = '', headers: rawHeaders = {}, cookies = [] }) {
    // Responses fetched from a Worker always look like Cloudflare (server: cloudflare, cf-ray, cf-cache-status are added
    // by Cloudflare's edge even for sites that do not use it), so those headers are ignored here. The browser's own
    // check still detects Cloudflare from the Mozilla Observatory headers and DNS.
    const headers = { ...rawHeaders };
    for (const k of Object.keys(headers)) if (k.startsWith('cf-')) delete headers[k];
    if (/^cloudflare$/i.test(headers.server || '')) delete headers.server;
    const ev = evidence(html);
    const scripts = extract(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i, ev);
    const meta = {};
    for (const tag of extract(/(<meta\b[^>]*>)/i, ev, 200)) {
        const key = (tag.match(/\b(?:name|property|http-equiv)\s*=\s*["']([^"']+)["']/i) || [])[1];
        const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
        if (key && content !== undefined) { const k = key.toLowerCase(); meta[k] = meta[k] ? `${meta[k]} | ${content}` : content; }
    }
    const found = new Map();
    const add = (sig, by, text) => {
        const cur = found.get(sig.name) || { name: sig.name, category: sig.cat, version: null, by: new Set() };
        cur.by.add(by);
        if (!cur.version && sig.v && text) { const vm = String(text).match(sig.v); if (vm?.[1]) cur.version = vm[1]; }
        found.set(sig.name, cur);
    };
    for (const sig of SIGNATURES) {
        if (sig.h) for (const [k, re] of Object.entries(sig.h)) if (headers[k] !== undefined && re.test(headers[k])) add(sig, 'header', headers[k]);
        if (sig.c) for (const re of sig.c) if (cookies.some((c) => re.test(c))) add(sig, 'cookie');
        if (sig.m) for (const [k, re] of Object.entries(sig.m)) if (meta[k] && re.test(meta[k])) add(sig, 'meta', meta[k]);
        if (sig.s) for (const re of sig.s) { const hit = scripts.find((s) => re.test(s)); if (hit) { add(sig, 'script', hit); break; } }
        if (sig.html && ev) for (const re of sig.html) { const mm = ev.match(re); if (mm) { add(sig, 'html', sig.v ? meta.generator || mm[0] : mm[0]); break; } }
    }
    for (let pass = 0; pass < 3; pass++) {
        for (const t of [...found.values()]) {
            const sig = SIGNATURES.find((s) => s.name === t.name && s.implies);
            for (const imp of sig?.implies || []) {
                if (found.has(imp)) continue;
                const impSig = SIGNATURES.find((s) => s.name === imp);
                found.set(imp, { name: imp, category: impSig?.cat || IMPLIED_ONLY[imp] || 'Other', version: null, by: new Set([`implied by ${t.name}`]) });
            }
        }
    }
    const tech = [...found.values()].map((t) => ({ ...t, by: [...t.by] })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const leaks = [];
    if (/\d/.test(headers['x-powered-by'] || '')) leaks.push(`X-Powered-By: ${headers['x-powered-by']}`);
    if (/\/\d/.test(headers.server || '')) leaks.push(`Server: ${headers.server}`);
    if (meta.generator && /\d/.test(meta.generator)) leaks.push(`Generator: ${meta.generator.slice(0, 80)}`);
    return { tech, leaks, generator: meta.generator?.slice(0, 120) || null, evidenceBytes: ev.length };
}

export async function fingerprint(domain, { fetchImpl = fetch } = {}) {
    let page = await safeFetch(`https://${domain}/`, { fetchImpl, maxBytes: 196608 });
    if (!page.ok && !page.blocked) {
        const alt = await safeFetch(`http://${domain}/`, { fetchImpl, timeoutMs: 5000 });
        if (alt.ok) page = alt;
    }
    if (!page.ok) return { ok: false, error: page.error, blocked: !!page.blocked };
    if (page.status >= 400) return { ok: false, error: `the homepage answered HTTP ${page.status} (probably bot protection)`, status: page.status, finalUrl: page.finalUrl };
    const a = analyzePage(page);
    return { ok: true, status: page.status, finalUrl: page.finalUrl, bytes: page.html.length, ...a };
}
