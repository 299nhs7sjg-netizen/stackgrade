// One monitoring snapshot of a domain, and the diff between two snapshots.
import { makeDns, registrable, runObservatory, webChecks, rdapLookup, hiringSignal } from '../../assets/checks.js';
import { fingerprint } from './fingerprint.js';

export const MONITOR_DKIM = ['google', 'selector1', 'selector2', 'k1', 's1', 'default'];
function hiringPlan(prev, domain, now) {
    if (!prev || !('hiring' in prev) || prev.hiring) return 'check';
    let h = 0; for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return Math.floor(now / 86400000) % 7 === h % 7 ? 'check' : 'skip';
}
const safe = (p) => p.then((v) => v, (e) => ({ __error: e?.message || 'failed' }));
const failed = (v) => v && typeof v === 'object' && '__error' in v;

// prev: the previous snapshot (optional). To save subrequests and CPU, the hiring signal re-checks only the job board
// found last time, and domains without a board are re-scanned on all four boards once a week.
export async function takeSnapshot(domain, prev = null, now = Date.now()) {
    const org = registrable(domain);
    const dns = makeDns();
    const [txt, dmarcR, mxR, dkimR, obs, fp, rd, jobs] = await Promise.all([
        safe(dns(domain, 'TXT')),
        safe(dns(`_dmarc.${domain}`, 'TXT')),
        safe(dns(domain, 'MX')),
        Promise.all(MONITOR_DKIM.map((s) => safe(dns(`${s}._domainkey.${domain}`, 'TXT')).then((r) => (failed(r) ? null : (r.answers.some((a) => /(?:^|;)\s*p=[A-Za-z0-9+/]/.test(a)) ? s : ''))))),
        safe(runObservatory(domain, { fresh: true })),
        safe(fingerprint(domain)),
        safe(rdapLookup(org)),
        hiringPlan(prev, domain, now) === 'skip' ? Promise.resolve({ __skip: true }) : safe(hiringSignal(org, { only: prev?.hiring?.provider || null })),
    ]);
    const s = { v: 1, at: now, errors: [] };
    if (failed(txt)) s.errors.push('spf'); else s.spf = txt.answers.filter((a) => /^v=spf1/i.test(a)).sort().join(' || ') || null;
    if (failed(dmarcR)) s.errors.push('dmarc'); else {
        const rec = dmarcR.answers.filter((a) => /^v=DMARC1/i.test(a));
        s.dmarc = rec.length ? rec.join(' || ') : null;
        s.dmarcPolicy = rec.length === 1 ? ((rec[0].match(/(?:^|;)\s*p\s*=\s*(\w+)/i) || [])[1] || 'invalid').toLowerCase() : rec.length ? 'multiple' : 'missing';
    }
    if (failed(mxR)) s.errors.push('mx'); else s.mx = mxR.answers.map((a) => a.split(/\s+/).pop().replace(/\.$/, '').toLowerCase()).sort();
    if (dkimR.some((x) => x === null)) s.errors.push('dkim'); else s.dkim = dkimR.filter(Boolean);
    if (failed(obs) || obs.error || !obs.tests || obs.statusCode >= 400) s.errors.push('web');
    else {
        const checks = webChecks(obs);
        s.web = { grade: obs.scan?.grade || null, score: obs.scan?.score ?? null, tests: Object.fromEntries(checks.map((c) => [c.id, c.status])) };
    }
    if (failed(fp) || !fp.ok) s.errors.push('tech'); else s.tech = [...new Set(fp.tech.filter((t) => !t.by.every((b) => b.startsWith('implied'))).map((t) => t.name))].sort();
    if (failed(rd) || rd.error || rd.notFound) s.errors.push('domain'); else {
        s.expires = rd.expires ? String(rd.expires).slice(0, 10) : null;
        s.lock = rd.status?.length ? rd.status.some((x) => /transferprohibited/.test(x.replace(/\s/g, ''))) : null;
    }
    if (jobs?.__skip) s.skipped = ['hiring'];
    else if (failed(jobs)) s.errors.push('hiring'); else s.hiring = jobs.length ? { provider: jobs[0].provider, count: jobs[0].count, url: jobs[0].url } : null;
    return s;
}

// Fill fields that failed this time with the previous values (a failed lookup is "unknown", never a change).
export function mergeSnapshot(prev, cur) {
    if (!prev) return cur;
    const out = { ...cur };
    const carry = { spf: ['spf'], dmarc: ['dmarc', 'dmarcPolicy'], mx: ['mx'], dkim: ['dkim'], web: ['web'], tech: ['tech'], domain: ['expires', 'lock'], hiring: ['hiring'] };
    for (const e of [...(cur.errors || []), ...(cur.skipped || [])]) for (const k of carry[e] || []) if (k in prev) out[k] = prev[k];
    delete out.skipped;
    return out;
}

const DMARC_RANK = { reject: 3, quarantine: 2, none: 1, missing: 0, invalid: 0, multiple: 0 };
const ST_RANK = { pass: 3, warn: 2, fail: 1, skip: 0 };
const TEST_NAME = { https: 'HTTPS redirect', hsts: 'HSTS', csp: 'Content-Security-Policy', xfo: 'Clickjacking protection', xcto: 'X-Content-Type-Options', referrer: 'Referrer-Policy', cookies: 'Cookie security' };
const arr = (x) => (Array.isArray(x) ? x : []);

