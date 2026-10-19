// Instant sale/refund notification for every Gumroad Ping (the ping is store-wide: StackGrade, FortHire Pro, featured
// listings, Signals and the micro-tools all arrive here). One transactional email per NEW ping (deduped on sale_id +
// resource) through Resend to SALE_NOTIFY_TO. No buyer data beyond the first initial of the email. Fire-and-forget:
// callers wrap it in catch(); it never throws into the ping handler and times out after 8 s.
export const SALE_NOTIFY_TO_DEFAULT = 'productbuilder+sale@mail.grokbot.com';
const ctDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const ctTime = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT';
export const isRefund = (s) => s.resource === 'refund' || s.refunded === true || s.resource === 'dispute';
export function money(cents, cur = 'usd') { const n = (Number(cents) || 0) / 100; return (String(cur).toLowerCase() === 'usd' ? '$' : '') + n.toFixed(2) + (String(cur).toLowerCase() === 'usd' ? '' : ' ' + String(cur).toUpperCase()); }
// Running totals (non-test only) in KV: saletot:<YYYY-MM-DD> and saletot:<YYYY-MM> (CT), { n, refunds, cents: {cur: net} }.
export async function bumpTotals(env, s, now) {
  const out = {};
  for (const k of [ctDay(now), ctDay(now).slice(0, 7)]) {
    const t = (await env.KV.get('saletot:' + k, 'json')) || { n: 0, refunds: 0, cents: {} };
    if (!s.test) { const cur = (s.currency || 'usd').toLowerCase(), c = Number(s.price) || 0; if (isRefund(s)) { t.refunds++; t.cents[cur] = (t.cents[cur] || 0) - c; } else if (s.resource === 'sale') { t.n++; t.cents[cur] = (t.cents[cur] || 0) + c; } await env.KV.put('saletot:' + k, JSON.stringify(t), { expirationTtl: 400 * 86400 }); }
    out[k.length === 7 ? 'month' : 'day'] = t;
  }
  return out;
}
const fmtTot = (t) => `${t.n} sale${t.n === 1 ? '' : 's'}, ${t.refunds} refund${t.refunds === 1 ? '' : 's'}, net ${Object.entries(t.cents).map(([c, v]) => money(v, c)).join(' + ') || '$0.00'}`;
export function renderSaleEmail(s, { now, totals, brand }) {
  const kind = s.label || (isRefund(s) ? 'Refund' : s.resource === 'sale' ? 'Sale' : s.resource.charAt(0).toUpperCase() + s.resource.slice(1));
  const product = s.productName || s.productPermalink || s.productId || 'unknown product';
  const subject = `${s.test ? '[TEST] ' : ''}${kind}: ${product} ${money(s.price, s.currency)}`;
  const text = [`${kind}: ${product}`, `Brand: ${brand}`, `Amount: ${money(s.price, s.currency)}`, `Currency: ${String(s.currency || '').toUpperCase()}`, `Test: ${s.test ? 'yes' : 'no'}`,
    s.recurrence ? `Recurrence: ${s.recurrence}${s.isRecurringCharge ? ' (renewal)' : ''}` : '', `Buyer: ${String(s.email || '').slice(0, 1) || '?'}.`, `Time: ${ctTime(now)}`, ...(s.extra || []), '',
    totals ? `Today (CT, real sales only): ${fmtTot(totals.day)}` : '', totals ? `Month to date: ${fmtTot(totals.month)}` : ''].filter((x) => x !== '').join('\n');
  return { subject, text };
}
export async function notifySale(env, s, { brand, now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (!env.RESEND_API_KEY || !env.SALE_NOTIFY_FROM) return { sent: false, reason: 'not configured' };
  let totals = null; try { totals = await bumpTotals(env, s, now); } catch {}
  const m = renderSaleEmail(s, { now, totals, brand });
  const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(8000), headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `sale-${s.saleId || ''}-${s.resource}`.slice(0, 256) },
    body: JSON.stringify({ from: env.SALE_NOTIFY_FROM, to: [env.SALE_NOTIFY_TO || SALE_NOTIFY_TO_DEFAULT], subject: m.subject, text: m.text, tags: [{ name: 'kind', value: 'sale-notify' }] }) });
  return { sent: r.ok, status: r.status };
}
