import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { runSlot, webhookPayload, licenseAccount } from '../src/index.js';
import { kv, jres, ctx, req } from './helpers.js';

const gumroad = (map, calls = []) => async (url, init) => {
    if (!String(url).includes('api.gumroad.com')) throw new Error(`unexpected ${url}`);
    const b = new URLSearchParams(init.body); calls.push(b.get('product_id'));
    const p = map[`${b.get('product_id')}|${b.get('license_key')}`];
    return p ? jres(200, { success: true, purchase: { refunded: false, chargebacked: false, disputed: false, ...p } }) : jres(404, { success: false, message: 'That license does not exist for the provided product.' });
};
const envBase = () => ({ KV: kv(), PRODUCT_AGENCY_KIT: 'KIT', PRODUCT_PRO: 'PRO', PRODUCT_AGENCY: 'AG', PRODUCT_AGENCY_PLUS: 'AGP', INTERNAL_KEY: 'ik', ADMIN_KEY: 'ak' });
const call = async (env, r, c = ctx()) => { const res = await worker.fetch(r, env, c); return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() }; };

test('license verify: highest tier, cached in KV for 24h (one Gumroad round per day), refunds rejected', async () => {
    const env = envBase(); const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = gumroad({ 'AG|KEY-AGENCY-1': {}, 'PRO|KEY-AGENCY-1': {}, 'PRO|KEY-REFUND-1': { refunded: true } }, calls);
    try {
        const a = await call(env, req('POST', '/v1/license/verify', { body: { key: 'KEY-AGENCY-1' } }));
        assert.equal(a.status, 200); assert.equal(a.body.tier, 'agency'); assert.equal(a.body.monitors, 200); assert.equal(a.body.cached, false);
        assert.equal(a.headers.get('access-control-allow-origin'), 'https://299nhs7sjg-netizen.github.io');
        assert.equal(calls.length, 4);
        const b = await call(env, req('POST', '/v1/license/verify', { body: { key: 'KEY-AGENCY-1' } }));
        assert.equal(b.body.cached, true); assert.equal(calls.length, 4, 'no Gumroad call within 24h');
        const c = await call(env, req('POST', '/v1/license/verify', { body: { key: 'KEY-REFUND-1' } }));
        assert.equal(c.status, 403); assert.match(c.body.error, /refunded/);
        const d = await call(env, req('POST', '/v1/license/verify', { body: { key: 'NOT-A-REAL-KEY' } }));
        assert.equal(d.status, 403);
        assert.equal(env.KV.stats.writes, 1, 'only the valid license wrote to KV');
    } finally { globalThis.fetch = real; }
});
test('license cache expires after 24h and a cancelled membership past its period locks', async () => {
    const env = envBase(); const real = globalThis.fetch; const t0 = Date.parse('2026-10-01T00:00:00Z');
    let purchase = { recurrence: 'monthly', created_at: '2026-09-01T00:00:00Z' };
    globalThis.fetch = async (u, init) => gumroad({ 'PRO|KEY-PRO-123': purchase })(u, init);
    try {
        assert.equal((await licenseAccount(env, 'KEY-PRO-123', { now: t0 })).ok, true);
        purchase = { ...purchase, subscription_cancelled_at: '2026-10-01T00:00:00Z' }; // Gumroad: cancelled_at = end of paid period
        const r = await licenseAccount(env, 'KEY-PRO-123', { now: t0 + 86400000 + 5 });
        assert.equal(r.ok, false); assert.match(r.error, /cancelled/);
    } finally { globalThis.fetch = real; }
});
test('CORS: unknown origins get no allow-origin header; preflight works', async () => {
    const env = envBase();
    const r = await worker.fetch(req('OPTIONS', '/v1/monitors', { origin: 'https://evil.example' }), env, ctx());
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), null);
    const r2 = await worker.fetch(req('GET', '/v1/health'), env, ctx());
    assert.equal(r2.headers.get('access-control-allow-origin'), 'https://299nhs7sjg-netizen.github.io');
});
test('free token: 1 weekly monitor, one per network per week, slots written', async () => {
    const env = envBase(); delete env.INTERNAL_KEY;
    const t = (await call(env, req('POST', '/v1/free/token'))).body.token;
    assert.match(t, /^sgf_[0-9a-f]{32}$/);
    const a = await call(env, req('POST', '/v1/monitors', { token: t, body: { domain: 'Example.COM' } }));
    assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.added[0].frequency, 'weekly');
    const b = await call(env, req('POST', '/v1/monitors', { token: t, body: { domain: 'github.com' } }));
    assert.equal(b.status, 403); assert.match(b.body.error, /allows 1/);
    const t2 = (await call(env, req('POST', '/v1/free/token'))).body.token;
    const c = await call(env, req('POST', '/v1/monitors', { token: t2, body: { domain: 'github.com' } }));
    assert.equal(c.status, 429);
    const d = await call(env, req('POST', '/v1/monitors', { token: t2, body: { domain: 'github.com' }, ip: '5.6.7.8' }));
    assert.equal(d.status, 200);
    const list = await call(env, req('GET', '/v1/monitors', { token: t }));
    assert.equal(list.body.monitors.length, 1); assert.equal(list.body.monitors[0].domain, 'example.com');
    const slots = [...env.KV.m.keys()].filter((k) => k.startsWith('due:'));
    assert.ok(slots.length >= 1);
    const del = await call(env, req('DELETE', `/v1/monitors/${list.body.monitors[0].id}`, { token: t }));
    assert.equal(del.status, 200);
    assert.equal((await call(env, req('GET', '/v1/monitors', { token: t }))).body.monitors.length, 0);
});
test('monitor input validation rejects internal targets', async () => {
    const env = envBase();
    const t = (await call(env, req('POST', '/v1/free/token', { ip: '9.9.9.9' }))).body.token;
    for (const d of ['127.0.0.1', 'localhost', '169.254.169.254', 'metadata.google.internal', 'foo.local'])
        assert.equal((await call(env, req('POST', '/v1/monitors', { token: t, body: { domain: d }, ip: '9.9.9.9' }))).status, 400, d);
});
test('cron slot selection dispatches only due monitors, capped at 45 per run', async () => {
    const env = envBase(); const sent = [];
    env.SELF = { fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return jres(200, { ok: true, subrequests: 20 }); } };
    const items = Array.from({ length: 120 }, (_, i) => ({ m: `m${i}`, a: 'A', d: 'x.com', f: i % 2 ? 'd' : 'w', s: 3, w: i % 7 }));
    for (const x of items) await env.KV.put(`due:14:3:${x.m}`, '', { metadata: { a: x.a, d: x.d, f: x.f, w: x.w } });
    await env.KV.put('due:14:4:other', '', { metadata: { a: 'A', d: 'y.com', f: 'd', w: 0 } });
    const at = new Date('2026-10-01T14:17:00Z'); // hour 14, sub 3, Thursday (4)
    const r = await runSlot(env, at);
    const dueDaily = items.filter((x) => x.f === 'd').length; const dueWeekly = items.filter((x) => x.f === 'w' && x.w === 4).length;
    assert.equal(r.summary.due, dueDaily + dueWeekly);
    assert.equal(sent.length, 45); assert.equal(r.summary.overflow, dueDaily + dueWeekly - 45);
    assert.ok(sent.every((b) => b.d === 'x.com'));
    assert.equal(env.KV.stats.lists, 1, 'one list() per cron run');
});
test('leads: honeypot dropped silently, Pro rejected, Agency Kit stored, CSV escapes formulas, removal suppresses', async () => {
    const env = envBase(); const real = globalThis.fetch;
    globalThis.fetch = gumroad({ 'KIT|KEY-KIT-0001': {}, 'PRO|KEY-PRO-0001': {} });
    try {
        const lead = (extra, ip) => call(env, req('POST', '/v1/leads', { body: { license: 'KEY-KIT-0001', name: 'Ann', email: 'ann@client.com', domain: 'client.com', grade: 'C', score: 72, elapsedMs: 9000, ...extra }, ip }));
        assert.equal((await lead({ website: 'http://spam' }, '2.2.2.1')).body.ok, true);
        assert.equal(env.KV.m.has([...env.KV.m.keys()].find((k) => k.startsWith('leads:')) || 'none'), false, 'honeypot stored nothing');
        assert.equal((await call(env, req('POST', '/v1/leads', { body: { license: 'KEY-PRO-0001', email: 'a@b.co', elapsedMs: 9000 }, ip: '2.2.2.2' }))).status, 403);
        assert.equal((await lead({}, '2.2.2.3')).status, 200);
        assert.equal((await lead({ name: '=HYPERLINK("http://x")', email: 'bob@client.com' }, '2.2.2.4')).status, 200);
        const csv = await call(env, req('GET', '/v1/leads?format=csv', { token: 'KEY-KIT-0001' }));
        assert.match(csv.body, /^at,name,email,domain,grade,score,consent/);
        assert.match(csv.body, /"'=HYPERLINK\(""http:\/\/x""\)"/);
        const rm = await call(env, req('POST', '/v1/removal', { body: { kind: 'email', value: 'ann@client.com' }, ip: '3.3.3.3' }), ctx());
        assert.equal(rm.status, 200);
        await new Promise((r) => setTimeout(r, 20));
        const j = await call(env, req('GET', '/v1/leads', { token: 'KEY-KIT-0001' }));
        assert.ok(!j.body.leads.some((l) => l.email === 'ann@client.com'), 'removed lead purged');
        await lead({}, '2.2.2.5');
        const j2 = await call(env, req('GET', '/v1/leads', { token: 'KEY-KIT-0001' }));
        assert.ok(!j2.body.leads.some((l) => l.email === 'ann@client.com'), 'suppressed email not stored again');
        const pro = await call(env, req('GET', '/v1/leads', { token: 'KEY-PRO-0001' }));
        assert.equal(pro.status, 403);
    } finally { globalThis.fetch = real; }
});
test('webhook payloads: json, Slack {text}, Discord {content}; webhook URL must be public https', async () => {
    const ev = [{ severity: 'high', title: 'DMARC policy weakened' }];
    assert.ok(webhookPayload('slack', 'x.com', ev).text.includes('DMARC'));
    assert.ok(webhookPayload('discord', 'x.com', ev).content.includes('x.com'));
    assert.equal(webhookPayload('json', 'x.com', ev).type, 'stackgrade.changes');
    const env = envBase(); delete env.INTERNAL_KEY;
    const t = (await call(env, req('POST', '/v1/free/token', { ip: '7.7.7.7' }))).body.token;
    await call(env, req('POST', '/v1/monitors', { token: t, body: { domain: 'example.com' }, ip: '7.7.7.7' }));
    for (const u of ['http://hooks.slack.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/'])
        assert.equal((await call(env, req('PUT', '/v1/webhook', { token: t, body: { url: u }, ip: '7.7.7.7' }))).status, 400, u);
    assert.equal((await call(env, req('PUT', '/v1/webhook', { token: t, body: { url: 'https://hooks.slack.com/services/T/B/X', format: 'slack' }, ip: '7.7.7.7' }))).status, 200);
});
test('internal and admin endpoints are hidden without their keys', async () => {
    const env = envBase();
    assert.equal((await call(env, req('POST', '/internal/check', { body: {} }))).status, 404);
    assert.equal((await call(env, req('POST', '/v1/admin/test-account', { body: { tier: 'pro' }, token: 'wrong' }))).status, 404);
    assert.equal((await call(env, req('GET', '/v1/monitors'))).status, 401);
});

