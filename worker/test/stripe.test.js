import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { stripeSign, deriveKey, isStripeKey, keyHash } from '../src/stripe.js';
import { CATALOG, catalogIndex } from '../src/stripe-config.js';
import { kv, ctx } from './helpers.js';

const SECRET = 'whsec_test_secret';
// Fill sandbox and live IDs for the tests (the shipped config has placeholders only).
const byId = Object.fromEntries(CATALOG.map((e) => [e.id, e]));
byId['gt-snapfit'].sandbox = { plink: 'plink_T_SNAP', price: 'price_T_SNAP' };
byId['gt-allaccess'].sandbox = { plink: 'plink_T_ALL', price: 'price_T_ALL' };
byId['sg-pro-monthly'].sandbox = { plink: 'plink_T_PRO_M', price: 'price_T_PRO_M' };
byId['sg-agency-monthly'].sandbox = { plink: 'plink_T_AG_M', price: 'price_T_AG_M' };
byId['sg-agencykit'].live = { plink: 'plink_L_KIT', price: 'price_L_KIT' };

const envBase = () => ({ KV: kv(), STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 're_x', SALE_NOTIFY_FROM: 'FortHire sales <alerts@forthire.com>', SALE_NOTIFY_TO: 'productbuilder+sale@mail.grokbot.com',
    GT_EMAIL_FROM: 'GreenTools <keys@example.com>', SG_EMAIL_FROM: 'StackGrade <keys@example.com>', STRIPE_PORTAL_URL: 'https://billing.stripe.com/p/login/test_x',
    PRODUCT_AGENCY_KIT: 'KIT', PRODUCT_PRO: 'PRO', PRODUCT_AGENCY: 'AG', PRODUCT_AGENCY_PLUS: 'AGP' });
let mails = [];
const realFetch = globalThis.fetch;
test.beforeEach(() => { mails = []; globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.resend.com/')) { mails.push({ ...JSON.parse(init.body), idem: init.headers['idempotency-key'] }); return new Response('{"id":"x"}', { status: 200 }); }
    if (String(u).includes('api.gumroad.com')) return new Response(JSON.stringify({ success: false, message: 'That license does not exist for the provided product.' }), { status: 404 });
    throw new Error(`unexpected fetch ${u}`);
}; });
test.afterEach(() => { globalThis.fetch = realFetch; });

const call = async (env, method, path, { body, raw, headers = {}, origin = 'https://299nhs7sjg-netizen.github.io' } = {}) => {
    const res = await worker.fetch(new Request(`https://api.example${path}`, { method, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, origin, ...headers } }), env, ctx());
    return { status: res.status, body: await res.json() };
};
const signed = async (env, ev, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) => {
    const raw = JSON.stringify(ev);
    return call(env, 'POST', '/v1/stripe/webhook', { raw, headers: { 'stripe-signature': `t=${t},v1=${await stripeSign(secret, t, raw)}` } });
};
const session = (o = {}) => ({ id: `cs_test_${Math.random().toString(36).slice(2)}abcdefghij`, object: 'checkout.session', livemode: false, payment_status: 'paid', payment_link: 'plink_T_SNAP',
    amount_total: 299, currency: 'usd', customer: 'cus_1', customer_details: { email: 'buyer@example.com' }, payment_intent: 'pi_1', subscription: null, invoice: null, ...o });
const completed = (s) => ({ id: `evt_${s.id}`, type: 'checkout.session.completed', livemode: s.livemode, data: { object: s } });

