// Shared licensing rules for the browser (assets/license.js) and the API Worker (worker/src).
// Pure functions + fetch only, so the same code runs in both places and in Node tests.

export const VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

// Higher rank wins when a key is valid for more than one product.
export const TIERS = {
    free:       { rank: 0, name: 'Free',       monitors: 1,    freq: 'weekly', whiteLabel: false, leads: false, webhooks: true },
    agencykit:  { rank: 1, name: 'Agency Kit', monitors: 1,    freq: 'weekly', whiteLabel: true,  leads: true,  webhooks: true },
    pro:        { rank: 2, name: 'Pro',        monitors: 25,   freq: 'daily',  whiteLabel: false, leads: false, webhooks: true },
    agency:     { rank: 3, name: 'Agency',     monitors: 200,  freq: 'daily',  whiteLabel: true,  leads: true,  webhooks: true },
    agencyplus: { rank: 4, name: 'Agency+',    monitors: 1000, freq: 'daily',  whiteLabel: true,  leads: true,  webhooks: true },
};

// Gumroad booleans are JSON booleans; tolerate "true"/"false" strings and missing (undefined) fields.
const yes = (v) => v === true || v === 'true' || v === 1;
const stamp = (v) => { if (v === null || v === undefined || v === '' || v === false) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? t : NaN; };
const day = (t) => new Date(t).toISOString().slice(0, 10);

// Decide whether a Gumroad purchase is currently entitled. Returns { ok, definitive, reason, lockAt? }.
// Field semantics are taken from Gumroad's open-source code (antiwork/gumroad, see test/tiers.test.js for links):
//  - refunded / chargebacked (one-time products only) / disputed + dispute_won (a won dispute keeps access).
//  - subscription_cancelled_at is set to the END of the paid period when the buyer cancels (Subscription#cancel!
//    uses end_time_of_subscription), so a future value means "cancelled, still paid up": access until then.
//    A past value means the period is over. Gumroad's own Subscription#alive? uses the same rule.
//  - subscription_ended_at / subscription_failed_at set: not alive (lock now).
//  - test: true (seller's own test purchase) is a normal valid purchase.
export function evaluatePurchase(p, now = Date.now()) {
    p = p && typeof p === 'object' ? p : {};
    if (yes(p.refunded) || yes(p.chargebacked) || (yes(p.disputed) && !yes(p.dispute_won))) return { ok: false, definitive: true, reason: 'This purchase was refunded, charged back or disputed, so the license is no longer active.' };
    const ended = stamp(p.subscription_ended_at);
    if (ended !== null) return { ok: false, definitive: true, reason: `This membership ended${Number.isNaN(ended) ? '' : ` on ${day(ended)}`}. Renew it on Gumroad to restore access.` };
    const failed = stamp(p.subscription_failed_at);
    if (failed !== null) return { ok: false, definitive: true, reason: `The membership payment failed${Number.isNaN(failed) ? '' : ` on ${day(failed)}`}. Update your payment method on Gumroad to restore access.` };
    const cancelled = stamp(p.subscription_cancelled_at);
    if (cancelled !== null) {
        if (!Number.isNaN(cancelled) && now < cancelled) return { ok: true, lockAt: cancelled, reason: `Membership cancelled; access continues until ${day(cancelled)}.` };
        return { ok: false, definitive: true, reason: `This membership was cancelled${Number.isNaN(cancelled) ? '' : ` and its paid period ended on ${day(cancelled)}`}.` };
    }
    return { ok: true }; // active membership (subscription_* null or missing) or one-time purchase
}