test('netPrefix groups rotating IPs by network', async () => {
    const { netPrefix } = await import('../src/index.js');
    assert.equal(netPrefix('140.248.52.116'), '140.248.52.0/24');
    assert.equal(netPrefix('140.248.52.41'), netPrefix('140.248.52.100'));
    assert.equal(netPrefix('2001:db8:abcd:12::1'), '2001:db8:abcd::/48');
});

test('Gumroad ping: secret path, 200 at once, verify recorded with masked email, dedupe key, refund triggers re-check', async () => {
    const env = { ...envBase(), PING_SECRET: 'sEcReT_sEcReT_1234567890' }; const real = globalThis.fetch;
    globalThis.fetch = gumroad({ 'AG|85DB562A-C11D4B06-A2335A6B-8C079166': {} });
    try {
        const form = (o) => new URLSearchParams(o).toString();
        const mk = (path, body) => new Request(`https://api.stackgrade.workers.dev${path}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        assert.equal((await call(env, mk('/v1/gumroad/ping/wrong_secret_wrong_secret', 'x=1'))).status, 404);
        const base = { seller_id: 'S', product_id: 'AG', product_permalink: 'https://greenlight5868.gumroad.com/l/vmdksq', email: 'buyer.name@example.com', price: '4900', recurrence: 'monthly', sale_id: 'SALE1==', license_key: '85db562a-c11d4b06-a2335a6b-8c079166', test: 'true', refunded: 'false' };
        const c = ctx();
        const r = await call(env, mk('/v1/gumroad/ping/sEcReT_sEcReT_1234567890', form(base)), c);
        assert.equal(r.status, 200); assert.equal(r.body, 'ok');
        await c.done();
        const rec = JSON.parse(env.KV.m.get('sale:SALE1==:sale'));
        assert.equal(rec.email, 'b***@example.com'); assert.equal(rec.keyLast4, '9166'); assert.equal(rec.test, true);
        assert.equal(rec.verify.unlocks, true); assert.equal(rec.verify.tier, 'agency'); assert.equal(rec.verify.result, 'valid');
        assert.ok(!JSON.stringify(rec).includes('buyer.name') && !JSON.stringify(rec).includes('A2335A6B'), 'no full email or key stored');
        // an account using that key gets a forced re-check when a refund ping arrives
        await licenseAccount(env, '85DB562A-C11D4B06-A2335A6B-8C079166');
        const c2 = ctx();
        await call(env, mk('/v1/gumroad/ping/sEcReT_sEcReT_1234567890', form({ ...base, resource_name: 'refund', refunded: 'true' })), c2); await c2.done();
        const acctKey = [...env.KV.m.keys()].find((k) => k.startsWith('acct:L'));
        assert.equal(JSON.parse(env.KV.m.get(acctKey)).lic.checkedAt, 0);
        assert.ok(env.KV.m.has('sale:SALE1==:refund'));
        // fake key -> not found; unknown product -> not checked
        const c3 = ctx();
        await call(env, mk('/v1/gumroad/ping/sEcReT_sEcReT_1234567890', form({ ...base, sale_id: 'SALE2==', license_key: 'FAKE0000-FAKE0000-FAKE0000-FAKE0000' })), c3);
        await call(env, mk('/v1/gumroad/ping/sEcReT_sEcReT_1234567890', form({ ...base, sale_id: 'SALE3==', product_id: 'OTHER' })), c3); await c3.done();
        assert.equal(JSON.parse(env.KV.m.get('sale:SALE2==:sale')).verify.result, 'not found');
        assert.equal(JSON.parse(env.KV.m.get('sale:SALE3==:sale')).verify.checked, false);
        const list = await call(env, req('GET', '/v1/admin/sales', { token: 'ak' }));
        assert.equal(list.body.count, 4);
        const del = await call(env, req('DELETE', '/v1/admin/sales/SALE2%3D%3D%3Asale', { token: 'ak' }));
        assert.equal(del.body.deleted, 'sale:SALE2==:sale'); assert.equal(env.KV.m.has('sale:SALE2==:sale'), false);
    } finally { globalThis.fetch = real; }
});

test('support: validation, honeypot, only last 4 of a key, rate limit, admin list', async () => {
    const env = envBase();
    const post = (body, ip = '9.9.9.1') => call(env, req('POST', '/v1/support', { body, ip }));
    assert.equal((await post({ email: 'nope', message: 'help me', elapsedMs: 9000 })).status, 400);
    const hp = await post({ email: 'a@example.com', message: 'spam spam', website: 'x', elapsedMs: 9000 }, '9.9.9.2');
    assert.equal(hp.status, 200); assert.equal([...env.KV.m.keys()].filter((k) => k.startsWith('support:')).length, 0);
    const ok = await post({ email: 'Buyer@Example.com', message: 'My key does not work', keyLast4: '85DB562A-C11D4B06-A2335A6B-8C079166', page: 'app', elapsedMs: 9000 }, '9.9.9.3');
    assert.equal(ok.status, 200);
    const rec = JSON.parse(env.KV.m.get(`support:${ok.body.id}`));
    assert.equal(rec.keyLast4, '9166'); assert.equal(rec.email, 'buyer@example.com');
    for (let i = 0; i < 2; i++) await post({ email: 'b@example.com', message: 'again please', elapsedMs: 9000 }, '9.9.9.4');
    assert.equal((await post({ email: 'b@example.com', message: 'again please', elapsedMs: 9000 }, '9.9.9.4')).status, 200);
    assert.equal((await post({ email: 'b@example.com', message: 'again please', elapsedMs: 9000 }, '9.9.9.4')).status, 429);
    const list = await call(env, req('GET', '/v1/admin/support', { token: 'ak' }));
    assert.equal(list.body.items.length, 4);
    assert.equal((await call(env, req('GET', '/v1/admin/support'))).status, 404);
});

test('Gumroad ping logs non-StackGrade products (Ciphire Pro) with a brand label and no unlock', async () => {
    const { handlePing } = await import('../src/index.js');
    const store = new Map();
    const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => store.set(k, v), list: async () => ({ keys: [] }), delete: async (k) => store.delete(k) };
    const env = { KV, PRODUCT_PRO: 'yQKekf6hTcpoK_7Xp83jPg==', PRODUCT_CIPHIRE_PRO: 'rlbL5LDgB6P7GJLCuC65NQ==' };
    const raw = new URLSearchParams({ sale_id: 'S1', product_id: 'rlbL5LDgB6P7GJLCuC65NQ==', product_name: 'Ciphire Pro', price: '1500', license_key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD' }).toString();
    const rec = await handlePing(env, raw, 'application/x-www-form-urlencoded', { fetchImpl: async () => { throw new Error('must not call Gumroad'); } });
    assert.equal(rec.brand, 'FortHire'); assert.equal(rec.tierForProduct, null); assert.equal(rec.verify.checked, false);
    assert.ok(store.has('sale:S1:sale'));
});

test('CORS: FortHire (forthire.com) and the old ciphire.pages.dev origin may call /v1/support; others may not', async () => {
    const { cors } = await import('../src/util.js');
    const h = (o) => cors(new Request('https://api.example/v1/support', { headers: { origin: o } }))['access-control-allow-origin'];
    assert.equal(h('https://forthire.com'), 'https://forthire.com');
    assert.equal(h('https://ciphire.pages.dev'), 'https://ciphire.pages.dev');
    assert.equal(h('https://evil.example'), undefined);
});
test('cron list budget: one list per hour when empty, hint skips empty sub-slots, add updates hint', async () => {
    const env = envBase(); const sent = [];
    env.SELF = { fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return jres(200, { ok: true, subrequests: 1 }); } };
    for (let sub = 0; sub < 12; sub++) await runSlot(env, new Date(Date.UTC(2026, 9, 1, 9, sub * 5)));
    assert.equal(env.KV.stats.lists, 1, 'empty hour: a single list() at sub-slot 0');
    assert.equal(env.KV.m.get('dueocc:9'), '[]');
    const w0 = env.KV.stats.writes;
    await runSlot(env, new Date(Date.UTC(2026, 9, 2, 9, 0)));
    assert.equal(env.KV.stats.writes, w0, 'unchanged hint is not rewritten');
    // a monitor lands in hour 9 sub-slot 7 (simulate addToSlots via the admin move path is heavier; write like addToSlots does)
    await env.KV.put('due:9:7:mX', '', { metadata: { a: 'A', d: 'z.com', f: 'd', w: 0 } });
    await env.KV.put('dueocc:9', '[7]');
    const l0 = env.KV.stats.lists;
    await runSlot(env, new Date(Date.UTC(2026, 9, 2, 9, 30))); // sub 6: skipped
    assert.equal(env.KV.stats.lists, l0);
    const r = await runSlot(env, new Date(Date.UTC(2026, 9, 2, 9, 35))); // sub 7: listed + dispatched
    assert.equal(env.KV.stats.lists, l0 + 1); assert.equal(r.summary.dispatched, 1); assert.equal(sent.at(-1).d, 'z.com');
    // reconciliation at sub 0 repairs a lost hint
    await env.KV.put('dueocc:9', '[]');
    await runSlot(env, new Date(Date.UTC(2026, 9, 3, 9, 0)));
    assert.equal(env.KV.m.get('dueocc:9'), '[7]');
});
test('creating a monitor adds its sub-slot to an existing hour hint', async () => {
    const env = envBase();
    for (let h = 0; h < 24; h++) await env.KV.put(`dueocc:${h}`, '[]');
    const t = (await call(env, req('POST', '/v1/free/token', { ip: '7.7.7.7' }))).body.token;
    assert.equal((await call(env, req('POST', '/v1/monitors', { token: t, body: { domain: 'example.org' }, ip: '7.7.7.7' }))).status, 200);
    const due = [...env.KV.m.keys()].find((k) => k.startsWith('due:'));
    const [, h, s] = due.split(':');
    assert.deepEqual(JSON.parse(env.KV.m.get(`dueocc:${h}`)), [Number(s)]);
});
