// Agency Kit licensing: client-side only (StackGrade has no backend).
//
// HONEST LIMITS: verification runs in the visitor's browser against Gumroad's public
// license API. Anyone who edits this JavaScript or their localStorage can bypass it, and a
// license key placed in a public embed snippet can be copied by anyone. This is a
// convenience lock for honest customers, not DRM. There is no "I paid" / honor path.
import { CONFIG } from './config.js';

export const VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
export const STORE_KEY = 'sg-agency-kit';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const GRACE_MS = 7 * DAY_MS; // keep an already-verified license during Gumroad/network outages, max 7 days

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const defaultStore = () => { try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* blocked */ } return memStore(); };

export function productId(cfg = CONFIG) { return String(cfg?.agencyKit?.productId || '').trim(); }
export function checkoutUrl(cfg = CONFIG) {
    const u = String(cfg?.agencyKit?.checkoutUrl || '').trim();
    return /^https:\/\//i.test(u) ? u : '';
}
export function isConfigured(cfg = CONFIG) { return !!productId(cfg); }

// Returns { ok: true } | { ok: false, definitive: bool, reason }
export async function verifyKey(key, { cfg = CONFIG, fetchImpl = globalThis.fetch } = {}) {
    const pid = productId(cfg);
    const k = String(key || '').trim();
    if (!pid) return { ok: false, definitive: true, reason: 'Agency Kit is not on sale yet.' };
    if (!k || k.length < 8 || k.length > 200) return { ok: false, definitive: true, reason: 'Enter the license key from your Gumroad receipt.' };
    const body = new URLSearchParams({ product_id: pid, license_key: k, increment_uses_count: 'false' });
    let res; let data = null;
    try {
        res = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        data = await res.json().catch(() => null);
    } catch {
        return { ok: false, definitive: false, reason: 'Could not reach Gumroad to verify the license. Check your connection and try again.' };
    }
    if (!data || (res.status >= 500 && data.success !== false)) return { ok: false, definitive: false, reason: 'Gumroad did not answer the license check. Try again shortly.' };
    if (data.success !== true) return { ok: false, definitive: true, reason: data.message || 'That license key is not valid for Agency Kit.' };
    const p = data.purchase || {};
    if (p.refunded || p.chargebacked || p.disputed) return { ok: false, definitive: true, reason: 'This purchase was refunded, charged back or disputed, so the license is no longer active.' };
    // One-time purchases have these fields null/absent, so they never lock; they only matter if the product is a membership.
    for (const f of ['subscription_ended_at', 'subscription_cancelled_at', 'subscription_failed_at']) {
        if (p[f]) return { ok: false, definitive: true, reason: `This membership is no longer active (${f.replace('subscription_', '').replace('_at', '')} ${String(p[f]).slice(0, 10)}).` };
    }
    return { ok: true };
}

function read(store) { try { return JSON.parse(store.getItem(STORE_KEY) || 'null'); } catch { return null; } }

// Activate a new key (always hits Gumroad).
export async function activate(key, { cfg = CONFIG, fetchImpl, store = defaultStore(), now = Date.now() } = {}) {
    const r = await verifyKey(key, { cfg, fetchImpl });
    if (r.ok) store.setItem(STORE_KEY, JSON.stringify({ key: String(key).trim(), productId: productId(cfg), verifiedAt: now, lastOkAt: now }));
    return r;
}

export function deactivate({ store = defaultStore() } = {}) { store.removeItem(STORE_KEY); }

// Current status. Re-verifies with Gumroad at most once per DAY_MS. Locks on any definitive failure.
export async function status({ cfg = CONFIG, fetchImpl, store = defaultStore(), now = Date.now() } = {}) {
    if (!isConfigured(cfg)) return { unlocked: false, configured: false, reason: 'Agency Kit is coming soon.' };
    const s = read(store);
    if (!s || !s.key || s.productId !== productId(cfg)) return { unlocked: false, configured: true };
    if (now - (s.verifiedAt || 0) < DAY_MS) return { unlocked: true, configured: true, key: s.key, cached: true };
    const r = await verifyKey(s.key, { cfg, fetchImpl });
    if (r.ok) {
        store.setItem(STORE_KEY, JSON.stringify({ ...s, verifiedAt: now, lastOkAt: now }));
        return { unlocked: true, configured: true, key: s.key };
    }
    if (!r.definitive && now - (s.lastOkAt || 0) < GRACE_MS) {
        store.setItem(STORE_KEY, JSON.stringify({ ...s, verifiedAt: now - DAY_MS + 60 * 60 * 1000 })); // retry in ~1h
        return { unlocked: true, configured: true, key: s.key, grace: true };
    }
    store.removeItem(STORE_KEY);
    return { unlocked: false, configured: true, reason: r.reason };
}

// Widget: verify a license passed in an embed snippet, once per page load (in-memory cache).
const pageCache = new Map();
export function verifyForWidget(key, opts = {}) {
    const k = String(key || '').trim();
    if (!pageCache.has(k)) pageCache.set(k, verifyKey(k, opts).catch(() => ({ ok: false, definitive: false })));
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
