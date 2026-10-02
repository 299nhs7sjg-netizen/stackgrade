import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyKey, activate, status, verifyForWidget, _clearWidgetCache, encodeConfig, decodeConfig, cleanBrand, DAY_MS, GRACE_MS, STORE_KEY, checkoutUrl } from '../assets/license.js';

const cfg = { agencyKit: { productId: 'PROD123', checkoutUrl: '' } };
const inert = { agencyKit: { productId: '', checkoutUrl: '' } };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const KEY = 'ABCD1234-EF567890-11223344-55667788';
function mockFetch(responder) {
    const calls = [];
    const f = async (url, opts) => { calls.push({ url, body: new URLSearchParams(opts.body) }); return responder(calls.length); };
    f.calls = calls; return f;
}
const json = (status, body) => ({ status, json: async () => body });
const ok = (purchase = {}) => json(200, { success: true, uses: 1, purchase: { refunded: false, chargebacked: false, disputed: false, ...purchase } });

test('valid key unlocks; request is correct and does not increment uses', async () => {
    const f = mockFetch(() => ok());
    const r0 = await verifyKey(KEY, { cfg, fetchImpl: f }); assert.equal(r0.ok, true); assert.equal(r0.tier, 'agencykit');
    assert.equal(f.calls[0].url, 'https://api.gumroad.com/v2/licenses/verify');
    assert.equal(f.calls[0].body.get('product_id'), 'PROD123');
    assert.equal(f.calls[0].body.get('license_key'), KEY);
    assert.equal(f.calls[0].body.get('increment_uses_count'), 'false');
});
for (const flag of ['refunded', 'chargebacked', 'disputed']) {
    test(`${flag} purchase is rejected`, async () => {
        const r = await verifyKey(KEY, { cfg, fetchImpl: mockFetch(() => ok({ [flag]: true })) });
        assert.equal(r.ok, false); assert.equal(r.definitive, true);
    });
}
for (const f of ['subscription_cancelled_at', 'subscription_ended_at', 'subscription_failed_at']) {
    test(`${f} locks`, async () => {
        const r = await verifyKey(KEY, { cfg, fetchImpl: mockFetch(() => ok({ [f]: '2026-09-30T00:00:00Z' })) });
        assert.equal(r.ok, false); assert.equal(r.definitive, true);
    });
}
test('null subscription fields are fine', async () => {
    assert.equal((await verifyKey(KEY, { cfg, fetchImpl: mockFetch(() => ok({ subscription_cancelled_at: null, subscription_ended_at: null, subscription_failed_at: null })) })).ok, true);
});
test('invalid key is rejected', async () => {
    const r = await verifyKey(KEY, { cfg, fetchImpl: mockFetch(() => json(404, { success: false, message: 'That license does not exist for the provided product.' })) });
    assert.equal(r.ok, false); assert.equal(r.definitive, true); assert.match(r.reason, /does not exist/);
});
test('inert config never calls Gumroad and never unlocks', async () => {
    const f = mockFetch(() => ok()); const store = mem();
    assert.equal((await activate(KEY, { cfg: inert, fetchImpl: f, store })).ok, false);
    store.setItem(STORE_KEY, JSON.stringify({ key: KEY, productId: '', verifiedAt: Date.now(), lastOkAt: Date.now() }));
    assert.equal((await status({ cfg: inert, fetchImpl: f, store })).unlocked, false);
    assert.equal(f.calls.length, 0);
    assert.equal(checkoutUrl(inert), '');
});
test('no honor path: a hand-written storage entry for another product does not unlock', async () => {
    const store = mem();
    store.setItem(STORE_KEY, JSON.stringify({ key: KEY, productId: 'OTHER', verifiedAt: Date.now() }));
    assert.equal((await status({ cfg, fetchImpl: mockFetch(() => ok()), store })).unlocked, false);
    store.setItem(STORE_KEY, '1');
    assert.equal((await status({ cfg, fetchImpl: mockFetch(() => ok()), store })).unlocked, false);
});
test('re-verifies at most once a day, then locks when the membership is cancelled', async () => {
    const store = mem(); const t0 = 1_800_000_000_000;
    let mode = 'ok';
    const f = mockFetch(() => (mode === 'ok' ? ok() : ok({ subscription_cancelled_at: '2026-10-05' })));
    assert.equal((await activate(KEY, { cfg, fetchImpl: f, store, now: t0 })).ok, true);
    assert.equal((await status({ cfg, fetchImpl: f, store, now: t0 + DAY_MS - 1000 })).unlocked, true);
    assert.equal(f.calls.length, 1, 'no network within 24h');
    assert.equal((await status({ cfg, fetchImpl: f, store, now: t0 + DAY_MS + 1 })).unlocked, true);
    assert.equal(f.calls.length, 2);
    mode = 'cancelled';
    const s = await status({ cfg, fetchImpl: f, store, now: t0 + 2 * DAY_MS + 2 });
    assert.equal(s.unlocked, false); assert.match(s.reason, /cancelled/);
    assert.equal(store.getItem(STORE_KEY), null);
});
test('refund after activation locks on the next daily check', async () => {
    const store = mem(); const t0 = 1_800_000_000_000; let refunded = false;
    const f = mockFetch(() => ok({ refunded }));
    await activate(KEY, { cfg, fetchImpl: f, store, now: t0 });
    refunded = true;
    assert.equal((await status({ cfg, fetchImpl: f, store, now: t0 + DAY_MS + 5 })).unlocked, false);
});
test('network outage keeps a verified license for up to 7 days, then locks', async () => {
    const store = mem(); const t0 = 1_800_000_000_000; let down = false;
    const f = mockFetch(() => { if (down) throw new TypeError('Failed to fetch'); return ok(); });
    await activate(KEY, { cfg, fetchImpl: f, store, now: t0 });
    down = true;
    const g = await status({ cfg, fetchImpl: f, store, now: t0 + 2 * DAY_MS });
    assert.equal(g.unlocked, true); assert.equal(g.grace, true);
    assert.equal((await status({ cfg, fetchImpl: f, store, now: t0 + GRACE_MS + DAY_MS })).unlocked, false);
});
test('widget verification is cached per page load', async () => {
    _clearWidgetCache();
    const f = mockFetch(() => ok());
    await verifyForWidget(KEY, { cfg, fetchImpl: f }); await verifyForWidget(KEY, { cfg, fetchImpl: f });
    assert.equal(f.calls.length, 1);
});
test('embed config round-trips, detects tampering, and sanitizes', async () => {
    const tok = await encodeConfig({ name: 'Acme <Web>', logo: 'https://acme.example/logo.png', color: '#7C3AED', cta: 'Book a call', ctaUrl: 'javascript:alert(1)', hidePowered: true, junk: 1 }, KEY);
    const dec = await decodeConfig(tok, KEY);
    assert.deepEqual(dec, { name: 'Acme <Web>', logo: 'https://acme.example/logo.png', color: '7c3aed', cta: 'Book a call', hidePowered: true });
    assert.equal(await decodeConfig(tok, 'OTHERKEY-123'), null);
    assert.equal(await decodeConfig(tok.replace(/^./, 'x'), KEY), null);
    assert.deepEqual(cleanBrand({ logo: 'http://insecure.example/x.png' }), {});
});

test('one-time purchase (no subscription fields at all) unlocks and stays unlocked across daily re-checks', async () => {
    const store = mem(); const t0 = Date.parse('2026-10-01T12:00:00Z');
    const f = mockFetch(() => json(200, { success: true, uses: 0, purchase: { refunded: false, chargebacked: false, disputed: false, recurrence: null, product_id: 'PROD123' } }));
    assert.equal((await activate(KEY, { cfg, fetchImpl: f, store, now: t0 })).ok, true);
    for (let d = 1; d <= 30; d++) assert.equal((await status({ cfg, fetchImpl: f, store, now: t0 + d * DAY_MS + 1000 })).unlocked, true);
    assert.equal(f.calls.length, 31); // activation + one re-verify per day
});
test('shipped public config is filled in, https checkout, and not a license-key-format value', async () => {
    const { CONFIG } = await import('../assets/config.js');
    assert.ok(CONFIG.agencyKit.productId);
    assert.doesNotMatch(CONFIG.agencyKit.productId, /^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/i);
    assert.match(checkoutUrl(CONFIG), /^https:\/\/[a-z0-9-]+\.gumroad\.com\/l\//);
});
