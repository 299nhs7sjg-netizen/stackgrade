// StackGrade API: Cloudflare Worker (Workers Free plan) + one KV namespace. No secrets in this file.
// Secrets (wrangler secret put): ADMIN_KEY, INTERNAL_KEY, PING_SECRET.  Vars (wrangler.toml): PRODUCT_* Gumroad product ids.
import { AsyncLocalStorage } from 'node:async_hooks';
import { TIERS, verifyLicense, normalizeKey } from '../../assets/tiers.js';
import { parseInput } from '../../assets/checks.js';
import { json, err, cors, sha256hex, randomId, hashInt, readJson, HttpError, rateLimit, clientIp, csvCell, EMAIL_RE } from './util.js';
import { checkUrl, safeFetch } from './ssrf.js';
import { fingerprint } from './fingerprint.js';
import { takeSnapshot, mergeSnapshot, diffSnapshots, sameSnapshot } from './snapshot.js';

export const VERSION = '1.0.0';
const DAY = 86400000;
const MAX_FANOUT = 45;          // Workers Free: 50 subrequests per invocation; keep 5 spare
const CHECK_BUDGET = 48;        // subrequests one monitor check may use
const SUBSLOTS = 12;            // cron runs every 5 minutes -> 12 runs per hour
const LEADS_MAX = 5000;
const LEADS_PER_DAY = 200;

// ---- subrequest accounting (per invocation, via AsyncLocalStorage) ----
const als = new AsyncLocalStorage();
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
    const st = als.getStore();
    if (st) { st.n++; if (st.n > st.max) return Promise.reject(new Error('subrequest budget exhausted')); }
    return realFetch(input, init);
};
const withBudget = (max, fn) => { const st = { n: 0, max }; return als.run(st, async () => ({ result: await fn(), subrequests: st.n })); };

// ---- KV helpers ----
// KV layout. Monitor schedule entries are one key each (due:<hour>:<subslot>:<monitorId>, details in key metadata), so
// concurrent writes never overwrite each other and a cron run needs a single list() call. Each monitor's snapshot record
// is written only by that monitor's own check, and holds its recent change events (the alert feed is built from them).
const K = { acct: (id) => `acct:${id}`, due: (h, s, m) => `due:${h}:${s}:${m}`, snap: (m) => `snap:${m}`, leads: (a) => `leads:${a}` };
const EVENTS_PER_MONITOR = 25;
const getJ = (env, k) => env.KV.get(k, 'json');
const putJ = (env, k, v, opt) => env.KV.put(k, JSON.stringify(v), opt);