// Clean up a pasted key: Unicode-normalize, drop invisible characters, quotes and a "License key:" label, turn
// typographic dashes into "-", remove all whitespace, and upper-case Gumroad's hex key format.
export function normalizeKey(raw) {
    let k = String(raw ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
    k = k.replace(/^\s*(?:your\s+)?licen[cs]e(?:\s+key)?\s*[:#=-]?\s*/i, '');
    k = k.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-').replace(/["'`\u2018\u2019\u201C\u201D<>\[\](){}]/g, '').replace(/\s+/g, '');
    if (/^[0-9a-f]{8}(-[0-9a-f]{8}){3}$/i.test(k)) k = k.toUpperCase();
    return k;
}
// Recognise things people paste instead of the license key.
export function keyShapeHint(k) {
    if (!k) return 'Paste the license key from your Gumroad receipt.';
    if (/^\d{5,}$/.test(k)) return 'That looks like an order number, not a license key. The license key has four groups of 8 letters and numbers, like XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX.';
    if (/@/.test(k)) return 'That looks like an email address. Paste the license key from your Gumroad receipt instead.';
    if (/^https?:/i.test(k) || /gumroad\.com/i.test(k)) return 'That looks like a link. Paste the license key itself (four groups of 8 letters and numbers), not the receipt or product link.';
    if (/^[A-Za-z0-9_-]{20,24}==$/.test(k)) return 'That looks like a Gumroad sale or product ID, not a license key. The license key has four groups of 8 letters and numbers.';
    return null;
}

async function verifyOne(productId, key, fetchImpl, now) {
    const body = new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: 'false' });
    let res; let data = null;
    try {
        res = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        data = await res.json().catch(() => null);
    } catch { return { ok: false, definitive: false, reason: 'Could not reach Gumroad to verify the license. Check your connection and try again.' }; }
    if (!data || res.status >= 500 || res.status === 429) return { ok: false, definitive: false, reason: 'Gumroad did not answer the license check. Try again shortly.' };
    if (data.success !== true) {
        const msg = String(data.message || 'That license key is not valid.');
        // "does not exist for the provided product" = wrong key or other product; "disabled" / "expired" = key found but inactive.
        return { ok: false, definitive: true, notFound: !/disabled|expired|revoked/i.test(msg), reason: msg };
    }
    // Imported customers come back with success: true and no purchase object; they are valid.
    return { ...evaluatePurchase(data.purchase, now), purchase: data.purchase || {}, test: yes(data.purchase?.test) };
}

// products: { tierId: productId } (empty ids are skipped). Checks every product in parallel; the highest valid tier wins.
// Returns { ok, tier, definitive, reason, lockAt?, recurrence? }.
export async function verifyLicense(key, products, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
    const k = normalizeKey(key);
    const list = Object.entries(products || {}).filter(([t, id]) => TIERS[t] && String(id || '').trim());
    if (!list.length) return { ok: false, definitive: true, reason: 'No paid plans are on sale yet.' };
    const hint = keyShapeHint(k);
    if (hint) return { ok: false, definitive: true, notFound: true, shape: true, reason: hint };
    if (k.length < 8 || k.length > 200 || /[<>"'\s]/.test(k)) return { ok: false, definitive: true, notFound: true, shape: true, reason: 'Enter the license key from your Gumroad receipt.' };
    const results = await Promise.all(list.map(async ([tier, id]) => ({ tier, ...(await verifyOne(String(id).trim(), k, fetchImpl, now)) })));
    const good = results.filter((r) => r.ok).sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank);
    if (good.length) {
        const g = good[0];
        return { ok: true, tier: g.tier, key: k, lockAt: g.lockAt, recurrence: g.purchase?.recurrence || null, test: !!g.test, reason: g.reason };
    }
    // A key that exists for some product but is refunded/cancelled is more informative than "not found" elsewhere.
    const found = results.find((r) => r.definitive && !r.notFound);
    if (found) return { ok: false, definitive: true, tier: found.tier, reason: found.reason };
    const transient = results.find((r) => !r.definitive);
    if (transient) return { ok: false, definitive: false, reason: transient.reason };
    return { ok: false, definitive: true, notFound: true, reason: results[0].reason };
}
