// StackGrade licensing in the browser (Agency Kit, Pro, Agency, Agency+). Rules live in ./tiers.js (shared with the API Worker).
//
// HONEST LIMITS: verification runs in the visitor's browser against Gumroad's public
// license API. Anyone who edits this JavaScript or their localStorage can bypass it, and a
// license key placed in a public embed snippet can be copied by anyone. This is a
// convenience lock for honest customers, not DRM. There is no "I paid" / honor path.
import { CONFIG } from './config.js';
import { TIERS, VERIFY_URL, verifyLicense } from './tiers.js';

export { VERIFY_URL, TIERS };
export const STORE_KEY = 'sg-agency-kit'; // kept for compatibility; now stores any StackGrade license (with its tier)
export const DAY_MS = 24 * 60 * 60 * 1000;
export const GRACE_MS = 7 * DAY_MS; // keep an already-verified license during Gumroad/network outages, max 7 days

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const defaultStore = () => { try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* blocked */ } return memStore(); };
const https = (u) => (/^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

// { tierId: productId } for every plan in the config.
export function products(cfg = CONFIG) {
    const out = { agencykit: String(cfg?.agencyKit?.productId || '').trim() };
    for (const [t, v] of Object.entries(cfg?.tiers || {})) out[t] = String(v?.productId || '').trim();
    return out;
}
export function productId(cfg = CONFIG) { return String(cfg?.agencyKit?.productId || '').trim(); }
export function checkoutUrl(cfg = CONFIG) { return https(cfg?.agencyKit?.checkoutUrl); }
export function tierCheckout(tier, cfg = CONFIG) { return tier === 'agencykit' ? checkoutUrl(cfg) : https(cfg?.tiers?.[tier]?.checkoutUrl); }
export function isConfigured(cfg = CONFIG) { return Object.values(products(cfg)).some(Boolean); }
const pkey = (cfg) => JSON.stringify(products(cfg));

// Returns { ok: true, tier } | { ok: false, definitive: bool, reason }
export async function verifyKey(key, { cfg = CONFIG, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
    if (!isConfigured(cfg)) return { ok: false, definitive: true, reason: 'Agency Kit is not on sale yet.' };
    return verifyLicense(key, products(cfg), { fetchImpl, now });
}

function read(store) { try { return JSON.parse(store.getItem(STORE_KEY) || 'null'); } catch { return null; } }
const feat = (tier) => ({ tier, plan: TIERS[tier]?.name || tier, whiteLabel: !!TIERS[tier]?.whiteLabel, leads: !!TIERS[tier]?.leads });

// Activate a new key (always hits Gumroad).
export async function activate(key, { cfg = CONFIG, fetchImpl, store = defaultStore(), now = Date.now() } = {}) {
    const r = await verifyKey(key, { cfg, fetchImpl, now });
    if (r.ok) store.setItem(STORE_KEY, JSON.stringify({ key: String(key).trim(), tier: r.tier, products: pkey(cfg), verifiedAt: now, lastOkAt: now, lockAt: r.lockAt || null }));
    return r.ok ? { ...r, ...feat(r.tier) } : r;
}

export function deactivate({ store = defaultStore() } = {}) { store.removeItem(STORE_KEY); }

// Current status. Re-verifies with Gumroad at most once per DAY_MS (and when a cancelled membership's paid period ends).
// Locks on any definitive failure. `unlocked` = white-label features (Agency Kit, Agency, Agency+).
export async function status({ cfg = CONFIG, fetchImpl, store = defaultStore(), now = Date.now() } = {}) {
    if (!isConfigured(cfg)) return { unlocked: false, configured: false, reason: 'Agency Kit is coming soon.' };
    const s = read(store);
    if (!s || !s.key || (s.products && s.products !== pkey(cfg)) || (!s.products && s.productId !== productId(cfg))) return { unlocked: false, configured: true, licensed: false };
    const tier = s.tier || 'agencykit';
    const ok = (extra = {}) => ({ ...feat(extra.tier || tier), unlocked: !!TIERS[extra.tier || tier]?.whiteLabel, licensed: true, configured: true, key: s.key, ...extra });
    if (now - (s.verifiedAt || 0) < DAY_MS && !(s.lockAt && now >= s.lockAt)) return ok({ cached: true });
    const r = await verifyKey(s.key, { cfg, fetchImpl, now });
    if (r.ok) {
        store.setItem(STORE_KEY, JSON.stringify({ ...s, tier: r.tier, products: pkey(cfg), verifiedAt: now, lastOkAt: now, lockAt: r.lockAt || null }));
        return ok({ tier: r.tier });
    }
    if (!r.definitive && now - (s.lastOkAt || 0) < GRACE_MS && !(s.lockAt && now >= s.lockAt)) {
        store.setItem(STORE_KEY, JSON.stringify({ ...s, verifiedAt: now - DAY_MS + 60 * 60 * 1000 })); // retry in ~1h
        return ok({ grace: true });
    }
    store.removeItem(STORE_KEY);
    return { unlocked: false, licensed: false, configured: true, reason: r.reason };
}

// Widget: verify a license passed in an embed snippet, once per page load (in-memory cache).
const pageCache = new Map();
export function verifyForWidget(key, opts = {}) {
    const k = String(key || '').trim();
    if (!pageCache.has(k)) {
        pageCache.set(k, verifyKey(k, opts).then((r) => (r.ok && !TIERS[r.tier]?.whiteLabel ? { ok: false, definitive: true, reason: `The ${TIERS[r.tier]?.name} plan does not include the white-label widget.` } : r.ok ? { ...r, leadsOk: !!TIERS[r.tier]?.leads } : r))
            .catch(() => ({ ok: false, definitive: false })));
    }
    return pageCache.get(k);
}
export function _clearWidgetCache() { pageCache.clear(); }

// ---- embed config ("signed-ish") ----
// The config is base64url JSON plus a short SHA-256 checksum over config + license key.
// This only detects accidental edits or copy/paste damage. It is NOT a security signature:
// anyone can recompute it. Branding removal is enforced only by the Gumroad license check.
const b64u = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); };
async function sha(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function cleanBrand(b = {}) {
    const out = {};
    const name = String(b.name || '').trim().slice(0, 60); if (name) out.name = name;
    const logo = String(b.logo || '').trim(); if (/^https:\/\/[^\s"'<>]{4,500}$/i.test(logo)) out.logo = logo;
    const color = String(b.color || '').replace(/^#/, ''); if (/^[0-9a-f]{6}$/i.test(color)) out.color = color.toLowerCase();
    const cta = String(b.cta || '').trim().slice(0, 40); if (cta) out.cta = cta;
    const ctaUrl = String(b.ctaUrl || '').trim(); if (/^https:\/\/[^\s"'<>]{4,500}$/i.test(ctaUrl)) out.ctaUrl = ctaUrl;
    if (b.hidePowered) out.hidePowered = true;
    if (b.leads) out.leads = true;
    return out;
}
export async function encodeConfig(brand, licenseKey) {
    const json = JSON.stringify(cleanBrand(brand));
    return `${b64u(json)}.${await sha(json + '|' + String(licenseKey || '').trim())}`;
}
export async function decodeConfig(token, licenseKey) {
    const [body, sum] = String(token || '').split('.');
    if (!body || !sum) return null;
    try {
        const json = unb64u(body);
        if (sum !== await sha(json + '|' + String(licenseKey || '').trim())) return null;
        return cleanBrand(JSON.parse(json));
    } catch { return null; }
}