export function products(env) {
    return { agencykit: env.PRODUCT_AGENCY_KIT || '', pro: env.PRODUCT_PRO || '', agency: env.PRODUCT_AGENCY || '', agencyplus: env.PRODUCT_AGENCY_PLUS || '' };
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const fpCache = new Map();
const negCache = new Map(); // per-isolate cache of rejected keys (10 min), so junk keys do not hammer Gumroad

// Resolve a license key to an account, verifying with Gumroad at most once per 24 h (cached in the account's KV doc).
export const licenseAccountId = async (key) => `L${(await sha256hex(`lic:${normalizeKey(key)}`)).slice(0, 32)}`;
export async function licenseAccount(env, key, { now = Date.now(), fetchImpl } = {}) {
    key = normalizeKey(key);
    const id = await licenseAccountId(key);
    const neg = negCache.get(id);
    if (neg && now - neg.at < 600000) return { ok: false, status: 403, error: neg.reason };
    let acct = await getJ(env, K.acct(id));
    const lic = acct?.lic;
    if (lic?.ok && now - lic.checkedAt < DAY && !(lic.lockAt && now >= lic.lockAt)) return { ok: true, acct, cached: true };
    const r = await verifyLicense(key, products(env), { fetchImpl, now });
    if (r.ok) {
        acct = { id, kind: 'license', monitors: [], webhook: null, created: now, ...(acct || {}), tier: r.tier, lic: { ok: true, checkedAt: now, lastOkAt: now, lockAt: r.lockAt || null, recurrence: r.recurrence || null, note: r.reason || null } };
        await putJ(env, K.acct(id), acct);
        return { ok: true, acct, cached: false };
    }
    if (!r.definitive && lic?.ok && now - (lic.lastOkAt || 0) < 7 * DAY) return { ok: true, acct, grace: true };
    if (acct && acct.lic?.ok !== false) { acct.lic = { ok: false, checkedAt: now, reason: r.reason, lastOkAt: lic?.lastOkAt || null }; await putJ(env, K.acct(id), acct); }
    if (r.definitive) negCache.set(id, { at: now, reason: r.reason });
    if (negCache.size > 2000) negCache.clear();
    return { ok: false, status: r.definitive ? 403 : 503, error: r.reason };
}

async function account(req, env) {
    const t = bearer(req);
    if (!t) throw new HttpError(401, 'Send your license key or free monitor token as "Authorization: Bearer <key>".');
    if (/^sgf_[0-9a-f]{32}$/.test(t)) {
        const id = `F${(await sha256hex(t)).slice(0, 32)}`;
        return (await getJ(env, K.acct(id))) || { id, kind: 'free', tier: 'free', monitors: [], webhook: null, created: Date.now(), _new: true };
    }
    if (/^sgt_[0-9a-f]{32}$/.test(t)) {
        const a = await getJ(env, K.acct(`T${(await sha256hex(t)).slice(0, 32)}`));
        if (!a) throw new HttpError(401, 'Unknown test token.');
        return a;
    }
    if (!rateLimit(`lic:${clientIp(req)}`, 30, 60000)) throw new HttpError(429, 'Too many license checks. Wait a minute.');
    const r = await licenseAccount(env, t);
    if (!r.ok) throw new HttpError(r.status, r.error);
    return r.acct;
}
const limits = (tier) => ({ tier, plan: TIERS[tier].name, monitors: TIERS[tier].monitors, frequency: TIERS[tier].freq, whiteLabel: TIERS[tier].whiteLabel, leads: TIERS[tier].leads, webhooks: TIERS[tier].webhooks });
const pausedReason = (acct, now = Date.now()) => {
    if (acct.kind !== 'license') return null;
    if (!acct.lic?.ok) return `license not active: ${acct.lic?.reason || 'unknown'}`;
    if (acct.lic.lockAt && now >= acct.lic.lockAt) return 'membership period ended';
    if (now - acct.lic.checkedAt > 7 * DAY) return 'license not re-verified for 7 days; open the dashboard to resume';
    return null;
};

function normDomain(raw) {
    const p = parseInput(String(raw || '').slice(0, 300));
    if (p.error) throw new HttpError(400, p.error);
    const c = checkUrl(`https://${p.domain}/`);
    if (c.error) throw new HttpError(400, `Cannot monitor this domain: ${c.error}.`);
    return p.domain;
}

// ---- monitors ----
async function addToSlots(env, items) {
    for (const { m, a, d, f, h, s, w } of items) await env.KV.put(K.due(h, s, m), '', { metadata: { a, d, f, w } });
}
const removeFromSlot = (env, mon) => env.KV.delete(K.due(mon.h, mon.s, mon.id));

// Free-plan anti-abuse works per network: IPv4 /24, IPv6 /48 (rotating egress IPs share a prefix).
export function netPrefix(ip) {
    if (ip.includes(':')) { const parts = ip.split('::')[0].split(':'); return `${parts.slice(0, 3).join(':')}::/48`; }
    return ip.split('.').slice(0, 3).join('.') + '.0/24';
}
async function createMonitors(req, env, ctx, acct) {
    const body = await readJson(req);
    const list = [...new Set((Array.isArray(body.domains) ? body.domains : [body.domain]).filter(Boolean).slice(0, 100).map(normDomain))];
    if (!list.length) throw new HttpError(400, 'Send {"domain":"example.com"} or {"domains":[...]}.');
    const reason = pausedReason(acct); if (reason) throw new HttpError(403, `Monitoring is paused: ${reason}.`);
    const tier = TIERS[acct.tier];
    const existing = new Set(acct.monitors.map((m) => m.d));
    const fresh = list.filter((d) => !existing.has(d));
    if (acct.monitors.length + fresh.length > tier.monitors) throw new HttpError(403, `The ${tier.name} plan allows ${tier.monitors} monitored domain${tier.monitors === 1 ? '' : 's'}. Remove one or upgrade.`, { limit: tier.monitors });
    for (const d of fresh) if (await env.KV.get(`suppress:d:${d}`)) throw new HttpError(403, `${d} cannot be monitored (the domain owner asked us to stop).`);
    if (acct.kind === 'free' && fresh.length) {
        const ipKey = `freeip:${(await sha256hex(`ip:${env.INTERNAL_KEY || ''}:${netPrefix(clientIp(req))}`)).slice(0, 32)}`; // salted hash, kept 7 days
        // KV is eventually consistent (~60 s), so also block rapid repeats within this isolate.
        if (!rateLimit(`free:${ipKey}`, 1, 600000) || await env.KV.get(ipKey)) throw new HttpError(429, 'One free monitor per network per week. Try again later or use a paid plan.');
        await env.KV.put(ipKey, '1', { expirationTtl: 7 * 86400 });
    }
    const now = Date.now();
    const added = fresh.map((d) => { const id = randomId(6); const hv = hashInt(id); return { id, d, f: tier.freq === 'daily' ? 'd' : 'w', h: hv % 24, s: hashInt(`${id}s`) % SUBSLOTS, w: hashInt(`${id}w`) % 7, c: now }; });
    if (added.length) {
        await addToSlots(env, added.map((m) => ({ m: m.id, a: acct.id, d: m.d, f: m.f, h: m.h, s: m.s, w: m.w })));
        const { _new, ...doc } = acct;
        doc.monitors = [...acct.monitors, ...added];
        await putJ(env, K.acct(acct.id), doc);
        if (env.SELF && env.INTERNAL_KEY) for (const m of added.slice(0, 5)) ctx.waitUntil(dispatchCheck(env, { m: m.id, a: acct.id, d: m.d }).catch(() => {}));
    }
    return { added: added.map(pubMonitor), skipped: list.filter((d) => existing.has(d)) };
}
const pubMonitor = (m) => ({ id: m.id, domain: m.d, frequency: m.f === 'd' ? 'daily' : 'weekly', createdAt: new Date(m.c).toISOString(), checkHourUtc: m.h, checkMinuteUtc: m.s * 5, ...(m.f === 'w' ? { checkWeekdayUtc: m.w } : {}) });

function dispatchCheck(env, body) { // body: { m, a, d, f }
    return env.SELF.fetch('https://internal/internal/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': env.INTERNAL_KEY }, body: JSON.stringify(body) }).then((r) => r.json());
}

