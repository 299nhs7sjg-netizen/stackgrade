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

const PERIOD_MONTHS = { monthly: 1, quarterly: 3, biannually: 6, yearly: 12, every_two_years: 24 };
function addMonths(t, n) {
    const d = new Date(t);
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.getTime();
}
// End of the billing period that was running when the membership was cancelled, or null if it cannot be determined
// (unknown recurrence or start date). Billing periods are anchored on the purchase date.
export function paidThrough(purchase) {
    const months = PERIOD_MONTHS[purchase?.recurrence];
    const start = Date.parse(purchase?.created_at || purchase?.sale_timestamp || '');
    const cancelled = Date.parse(purchase?.subscription_cancelled_at || '');
    if (!months || !Number.isFinite(start) || !Number.isFinite(cancelled) || cancelled < start) return null;
    let end = addMonths(start, months); let n = 1;
    while (end <= cancelled && n < 600) end = addMonths(start, months * ++n);
    return end;
}

// Decide whether a Gumroad purchase is currently entitled. Returns { ok, definitive, reason, lockAt? }.
export function evaluatePurchase(p = {}, now = Date.now()) {
    if (p.refunded || p.chargebacked || p.disputed) return { ok: false, definitive: true, reason: 'This purchase was refunded, charged back or disputed, so the license is no longer active.' };
    if (p.subscription_ended_at) return { ok: false, definitive: true, reason: `This membership ended on ${String(p.subscription_ended_at).slice(0, 10)}.` };
    if (p.subscription_failed_at) return { ok: false, definitive: true, reason: `The membership payment failed on ${String(p.subscription_failed_at).slice(0, 10)}. Update your card on Gumroad to restore access.` };
    if (p.subscription_cancelled_at) {
        const end = paidThrough(p);
        if (end && now < end) return { ok: true, lockAt: end, reason: `Membership cancelled; access continues until ${new Date(end).toISOString().slice(0, 10)}.` };
        return { ok: false, definitive: true, reason: `This membership was cancelled${end ? ` and its paid period ended on ${new Date(end).toISOString().slice(0, 10)}` : ''}.` };
    }
    return { ok: true }; // one-time purchases have no subscription_* fields
}

async function verifyOne(productId, key, fetchImpl, now) {
    const body = new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: 'false' });
    let res; let data = null;
    try {
        res = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        data = await res.json().catch(() => null);
    } catch { return { ok: false, definitive: false, reason: 'Could not reach Gumroad to verify the license. Check your connection and try again.' }; }
    if (!data || (res.status >= 500 && data.success !== false)) return { ok: false, definitive: false, reason: 'Gumroad did not answer the license check. Try again shortly.' };
    if (data.success !== true) return { ok: false, definitive: true, notFound: true, reason: data.message || 'That license key is not valid.' };
    return { ...evaluatePurchase(data.purchase || {}, now), purchase: data.purchase || {} };
}

// products: { tierId: productId } (empty ids are skipped). Checks every product in parallel; the highest valid tier wins.
// Returns { ok, tier, definitive, reason, lockAt?, recurrence? }.
export async function verifyLicense(key, products, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
    const k = String(key || '').trim();
    const list = Object.entries(products || {}).filter(([t, id]) => TIERS[t] && String(id || '').trim());
    if (!list.length) return { ok: false, definitive: true, reason: 'No paid plans are on sale yet.' };
    if (!k || k.length < 8 || k.length > 200 || /[\s<>"']/.test(k)) return { ok: false, definitive: true, reason: 'Enter the license key from your Gumroad receipt.' };
    const results = await Promise.all(list.map(async ([tier, id]) => ({ tier, ...(await verifyOne(String(id).trim(), k, fetchImpl, now)) })));
    const good = results.filter((r) => r.ok).sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank);
    if (good.length) {
        const g = good[0];
        return { ok: true, tier: g.tier, lockAt: g.lockAt, recurrence: g.purchase?.recurrence || null, reason: g.reason };
    }
    // A key that exists for some product but is refunded/cancelled is more informative than "not found" elsewhere.
    const found = results.find((r) => r.definitive && !r.notFound);
    if (found) return { ok: false, definitive: true, tier: found.tier, reason: found.reason };
    const transient = results.find((r) => !r.definitive);
    if (transient) return { ok: false, definitive: false, reason: transient.reason };
    return { ok: false, definitive: true, reason: results[0].reason };
}
