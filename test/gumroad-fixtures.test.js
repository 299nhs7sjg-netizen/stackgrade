// Licensing against Gumroad's documented / recorded licenses/verify shapes. Sources are cited in fixtures/gumroad-verify.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePurchase, verifyLicense, normalizeKey, keyShapeHint } from '../assets/tiers.js';
import { DOCUMENTED_MEMBERSHIP, RECORDED_TEST_MEMBERSHIP, NOT_FOUND, DISABLED, REVOKED } from './fixtures/gumroad-verify.js';

const P = { pro: 'PRO', agency: 'AG', agencyplus: 'AGP', agencykit: 'KIT' };
const KEY = '85DB562A-C11D4B06-A2335A6B-8C079166';
const res = (status, body) => ({ status, json: async () => body });
const clone = (o) => JSON.parse(JSON.stringify(o));
// Gumroad mock: { productId: [status, body] }, anything else -> documented 404.
const gum = (map) => async (u, o) => { const pid = new URLSearchParams(o.body).get('product_id'); const r = map[pid]; return r ? res(r[0], r[1]) : res(404, NOT_FOUND); };
const withPurchase = (base, patch) => { const b = clone(base); Object.assign(b.purchase, patch); return b; };

test('documented active membership (all subscription_* null) unlocks with no lock date', async () => {
    assert.deepEqual(evaluatePurchase(DOCUMENTED_MEMBERSHIP.purchase), { ok: true });
    const r = await verifyLicense(KEY, P, { fetchImpl: gum({ AG: [200, DOCUMENTED_MEMBERSHIP] }) });
    assert.equal(r.ok, true); assert.equal(r.tier, 'agency'); assert.equal(r.lockAt, undefined); assert.equal(r.recurrence, 'monthly');
});
test('recorded membership with missing (undefined) fields and test: true is valid', async () => {
    const p = RECORDED_TEST_MEMBERSHIP.purchase;
    assert.equal('subscription_ended_at' in p, false); assert.equal('chargebacked' in p, false);
    assert.deepEqual(evaluatePurchase(p), { ok: true });
    const r = await verifyLicense(KEY, P, { fetchImpl: gum({ PRO: [200, RECORDED_TEST_MEMBERSHIP] }) });
    assert.equal(r.ok, true); assert.equal(r.tier, 'pro'); assert.equal(r.test, true);
});
test('purchase object entirely missing (imported customer) or empty is tolerated as valid', async () => {
    assert.equal(evaluatePurchase(undefined).ok, true);
    assert.equal(evaluatePurchase(null).ok, true);
    const r = await verifyLicense(KEY, P, { fetchImpl: gum({ KIT: [200, { success: true, uses: 0, imported_customer: { email: 'x@example.com' } }] }) });
    assert.equal(r.ok, true); assert.equal(r.tier, 'agencykit');
});
test('BUG FIX: a dispute the seller won (disputed + dispute_won) keeps access; an open/lost dispute locks', () => {
    assert.equal(evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, { disputed: true, dispute_won: true }).purchase).ok, true);
    assert.equal(evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, { disputed: true, dispute_won: false }).purchase).ok, false);
    assert.equal(evaluatePurchase(withPurchase(RECORDED_TEST_MEMBERSHIP, { disputed: true }).purchase).ok, false);
});
test('cancelled membership: future subscription_cancelled_at = paid-through date (Gumroad Subscription#cancel!)', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    const a = evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, { subscription_cancelled_at: '2026-10-20T19:38:56Z' }).purchase, now);
    assert.equal(a.ok, true); assert.equal(a.lockAt, Date.parse('2026-10-20T19:38:56Z'));
    const b = evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, { subscription_cancelled_at: '2026-09-20T19:38:56Z' }).purchase, now);
    assert.equal(b.ok, false); assert.match(b.reason, /cancelled and its paid period ended on 2026-09-20/);
});
test('ended / failed / refunded / chargebacked lock immediately, including string booleans', () => {
    for (const patch of [{ subscription_ended_at: '2026-09-01T00:00:00Z' }, { subscription_failed_at: '2026-09-01T00:00:00Z' }, { refunded: true }, { refunded: 'true' }, { chargebacked: true }]) {
        const r = evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, patch).purchase);
        assert.equal(r.ok, false, JSON.stringify(patch)); assert.equal(r.definitive, true);
    }
    assert.equal(evaluatePurchase(withPurchase(DOCUMENTED_MEMBERSHIP, { refunded: 'false', disputed: 'false' }).purchase).ok, true);
});
test('"disabled" and "expired access" 404s are reported over "does not exist" on other products', async () => {
    const r = await verifyLicense(KEY, P, { fetchImpl: gum({ AG: [404, DISABLED] }) });
    assert.equal(r.ok, false); assert.equal(r.notFound, undefined); assert.match(r.reason, /disabled/);
    const r2 = await verifyLicense(KEY, P, { fetchImpl: gum({ PRO: [404, REVOKED] }) });
    assert.match(r2.reason, /expired/);
    const r3 = await verifyLicense(KEY, P, { fetchImpl: gum({}) });
    assert.equal(r3.notFound, true); assert.match(r3.reason, /does not exist/);
});
test('Gumroad 5xx / 429 are temporary (no lock)', async () => {
    for (const st of [500, 502, 503, 429]) {
        const r = await verifyLicense(KEY, P, { fetchImpl: async () => res(st, { success: false, message: 'x' }) });
        assert.equal(r.definitive, false, String(st));
    }
});
test('pasted keys are trimmed and normalised', async () => {
    assert.equal(normalizeKey('  85db562a-c11d4b06-a2335a6b-8c079166\n'), KEY);
    assert.equal(normalizeKey('License key: 85DB562A–C11D4B06—A2335A6B‑8C079166'), KEY);
    assert.equal(normalizeKey('"85DB562A-C11D4B06-\u200BA2335A6B-8C079166"'), KEY);
    assert.equal(normalizeKey('85DB562A - C11D4B06 - A2335A6B - 8C079166'), KEY);
    const seen = [];
    const r = await verifyLicense(` ${KEY.toLowerCase()} `, P, { fetchImpl: async (u, o) => { seen.push(new URLSearchParams(o.body).get('license_key')); return res(200, DOCUMENTED_MEMBERSHIP); } });
    assert.equal(r.ok, true); assert.ok(seen.every((k) => k === KEY));
});
test('order numbers, emails, links and sale ids get a specific hint without calling Gumroad', async () => {
    assert.match(keyShapeHint('524459935'), /order number/);
    assert.match(keyShapeHint('me@example.com'), /email/);
    assert.match(keyShapeHint('https://app.gumroad.com/r/abc'), /link/);
    assert.match(keyShapeHint('FO8TXN-dbxYaBdahG97Y-Q=='), /sale or product ID/);
    assert.equal(keyShapeHint(KEY), null);
    let called = false;
    const r = await verifyLicense('524459935', P, { fetchImpl: async () => { called = true; return res(404, NOT_FOUND); } });
    assert.equal(r.ok, false); assert.equal(called, false); assert.match(r.reason, /order number/);
});