// Run one monitor check (own invocation, so it gets its own subrequest budget and CPU time).
export async function runCheck(env, { m, a, d }, { now = Date.now() } = {}) {
    const acct = await getJ(env, K.acct(a));
    if (!acct) return { ok: false, skipped: 'account not found' };
    // The schedule key is the source of truth; the account doc may lag behind a just-created monitor (KV is eventually consistent).
    const mon = acct.monitors?.find((x) => x.id === m) || (d ? { id: m, d } : null);
    if (!mon) return { ok: false, skipped: 'monitor not found' };
    const paused = pausedReason(acct, now);
    if (paused) return { ok: false, skipped: `paused: ${paused}` };
    if (await env.KV.get(`suppress:d:${mon.d}`)) return { ok: false, skipped: 'domain owner opted out' };
    const rec = await getJ(env, K.snap(m));
    const { result: raw, subrequests } = await withBudget(CHECK_BUDGET, () => takeSnapshot(mon.d, rec?.snap || null, now));
    const merged = mergeSnapshot(rec?.snap, raw);
    const events = diffSnapshots(rec?.snap, merged, now);
    const changed = !rec || !sameSnapshot(rec.snap, merged) || events.length > 0;
    const heartbeat = rec && now - (rec.writtenAt || 0) > 6 * DAY;
    let webhook = null;
    const stamped = events.map((e) => ({ id: randomId(5), at: now, m, d: mon.d, ...e }));
    if (changed || heartbeat) await putJ(env, K.snap(m), { d: mon.d, snap: merged, firstAt: rec?.firstAt || now, writtenAt: now, changedAt: changed ? now : rec?.changedAt || now, events: [...stamped, ...(rec?.events || [])].slice(0, EVENTS_PER_MONITOR) });
    if (stamped.length && acct.webhook?.url) webhook = await sendWebhook(acct.webhook, mon.d, stamped);
    return { ok: true, domain: mon.d, first: !rec, changed, events: events.length, errors: raw.errors, subrequests, webhook };
}

export function webhookPayload(format, domain, events) {
    const lines = events.map((e) => `• [${e.severity}] ${e.title}`).join('\n');
    const text = `StackGrade: ${events.length} change${events.length === 1 ? '' : 's'} on ${domain}\n${lines}`;
    if (format === 'slack') return { text };
    if (format === 'discord') return { content: text.slice(0, 1900) };
    return { type: 'stackgrade.changes', domain, events, text };
}
async function sendWebhook(hook, domain, events) {
    const r = await safeFetch(hook.url, { method: 'POST', body: JSON.stringify(webhookPayload(hook.format, domain, events)), headers: { 'content-type': 'application/json' }, timeoutMs: 6000, maxRedirects: 0 });
    return r.ok ? { status: r.status } : { error: r.error };
}

// Cron: every 5 minutes. Monitors are spread over 24 hourly slots x 12 sub-slots (weekly ones also by weekday).
export async function runSlot(env, date, { limit = MAX_FANOUT } = {}) {
    const h = date.getUTCHours(); const sub = Math.floor(date.getUTCMinutes() / 5); const wd = date.getUTCDay();
    const page = await env.KV.list({ prefix: `due:${h}:${sub}:`, limit: 1000 });
    const slot = page.keys.map((k) => ({ m: k.name.split(':')[3], ...(k.metadata || {}) }));
    const due = slot.filter((x) => x.a && (x.f === 'd' || x.w === wd));
    const run = due.slice(0, limit);
    const results = await Promise.allSettled(run.map((x) => dispatchCheck(env, { m: x.m, a: x.a, d: x.d })));
    const summary = { cron: date.toISOString(), slot: h, sub, inSlot: slot.length, due: due.length, dispatched: run.length, overflow: due.length - run.length,
        ok: results.filter((r) => r.status === 'fulfilled' && r.value?.ok).length, changed: results.filter((r) => r.value?.changed).length,
        maxSubrequests: Math.max(0, ...results.map((r) => r.value?.subrequests || 0)) };
    console.log(JSON.stringify(summary));
    return { summary, results: results.map((r) => r.value || { error: String(r.reason) }) };
}

