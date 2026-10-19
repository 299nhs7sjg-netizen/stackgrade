// Stripe fulfillment for GreenTools (micro-tools) and StackGrade. Payment links -> signed webhook -> our own key.
//   POST /v1/stripe/webhook      Stripe events (signature checked with STRIPE_WEBHOOK_SECRET; missing secret = 503)
//   GET  /v1/stripe/session?id=  thanks page lookup: { status: "ready", key, ... } or { status: "pending" }
//   POST /v1/stripe/verify       { key, product? } -> key status, for browser verifiers (license.js, widget)
// Keys: GT-<TOOL>-XXXX-XXXX-XXXX-XXXX (micro-tools, unlock via /v1/unlock) and SG-<PLAN>-XXXX-XXXX-XXXX-XXXX
// (StackGrade plans, resolved by licenseAccount). A key is derived from the checkout session id with an HMAC, so a
// retried or duplicated webhook produces the same key and the same records (idempotent per session).
// KV: skey:<sha256> key record (no plaintext key) | ssess:<session> thanks-page record (plaintext key, 30-day TTL)
//     ssub:<subscription> / spi:<payment_intent> / sinv:<invoice> -> key hash | scus:<customer> -> [key hashes]
//   POST /v1/stripe/portal       { key } -> { url } customer portal login link (for Stripe keys only)
// Vars: GT_EMAIL_FROM, SG_EMAIL_FROM (buyer email senders; empty = no buyer email, the thanks page still shows the key),
//       STRIPE_PORTAL_URL (portal login link). Secrets: STRIPE_WEBHOOK_SECRET, RESEND_API_KEY. No Stripe API key is used.
import { catalogIndex, CATALOG } from './stripe-config.js';
import { notifySale, money } from './salenotify.js';
import { sha256hex, HttpError, rateLimit, clientIp, readJson } from './util.js';

const te = new TextEncoder();
const DAY = 86400000;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const hmac = async (secret, msg) => {
    const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(msg)));
};
export const stripeSign = async (secret, t, body) => hex(await hmac(secret, `${t}.${body}`));
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export async function verifyStripeSig(secret, header, body, now = Date.now(), tol = 300) {
    if (!secret || !header) return false;
    let t = null; const v1 = [];
    for (const p of String(header).split(',')) { const i = p.indexOf('='); const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k === 't') t = v; if (k === 'v1' && v) v1.push(v); }
    if (!t || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > tol || !v1.length) return false;
    const want = await stripeSign(secret, t, body);
    return v1.some((s) => safeEq(s, want));
}

// ---- keys ----
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O, U
export const STRIPE_KEY_RE = /^(GT|SG)-[A-Z]{2,12}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
export const isStripeKey = (k) => STRIPE_KEY_RE.test(String(k || '').trim().toUpperCase());
export async function deriveKey(secret, prefix, sessionId) {
    const b = await hmac(secret, `key:v1:${sessionId}`);
    let bits = 0, val = 0, out = '';
    for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5 && out.length < 16) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } if (out.length >= 16) break; }
    return `${prefix}-${out.match(/.{4}/g).join('-')}`;
}
export const keyHash = (key) => sha256hex(`skey:${String(key).trim().toUpperCase()}`);
const ACTIVE = new Set(['active', 'trialing', 'past_due']);   // past_due: Stripe is still retrying the card

// Status of a Stripe-issued key from KV. { ok, definitive: true, kind, products?, tier?, lockAt?, reason? }
export async function stripeKeyStatus(env, key, now = Date.now()) {
    const k = String(key || '').trim().toUpperCase();
    if (!STRIPE_KEY_RE.test(k)) return { ok: false, definitive: true, notFound: true, reason: 'That is not a valid key.' };
    const rec = await env.KV.get(`skey:${await keyHash(k)}`, 'json');
    if (!rec) return { ok: false, definitive: true, notFound: true, reason: 'That key was not found. Check it against your receipt email.' };
    const base = { kind: rec.kind, name: rec.name, products: rec.products || null, tier: rec.tier || null, recurring: !!rec.subscription, lockAt: rec.lockAt || null, test: !rec.livemode };
    if (rec.status === 'refunded') return { ...base, ok: false, definitive: true, reason: 'This purchase was refunded, so the key is no longer active.' };
    if (!ACTIVE.has(rec.status)) return { ...base, ok: false, definitive: true, reason: rec.status === 'canceled' ? 'This subscription has ended. Subscribe again to restore access.' : `This subscription is not active (${rec.status}). Update your payment method to restore access.` };
    if (rec.lockAt && now >= rec.lockAt) return { ...base, ok: false, definitive: true, reason: `This subscription was canceled and its paid period ended on ${new Date(rec.lockAt).toISOString().slice(0, 10)}.` };
    return { ...base, ok: true, key: k, reason: rec.lockAt ? `Subscription canceled; access continues until ${new Date(rec.lockAt).toISOString().slice(0, 10)}.` : null };
}

