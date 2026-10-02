import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePurchase, paidThrough, verifyLicense, TIERS } from '../assets/tiers.js';
import { status, activate, verifyForWidget, _clearWidgetCache, DAY_MS } from '../assets/license.js';

const json = (status, body) => ({ status, json: async () => body });
const P = { pro: 'PRO', agency: 'AG', agencyplus: 'AGP', agencykit: 'KIT' };
// Gumroad mock: map of productId -> purchase (or null = "does not exist")
function gum(map) {
    const calls = [];
    const f = async (url, o) => { const b = new URLSearchParams(o.body); calls.push(b.get('product_id')); const p = map[b.get('product_id')]; return p ? json(200, { success: true, purchase: { refunded: false, chargebacked: false, disputed: false, ...p } }) : json(404, { success: false, message: 'That license does not exist for the provided product.' }); };
    f.calls = calls; return f;
}
const day = (s) => Date.parse(s);

test('paidThrough: monthly and yearly anchored on purchase date, month-end safe', () => {
    assert.equal(paidThrough({ recurrence: 'monthly', created_at: '2026-01-31T10:00:00Z', subscription_cancelled_at: '2026-03-05T00:00:00Z' }), day('2026-03-31T10:00:00Z'));
    assert.equal(paidThrough({ recurrence: 'monthly', created_at: '2026-01-31T10:00:00Z', subscription_cancelled_at: '2026-02-10T00:00:00Z' }), day('2026-02-28T10:00:00Z'));
    assert.equal(paidThrough({ recurrence: 'yearly', created_at: '2025-06-01T00:00:00Z', subscription_cancelled_at: '2026-07-01T00:00:00Z' }), day('2027-06-01T00:00:00Z'));
    assert.equal(paidThrough({ recurrence: null, created_at: '2025-06-01', subscription_cancelled_at: '2026-07-01' }), null);
});
test('cancelled membership stays active until the paid period ends, then locks', () => {
    const p = { recurrence: 'monthly', created_at: '2026-09-15T00:00:00Z', subscription_cancelled_at: '2026-10-01T00:00:00Z' };
    const a = evaluatePurchase(p, day('2026-10-10T00:00:00Z'));
    assert.equal(a.ok, true); assert.equal(a.lockAt, day('2026-10-15T00:00:00Z'));
    const b = evaluatePurchase(p, day('2026-10-15T00:00:01Z'));
    assert.equal(b.ok, false); assert.equal(b.definitive, true);
});
test('cancelled with undeterminable period locks immediately; ended/failed lock immediately', () => {
    assert.equal(evaluatePurchase({ subscription_cancelled_at: '2026-10-01' }).ok, false);
    assert.equal(evaluatePurchase({ recurrence: 'monthly', created_at: '2026-09-30', subscription_ended_at: '2026-10-01' }).ok, false);
    assert.equal(evaluatePurchase({ recurrence: 'monthly', created_at: '2026-09-30', subscription_failed_at: '2026-10-01' }).ok, false);
    for (const f of ['refunded', 'chargebacked', 'disputed']) assert.equal(evaluatePurchase({ [f]: true }).ok, false);
});
test('verifyLicense checks every configured product and the highest valid tier wins', async () => {
    const f = gum({ PRO: {}, AGP: {} });
    const r = await verifyLicense('KEY12345-ABC', P, { fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(r.tier, 'agencyplus');
    assert.deepEqual(f.calls.sort(), ['AG', 'AGP', 'KIT', 'PRO']);
});
test('a refunded higher tier does not beat a valid lower tier, and refunded-only is reported as refunded', async () => {
    assert.equal((await verifyLicense('KEY12345-ABC', P, { fetchImpl: gum({ PRO: {}, AG: { refunded: true } }) })).tier, 'pro');
    const r = await verifyLicense('KEY12345-ABC', P, { fetchImpl: gum({ AG: { refunded: true } }) });
    assert.equal(r.ok, false); assert.equal(r.definitive, true); assert.match(r.reason, /refunded/);
});
test('empty product ids are skipped', async () => {
    const f = gum({ KIT: {} });
    const r = await verifyLicense('KEY12345-ABC', { pro: '', agency: '', agencykit: 'KIT' }, { fetchImpl: f });
    assert.equal(r.tier, 'agencykit'); assert.deepEqual(f.calls, ['KIT']);
});
test('network failure on one product is non-definitive (grace), not a lock', async () => {
    const f = async (u, o) => { if (new URLSearchParams(o.body).get('product_id') === 'AG') throw new Error('net'); return json(404, { success: false, message: 'nope' }); };
    const r = await verifyLicense('KEY12345-ABC', P, { fetchImpl: f });
    assert.equal(r.ok, false); assert.equal(r.definitive, false);
});
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const cfg = { agencyKit: { productId: 'KIT' }, tiers: { pro: { productId: 'PRO' }, agency: { productId: 'AG' }, agencyplus: { productId: 'AGP' } } };
test('browser status: Pro is licensed but not white-label; Agency is white-label', async () => {
    const s1 = mem();
    await activate('KEY12345-ABC', { cfg, fetchImpl: gum({ PRO: {} }), store: s1, now: 0 });
    const a = await status({ cfg, store: s1, now: 1000 });
    assert.equal(a.licensed, true); assert.equal(a.tier, 'pro'); assert.equal(a.unlocked, false);
    const s2 = mem();
    await activate('KEY12345-ABC', { cfg, fetchImpl: gum({ AG: {} }), store: s2, now: 0 });
    const b = await status({ cfg, store: s2, now: 1000 });
    assert.equal(b.unlocked, true); assert.equal(b.leads, true); assert.equal(b.plan, 'Agency');
});
test('browser status: cancelled membership re-checks at period end and locks', async () => {
    const store = mem(); const t0 = day('2026-10-01T00:00:00Z');
    const p = { recurrence: 'monthly', created_at: '2026-09-20T00:00:00Z', subscription_cancelled_at: '2026-09-30T00:00:00Z' };
    const f = gum({ AG: p });
    assert.equal((await activate('KEY12345-ABC', { cfg, fetchImpl: f, store, now: t0 })).ok, true);
    assert.equal((await status({ cfg, fetchImpl: f, store, now: day('2026-10-19T00:00:00Z') })).unlocked, true);
    const s = await status({ cfg, fetchImpl: f, store, now: day('2026-10-20T01:00:00Z') });
    assert.equal(s.unlocked, false);
});
test('widget: Pro key does not unlock white-label', async () => {
    _clearWidgetCache();
    const r = await verifyForWidget('KEY12345-PRO', { cfg, fetchImpl: gum({ PRO: {} }) });
    assert.equal(r.ok, false); assert.match(r.reason, /does not include/);
    assert.equal(TIERS.agencyplus.monitors, 1000);
});