// ---- leads ----
async function postLead(req, env) {
    const ip = clientIp(req);
    if (!rateLimit(`lead:${ip}`, 5, 600000)) throw new HttpError(429, 'Too many submissions. Try again later.');
    const b = await readJson(req, 4096);
    if (b.website || (Number(b.elapsedMs) > 0 && Number(b.elapsedMs) < 2500)) return { ok: true }; // honeypot / too fast: accept silently, store nothing
    const name = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    let domain = null; try { domain = b.domain ? normDomain(b.domain) : null; } catch { domain = null; }
    const key = String(b.license || '').trim();
    if (!key) throw new HttpError(400, 'Missing license.');
    const r = await licenseAccount(env, key);
    if (!r.ok) throw new HttpError(403, 'This widget is not licensed for lead capture.');
    if (!TIERS[r.acct.tier].leads) throw new HttpError(403, `The ${TIERS[r.acct.tier].name} plan does not include lead capture.`);
    if (await env.KV.get(`suppress:e:${(await sha256hex(email)).slice(0, 32)}`)) return { ok: true }; // opted out: do not store
    const docKey = K.leads(r.acct.id);
    const doc = (await getJ(env, docKey)) || { leads: [], days: {} };
    const today = new Date().toISOString().slice(0, 10);
    doc.days = { [today]: (doc.days?.[today] || 0) + 1 };
    if (doc.days[today] > LEADS_PER_DAY) throw new HttpError(429, 'This widget has reached its daily lead limit.');
    if (doc.leads.length >= LEADS_MAX) throw new HttpError(507, 'The agency\'s lead inbox is full.');
    doc.leads.unshift({ at: new Date().toISOString(), name, email, domain, grade: /^[A-F]$/.test(b.grade) ? b.grade : null, score: Number.isFinite(+b.score) ? Math.max(0, Math.min(100, Math.round(+b.score))) : null, consent: !!b.consent });
    await putJ(env, docKey, doc);
    return { ok: true };
}
const LEAD_COLS = ['at', 'name', 'email', 'domain', 'grade', 'score', 'consent'];

