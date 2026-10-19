import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePing } from '../src/index.js';
import { renderSaleEmail } from '../src/salenotify.js';
const kvMem = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k), list: async () => ({ keys: [] }) }; };
test('ping sends one notification per new sale, no PII beyond first initial; totals skip test sales; failure never throws', async () => {
  const KV = kvMem(); const sent = [];
  const env = { KV, RESEND_API_KEY: 're_test', SALE_NOTIFY_FROM: 'FortHire sales <s@forthire.com>', SALE_NOTIFY_TO: 'productbuilder+sale@mail.grokbot.com' };
  const fetchImpl = async (u, init) => { if (String(u).includes('resend')) { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } throw new Error('no gumroad'); };
  const body = (o) => new URLSearchParams({ sale_id: 'S1', product_name: 'BlotOut', price: '99', currency: 'usd', email: 'jane@example.com', ...o }).toString();
  await handlePing(env, body({ test: 'false' }), 'application/x-www-form-urlencoded', { fetchImpl });
  await handlePing(env, body({ test: 'false' }), 'application/x-www-form-urlencoded', { fetchImpl });   // Gumroad retry
  assert.equal(sent.length, 1); assert.equal(sent[0].subject, 'Sale: BlotOut $0.99'); assert.deepEqual(sent[0].to, ['productbuilder+sale@mail.grokbot.com']);
  assert.match(sent[0].text, /Buyer: j\./); assert.ok(!sent[0].text.includes('jane')); assert.match(sent[0].text, /Today \(CT, real sales only\): 1 sale, 0 refunds, net \$0\.99/);
  await handlePing(env, body({ sale_id: 'S2', test: 'true' }), 'application/x-www-form-urlencoded', { fetchImpl });
  assert.match(sent[1].subject, /^\[TEST\] Sale/); assert.match(sent[1].text, /1 sale,/);
  await handlePing(env, body({ sale_id: 'S1', resource_name: 'refund', test: 'false' }), 'application/x-www-form-urlencoded', { fetchImpl });
  assert.equal(sent[2].subject, 'Refund: BlotOut $0.99'); assert.match(sent[2].text, /1 refund, net \$0\.00/);
  const rec = await handlePing(env, body({ sale_id: 'S3' }), 'application/x-www-form-urlencoded', { fetchImpl: async (u) => { if (String(u).includes('resend')) throw new Error('down'); throw new Error('x'); } });
  assert.ok(rec.id);
});
test('subject format', () => { assert.equal(renderSaleEmail({ resource: 'sale', productName: 'FortHire Pro', price: '6000', currency: 'usd' }, { now: Date.now(), brand: 'FortHire' }).subject, 'Sale: FortHire Pro $60.00'); });