test('webhook fails closed: no secret = 503, bad or stale signature = 400', async () => {
    const env = envBase(); delete env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await signed(env, completed(session()))).status, 503);
    const env2 = envBase();
    assert.equal((await signed(env2, completed(session()), { secret: 'whsec_wrong' })).status, 400);
    assert.equal((await signed(env2, completed(session()), { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
    assert.equal((await call(env2, 'POST', '/v1/stripe/webhook', { raw: '{}' })).status, 400);
    assert.equal(env2.KV.m.size, 0);
});

test('placeholders never match: the shipped catalog maps nothing until real IDs are filled in', () => {
    const fresh = CATALOG.flatMap((e) => [e.live, e.sandbox]).filter((x) => x.plink.startsWith('PLACEHOLDER'));
    assert.ok(fresh.length > 10);
    assert.ok(!catalogIndex().has('PLACEHOLDER_PLINK_SNAPFIT_LIVE'));
});

test('GreenTools sale: key issued, emailed with receipt, [TEST] alert, thanks lookup, unlock; idempotent per session', async () => {
    const env = envBase(); const s = session();
    const pend = await call(env, 'GET', `/v1/stripe/session?id=${s.id}`);
    assert.equal(pend.body.status, 'pending'); assert.match(pend.body.message, /check your email/);
    const r = await signed(env, completed(s));
    assert.equal(r.status, 200); assert.equal(r.body.issued, true);
    const look = await call(env, 'GET', `/v1/stripe/session?id=${s.id}`);
    assert.equal(look.body.status, 'ready'); assert.match(look.body.key, /^GT-SNAPFIT-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/); assert.ok(isStripeKey(look.body.key));
    assert.equal(look.body.key, await deriveKey(SECRET, 'GT-SNAPFIT', s.id));
    const buyer = mails.find((m) => m.to[0] === 'buyer@example.com');
    assert.ok(buyer.subject.startsWith('[TEST] Your SnapFit')); assert.ok(buyer.text.includes(look.body.key)); assert.match(buyer.text, /Amount paid: \$2\.99/); assert.match(buyer.text, /one-time/);
    assert.equal(buyer.from, 'GreenTools <keys@example.com>'); assert.equal(buyer.idem, `stripe-key-${s.id}`);
    const alert = mails.find((m) => m.to[0] === 'productbuilder+sale@mail.grokbot.com');
    assert.match(alert.subject, /^\[TEST\] Sale: SnapFit lifetime unlock \$2\.99/); assert.match(alert.text, /GreenTools \(Stripe\)/);
    // the plaintext key is stored only in the 30-day thanks record, never in the key record
    const recKey = `skey:${await keyHash(look.body.key)}`; assert.ok(env.KV.m.has(recKey)); assert.ok(!env.KV.m.get(recKey).includes(look.body.key));
    // duplicate delivery: no new records, no new email
    const n = env.KV.m.size; const m0 = mails.length;
    const d = await signed(env, completed(s)); assert.equal(d.body.duplicate, true); assert.equal(env.KV.m.size, n); assert.equal(mails.length, m0);
    // unlock
    const ok = await call(env, 'POST', '/v1/unlock', { body: { product: 'snapfit', key: look.body.key.toLowerCase() }, origin: 'https://snapfit-app.pages.dev' });
    assert.equal(ok.status, 200); assert.equal(ok.body.via, 'stripe');
    const wrong = await call(env, 'POST', '/v1/unlock', { body: { product: 'blotout', key: look.body.key } });
    assert.equal(wrong.status, 403); assert.match(wrong.body.error, /different product/);
    const fake = await call(env, 'POST', '/v1/unlock', { body: { product: 'snapfit', key: 'GT-SNAPFIT-AAAA-BBBB-CCCC-DDDD' } });
    assert.equal(fake.status, 403);
});

test('unpaid sessions issue nothing; ACH async_payment_succeeded issues the key', async () => {
    const env = envBase(); const s = session({ payment_status: 'unpaid' });
    const r = await signed(env, completed(s)); assert.equal(r.status, 200); assert.match(r.body.skipped, /unpaid/);
    assert.equal((await call(env, 'GET', `/v1/stripe/session?id=${s.id}`)).body.status, 'pending');
    const r2 = await signed(env, { id: 'evt_a', type: 'checkout.session.async_payment_succeeded', livemode: false, data: { object: { ...s, payment_status: 'paid' } } });
    assert.equal(r2.body.issued, true);
});

test('sandbox link never matches a live session (and the reverse)', async () => {
    const env = envBase();
    const r = await signed(env, completed(session({ livemode: true, id: 'cs_live_aaaaaaaaaaaaaaaa' })));
    assert.match(r.body.skipped, /not a GreenTools/);
    const r2 = await signed(env, completed(session({ payment_link: 'plink_L_KIT' })));
    assert.match(r2.body.skipped, /not a GreenTools/);
});

test('All-Access key unlocks all five tools; full refund revokes it, partial refund does not', async () => {
    const env = envBase(); const s = session({ payment_link: 'plink_T_ALL', amount_total: 999, payment_intent: 'pi_all' });
    await signed(env, completed(s));
    const key = (await call(env, 'GET', `/v1/stripe/session?id=${s.id}`)).body.key;
    assert.match(key, /^GT-ALLACCESS-/);
    for (const p of ['snapfit', 'blotout', 'lockfit', 'metagone', 'docburn']) assert.equal((await call(env, 'POST', '/v1/unlock', { body: { product: p, key } })).status, 200, p);
    await signed(env, { id: 'evt_r1', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_1', refunded: false, amount_refunded: 100, payment_intent: 'pi_all', currency: 'usd', livemode: false } } });
    assert.equal((await call(env, 'POST', '/v1/unlock', { body: { product: 'snapfit', key } })).status, 200);
    const r = await signed(env, { id: 'evt_r2', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_1', refunded: true, amount_refunded: 999, payment_intent: 'pi_all', currency: 'usd', livemode: false } } });
    assert.equal(r.body.revoked, true);
    const u = await call(env, 'POST', '/v1/unlock', { body: { product: 'snapfit', key } });
    assert.equal(u.status, 403); assert.match(u.body.error, /refunded/);
    assert.ok(mails.some((m) => /^\[TEST\] Refund: GreenTools All-Access/.test(m.subject)));
});

test('StackGrade subscription: key -> account tier; portal plan change; cancel at period end; deleted locks; browser verify endpoint', async () => {
    const env = envBase(); const t0 = Date.now();
    const s = session({ payment_link: 'plink_T_PRO_M', amount_total: 1900, subscription: 'sub_1', payment_intent: null, invoice: 'in_1', customer: 'cus_sg' });
    await signed(env, completed(s));
    const key = (await call(env, 'GET', `/v1/stripe/session?id=${s.id}`)).body.key;
    assert.match(key, /^SG-PRO-/);
    assert.ok(mails.find((m) => m.to[0] === 'buyer@example.com').text.includes('Manage billing, invoices or cancel: https://billing.stripe.com/p/login/test_x'));
    let v = await call(env, 'POST', '/v1/license/verify', { body: { key } });
    assert.equal(v.status, 200); assert.equal(v.body.tier, 'pro'); assert.equal(v.body.monitors, 25);
    const me = await call(env, 'GET', '/v1/me', { headers: { authorization: `Bearer ${key}` } });
    assert.equal(me.status, 200); assert.equal(me.body.account.tier, 'pro');
    // upgrade in the portal
    await signed(env, { id: 'evt_u1', type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: false, items: { data: [{ price: { id: 'price_T_AG_M' }, current_period_end: Math.floor(t0 / 1000) + 86400 * 30 }] } } } });
    v = await call(env, 'POST', '/v1/license/verify', { body: { key } }); assert.equal(v.body.tier, 'agency');
    // cancel at period end keeps access until then
    const end = Math.floor(t0 / 1000) + 86400 * 10;
    await signed(env, { id: 'evt_u2', type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: true, items: { data: [{ price: { id: 'price_T_AG_M' }, current_period_end: end }] } } } });
    const bv = await call(env, 'POST', '/v1/stripe/verify', { body: { key } });
    assert.equal(bv.status, 200); assert.equal(bv.body.tier, 'agency'); assert.equal(bv.body.lockAt, new Date(end * 1000).toISOString()); assert.equal(bv.body.key, undefined);
    // deleted -> locked everywhere
    const d = await signed(env, { id: 'evt_d', type: 'customer.subscription.deleted', livemode: false, data: { object: { id: 'sub_1', status: 'canceled' } } });
    assert.equal(d.body.status, 'canceled');
    v = await call(env, 'POST', '/v1/license/verify', { body: { key } }); assert.equal(v.status, 403); assert.match(v.body.error, /ended/);
    assert.equal((await call(env, 'POST', '/v1/stripe/verify', { body: { key } })).status, 403);
    assert.ok(mails.some((m) => /^\[TEST\] Cancellation: StackGrade/.test(m.subject)));
    // a GT key is not a StackGrade account
    const g = session({ id: 'cs_test_gtkeyforsgcheck1' }); await signed(env, completed(g));
    const gk = (await call(env, 'GET', `/v1/stripe/session?id=${g.id}`)).body.key;
    assert.equal((await call(env, 'POST', '/v1/license/verify', { body: { key: gk } })).status, 403);
});

test('subscription refund without a payment_intent falls back to the one active key of that customer', async () => {
    const env = envBase();
    const s = session({ payment_link: 'plink_T_PRO_M', amount_total: 1900, subscription: 'sub_9', payment_intent: null, invoice: 'in_9', customer: 'cus_9' });
    await signed(env, completed(s));
    const r = await signed(env, { id: 'evt_rr', type: 'charge.refunded', livemode: false, data: { object: { id: 'ch_9', refunded: true, amount_refunded: 1900, customer: 'cus_9', currency: 'usd', livemode: false } } });
    assert.equal(r.body.revoked, true);
});

test('Gumroad keys are unchanged: unknown non-Stripe key still goes to Gumroad', async () => {
    const env = envBase();
    const r = await call(env, 'POST', '/v1/unlock', { body: { product: 'snapfit', key: 'ABCDEF12-ABCDEF12-ABCDEF12-ABCDEF12' } });
    assert.equal(r.status, 403); assert.match(r.body.error, /receipt email/);
    const h = await call(env, 'GET', '/v1/health'); assert.equal(h.body.stripe.webhook, true);
});

test('session lookup validates the id', async () => {
    const env = envBase();
    assert.equal((await call(env, 'GET', '/v1/stripe/session?id=nope')).status, 400);
});