// ---- removal requests ----
async function postRemoval(req, env, ctx) {
    if (!rateLimit(`rm:${clientIp(req)}`, 5, 3600000)) throw new HttpError(429, 'Too many requests. Try again later.');
    const b = await readJson(req, 4096);
    if (b.website) return { ok: true };
    const kind = b.kind === 'domain' ? 'domain' : 'email';
    let value = String(b.value || '').trim().toLowerCase().slice(0, 200);
    if (kind === 'email' && !EMAIL_RE.test(value)) throw new HttpError(400, 'Enter a valid email address.');
    if (kind === 'domain') value = normDomain(value);
    const id = `${Date.now()}-${randomId(4)}`;
    await putJ(env, `rm:${id}`, { id, kind, value, note: String(b.note || '').slice(0, 500), at: new Date().toISOString() });
    if (kind === 'email') {
        await env.KV.put(`suppress:e:${(await sha256hex(value)).slice(0, 32)}`, '1');
        ctx.waitUntil(purgeLeadEmail(env, value).catch(() => {}));
    } else await env.KV.put(`suppress:d:${value}`, '1');
    return { ok: true, id, kind, message: kind === 'email' ? 'Done. This email address has been removed from all lead lists and will not be stored again.' : `Done. ${value} will no longer be monitored by StackGrade.` };
}
async function purgeLeadEmail(env, email) {
    let cursor; let removed = 0;
    do {
        const page = await env.KV.list({ prefix: 'leads:', cursor, limit: 1000 });
        for (const k of page.keys) {
            const doc = await getJ(env, k.name);
            const n = doc?.leads?.length || 0;
            if (!n) continue;
            doc.leads = doc.leads.filter((l) => l.email !== email);
            if (doc.leads.length !== n) { removed += n - doc.leads.length; await putJ(env, k.name, doc); }
        }
        cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return removed;
}

// ---- support requests ----
async function postSupport(req, env) {
    if (!rateLimit(`support:${clientIp(req)}`, 3, 3600000)) throw new HttpError(429, 'Too many messages. Try again in an hour, or contact the seller through Gumroad.');
    const b = await readJson(req, 8192);
    if (b.website || (Number.isFinite(+b.elapsedMs) && +b.elapsedMs < 2500)) return { ok: true, message: 'Thanks, we got your message.' }; // bots: pretend success
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    const message = String(b.message || '').trim().slice(0, 2000);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address so we can reply.');
    if (message.length < 5) throw new HttpError(400, 'Please describe the problem in a few words.');
    const last4 = String(b.keyLast4 || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() || null;
    const at = new Date().toISOString();
    const id = `${at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomId(4)}`;
    const rec = { id, at, email, message, keyLast4: last4, page: String(b.page || '').slice(0, 40), reason: String(b.reason || '').slice(0, 300) };
    await env.KV.put(`support:${id}`, JSON.stringify(rec), { metadata: { at, email: maskEmail(email), page: rec.page }, expirationTtl: 180 * 86400 });
    return { ok: true, id, message: 'Thanks, we got your message and will reply by email.' };
}
export const maskEmail = (e) => { const m = String(e || '').toLowerCase().match(/^(.)[^@]*@(.+)$/); return m ? `${m[1]}***@${m[2]}` : null; };
async function listRecords(env, prefix, url) {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const l = await env.KV.list({ prefix, limit: 1000 });
    const keys = l.keys.sort((a, b) => String(b.metadata?.at || '').localeCompare(String(a.metadata?.at || ''))).slice(0, limit);
    const items = await Promise.all(keys.map((k) => getJ(env, k.name)));
    return { ok: true, count: l.keys.length, items: items.filter(Boolean) };
}
async function safeEqual(a, b) {
    const [x, y] = await Promise.all([sha256hex(`cmp:${a}`), sha256hex(`cmp:${b}`)]);
    let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0;
}

// ---- Gumroad Ping (https://gumroad.com/ping) ----
// Form-encoded, unsigned, at-least-once, unordered; dedupe on sale_id + resource_name. The ping is only a trigger: the
// license is re-checked against Gumroad's licenses/verify API, and that result is what gets recorded.
const BOOL = (v) => (v === undefined || v === null || v === '' ? null : v === true || v === 'true' || v === '1');
export function parsePing(raw, contentType = '') {
    let f = {};
    if (/json/i.test(contentType)) { try { f = JSON.parse(raw) || {}; } catch { f = {}; } } else f = Object.fromEntries(new URLSearchParams(raw));
    const g = (k) => (f[k] === undefined || f[k] === null ? null : String(f[k]).slice(0, 300));
    return {
        resource: g('resource_name') || 'sale',
        saleId: g('sale_id'), saleTimestamp: g('sale_timestamp'), orderNumber: g('order_number'),
        sellerId: g('seller_id'), productId: g('product_id'), productPermalink: g('product_permalink'), shortProductId: g('short_product_id'), productName: g('product_name'),
        email: maskEmail(f.email || f.user_email || f.purchase_email), price: g('price'), currency: g('currency'), recurrence: g('recurrence'),
        subscriptionId: g('subscription_id'), isRecurringCharge: BOOL(f.is_recurring_charge), test: BOOL(f.test), refunded: BOOL(f.refunded), disputed: BOOL(f.disputed), disputeWon: BOOL(f.dispute_won),
        cancelled: BOOL(f.cancelled), cancelledAt: g('cancelled_at'), endedAt: g('ended_at'), endedReason: g('ended_reason'), retryCount: g('retry_count'),
        licenseKey: f.license_key ? normalizeKey(f.license_key) : null,
    };
}
export async function handlePing(env, raw, contentType, { fetchImpl, now = Date.now() } = {}) {
    const s = parsePing(raw, contentType);
    const prods = products(env);
    const tierForProduct = Object.entries(prods).find(([, id]) => id && id === s.productId)?.[0] || null;
    let verify = null;
    if (!s.licenseKey) verify = { checked: false, reason: 'no license_key in ping' };
    else if (!tierForProduct) verify = { checked: false, reason: 'product_id is not a StackGrade product' };
    else {
        const r = await verifyLicense(s.licenseKey, { [tierForProduct]: s.productId }, { fetchImpl, now });
        verify = { checked: true, at: new Date(now).toISOString(), unlocks: !!r.ok, tier: r.ok ? r.tier : null, plan: r.ok ? TIERS[r.tier].name : null,
            whiteLabel: r.ok ? TIERS[r.tier].whiteLabel : false, result: r.ok ? 'valid' : r.notFound ? 'not found' : r.definitive ? 'inactive' : 'temporary error',
            reason: r.reason || null, lockAt: r.lockAt ? new Date(r.lockAt).toISOString() : null, test: r.test || false };
        // Refund / dispute / cancellation pings: make the account re-check Gumroad on its next request or cron check.
        if (s.resource !== 'sale' || !r.ok) {
            const id = await licenseAccountId(s.licenseKey); const acct = await getJ(env, K.acct(id));
            if (acct?.lic) { acct.lic.checkedAt = 0; await putJ(env, K.acct(id), acct); verify.accountRecheck = true; }
        }
    }
    const rid = `${s.saleId || s.subscriptionId || `nosale-${randomId(4)}`}:${s.resource}`.replace(/[^A-Za-z0-9=_:+-]/g, '_').slice(0, 200);
    const { licenseKey, ...rest } = s;
    const rec = { id: rid, at: new Date(now).toISOString(), ...rest, keyLast4: licenseKey ? licenseKey.slice(-4) : null, tierForProduct, verify };
    await env.KV.put(`sale:${rid}`, JSON.stringify(rec), { metadata: { at: rec.at, resource: s.resource, tier: verify?.tier || null, unlocks: verify?.unlocks ?? null } });
    console.log(JSON.stringify({ ping: s.resource, product: tierForProduct, verify: verify.result || verify.reason, test: s.test }));
    return rec;
}

// ---- router ----
async function route(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const M = req.method;
    if (M === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (p === '/' || p === '/v1/health') return json(req, { ok: true, service: 'stackgrade-api', version: VERSION, plans: Object.fromEntries(Object.entries(products(env)).map(([t, id]) => [t, !!id])), docs: 'https://299nhs7sjg-netizen.github.io/stackgrade/faq/' });

    if (p === '/internal/check' && M === 'POST') {
        if (!env.INTERNAL_KEY || req.headers.get('x-internal-key') !== env.INTERNAL_KEY) return err(req, 404, 'Not found.');
        return json(req, await runCheck(env, await readJson(req)));
    }
    if (p.startsWith('/v1/admin/')) {
        if (!env.ADMIN_KEY || bearer(req) !== env.ADMIN_KEY) return err(req, 404, 'Not found.');
        return json(req, await admin(p.slice(10), req, env));
    }
    const pm = p.match(/^\/v1\/gumroad\/ping\/([A-Za-z0-9_-]{16,128})$/);
    if (pm) {
        if (M !== 'POST' || !env.PING_SECRET || !(await safeEqual(pm[1], env.PING_SECRET))) return err(req, 404, 'Not found.');
        const raw = await req.text().catch(() => '');
        // Gumroad gives the endpoint 5 seconds and retries only on 499/5xx: acknowledge now, work in the background.
        ctx.waitUntil(handlePing(env, raw, req.headers.get('content-type') || '').catch((e) => console.log(JSON.stringify({ ping_error: String(e?.message || e) }))));
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (p === '/v1/support' && M === 'POST') return json(req, await postSupport(req, env));
    if (p === '/v1/license/verify' && M === 'POST') {
        if (!rateLimit(`lic:${clientIp(req)}`, 30, 60000)) return err(req, 429, 'Too many license checks. Wait a minute.');
        const b = await readJson(req, 2048);
        const r = await licenseAccount(env, String(b.key || b.license_key || '').trim());
        if (!r.ok) return json(req, { ok: false, status: 'invalid', error: r.error }, r.status);
        const a = r.acct;
        return json(req, { ok: true, status: r.grace ? 'grace' : 'active', cached: !!r.cached, ...limits(a.tier), lockAt: a.lic.lockAt ? new Date(a.lic.lockAt).toISOString() : null, note: a.lic.note || null, checkedAt: new Date(a.lic.checkedAt).toISOString() });
    }
    if (p === '/v1/free/token' && M === 'POST') {
        if (!rateLimit(`free:${clientIp(req)}`, 5, 3600000)) return err(req, 429, 'Too many tokens requested. Try again later.');
        return json(req, { ok: true, token: `sgf_${randomId(16)}`, note: 'Keep this token: it is the only key to your free monitor. Free plan: 1 domain, checked weekly.' });
    }
    if (p === '/v1/fingerprint' && M === 'GET') {
        if (!rateLimit(`fp:${clientIp(req)}`, 20, 60000)) return err(req, 429, 'Too many requests. Wait a minute.');
        const domain = normDomain(url.searchParams.get('domain'));
        const cacheKey = new Request(`https://cache.stackgrade.internal/fp/v2/${domain}`);
        const cache = globalThis.caches?.default;
        // The Cache API is a no-op on *.workers.dev, so also keep a small per-isolate memory cache (no KV writes).
        const mem = fpCache.get(domain);
        if (mem && Date.now() - mem.t < (mem.body.ok ? 21600000 : 1800000)) return json(req, { ...mem.body, cached: true });
        const hit = cache && await cache.match(cacheKey);
        if (hit) { const j = await hit.json(); return json(req, { ...j, cached: true }); }
        const r = await fingerprint(domain);
        const body = { domain, checkedAt: new Date().toISOString(), ...r };
        if (fpCache.size > 500) fpCache.clear();
        fpCache.set(domain, { t: Date.now(), body });
        if (cache && (r.ok || !r.blocked)) ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${r.ok ? 21600 : 1800}` } })));
        return json(req, body);
    }
    if (p === '/v1/leads' && M === 'POST') return json(req, await postLead(req, env));
    if (p === '/v1/removal' && M === 'POST') return json(req, await postRemoval(req, env, ctx));

    // ---- authenticated ----
    const acct = await account(req, env);
    if (p === '/v1/me' && M === 'GET') return json(req, { ok: true, account: { kind: acct.kind, ...limits(acct.tier), used: acct.monitors.length, webhook: acct.webhook ? { url: acct.webhook.url.replace(/(https:\/\/[^/]+\/).{6,}/, '$1…'), format: acct.webhook.format } : null, paused: pausedReason(acct), lockAt: acct.lic?.lockAt ? new Date(acct.lic.lockAt).toISOString() : null } });
    if (p === '/v1/monitors' && M === 'GET') {
        const snaps = await Promise.all(acct.monitors.slice(0, 200).map((m) => getJ(env, K.snap(m.id))));
        return json(req, { ok: true, ...limits(acct.tier), paused: pausedReason(acct), monitors: acct.monitors.map((m, i) => ({ ...pubMonitor(m), snapshot: snaps[i]?.snap || null, firstCheckedAt: snaps[i]?.firstAt ? new Date(snaps[i].firstAt).toISOString() : null, lastChangeAt: snaps[i]?.changedAt ? new Date(snaps[i].changedAt).toISOString() : null })) });
    }
    if (p === '/v1/monitors' && M === 'POST') return json(req, { ok: true, ...(await createMonitors(req, env, ctx, acct)) });
    const md = p.match(/^\/v1\/monitors\/([0-9a-f]{12})$/);
    if (md && M === 'DELETE') {
        const mon = acct.monitors.find((m) => m.id === md[1]);
        if (!mon) return err(req, 404, 'Monitor not found.');
        await removeFromSlot(env, mon);
        await putJ(env, K.acct(acct.id), { ...acct, monitors: acct.monitors.filter((m) => m.id !== mon.id) });
        await env.KV.delete(K.snap(mon.id));
        return json(req, { ok: true, deleted: mon.id });
    }
    if (p === '/v1/alerts' && M === 'GET') {
        const pageN = Math.max(0, Number(url.searchParams.get('page') || 0)); const per = 300;
        const mons = acct.monitors.slice(pageN * per, pageN * per + per);
        const recs = await Promise.all(mons.map((m) => getJ(env, K.snap(m.id))));
        const alerts = recs.flatMap((r) => r?.events || []).sort((x, y) => y.at - x.at).slice(0, 200).map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
        return json(req, { ok: true, alerts, page: pageN, morePages: acct.monitors.length > (pageN + 1) * per });
    }
    if (p === '/v1/webhook' && (M === 'PUT' || M === 'POST')) {
        if (acct._new) throw new HttpError(400, 'Add a monitor first.');
        const b = await readJson(req, 2048);
        const c = checkUrl(String(b.url || ''));
        if (c.error || c.url.protocol !== 'https:') throw new HttpError(400, `Webhook URL must be a public https:// URL${c.error ? ` (${c.error})` : ''}.`);
        const format = ['json', 'slack', 'discord'].includes(b.format) ? b.format : 'json';
        await putJ(env, K.acct(acct.id), { ...acct, webhook: { url: c.url.toString(), format } });
        return json(req, { ok: true, format });
    }
    if (p === '/v1/webhook' && M === 'DELETE') { await putJ(env, K.acct(acct.id), { ...acct, webhook: null }); return json(req, { ok: true }); }
    if (p === '/v1/webhook/test' && M === 'POST') {
        if (!acct.webhook) throw new HttpError(400, 'No webhook set.');
        if (!rateLimit(`wht:${acct.id}`, 3, 600000)) throw new HttpError(429, 'Too many tests. Wait a few minutes.');
        return json(req, { ok: true, result: await sendWebhook(acct.webhook, 'example.com', [{ severity: 'info', title: 'Test alert from StackGrade', type: 'test' }]) });
    }
    if (p === '/v1/leads' && (M === 'GET' || M === 'DELETE')) {
        if (!TIERS[acct.tier].leads) throw new HttpError(403, `The ${TIERS[acct.tier].name} plan does not include lead capture.`);
        const doc = (await getJ(env, K.leads(acct.id))) || { leads: [], days: {} };
        if (M === 'DELETE') {
            const email = String(url.searchParams.get('email') || '').toLowerCase();
            const before = doc.leads.length;
            doc.leads = url.searchParams.get('all') === '1' ? [] : doc.leads.filter((l) => l.email !== email);
            if (doc.leads.length !== before) await putJ(env, K.leads(acct.id), doc);
            return json(req, { ok: true, deleted: before - doc.leads.length });
        }
        if (url.searchParams.get('format') === 'csv') {
            const csv = [LEAD_COLS.join(','), ...doc.leads.map((l) => LEAD_COLS.map((c) => csvCell(l[c])).join(','))].join('\r\n');
            return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="stackgrade-leads.csv"', 'cache-control': 'no-store', ...cors(req) } });
        }
        return json(req, { ok: true, count: doc.leads.length, leads: doc.leads });
    }
    return err(req, 404, 'Not found.');
}

async function admin(cmd, req, env) {
    const b = req.method === 'POST' ? await readJson(req) : {};
    if (cmd === 'test-account') {
        if (!TIERS[b.tier]) throw new HttpError(400, 'tier?');
        const token = `sgt_${randomId(16)}`; const id = `T${(await sha256hex(token)).slice(0, 32)}`;
        await putJ(env, K.acct(id), { id, kind: 'test', tier: b.tier, monitors: [], webhook: null, created: Date.now() });
        return { ok: true, token, id };
    }
    if (cmd === 'run-account') { // dispatch checks for every monitor of an account, like the cron does
        const acct = await getJ(env, K.acct(b.id));
        if (!acct) throw new HttpError(404, 'no account');
        const run = acct.monitors.slice(0, MAX_FANOUT);
        const results = await Promise.allSettled(run.map((m) => dispatchCheck(env, { m: m.id, a: acct.id, d: m.d })));
        return { ok: true, results: results.map((r) => r.value || { error: String(r.reason) }) };
    }
    if (cmd === 'run-slot') return runSlot(env, b.at ? new Date(b.at) : new Date());
    if (cmd === 'tamper') { // test helper: alter a stored snapshot so the next check reports a change
        const rec = await getJ(env, K.snap(b.m)); if (!rec) throw new HttpError(404, 'no snapshot');
        Object.assign(rec.snap, b.set || {});
        await putJ(env, K.snap(b.m), rec);
        return { ok: true, snap: rec.snap };
    }
    if (cmd === 'reslot') { // test helper: move a monitor to a given hour/sub-slot so a real cron run picks it up
        const acct = await getJ(env, K.acct(b.a)); const mon = acct?.monitors?.find((x) => x.id === b.m);
        if (!mon) throw new HttpError(404, 'no monitor');
        await removeFromSlot(env, mon);
        Object.assign(mon, { h: Number(b.h) % 24, s: Number(b.s) % SUBSLOTS });
        await putJ(env, K.acct(acct.id), acct);
        await addToSlots(env, [{ m: mon.id, a: acct.id, d: mon.d, f: mon.f, h: mon.h, s: mon.s, w: mon.w }]);
        return { ok: true, monitor: pubMonitor(mon) };
    }
    if (cmd === 'sales' && req.method === 'GET') return listRecords(env, 'sale:', new URL(req.url));
    if (cmd === 'support' && req.method === 'GET') return listRecords(env, 'support:', new URL(req.url));
    const del = cmd.match(/^(sales|support)\/(.+)$/);
    if (del && req.method === 'DELETE') {
        const k = `${del[1] === 'sales' ? 'sale' : 'support'}:${decodeURIComponent(del[2])}`;
        await env.KV.delete(k); return { ok: true, deleted: k };
    }
    if (cmd === 'delete-account' && req.method === 'POST') { // removes an account doc plus its monitors' schedule and snapshots
        const acct = await getJ(env, K.acct(b.id)); if (!acct) throw new HttpError(404, 'no account');
        for (const m of acct.monitors || []) { await removeFromSlot(env, m); await env.KV.delete(K.snap(m.id)); }
        await env.KV.delete(K.acct(acct.id));
        return { ok: true, deleted: acct.id, monitors: (acct.monitors || []).length };
    }
    if (cmd === 'removals') { const l = await env.KV.list({ prefix: 'rm:', limit: 100 }); return { ok: true, keys: l.keys.map((k) => k.name) }; }
    if (cmd === 'slots') { const l = await env.KV.list({ prefix: 'due:', limit: 1000 }); return { ok: true, count: l.keys.length, keys: l.keys.map((k) => `${k.name} ${k.metadata?.d}`) }; }
    throw new HttpError(404, 'unknown admin command');
}

export default {
    async fetch(req, env, ctx) {
        try { return await route(req, env, ctx); } catch (e) {
            if (e instanceof HttpError) return err(req, e.status, e.message, e.extra || {});
            console.log(JSON.stringify({ error: e?.message, stack: String(e?.stack || '').slice(0, 500) }));
            return err(req, 500, 'Internal error.');
        }
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runSlot(env, new Date(event.scheduledTime)).catch((e) => console.log(JSON.stringify({ cronError: e?.message }))));
    },
};