export function diffSnapshots(prev, cur, now = Date.now()) {
    if (!prev) return [];
    const ev = [];
    const add = (type, severity, title, from, to) => ev.push({ type, severity, title, from: from ?? null, to: to ?? null });
    const has = (k) => k in prev && k in cur;
    if (has('spf') && prev.spf !== cur.spf) add('spf', !cur.spf ? 'high' : !prev.spf ? 'info' : 'medium', !cur.spf ? 'SPF record removed' : !prev.spf ? 'SPF record added' : 'SPF record changed', prev.spf, cur.spf);
    if (has('dmarcPolicy') && prev.dmarcPolicy !== cur.dmarcPolicy) {
        const down = DMARC_RANK[cur.dmarcPolicy] < DMARC_RANK[prev.dmarcPolicy];
        add('dmarc', down ? 'high' : 'info', down ? `DMARC policy weakened (${prev.dmarcPolicy} → ${cur.dmarcPolicy})` : `DMARC policy changed (${prev.dmarcPolicy} → ${cur.dmarcPolicy})`, prev.dmarc, cur.dmarc);
    } else if (has('dmarc') && prev.dmarc !== cur.dmarc) add('dmarc', 'low', 'DMARC record changed', prev.dmarc, cur.dmarc);
    if (has('mx') && arr(prev.mx).join(',') !== arr(cur.mx).join(',')) add('mx', 'medium', 'Mail servers (MX) changed', arr(prev.mx).join(', '), arr(cur.mx).join(', '));
    if (has('dkim')) {
        const lost = arr(prev.dkim).filter((x) => !arr(cur.dkim).includes(x)); const gained = arr(cur.dkim).filter((x) => !arr(prev.dkim).includes(x));
        if (lost.length) add('dkim', 'medium', `DKIM key no longer found (${lost.join(', ')})`, arr(prev.dkim).join(', '), arr(cur.dkim).join(', '));
        if (gained.length) add('dkim', 'info', `New DKIM key found (${gained.join(', ')})`, arr(prev.dkim).join(', '), arr(cur.dkim).join(', '));
    }
    if (has('web') && prev.web && cur.web) {
        if (prev.web.grade !== cur.web.grade) {
            const down = (cur.web.score ?? 0) < (prev.web.score ?? 0);
            add('web-grade', down ? 'medium' : 'info', `Mozilla Observatory grade ${down ? 'dropped' : 'changed'} (${prev.web.grade} → ${cur.web.grade})`, prev.web.grade, cur.web.grade);
        }
        for (const [id, st] of Object.entries(cur.web.tests || {})) {
            const was = prev.web.tests?.[id];
            if (!was || was === st || st === 'skip' || was === 'skip') continue;
            const worse = ST_RANK[st] < ST_RANK[was];
            add('header', worse ? 'medium' : 'info', `${TEST_NAME[id] || id}: ${was} → ${st}`, was, st);
        }
    }
    if (has('tech')) {
        const gone = arr(prev.tech).filter((x) => !arr(cur.tech).includes(x)); const added = arr(cur.tech).filter((x) => !arr(prev.tech).includes(x));
        if (added.length) add('tech', 'info', `New technology detected: ${added.join(', ')}`, null, added.join(', '));
        if (gone.length) add('tech', 'info', `Technology no longer detected: ${gone.join(', ')}`, gone.join(', '), null);
    }
    if (has('expires') && prev.expires !== cur.expires) add('expiry', cur.expires > prev.expires ? 'info' : 'medium', cur.expires > prev.expires ? `Domain renewed (expires ${cur.expires})` : `Domain expiry changed (${prev.expires} → ${cur.expires})`, prev.expires, cur.expires);
    const soon = (d, t) => !!d && (Date.parse(d) - t) / 86400000 <= 30;
    if ('expires' in cur && prev.expires === cur.expires && soon(cur.expires, now) && !soon(prev.expires, prev.at ?? now)) add('expiry', 'high', `Domain expires within 30 days (${cur.expires})`, null, cur.expires);
    if (has('lock') && prev.lock !== cur.lock && prev.lock !== null && cur.lock !== null) add('lock', cur.lock ? 'info' : 'high', cur.lock ? 'Registrar transfer lock turned on' : 'Registrar transfer lock turned off', String(prev.lock), String(cur.lock));
    if (has('hiring')) {
        const a = prev.hiring; const b = cur.hiring;
        if (!a && b) add('hiring', 'info', `Now hiring: ${b.count} open roles on ${b.provider}`, null, String(b.count));
        else if (a && !b) add('hiring', 'info', 'Job board no longer found', String(a.count), null);
        else if (a && b && Math.abs(b.count - a.count) >= Math.max(3, Math.round(a.count * 0.3))) add('hiring', 'info', `Open roles ${b.count > a.count ? 'up' : 'down'}: ${a.count} → ${b.count} (${b.provider})`, String(a.count), String(b.count));
    }
    return ev;
}
// Stable comparison of the stored fields (ignores the check timestamp).
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
export function sameSnapshot(a, b) {
    if (!a || !b) return false;
    const strip = ({ at, ...rest }) => rest;
    return canon(strip(a)) === canon(strip(b));
}
