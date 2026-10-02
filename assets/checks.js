// StackGrade check engine. Runs in the browser (and in Node 20+ for tests): only uses fetch().
// Every check returns { id, group, title, status, points, weight, summary, details, fix, source }.
// status: 'pass' | 'warn' | 'fail' | 'skip' (not checked; excluded from score) | 'info' (never scored)
import { SIGNATURES, IMPLIED_ONLY } from './signatures.js';

export const VERSION = '0.1.0';

// ---------- scoring rubric (keep in sync with README) ----------
export const WEIGHTS = {
    spf: 15, dmarc: 20, dkim: 10, mx: 5,                   // Email: 50
    https: 10, hsts: 8, csp: 6, xfo: 4, xcto: 3, referrer: 2, cookies: 2, // Website security: 35
    expiry: 10, lock: 5,                                   // Domain: 15
};
export const GROUPS = { email: 'Email authentication', web: 'Website security', domain: 'Domain health', signals: 'Tech stack & signals' };

export function letter(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
}

// ---------- utils ----------
async function fetchT(url, opts = {}, ms = 8000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try { return await fetch(url, { ...opts, signal: c.signal }); }
    finally { clearTimeout(t); }
}
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const plural = (n, w) => `${n} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`;

// ---------- input ----------
const HOST_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
export function parseInput(raw) {
    let s = String(raw ?? '').trim().toLowerCase();
    if (!s) return { error: 'Enter a domain, for example yourcompany.com' };
    if (s.includes('@') && !/^[a-z]+:\/\//.test(s)) s = s.slice(s.lastIndexOf('@') + 1);
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '');
    s = s.split(/[/?#\s]/)[0];
    if (/^\[.*\]/.test(s) || (s.match(/:/g) || []).length > 1) return { error: 'That looks like an IP address. Enter a domain name instead.' };
    s = s.replace(/:\d+$/, '').replace(/\.+$/, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return { error: 'That looks like an IP address. Enter a domain name instead.' };
    try { s = new URL(`http://${s}`).hostname; } catch { return { error: `"${String(raw).slice(0, 60)}" isn't a valid domain name.` }; }
    s = s.replace(/\.+$/, '').replace(/^www\./, '');
    if (!HOST_RE.test(s)) return { error: `"${String(raw).slice(0, 60)}" isn't a valid domain name.` };
    if (/\.(local|localhost|internal|lan|home|corp|test|invalid|example|onion)$/.test(s)) return { error: 'That is a private or reserved name. Enter a public domain.' };
    return { domain: s };
}

// ---------- IDN display (RFC 3492 punycode decoder; queries always use the ASCII form) ----------
function punyDecode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const out = [];
    let n = 128, bias = 72, i = 0;
    const basic = Math.max(input.lastIndexOf('-'), 0);
    for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
    const adapt = (delta, num, first) => {
        let k = 0;
        delta = first ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / num);
        for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
        return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    };
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
        const oldi = i;
        let w = 1;
        for (let k = base; ; k += base) {
            if (idx >= input.length) throw new Error('bad punycode');
            const c = input.charCodeAt(idx++);
            const digit = c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base;
            if (digit >= base) throw new Error('bad punycode');
            i += digit * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (digit < t) break;
            w *= base - t;
        }
        const len = out.length + 1;
        bias = adapt(i - oldi, len, oldi === 0);
        n += Math.floor(i / len);
        i %= len;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}
export function toUnicode(host) {
    return String(host).split('.').map((l) => {
        if (!l.startsWith('xn--')) return l;
        try { return punyDecode(l.slice(4)); } catch { return l; }
    }).join('.');
}

// Registrable domain guess (handles common 2nd-level ccTLD suffixes such as co.uk, com.au).
const SECOND_LEVEL = /^(co|com|net|org|gov|edu|ac|or|ne|go|ltd|plc|me|gen|biz|info|nom|sch|nhs|gob|gv|mil|id|in)\.[a-z]{2}$/;
export function registrable(domain) {
    const p = domain.split('.');
    if (p.length <= 2) return domain;
    return SECOND_LEVEL.test(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

// ---------- DNS over HTTPS ----------
const TYPE = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };
function cleanTxt(v) {
    v = String(v);
    if (v.startsWith('"')) v = v.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
    return v;
}
export function makeDns() {
    const cache = new Map();
    async function q(name, type) {
        const key = `${name}|${type}`;
        if (!cache.has(key)) cache.set(key, run(name, type));
        return cache.get(key);
    }
    async function run(name, type) {
        const n = encodeURIComponent(name);
        const tries = [
            () => fetchT(`https://dns.google/resolve?name=${n}&type=${type}`, {}, 6000),
            () => fetchT(`https://cloudflare-dns.com/dns-query?name=${n}&type=${type}`, { headers: { accept: 'application/dns-json' } }, 6000),
        ];
        let lastErr;
        for (const t of tries) {
            try {
                const res = await t();
                if (!res.ok) { res.body?.cancel?.().catch?.(() => {}); lastErr = new Error(`DNS HTTP ${res.status}`); continue; }
                const j = await res.json();
                if (j.Status !== 0 && j.Status !== 3) { lastErr = new Error(`DNS status ${j.Status}`); continue; } // SERVFAIL etc: try other resolver
                const answers = (j.Answer || []).filter((a) => a.type === TYPE[type]).map((a) => (type === 'TXT' ? cleanTxt(a.data) : String(a.data)));
                return { nx: j.Status === 3, ad: !!j.AD, answers };
            } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error('DNS lookup failed');
    }
    return q;
}

// ---------- SPF ----------
const SPF_INCLUDE_FOR = [
    ['Google Workspace', 'include:_spf.google.com'],
    ['Microsoft 365', 'include:spf.protection.outlook.com'],
    ['Zoho Mail', 'include:zoho.com'],
    ['Fastmail', 'include:spf.messagingengine.com'],
    ['Proton Mail', 'include:_spf.protonmail.ch'],
];
function suggestedSpf(provider) {
    const inc = SPF_INCLUDE_FOR.find(([p]) => p === provider)?.[1];
    return inc ? `v=spf1 ${inc} ~all` : 'v=spf1 include:<your-email-provider> ~all';
}

async function countSpfLookups(record, dns, depth = 0, state = { fetches: 0, problems: [] }) {
    let count = 0;
    const terms = record.split(/\s+/).slice(1);
    for (const raw of terms) {
        const t = raw.replace(/^[+\-~?]/, '').toLowerCase();
        let target = null;
        if (/^include:/.test(t)) { count++; target = t.slice(8); }
        else if (/^redirect=/.test(t)) { count++; target = t.slice(9); }
        else if (/^(a|mx)([:/]|$)/.test(t) || /^ptr([:]|$)/.test(t) || /^exists:/.test(t)) count++;
        if (target) {
            if (target.includes('%{')) continue; // macro: can't expand statically
            if (depth >= 8 || state.fetches >= 25) continue;
            state.fetches++;
            try {
                const r = await dns(target, 'TXT');
                const sub = r.answers.filter((x) => /^v=spf1(\s|$)/i.test(x));
                if (sub.length !== 1) { state.problems.push(`${target} has ${sub.length ? 'multiple SPF records' : 'no SPF record'}`); continue; }
                count += (await countSpfLookups(sub[0], dns, depth + 1, state)).count;
            } catch { state.problems.push(`couldn't look up ${target}`); }
        }
    }
    return { count, problems: state.problems };
}

async function checkSpf(domain, dns, ctx) {
    const base = { id: 'spf', group: 'email', title: 'SPF record', source: 'DNS (Google Public DNS / Cloudflare DoH)' };
    const r = await dns(domain, 'TXT');
    const recs = r.answers.filter((x) => /^v=spf1(\s|$)/i.test(x));
    const noMail = ctx.mx.kind !== 'present';
    if (recs.length === 0 && noMail && ctx.dmarcEnforced) {
        return { ...base, status: 'warn', points: 0.5, summary: 'No SPF record, but this name does not receive email and DMARC enforcement already blocks spoofing.',
            details: 'Publishing "v=spf1 -all" makes it explicit that no server may send as this name, which some filters check directly.',
            fix: `Add a TXT record at ${domain}:`, record: 'v=spf1 -all' };
    }
    if (recs.length === 0) {
        return { ...base, status: 'fail', points: 0, summary: 'No SPF record found.',
            details: 'Without SPF, receivers cannot tell which servers may send email for this domain, and anyone can spoof it more easily. Gmail and Yahoo require SPF or DKIM for all senders.',
            fix: noMail ? 'This domain does not seem to send email. Publish a TXT record at the root (@) that says no server may send for it:' : `Add one TXT record at the root (@) of ${domain}. List every service that sends email as you:`,
            record: noMail ? 'v=spf1 -all' : suggestedSpf(ctx.mx.provider) };
    }
    if (recs.length > 1) {
        return { ...base, status: 'fail', points: 0, summary: `${recs.length} SPF records found. Only one is allowed.`,
            details: 'With more than one SPF record, receivers return a "permerror" and treat SPF as broken. Records found: ' + recs.join(' | '),
            fix: 'Merge them into a single TXT record that starts with v=spf1 and ends with one ~all or -all.', value: recs.join('\n') };
    }
    const rec = recs[0];
    let terms = rec.split(/\s+/);
    let allTerm = terms.find((t) => /^[+\-~?]?all$/i.test(t));
    const redirect = terms.find((t) => /^redirect=/i.test(t));
    if (!allTerm && redirect) {
        try {
            const rr = await dns(redirect.slice(9), 'TXT');
            const sub = rr.answers.find((x) => /^v=spf1(\s|$)/i.test(x));
            allTerm = sub?.split(/\s+/).find((t) => /^[+\-~?]?all$/i.test(t));
        } catch { /* ignore */ }
    }
    const q = allTerm ? (/^[+\-~?]/.test(allTerm) ? allTerm[0] : '+') : null;
    const { count, problems } = await countSpfLookups(rec, dns);
    const out = { ...base, value: rec };
    const lookupNote = `Uses ${plural(count, 'DNS lookup')} (limit is 10).`;
    if (q === '+') return { ...out, status: 'fail', points: 0, summary: 'SPF ends in +all, which lets any server on the internet send as you.', details: lookupNote, fix: 'Change "+all" to "~all" (or "-all" once you are sure every sender is listed).' };
    if (count > 10) return { ...out, status: 'fail', points: 0, summary: `SPF needs ${count} DNS lookups. The limit is 10, so SPF fails for every message.`, details: 'Receivers stop after 10 lookups and return "permerror". Every include:, a, mx, ptr, exists and redirect counts, including the ones nested inside includes.', fix: 'Remove services you no longer use, or replace nested includes with the ip4:/ip6: ranges they cover (SPF "flattening").' };
    if (problems.length) return { ...out, status: 'warn', points: 0.5, summary: 'SPF exists, but part of it is broken.', details: `${lookupNote} Problems: ${problems.join('; ')}.`, fix: 'Fix or remove the include that points to a domain without a single valid SPF record.' };
    if (q === '?' || q === null) return { ...out, status: 'warn', points: 0.5, summary: q ? 'SPF ends in ?all (neutral), so it gives receivers no instruction.' : 'SPF has no "all" rule, so mail from unlisted servers is treated as neutral.', details: lookupNote, fix: 'End the record with "~all" (soft fail) or "-all" (hard fail).' };
    return { ...out, status: 'pass', points: 1, summary: `Valid SPF record ending in ${allTerm}.`, details: lookupNote + (q === '~' ? ' ~all (soft fail) is the common, safe choice when DMARC is enforced.' : '') };
}

// ---------- DMARC ----------
function parseTags(rec) {
    const tags = {};
    for (const part of rec.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    return tags;
}
async function checkDmarc(domain, org, dns) {
    const base = { id: 'dmarc', group: 'email', title: 'DMARC policy', source: 'DNS' };
    let at = `_dmarc.${domain}`;
    let r = await dns(at, 'TXT');
    let recs = r.answers.filter((x) => /^v=DMARC1\s*(;|$)/i.test(x));
    let inherited = false;
    if (recs.length === 0 && org !== domain) {
        at = `_dmarc.${org}`;
        r = await dns(at, 'TXT');
        recs = r.answers.filter((x) => /^v=DMARC1\s*(;|$)/i.test(x));
        inherited = recs.length > 0;
    }
    const rua = `mailto:dmarc-reports@${org}`;
    if (recs.length === 0) {
        return { ...base, status: 'fail', points: 0, summary: 'No DMARC record found.',
            details: 'DMARC tells receivers what to do with mail that fails SPF/DKIM, and sends you reports. Gmail and Yahoo require it for bulk senders, and without it your domain is easy to spoof in phishing emails.',
            fix: `Add a TXT record at _dmarc.${org}. Start with monitoring (p=none), read the reports for 2 to 4 weeks, then move to p=quarantine and finally p=reject. Replace the rua address with a mailbox you actually read (or a free DMARC report service):`,
            record: `v=DMARC1; p=none; rua=${rua}` };
    }
    if (recs.length > 1) return { ...base, status: 'fail', points: 0, summary: 'More than one DMARC record found, so receivers ignore DMARC.', value: recs.join('\n'), fix: `Keep exactly one TXT record at ${at}.` };
    const rec = recs[0];
    const tags = parseTags(rec);
    const p = (inherited ? (tags.sp || tags.p) : tags.p || '').toLowerCase();
    const pct = tags.pct === undefined ? 100 : Number(tags.pct);
    const notes = [];
    if (inherited) notes.push(`Inherited from ${org}${tags.sp ? ' (sp= tag)' : ''}.`);
    if (!tags.rua) notes.push('No rua= reporting address, so you get no reports about who sends as you.');
    if (pct < 100) notes.push(`pct=${pct}: the policy applies to only ${pct}% of failing mail.`);
    const out = { ...base, value: rec, details: notes.join(' ') };
    const pctFactor = pct < 100 ? 0.7 : 1;
    if (p === 'reject') return { ...out, status: pct < 100 ? 'warn' : 'pass', points: (tags.rua ? 1 : 0.9) * pctFactor, summary: 'DMARC is enforced with p=reject, the strongest protection.', fix: pct < 100 ? 'Remove pct= (or set pct=100) so the policy covers all mail.' : (!tags.rua ? `Add rua=${rua} to receive aggregate reports.` : undefined) };
    if (p === 'quarantine') return { ...out, status: pct < 100 ? 'warn' : 'pass', points: (tags.rua ? 0.85 : 0.75) * pctFactor, summary: 'DMARC is enforced with p=quarantine (failing mail goes to spam).', fix: 'When reports show all your real mail passes, move to p=reject for full protection.' };
    if (p === 'none') return { ...out, status: 'warn', points: tags.rua ? 0.4 : 0.3, summary: 'DMARC is in monitor-only mode (p=none). Spoofed mail is still delivered.',
        fix: tags.rua ? 'Review your DMARC reports. Once every legitimate sender passes SPF or DKIM, change p=none to p=quarantine, then p=reject.' : `Add a reporting address, review the reports, then move to p=quarantine and p=reject:`,
        record: tags.rua ? undefined : `v=DMARC1; p=none; rua=${rua}` };
    return { ...out, status: 'fail', points: 0, summary: `DMARC record has an invalid policy ("p=${tags.p ?? ''}"), so receivers ignore it.`, fix: 'Set p= to none, quarantine or reject.' };
}

// ---------- DKIM ----------
export const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 'default', 'mail', 's1', 's2', 'dkim', 'smtp', 'mx',
    'zmail', 'zoho', 'fm1', 'fm2', 'fm3', 'protonmail', 'protonmail2', 'protonmail3', 'pm', 'mandrill', 'mxvault', 'everlytickey1',
    'cm', 'mailjet', 'sig1', 'key1', 'key2', 'dkim1', 'scph0920', 'smtpapi', 'hs1', 'hs2', 'turbo-smtp', 'sm', 'sendgrid', 'ses', 'mailo'];
async function checkDkim(domain, dns, ctx = {}) {
    const extra = (ctx.extraSelectors || []).filter((x) => /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(x)).map((x) => x.toLowerCase());
    const selectors = [...new Set([...extra, ...DKIM_SELECTORS])];
    const base = { id: 'dkim', group: 'email', title: 'DKIM signing keys', source: `DNS probe of ${selectors.length} selectors${extra.length ? ` (including yours: ${extra.join(', ')})` : ''}` };
    const found = []; const revoked = []; let errors = 0;
    await Promise.all(selectors.map(async (sel) => {
        try {
            const r = await dns(`${sel}._domainkey.${domain}`, 'TXT');
            const rec = r.answers.join('');
            if (!rec) return;
            if (!/(^|;)\s*p=/i.test(rec) || !(/v=DKIM1/i.test(rec) || /k=(rsa|ed25519)/i.test(rec) || /p=[A-Za-z0-9+/]{40}/.test(rec))) return;
            const pv = (rec.match(/(?:^|;)\s*p=([^;]*)/i) || [])[1]?.replace(/\s/g, '') || '';
            if (pv.length === 0) revoked.push(sel); else found.push(sel);
        } catch { errors++; }
    }));
    found.sort(); revoked.sort();
    let wildcard = false; let wildcardRevoked = false;
    if (found.length || revoked.length) {
        try {
            const w = (await dns(`sg-probe-${Math.random().toString(36).slice(2, 8)}._domainkey.${domain}`, 'TXT')).answers.join('');
            wildcard = /p=[A-Za-z0-9+/]{40}/.test(w);
            wildcardRevoked = /(^|;)\s*p=\s*(;|$)/i.test(w);
        } catch { /* ignore */ }
    }
    if (extra.length && !extra.some((x) => found.includes(x))) {
        const missing = extra.filter((x) => !found.includes(x));
        if (!found.length) return { ...base, status: 'fail', points: 0, summary: `No active DKIM key at your selector${missing.length > 1 ? 's' : ''} ${missing.join(', ')}${revoked.some((r) => missing.includes(r)) ? ' (the key is revoked: empty p=)' : ''}.`, details: `We looked up ${missing.map((x) => `${x}._domainkey.${domain}`).join(', ')}. Mail signed with this selector will fail DKIM. Check the spelling against the "s=" value in a sent email's DKIM-Signature header.`, fix: 'Publish the DKIM record your email provider gives you for this selector (usually a TXT or CNAME record at <selector>._domainkey).' };
        return { ...base, status: 'pass', points: 1, summary: `No key at your selector ${missing.join(', ')}, but DKIM keys exist at: ${found.join(', ')}.`, details: 'Make sure your mail is signed with one of the selectors that has a key.' };
    }
    if (!found.length && wildcardRevoked) {
        if (ctx.noMail) return { ...base, status: 'pass', points: 1, summary: 'All DKIM keys are explicitly revoked (wildcard record), which is correct for a domain that does not send email.' };
        return { ...base, status: 'skip', points: null, summary: 'A wildcard record revokes every DKIM selector we tried.', details: 'Your real selector may still have its own key, so this is inconclusive and left out of your score. Check the "s=" value in the DKIM-Signature header of an email you sent.' };
    }
    if (found.length) return { ...base, status: 'pass', points: 1, summary: wildcard ? 'A DKIM key is published for every selector name (wildcard record).' : `DKIM key found (selector${found.length > 1 ? 's' : ''}: ${found.join(', ')}).`, details: wildcard ? 'A wildcard DKIM record answers any selector, so we cannot tell which selectors you actually sign with. Make sure your mail is signed with the matching private key.' : 'Receivers can verify mail signed with these keys. You may use other selectors too; we only probe common names.' };
    if (errors > selectors.length / 2) return { ...base, status: 'skip', points: null, summary: 'Not checked: DNS lookups for DKIM failed.', details: 'Try again in a minute.' };
    return { ...base, status: 'skip', points: null,
        summary: revoked.length ? `Only revoked DKIM keys found (${revoked.join(', ')}). No active key at common selectors.` : `No DKIM key at ${selectors.length} common selectors (inconclusive).`,
        details: 'DKIM keys live at a selector name chosen by your email provider, and some providers (for example Amazon SES or Salesforce) use random names that cannot be guessed. So "not found" does not prove DKIM is missing, and this check is left out of your score. To confirm, open the headers of an email you sent and look for "DKIM-Signature: ... s=<selector>".',
        fix: 'Turn on DKIM signing in your email provider (Google Workspace: Admin console > Apps > Gmail > Authenticate email; Microsoft 365: Defender portal > Email authentication > DKIM) and publish the DNS record it gives you.' };
}

// ---------- MX ----------
function detectProvider(mxHosts) {
    for (const sig of SIGNATURES) if (sig.mx && sig.mx.some((re) => mxHosts.some((h) => re.test(h)))) return sig.name;
    return null;
}
async function getMx(domain, dns) {
    const r = await dns(domain, 'MX');
    const recs = r.answers.map((a) => a.trim().split(/\s+/)).map(([p, h]) => ({ pref: Number(p), host: String(h || '').replace(/\.$/, '').toLowerCase() }))
        .sort((a, b) => a.pref - b.pref);
    if (recs.length === 1 && recs[0].host === '') return { kind: 'null', hosts: [] };
    if (!recs.length) return { kind: 'none', hosts: [] };
    const hosts = recs.map((x) => x.host);
    return { kind: 'present', hosts, provider: detectProvider(hosts) };
}
function checkMx(mx) {
    const base = { id: 'mx', group: 'email', title: 'Mail servers (MX)', source: 'DNS' };
    if (mx.kind === 'null') return { ...base, status: 'pass', points: 1, summary: 'Null MX: the domain clearly states it does not accept email (RFC 7505).' };
    if (mx.kind === 'none') return { ...base, status: 'warn', points: 0.5, summary: 'No MX records, so this domain cannot receive email.',
        details: 'Senders may fall back to the website\'s address and wait for days before bouncing.',
        fix: 'If you use email on this domain, add the MX records from your provider. If you never use email here, publish a "null MX" record:', record: '0 .' };
    return { ...base, status: 'pass', points: 1, summary: `${plural(mx.hosts.length, 'mail server')} found${mx.provider ? `, hosted by ${mx.provider}` : ''}.`, value: mx.hosts.slice(0, 5).join('\n') };
}

// ---------- Email provider (not scored) ----------
const SENDER_CATS = new Set(['Email provider', 'Transactional email', 'Email marketing', 'Email security', 'Marketing automation', 'CRM', 'Customer support']);
async function checkProvider(domain, mx, dns) {
    const txt = (await dns(domain, 'TXT').catch(() => ({ answers: [] }))).answers;
    const spf = txt.filter((x) => /^v=spf1(\s|$)/i.test(x));
    const inbound = mx.kind === 'present' ? (mx.provider || null) : null;
    const { tech } = detectStack({ txt: spf });
    const senders = tech.filter((t) => SENDER_CATS.has(t.category) && t.name !== inbound).map((t) => t.name);
    const gateway = mx.kind === 'present' && inbound && SIGNATURES.find((x) => x.name === inbound)?.cat === 'Email security';
    let summary;
    if (mx.kind === 'null') summary = 'This domain does not receive email (null MX).';
    else if (mx.kind === 'none') summary = 'No mail servers: this domain does not receive email.';
    else if (inbound) summary = gateway ? `Incoming mail is filtered by ${inbound} (a security gateway); the mailbox provider behind it is not visible in DNS.` : `Email is hosted by ${inbound}.`;
    else summary = `Email is handled by its own or a less common server (${mx.hosts[0]}).`;
    return { id: 'provider', group: 'email', title: 'Email provider', status: 'info', points: null, source: 'MX and SPF records',
        summary: summary + (senders.length ? ` Also authorized to send: ${senders.join(', ')}.` : ''),
        details: 'Not scored. "Authorized to send" comes from the services listed in the SPF record, so it shows who may send as this domain, not who actually does.' };
}

// ---------- extra email info (not scored) ----------
async function checkEmailExtras(domain, dns) {
    const [sts, rpt, bimi] = await Promise.all([
        dns(`_mta-sts.${domain}`, 'TXT').catch(() => null),
        dns(`_smtp._tls.${domain}`, 'TXT').catch(() => null),
        dns(`default._bimi.${domain}`, 'TXT').catch(() => null),
    ]);
    const has = (r, re) => !!r?.answers.some((x) => re.test(x));
    const items = [
        ['MTA-STS', has(sts, /^v=STSv1/i)], ['TLS-RPT', has(rpt, /^v=TLSRPTv1/i)], ['BIMI logo', has(bimi, /^v=BIMI1/i)],
    ];
    const on = items.filter((i) => i[1]).map((i) => i[0]);
    return { id: 'email-extras', group: 'email', title: 'Advanced email security (bonus)', status: 'info', points: null, source: 'DNS',
        summary: on.length ? `Enabled: ${on.join(', ')}.` : 'None of MTA-STS, TLS-RPT or BIMI are set up.',
        details: 'Not scored. MTA-STS and TLS-RPT force and monitor encrypted delivery of mail sent to you. BIMI shows your logo in Gmail and Apple Mail (needs DMARC enforcement).' };
}

// ---------- Website security via Mozilla HTTP Observatory ----------
const OBS = 'https://observatory-api.mdn.mozilla.net/api/v2';
const OBS_ERRORS = {
    'invalid-hostname-lookup': 'the domain does not resolve to a web server',
    'site-down': 'the site did not respond',
    'invalid-hostname': 'the scanner rejected the hostname',
    'scanner-error': 'the scanner hit an error',
};
async function observatoryScan(host) {
    const res = await fetchT(`${OBS}/scan?host=${encodeURIComponent(host)}`, { method: 'POST' }, 30000);
    const j = await res.json().catch(() => ({}));
    if (!res.ok && !j.error) throw new Error(`scanner HTTP ${res.status}`);
    return j;
}
const OBS_CACHE_MS = 60 * 60 * 1000;
const store = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })();
export async function runObservatory(domain, { fresh = false } = {}) {
    const key = `sg-obs:${domain}`;
    if (store && !fresh) {
        try { const c = JSON.parse(store.getItem(key) || 'null'); if (c && Date.now() - c.at < OBS_CACHE_MS) return { ...c.data, cached: true }; } catch { /* ignore */ }
    }
    const data = await runObservatoryLive(domain);
    if (store && !data.error && data.tests && Object.keys(data.tests).length) {
        try { store.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* quota */ }
    }
    return data;
}
async function runObservatoryLive(domain) {
    let host = domain;
    let scan;
    try {
        scan = await observatoryScan(host);
        if (scan.error && !domain.startsWith('www.')) {
            const alt = await observatoryScan(`www.${domain}`).catch(() => null);
            if (alt && !alt.error) { scan = alt; host = `www.${domain}`; }
        }
    } catch (e) {
        return { error: `the security scanner could not be reached (${e.name === 'AbortError' ? 'timed out' : e.message})` };
    }
    if (scan.error) return { error: OBS_ERRORS[scan.error] || stripHtml(scan.message || scan.error) };
    let detail;
    try {
        const r = await fetchT(`${OBS}/analyze?host=${encodeURIComponent(host)}`, {}, 100000);
        detail = await r.json();
    } catch (e) { return { error: e.name === 'AbortError' ? `Mozilla's scanner took too long to return details (its grade for this site was ${scan.grade})` : 'the security scanner results could not be loaded', scan, detailsUrl: scan.details_url }; }
    return { host, scan, tests: detail.tests || {}, headers: detail.scan?.response_headers || {}, statusCode: scan.status_code, detailsUrl: scan.details_url };
}

const WEB_FIX = {
    https: { title: 'HTTPS & redirect', fix: 'Redirect every http:// request to https:// on the same hostname first (http://example.com → https://example.com → https://www.example.com). Most hosts (Cloudflare, Netlify, Vercel, cPanel) have an "Always use HTTPS" switch.' },
    hsts: { title: 'HSTS (Strict-Transport-Security)', fix: 'Send this response header on HTTPS pages (start with a shorter max-age if unsure):', record: 'Strict-Transport-Security: max-age=31536000; includeSubDomains' },
    csp: { title: 'Content-Security-Policy', fix: 'Add a Content-Security-Policy header. Start in report-only mode to avoid breaking the site, then enforce. A minimal starting point:', record: "Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
    xfo: { title: 'Clickjacking protection', fix: 'Stop other sites from framing your pages:', record: "Content-Security-Policy: frame-ancestors 'self'   (or X-Frame-Options: SAMEORIGIN)" },
    xcto: { title: 'X-Content-Type-Options', fix: 'Add this header so browsers do not guess file types:', record: 'X-Content-Type-Options: nosniff' },
    referrer: { title: 'Referrer-Policy', fix: 'Limit what your URLs leak to other sites:', record: 'Referrer-Policy: strict-origin-when-cross-origin' },
    cookies: { title: 'Cookie security', fix: 'Set the Secure flag on every cookie, plus HttpOnly and SameSite=Lax (or Strict) on session cookies.' },
};
const OBS_TEST = { https: 'redirection', hsts: 'strict-transport-security', csp: 'content-security-policy', xfo: 'x-frame-options', xcto: 'x-content-type-options', referrer: 'referrer-policy', cookies: 'cookies' };

export function webChecks(obs) {
    const ids = Object.keys(OBS_TEST);
    const source = 'Mozilla HTTP Observatory (public scan)';
    if (obs.error || obs.statusCode >= 400 || !obs.tests || !Object.keys(obs.tests).length) {
        const reason = obs.error ? `Not checked: ${obs.error}.` : obs.statusCode >= 400
            ? `Not checked: the site answered the scanner with HTTP ${obs.statusCode}, so it probably blocks automated checks. These headers may differ from what visitors see.`
            : 'Not checked: the scanner returned no results.';
        return ids.map((id) => ({ id, group: 'web', title: WEB_FIX[id].title, status: 'skip', points: null, summary: reason, source }));
    }
    return ids.map((id) => {
        const t = obs.tests[OBS_TEST[id]];
        const base = { id, group: 'web', title: WEB_FIX[id].title, source, details: stripHtml(t?.score_description) };
        if (!t) return { ...base, status: 'skip', points: null, summary: 'Not checked: the scanner did not run this test.' };
        const result = String(t.result || '');
        if (id === 'cookies' && /cookies-not-found/.test(result)) return { ...base, status: 'pass', points: 1, summary: 'No cookies set on the homepage.' };
        let status;
        if (t.pass === true) status = 'pass';
        else if (id === 'csp' && /^csp-implemented|csp-not-implemented-but-reporting-enabled/.test(result)) status = 'warn';
        else if (id === 'hsts' && /hsts-implemented-max-age-less-than-six-months/.test(result)) status = 'warn';
        else if (id === 'https' && /redirection-off-host-from-http|redirection-not-needed/.test(result)) status = 'warn';
        else if ((t.score_modifier ?? -100) > -10) status = 'warn';
        else status = 'fail';
        const points = status === 'pass' ? 1 : status === 'warn' ? 0.5 : 0;
        const out = { ...base, status, points, summary: base.details || result, details: undefined };
        if (status !== 'pass') { out.fix = WEB_FIX[id].fix; if (WEB_FIX[id].record) out.record = WEB_FIX[id].record; }
        return out;
    });
}

// ---------- RDAP (domain age / expiry) ----------
const RDAP_SUPPLEMENTAL = {
    io: 'https://rdap.identitydigital.services/rdap/', sh: 'https://rdap.identitydigital.services/rdap/', ac: 'https://rdap.identitydigital.services/rdap/',
    me: 'https://rdap.identitydigital.services/rdap/', co: 'https://rdap.registry.co/co/', us: 'https://rdap.nic.us/', so: 'https://rdap.nic.so/',
};
let bootstrapP = null;
async function rdapBase(tld) {
    if (!bootstrapP) {
        bootstrapP = (async () => {
            const res = await fetchT('https://data.iana.org/rdap/dns.json', {}, 10000);
            const j = await res.json();
            const m = new Map();
            for (const [tlds, urls] of j.services) for (const t of tlds) m.set(t.toLowerCase(), (urls.find((u) => u.startsWith('https:')) || urls[0]).replace(/\/?$/, '/'));
            return m;
        })().catch((e) => { bootstrapP = null; throw e; });
    }
    const m = await bootstrapP;
    return m.get(tld) || RDAP_SUPPLEMENTAL[tld] || null;
}
export async function rdapLookup(org) {
    const tld = org.split('.').pop();
    let base;
    try { base = await rdapBase(tld); } catch { return { error: 'the IANA registry directory could not be loaded' }; }
    if (!base) return { unsupported: true, error: `the .${tld} registry does not publish RDAP (modern WHOIS) data` };
    if (base.startsWith('http:')) return { unsupported: true, error: `the .${tld} registry only offers insecure (http) RDAP, which browsers block` };
    let res;
    try { res = await fetchT(`${base}domain/${encodeURIComponent(org)}`, { headers: { accept: 'application/rdap+json' } }, 10000); }
    catch (e) { return { error: `the .${tld} registry's RDAP server ${e.name === 'AbortError' ? 'timed out' : 'blocked the request from the browser (CORS) or is unreachable'}` }; }
    if (!res.ok) res.body?.cancel?.().catch?.(() => {}); // free the connection (Workers limits open connections)
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { error: `the .${tld} registry returned HTTP ${res.status}` };
    const d = await res.json();
    const ev = (a) => (d.events || []).find((e) => String(e.eventAction).toLowerCase() === a)?.eventDate || null;
    const registrar = (d.entities || []).find((e) => e.roles?.includes('registrar'));
    const fn = registrar?.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3] || null;
    return { created: ev('registration'), expires: ev('expiration') || ev('registrar expiration'), status: (d.status || []).map((s) => String(s).toLowerCase()), registrar: fn, dnssec: d.secureDNS?.delegationSigned ?? null, url: res.url };
}
function domainChecks(rd, org) {
    const source = 'Registry RDAP';
    const tld = org.split('.').pop();
    if (rd.error) {
        const s = `Not checked: ${rd.error}.`;
        return [
            { id: 'expiry', group: 'domain', title: 'Domain expiry', status: 'skip', points: null, summary: s, source },
            { id: 'lock', group: 'domain', title: 'Registrar transfer lock', status: 'skip', points: null, summary: s, source },
            { id: 'age', group: 'domain', title: 'Domain age', status: 'info', points: null, summary: s, source },
        ];
    }
    const now = Date.now();
    const out = [];
    // expiry
    if (!rd.expires) out.push({ id: 'expiry', group: 'domain', title: 'Domain expiry', status: 'skip', points: null, summary: `Not checked: the .${tld} registry does not publish expiry dates.`, source });
    else {
        const days = Math.floor((new Date(rd.expires).getTime() - now) / 86400000);
        const when = new Date(rd.expires).toISOString().slice(0, 10);
        const bad = rd.status.some((s) => /redemption|pending delete/.test(s));
        if (days < 0 || bad) out.push({ id: 'expiry', group: 'domain', title: 'Domain expiry', status: 'fail', points: 0, summary: `The domain ${days < 0 ? `expired on ${when}` : 'is in its redemption/deletion period'}.`, fix: 'Renew it with your registrar immediately, before someone else can register it.', source });
        else if (days <= 30) out.push({ id: 'expiry', group: 'domain', title: 'Domain expiry', status: 'warn', points: 0.5, summary: `Expires in ${plural(days, 'day')} (${when}).`, details: 'If auto-renew is on and your card is valid, this is fine.', fix: 'Check that auto-renew is on at your registrar, or renew for several years.', source });
        else out.push({ id: 'expiry', group: 'domain', title: 'Domain expiry', status: 'pass', points: 1, summary: `Expires ${when} (in ${plural(days, 'day')}).`, details: rd.registrar ? `Registrar: ${rd.registrar}.` : undefined, source });
    }
    // lock
    const locked = rd.status.some((s) => /transfer prohibited/.test(s));
    if (locked) out.push({ id: 'lock', group: 'domain', title: 'Registrar transfer lock', status: 'pass', points: 1, summary: 'Transfer lock is on, which blocks unauthorized transfers to another registrar.', source });
    else if (tld.length > 2) out.push({ id: 'lock', group: 'domain', title: 'Registrar transfer lock', status: 'warn', points: 0.3, summary: 'No transfer lock (clientTransferProhibited) is set.', details: 'Without the lock, a hijacked registrar account or a social-engineering attack can move your domain away.', fix: 'Turn on "Domain lock" / "Transfer lock" in your registrar dashboard. It is free.', source });
    else out.push({ id: 'lock', group: 'domain', title: 'Registrar transfer lock', status: 'skip', points: null, summary: `Not checked: the .${tld} registry does not publish transfer-lock status in a consistent way.`, source });
    // age (info)
    if (rd.created) {
        const days = Math.floor((now - new Date(rd.created).getTime()) / 86400000);
        const yrs = days / 365.25;
        out.push({ id: 'age', group: 'domain', title: 'Domain age', status: 'info', points: null, source,
            summary: `Registered ${new Date(rd.created).toISOString().slice(0, 10)} (${yrs >= 1 ? `${yrs.toFixed(1)} years` : plural(days, 'day')} ago).`,
            details: days < 90 ? 'Not scored. New domains often have weaker email reputation: warm up sending volume slowly.' : 'Not scored. Older domains tend to have more established email reputation.' });
    } else out.push({ id: 'age', group: 'domain', title: 'Domain age', status: 'info', points: null, summary: `The .${tld} registry does not publish the registration date.`, source });
    return out;
}

// ---------- Tech stack from headers + DNS (no HTML: that needs a server) ----------
function cookieNames(setCookie) {
    if (!setCookie) return [];
    return String(setCookie).split(/,(?=\s*[^;,=\s]+=)/).map((c) => c.split('=')[0].trim()).filter(Boolean);
}
export function detectStack({ headers = {}, mxHosts = [], txt = [], ns = [] }) {
    const h = {};
    for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
    const cookies = cookieNames(h['set-cookie']);
    const found = new Map();
    const add = (sig, by, text) => {
        const cur = found.get(sig.name) || { name: sig.name, category: sig.cat, version: null, by: new Set() };
        cur.by.add(by);
        if (!cur.version && sig.v && text) { const m = String(text).match(sig.v); if (m?.[1]) cur.version = m[1]; }
        found.set(sig.name, cur);
    };
    for (const sig of SIGNATURES) {
        if (sig.h) for (const [k, re] of Object.entries(sig.h)) if (h[k] !== undefined && re.test(h[k])) add(sig, 'header', h[k]);
        if (sig.c) for (const re of sig.c) if (cookies.some((c) => re.test(c))) add(sig, 'cookie');
        if (sig.mx) for (const re of sig.mx) if (mxHosts.some((r) => re.test(r))) add(sig, 'MX');
        if (sig.txt) for (const re of sig.txt) if (txt.some((r) => re.test(r))) add(sig, 'TXT');
        if (sig.ns) for (const re of sig.ns) if (ns.some((r) => re.test(r))) add(sig, 'NS');
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
    const leaks = [];
    if (/\d/.test(h['x-powered-by'] || '')) leaks.push(`X-Powered-By: ${h['x-powered-by']}`);
    if (/\/\d/.test(h.server || '')) leaks.push(`Server: ${h.server}`);
    return { tech: [...found.values()].map((t) => ({ ...t, by: [...t.by] })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)), leaks };
}

// ---------- Hiring signal (public ATS job boards; not scored) ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// only: optional provider name to limit the lookups (used by the monitoring API to save requests and CPU).
export async function hiringSignal(org, { only = null } = {}) {
    const label = org.split('.')[0];
    const slug = label;
    const onDomain = (u) => { try { const h = new URL(u).hostname; return h === org || h.endsWith(`.${org}`); } catch { return false; } };
    // Boards on Lever/Ashby are keyed by a free-form name, so require the postings to mention the domain (confirmed) or the name as a word (likely).
    const mentions = (text) => {
        const t = String(text).toLowerCase();
        if (t.includes(org)) return 'confirmed';
        return label.length >= 4 && new RegExp(`\\b${label.replace(/[^a-z0-9]/g, '')}\\b`).test(t) ? 'likely' : null;
    };
    const getJson = async (u) => { const r = await fetchT(u, {}, 8000); if (!r.ok) { r.body?.cancel?.().catch?.(() => {}); return null; } return r.json(); };
    const providers = [
        async () => {
            const [b, j] = await Promise.all([getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}`), getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)]);
            if (!b || !j) return null;
            const jobs = j.jobs || [];
            const conf = jobs.some((x) => onDomain(x.absolute_url)) ? 'confirmed' : norm(b.name) === norm(label) ? 'likely' : null;
            return conf && { provider: 'Greenhouse', name: b.name, count: jobs.length, url: `https://job-boards.greenhouse.io/${slug}`, confidence: conf };
        },
        async () => {
            const j = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
            if (!Array.isArray(j) || !j.length) return null;
            const text = j.slice(0, 20).map((x) => `${x.descriptionPlain || ''} ${x.additionalPlain || ''}`).join(' ');
            const conf = mentions(text) || (j.some((x) => onDomain(x.applyUrl)) ? 'confirmed' : null);
            return conf && { provider: 'Lever', count: j.length, url: `https://jobs.lever.co/${slug}`, confidence: conf };
        },
        async () => {
            const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
            if (!j?.jobs?.length) return null;
            const conf = mentions(j.jobs.slice(0, 20).map((x) => x.descriptionPlain || '').join(' '));
            return conf && { provider: 'Ashby', count: j.jobs.length, url: `https://jobs.ashbyhq.com/${slug}`, confidence: conf };
        },
        async () => {
            const j = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
            if (!j?.jobs?.length) return null;
            const conf = norm(j.name) === norm(label) ? 'likely' : null;
            return conf && { provider: 'Workable', name: j.name, count: j.jobs.length, url: `https://apply.workable.com/${slug}/`, confidence: conf };
        },
    ];
    const NAMES = ['Greenhouse', 'Lever', 'Ashby', 'Workable'];
    const use = only ? providers.filter((_, i) => NAMES[i] === only) : providers;
    const results = (await Promise.all(use.map((p) => p().catch(() => null)))).filter(Boolean);
    const rank = { confirmed: 0, likely: 1, possible: 2 };
    results.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.count - a.count);
    return results;
}

// ---------- orchestrator ----------
// api: optional StackGrade API base URL. When set, the homepage HTML is fingerprinted server-side (CMS, analytics, ...).
export async function fetchFingerprint(api, domain) {
    try {
        const r = await fetchT(`${api.replace(/\/$/, '')}/v1/fingerprint?domain=${encodeURIComponent(domain)}`, {}, 15000);
        if (r.status === 429) return { ok: false, error: 'the page scanner is busy (rate limit); try again in a minute' };
        const j = await r.json();
        return j && typeof j === 'object' ? j : { ok: false, error: 'unexpected scanner response' };
    } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'the page scanner timed out' : 'the page scanner could not be reached' }; }
}
export async function grade(input, { onUpdate = () => {}, fresh = false, dkimSelectors = [], api = null } = {}) {
    const parsed = parseInput(input);
    if (parsed.error) return { error: parsed.error };
    const domain = parsed.domain;
    const org = registrable(domain);
    const dns = makeDns();
    const report = { domain, display: toUnicode(domain), org, startedAt: new Date().toISOString(), checks: [], version: VERSION };

    // Existence first: NXDOMAIN means there is nothing to grade.
    let soa;
    try { soa = await dns(domain, 'NS'); } catch { return { error: 'DNS lookups failed from your browser. Check your connection (or a blocker extension) and try again.' }; }
    if (soa.nx) {
        const rd = await rdapLookup(org).catch(() => ({}));
        return { domain, display: toUnicode(domain), org, nonexistent: true, registered: rd.notFound ? false : rd.created ? true : null };
    }

    const push = (c) => { report.checks.push(...[].concat(c)); onUpdate(report); };
    const safe = (id, group, title) => (e) => ({ id, group, title, status: 'skip', points: null, summary: `Not checked: ${e?.message || 'lookup failed'}.` });

    const mxP = getMx(domain, dns).catch(() => null);
    const emailP = (async () => {
        const mx = await mxP;
        if (!mx) { push(['spf', 'dmarc', 'dkim', 'mx'].map((id) => safe(id, 'email', id.toUpperCase())(new Error('DNS lookup failed')))); return; }
        const ctx = { mx };
        push(checkMx(mx));
        checkProvider(domain, mx, dns).then(push).catch(() => {});
        await Promise.all([
            checkDmarc(domain, org, dns).catch(safe('dmarc', 'email', 'DMARC policy')).then((d) => {
                push(d);
                ctx.dmarcEnforced = d.status !== 'skip' && /p=(reject|quarantine)/i.test(d.summary || '');
                return checkSpf(domain, dns, ctx).catch(safe('spf', 'email', 'SPF record')).then(push);
            }),
            checkDkim(domain, dns, { noMail: mx.kind !== 'present', extraSelectors: dkimSelectors }).catch(safe('dkim', 'email', 'DKIM signing keys')).then(push),
            checkEmailExtras(domain, dns).then(push).catch(() => {}),
        ]);
    })();
    const obsP = runObservatory(domain, { fresh }).catch((e) => ({ error: e.message }));
    const webP = obsP.then((obs) => { report.observatory = obs.detailsUrl ? { url: obs.detailsUrl, grade: obs.scan?.grade, host: obs.host, statusCode: obs.statusCode } : null; push(webChecks(obs)); });
    const rdapP = rdapLookup(org).catch((e) => ({ error: e.message })).then((rd) => { report.rdap = rd; push(domainChecks(rd, org)); });
    const fpP = api ? fetchFingerprint(api, domain) : Promise.resolve(null);
    const stackP = (async () => {
        const [obs, mx, txt, ns, fp] = await Promise.all([obsP, mxP, dns(org, 'TXT').catch(() => ({ answers: [] })), dns(org, 'NS').catch(() => ({ answers: [] })), fpP]);
        const base = detectStack({ headers: obs?.headers || {}, mxHosts: mx?.hosts || [], txt: txt.answers, ns: ns.answers.map((n) => n.replace(/\.$/, '').toLowerCase()) });
        const tech = [...base.tech]; const leaks = [...base.leaks];
        if (fp?.ok) {
            for (const t of fp.tech || []) {
                const cur = tech.find((x) => x.name === t.name);
                if (cur) { cur.by = [...new Set([...cur.by, ...t.by.map((b) => (b.startsWith('implied') ? b : `page ${b}`))])]; cur.version ||= t.version; }
                else tech.push({ name: t.name, category: t.category, version: t.version || null, by: t.by.map((b) => (b.startsWith('implied') ? b : `page ${b}`)) });
            }
            for (const l of fp.leaks || []) if (!leaks.includes(l) && !/^(Server|X-Powered-By):/.test(l)) leaks.push(l);
            tech.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        }
        report.tech = tech;
        const headerOk = obs && !obs.error && obs.headers && Object.keys(obs.headers).length;
        const srcs = ['DNS records', headerOk ? 'homepage response headers' : null, fp?.ok ? 'homepage HTML (StackGrade API)' : null].filter(Boolean);
        const fpNote = !api ? ' Page fingerprinting (CMS, analytics and scripts from the homepage HTML) was not run.'
            : fp?.ok ? ' CMS, analytics and scripts come from the homepage HTML, fetched by the StackGrade API (only tags are read; nothing is stored).'
                : ` Page fingerprinting not checked: ${fp?.error || 'unknown error'}.`;
        push({ id: 'stack', group: 'signals', title: 'Tech stack', status: 'info', points: null, tech, leaks,
            source: srcs.join(' + '),
            summary: tech.length ? `${plural(tech.length, 'technology')} detected.` : 'No technologies detected.',
            details: `Not scored.${fpNote}${headerOk ? '' : ' Response headers were unavailable for this site.'}` });
        if (leaks.length) push({ id: 'version-leak', group: 'signals', title: 'Software version disclosure', status: 'info', points: null, source: 'Homepage response headers and HTML', summary: `Your site reveals software versions: ${leaks.join('; ')}.`, details: 'Not scored. Version numbers help attackers find known vulnerabilities.', fix: 'Remove or blank the X-Powered-By header, hide version numbers in the Server header, and remove the version from the generator meta tag (most CMSs have a setting or plugin for this).' });
    })().catch(() => {});
    const hiringP = hiringSignal(org).then((jobs) => {
        report.hiring = jobs;
        const top = jobs[0];
        push({ id: 'hiring', group: 'signals', title: 'Hiring signal', status: 'info', points: null, jobs, source: 'Public job boards (Greenhouse, Lever, Ashby, Workable)',
            summary: top ? `${top.confidence === 'confirmed' ? 'Hiring' : top.confidence === 'likely' ? 'Likely hiring' : 'Possibly hiring'}: ${plural(top.count, 'open role')} on ${top.provider}${top.name ? ` (${top.name})` : ''}.` : 'No public job board found under this company name.',
            details: top ? `Not scored. ${top.confidence === 'confirmed' ? 'Job links point to this domain.' : top.confidence === 'likely' ? 'Matched by company name; verify the link.' : 'Matched by board name only, so it could be a different company with the same name. Verify the link.'}` : 'Not scored. We only check Greenhouse, Lever, Ashby and Workable boards named after the domain, so other careers pages are not detected.' });
    }).catch(() => {});

    await Promise.all([emailP, webP, rdapP, stackP, hiringP]);
    report.finishedAt = new Date().toISOString();
    Object.assign(report, score(report.checks));
    onUpdate(report);
    return report;
}

export function score(checks) {
    let got = 0; let possible = 0; let skipped = 0;
    const groups = {};
    for (const c of checks) {
        const w = WEIGHTS[c.id];
        if (!w) continue;
        const g = (groups[c.group] ||= { got: 0, possible: 0, skipped: 0 });
        if (c.status === 'skip' || c.points == null) { skipped += w; g.skipped += w; continue; }
        got += w * c.points; possible += w;
        g.got += w * c.points; g.possible += w;
    }
    for (const g of Object.values(groups)) g.score = g.possible ? Math.round((100 * g.got) / g.possible) : null;
    const total = possible ? Math.round((100 * got) / possible) : null;
    return { score: total, letter: total == null ? null : letter(total), coverage: possible, skippedWeight: skipped, groups };
}