// ---- helpers ----
const maskEmail = (e) => { const s = String(e || ''); const i = s.indexOf('@'); return i > 0 ? `${s[0]}***${s.slice(i)}` : null; };
const getJ = (env, k) => env.KV.get(k, 'json');
const putJ = (env, k, v, opt) => env.KV.put(k, JSON.stringify(v), opt);
const brandOf = (e) => (e.kind === 'gt' ? 'GreenTools' : 'StackGrade');
const periodEnd = (sub) => Number(sub?.current_period_end || sub?.items?.data?.[0]?.current_period_end || 0) * 1000 || null;
export function matchSession(session, index = catalogIndex()) {
    const ids = [session.payment_link, ...(session.line_items?.data || []).map((li) => li.price?.id)].filter(Boolean);
    for (const id of ids) { const hit = index.get(id); if (hit && hit.livemode === !!session.livemode) return hit.entry; }
    // Fallback: metadata.product (+ metadata.interval) copied from the payment link. Only GreenTools/StackGrade slugs match.
    const slug = session.metadata?.product, iv = session.metadata?.interval;
    if (slug) return CATALOG.find((e) => e.slug === slug && (!e.interval || e.interval === (iv === 'year' || iv === 'yearly' ? 'yearly' : 'monthly'))) || null;
    return null;
}

