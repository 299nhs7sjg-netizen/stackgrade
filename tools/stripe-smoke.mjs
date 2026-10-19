// Read-only smoke test of the Stripe routes (writes nothing to KV, safe on production).
//   node tools/stripe-smoke.mjs https://api-staging.<sub>.workers.dev
const B = String(process.argv[2] || '').replace(/\/+$/, '');
if (!B) { console.error('usage: stripe-smoke.mjs <base>'); process.exit(2); }
const H = { 'content-type': 'application/json', origin: 'https://299nhs7sjg-netizen.github.io' };
const j = async (path, init) => { const r = await fetch(B + path, init); return { status: r.status, body: await r.json().catch(() => null) }; };
const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (got ${JSON.stringify(got)})`}`); if (!ok) fails.push(name); };
const h = await j('/v1/health');
check('health reports stripe config', h.status === 200 && h.body?.stripe && typeof h.body.stripe.webhook === 'boolean', h);
const s = await j('/v1/stripe/session?id=cs_test_smokeNOTREAL000000', { headers: H });
check('unknown session = pending + refresh hint', s.status === 200 && s.body?.status === 'pending' && /Refresh this page/.test(s.body?.message || ''), s);
const w = await j('/v1/stripe/webhook', { method: 'POST', headers: { ...H, 'stripe-signature': 't=1,v1=00' }, body: '{"type":"checkout.session.completed"}' });
check(`webhook rejects a bad signature (${h.body?.stripe?.webhook ? '400' : '503 not configured'})`, w.status === (h.body?.stripe?.webhook ? 400 : 503), w);
const v = await j('/v1/stripe/verify', { method: 'POST', headers: H, body: JSON.stringify({ key: 'SG-PRO-0000-0000-0000-0000' }) });
check('verify: unknown SG key = 403', v.status === 403 && v.body?.ok === false, v);
const u = await j('/v1/unlock', { method: 'POST', headers: H, body: JSON.stringify({ product: 'snapfit', key: 'GT-SNAPFIT-0000-0000-0000-0000' }) });
check('unlock: unknown GT key = 403', u.status === 403, u);
if (fails.length) { console.error(`${fails.length} Stripe smoke check(s) failed`); process.exit(1); }
