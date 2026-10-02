// SSRF-safe fetching of public websites.
// - http/https only, default ports only, no credentials in the URL
// - hostnames only (no IP literals), no internal names (localhost, *.local, *.internal, ...)
// - every A/AAAA answer (via DNS-over-HTTPS) must be a public address; re-checked on every redirect hop
// - manual redirects (max 4), 8 s total timeout, body capped (default 256 KB), HTML/text only
// Residual risk: DNS can change between our lookup and Cloudflare's own resolution (rebinding). Cloudflare's edge does
// not route Worker subrequests to private networks, so this is defence in depth, not the only barrier.
const BLOCKED_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example|onion|arpa|home\.arpa)$/i;
const HOST_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function ipv4ToInt(ip) {
    const p = ip.split('.');
    if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
    return p.reduce((a, x) => (a << 8 >>> 0) + Number(x), 0) >>> 0;
}
const V4_BLOCKS = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([b, m]) => [ipv4ToInt(b), m]);
export function isPrivateV4(ip) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    return V4_BLOCKS.some(([b, m]) => (n >>> (32 - m)) === (b >>> (32 - m)));
}
function expandV6(ip) {
    let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) { const n = ipv4ToInt(v4[1]); if (n === null) return null; s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`; }
    const [head, tail] = s.split('::');
    if (s.split('::').length > 2) return null;
    const h = head ? head.split(':') : []; const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
    const parts = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
    return parts.map((x) => parseInt(x, 16));
}
export function isPrivateV6(ip) {
    const w = expandV6(ip);
    if (!w) return true;
    if (w.every((x) => x === 0)) return true;                                   // ::
    if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true;       // ::1
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return isPrivateV4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`); // v4-mapped/compatible
    if (w[0] === 0x64 && w[1] === 0xff9b) return isPrivateV4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`); // NAT64
    if ((w[0] & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
    if ((w[0] & 0xffc0) === 0xfe80) return true;   // fe80::/10 link local
    if ((w[0] & 0xff00) === 0xff00) return true;   // multicast
    if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
    if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true; // discard
    if (w[0] === 0x2002) return isPrivateV4(`${w[1] >> 8}.${w[1] & 255}.${w[2] >> 8}.${w[2] & 255}`); // 6to4
    return false;
}
export const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || /^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h);

// Synchronous checks on a URL. Returns { url } or { error }.
export function checkUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return { error: 'invalid URL' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'only http and https are allowed' };
    if (u.username || u.password) return { error: 'credentials in URLs are not allowed' };
    if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))) return { error: 'only default ports are allowed' };
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (isIpLiteral(host) || host.startsWith('[')) return { error: 'IP addresses are not allowed; use a domain name' };
    if (BLOCKED_SUFFIX.test(host) || !HOST_RE.test(host)) return { error: 'internal or invalid hostname' };
    return { url: u, host };
}

async function doh(name, type, fetchImpl) {
    for (const base of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']) {
        try {
            const r = await fetchImpl(`${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
            if (!r.ok) continue;
            const j = await r.json();
            if (j.Status !== 0 && j.Status !== 3) continue;
            return (j.Answer || []).filter((a) => a.type === (type === 'A' ? 1 : 28)).map((a) => String(a.data));
        } catch { /* next resolver */ }
    }
    throw new Error('DNS lookup failed');
}
// Resolves the host and rejects private/reserved addresses. Returns { ok, addresses } or { ok:false, error }.
export async function checkResolves(host, fetchImpl = fetch) {
    let a4; let a6;
    try { [a4, a6] = await Promise.all([doh(host, 'A', fetchImpl), doh(host, 'AAAA', fetchImpl)]); } catch { return { ok: false, error: 'DNS lookup failed' }; }
    const all = [...a4, ...a6];
    if (!all.length) return { ok: false, error: 'the hostname does not resolve' };
    const bad = all.find((ip) => (ip.includes(':') ? isPrivateV6(ip) : isPrivateV4(ip)));
    if (bad) return { ok: false, error: `the hostname resolves to a private or reserved address (${bad})` };
    return { ok: true, addresses: all };
}

async function readCapped(res, max) {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks = []; let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); size += value.byteLength;
        if (size >= max) { reader.cancel().catch(() => {}); break; }
    }
    const buf = new Uint8Array(Math.min(size, max)); let off = 0;
    for (const c of chunks) { const take = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, take), off); off += take; if (off >= buf.length) break; }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// GET a public page safely. Returns { ok, status, finalUrl, headers, cookies, html } or { ok:false, error }.
export async function safeFetch(raw, { fetchImpl = fetch, maxBytes = 262144, timeoutMs = 8000, maxRedirects = 4, method = 'GET', body, headers = {} } = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    let target = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const c = checkUrl(target);
        if (c.error) return { ok: false, error: c.error, blocked: true };
        const r = await checkResolves(c.host, fetchImpl);
        if (!r.ok) return { ok: false, error: r.error, blocked: /private|reserved/.test(r.error) };
        let res;
        try {
            res = await fetchImpl(c.url.toString(), { method, body, redirect: 'manual', signal: deadline, headers: { 'user-agent': 'Mozilla/5.0 (compatible; StackGradeBot/1.0; +https://299nhs7sjg-netizen.github.io/stackgrade/faq/)', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...headers } });
        } catch (e) { return { ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timed out' : 'could not connect' }; }
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            if (method !== 'GET') return { ok: false, error: `redirected (HTTP ${res.status})` };
            target = new URL(res.headers.get('location'), c.url).toString();
            res.body?.cancel?.().catch?.(() => {});
            continue;
        }
        const h = {}; res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
        const cookies = (res.headers.getSetCookie?.() || []).map((x) => x.split('=')[0].trim()).filter(Boolean);
        const ctype = h['content-type'] || '';
        let html = '';
        if (method === 'GET' && (!ctype || /html|xml|text\/plain/i.test(ctype))) {
            try { html = await readCapped(res, maxBytes); } catch { return { ok: false, error: 'timed out reading the page' }; }
        } else res.body?.cancel?.().catch?.(() => {});
        return { ok: true, status: res.status, finalUrl: c.url.toString(), headers: h, cookies, html };
    }
    return { ok: false, error: 'too many redirects' };
}