async function sendResend(env, msg, idem, fetchImpl) {
    if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not set' };
    const r = await fetchImpl('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': idem.slice(0, 256) }, body: JSON.stringify(msg) });
    return { sent: r.ok, status: r.status };
}
export function renderKeyEmail({ entry, key, session, now, portal = '' }) {
    const test = !session.livemode;
    const amount = money(session.amount_total, session.currency);
    const gt = entry.kind === 'gt';
    const how = gt
        ? (entry.products.length > 1
            ? ['To unlock a tool, open it, tap Unlock and paste the key. The same key unlocks all five tools:', ...CATALOG.filter((e) => e.kind === 'gt' && e.products.length === 1).map((e) => `  ${e.name.split(' ')[0]}: ${e.site}/#gt-k=${key}`)]
            : [`To unlock, open ${entry.site}/#gt-k=${key}`, 'or open the tool, tap Unlock and paste the key. Use the same key on each of your devices.'])
        : [`To activate, open ${entry.site}/app/ and paste the key in the License box. Use the same key on each of your devices.`];
    const lines = [`Thanks for buying ${entry.name}.`, '', `Your key: ${key}`, '', ...how, '', 'Receipt',
        `Product: ${entry.name}`, `Amount paid: ${amount} ${String(session.currency || '').toUpperCase()}`, `Date: ${new Date(now).toISOString().slice(0, 10)}`,
        `Order reference: ${String(session.id).slice(-10)}`, session.subscription ? `Billing: renews ${entry.interval || 'each period'} until you cancel.` : 'Billing: one-time payment, no renewal.',
        session.subscription && portal ? `To cancel, update your card or download invoices: ${portal} (sign in with this email address).` : '', '', 'Keep this email. The key is what unlocks your purchase on another device.', 'Questions? Reply to this email.'];
    return { subject: `${test ? '[TEST] ' : ''}Your ${entry.name} key`, text: lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n') };
}

// ---- fulfillment ----
export async function fulfillSession(env, session, { now = Date.now(), fetchImpl = globalThis.fetch, index } = {}) {
    if (!['paid', 'no_payment_required'].includes(session.payment_status)) return { skipped: `payment_status ${session.payment_status}` };
    const entry = matchSession(session, index);
    if (!entry) { console.log(JSON.stringify({ stripe: 'unmatched session', plink: session.payment_link || null, livemode: !!session.livemode })); return { skipped: 'not a GreenTools or StackGrade payment link' }; }
    const prior = await getJ(env, `ssess:${session.id}`);
    if (prior) return { duplicate: true, keyHash: prior.h };
    const key = await deriveKey(env.STRIPE_WEBHOOK_SECRET, entry.prefix, session.id);
    const h = await keyHash(key);
    const email = session.customer_details?.email || session.customer_email || null;
    const rec = { kind: entry.kind, entry: entry.id, name: entry.name, products: entry.products || null, tier: entry.tier || null, status: 'active', lockAt: null,
        livemode: !!session.livemode, customer: session.customer || null, subscription: session.subscription || null, session: session.id,
        paymentIntent: session.payment_intent || null, invoice: session.invoice || null, amount: session.amount_total ?? null, currency: session.currency || null,
        email: maskEmail(email), created: now, updated: now };
    await putJ(env, `skey:${h}`, rec);
    if (rec.subscription) await env.KV.put(`ssub:${rec.subscription}`, h);
    if (rec.paymentIntent) await env.KV.put(`spi:${rec.paymentIntent}`, h);
    if (rec.invoice) await env.KV.put(`sinv:${rec.invoice}`, h);
    if (rec.customer) { const l = (await getJ(env, `scus:${rec.customer}`)) || []; if (!l.includes(h)) await putJ(env, `scus:${rec.customer}`, [...l, h].slice(-50)); }
    const out = { issued: true, keyHash: h, entry: entry.id };
    const from = entry.kind === 'gt' ? env.GT_EMAIL_FROM : env.SG_EMAIL_FROM;
    if (email && from) {
        const m = renderKeyEmail({ entry, key, session, now, portal: env.STRIPE_PORTAL_URL || '' });
        try { out.buyerEmail = await sendResend(env, { from, to: [email], subject: m.subject, text: m.text, tags: [{ name: 'kind', value: 'stripe-key' }] }, `stripe-key-${session.id}`, fetchImpl); }
        catch (e) { out.buyerEmail = { sent: false, reason: String(e?.message || e) }; }
    } else out.buyerEmail = { sent: false, reason: email ? `${entry.kind === 'gt' ? 'GT' : 'SG'}_EMAIL_FROM not set` : 'no buyer email' };
    try { out.notify = await notifySale(env, { resource: 'sale', saleId: session.id, productName: entry.name, price: session.amount_total, currency: session.currency, test: !session.livemode, email, recurrence: entry.interval || null }, { brand: `${brandOf(entry)} (Stripe)`, now, fetchImpl }); } catch {}
    // Written last: if anything above throws, Stripe retries and the derived key makes the retry produce the same records.
    await putJ(env, `ssess:${session.id}`, { key, h, kind: entry.kind, name: entry.name, products: rec.products, tier: rec.tier, site: entry.site, at: now, livemode: rec.livemode }, { expirationTtl: 30 * 86400 });
    return out;
}

async function updateRecord(env, h, patch, now) {
    const rec = await getJ(env, `skey:${h}`); if (!rec) return null;
    const next = { ...rec, ...patch, updated: now };
    await putJ(env, `skey:${h}`, next);
    return { before: rec, after: next };
}
export async function onSubscription(env, sub, deleted, { now = Date.now(), fetchImpl = globalThis.fetch, index = catalogIndex() } = {}) {
    const h = await env.KV.get(`ssub:${sub.id}`);
    if (!h) return { skipped: 'unknown subscription' };
    const patch = deleted ? { status: 'canceled', lockAt: now } : { status: sub.status, lockAt: sub.cancel_at_period_end ? periodEnd(sub) : sub.cancel_at ? sub.cancel_at * 1000 : null };
    if (!deleted) { // plan change in the customer portal: the subscription's price decides the tier
        const price = sub.items?.data?.[0]?.price?.id; const hit = price && index.get(price);
        if (hit && hit.entry.kind === 'sg') { patch.tier = hit.entry.tier; patch.name = hit.entry.name; patch.entry = hit.entry.id; }
    }
    const r = await updateRecord(env, h, patch, now);
    if (r && deleted) try { await notifySale(env, { resource: 'cancellation', saleId: sub.id, productName: r.after.name, price: 0, currency: r.after.currency || 'usd', test: !r.after.livemode }, { brand: `${r.after.kind === 'gt' ? 'GreenTools' : 'StackGrade'} (Stripe)`, now, fetchImpl }); } catch {}
    return r ? { updated: true, status: r.after.status, lockAt: r.after.lockAt, tier: r.after.tier } : { skipped: 'record missing' };
}
export async function onRefund(env, charge, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
    if (!charge.refunded) return { skipped: 'partial refund' };   // only a full refund revokes the key
    let h = (charge.payment_intent && await env.KV.get(`spi:${charge.payment_intent}`)) || (charge.invoice && await env.KV.get(`sinv:${charge.invoice}`)) || null;
    if (!h && charge.customer) { // subscription charges (no payment_intent on the session): one active key for this customer
        const l = (await getJ(env, `scus:${charge.customer}`)) || [];
        const recs = (await Promise.all(l.map(async (x) => [x, await getJ(env, `skey:${x}`)]))).filter(([, r]) => r && r.livemode === !!charge.livemode && ACTIVE.has(r.status));
        if (recs.length === 1) h = recs[0][0];
    }
    if (!h) { console.log(JSON.stringify({ stripe: 'refund not matched to a key', charge: charge.id })); return { skipped: 'no matching key' }; }
    const r = await updateRecord(env, h, { status: 'refunded', lockAt: now }, now);
    if (r) try { await notifySale(env, { resource: 'refund', saleId: charge.id, productName: r.after.name, price: charge.amount_refunded, currency: charge.currency, test: !charge.livemode }, { brand: `${r.after.kind === 'gt' ? 'GreenTools' : 'StackGrade'} (Stripe)`, now, fetchImpl }); } catch {}
    return r ? { revoked: true } : { skipped: 'record missing' };
}

// ---- routes ----
export async function stripeWebhook(req, env, { now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
    if (!env.STRIPE_WEBHOOK_SECRET) return { status: 503, body: { ok: false, error: 'Stripe is not configured.' } };
    const raw = await req.text();
    if (raw.length > 512 * 1024) return { status: 413, body: { ok: false, error: 'Too large.' } };
    if (!(await verifyStripeSig(env.STRIPE_WEBHOOK_SECRET, req.headers.get('stripe-signature'), raw, now))) return { status: 400, body: { ok: false, error: 'Bad signature.' } };
    let ev; try { ev = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, error: 'Bad JSON.' } }; }
    const o = ev?.data?.object || {};
    let result = { ignored: ev.type };
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') result = await fulfillSession(env, o, { now, fetchImpl });
    else if (ev.type === 'customer.subscription.updated') result = await onSubscription(env, o, false, { now, fetchImpl });
    else if (ev.type === 'customer.subscription.deleted') result = await onSubscription(env, o, true, { now, fetchImpl });
    else if (ev.type === 'charge.refunded') result = await onRefund(env, o, { now, fetchImpl });
    console.log(JSON.stringify({ stripe: ev.type, livemode: !!ev.livemode, result: Object.keys(result)[0] }));
    return { status: 200, body: { ok: true, received: ev.type, ...result } };
}
export async function stripeSession(req, env, url, now = Date.now()) {
    if (!rateLimit(`ss:${clientIp(req)}`, 60, 300000)) throw new HttpError(429, 'Too many requests. Wait a few minutes.');
    const id = String(url.searchParams.get('id') || '');
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(id)) throw new HttpError(400, 'Missing or invalid session id.');
    const s = await getJ(env, `ssess:${id}`);
    if (!s) return { ok: true, status: 'pending', message: 'Payment received. Your key is on its way: check your email in a few minutes.' };
    if (now - s.at > 7 * DAY) return { ok: true, status: 'expired', message: 'Your key was sent to the email address you used at checkout.' };
    return { ok: true, status: 'ready', key: s.key, kind: s.kind, name: s.name, products: s.products, tier: s.tier, site: s.site, test: !s.livemode };
}
export async function stripeVerify(req, env, now = Date.now()) {
    if (!rateLimit(`sv:${clientIp(req)}`, 30, 60000)) throw new HttpError(429, 'Too many checks. Wait a minute.');
    const b = await readJson(req, 2048);
    const r = await stripeKeyStatus(env, b.key, now);
    const product = b.product ? String(b.product).toLowerCase() : null;
    if (r.ok && product && !(r.products || []).includes(product)) return { status: 403, body: { ok: false, definitive: true, reason: 'That key is for a different product.' } };
    const { key, ...pub } = r;
    return { status: r.ok ? 200 : 403, body: { ...pub, lockAt: r.lockAt ? new Date(r.lockAt).toISOString() : null } };
}
export const stripeHealth = (env) => ({ webhook: !!env.STRIPE_WEBHOOK_SECRET, mapped: catalogIndex().size, buyerEmail: { gt: !!env.GT_EMAIL_FROM, sg: !!env.SG_EMAIL_FROM }, portal: !!env.STRIPE_PORTAL_URL });

// Manage billing: the Stripe customer portal login link (STRIPE_PORTAL_URL, live or sandbox per Worker). Stripe emails the
// buyer a one-time code there. Only answered for a known Stripe key, so the page can show the button just for Stripe buyers.
export async function stripePortal(req, env) {
    if (!rateLimit(`sp:${clientIp(req)}`, 20, 600000)) throw new HttpError(429, 'Too many requests. Wait a few minutes.');
    if (!env.STRIPE_PORTAL_URL) return { status: 503, body: { ok: false, error: 'Billing management is not available yet. Email support and we will help.' } };
    const b = await readJson(req, 2048);
    const k = String(b.key || '').trim().toUpperCase();
    if (!STRIPE_KEY_RE.test(k)) return { status: 400, body: { ok: false, error: 'Manage billing works for keys bought through Stripe (they start with GT- or SG-).' } };
    const rec = await getJ(env, `skey:${await keyHash(k)}`);
    if (!rec) return { status: 404, body: { ok: false, error: 'No billing account was found for that key.' } };
    return { status: 200, body: { ok: true, url: env.STRIPE_PORTAL_URL } };
}
