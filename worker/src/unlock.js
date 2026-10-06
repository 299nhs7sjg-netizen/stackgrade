// Server-side unlock for the GreenTools product sites (BlotOut, DocBurn, LockFit, MetaGone, SnapFit, ImageBuff).
// POST /v1/unlock {"product":"blotout","key":"..."} -> {ok:true, via:"license"|"code"} or {ok:false, error} (403).
// Accepts (1) a Gumroad license key for THAT product (verified with Gumroad, server-side product id), or (2) a current
// unlock code. Codes live only in KV as SHA-256 hashes: unlockcode:<product>:<sha256("unlock:<product>:<CODE>")> -> "1".
// No code is ever in public JS; retired codes simply have no KV entry, so they are rejected.
import { evaluatePurchase, VERIFY_URL } from '../../assets/tiers.js';
import { sha256hex, readJson, HttpError, rateLimit, clientIp } from './util.js';

export const UNLOCK_PRODUCTS = {
    blotout: 'Qs1Qjc4ilvLILnInaDwHrg==',
    docburn: 'Nvx3VipTkcN8TD5YpyF7Rg==',
    lockfit: 'qBLgtpiGSLbzGK9bM4U3wA==',
    metagone: 'IUKKFoyFdUrdZ3Cb0c8vGg==',
    snapfit: 'zKmXt9W4fCMSq4WdqLSD2Q==',
    imagebuff: '',   // retired product: codes only
};
const CODE_FORMAT = /^GT-[A-Z]{3}(-[2-9A-HJ-NP-Z]{4}){4}$/;
const RETIRED_FORMAT = /^(IB|SF)-[A-Z0-9-]+$/;
const RETIRED_MSG = 'That unlock code was retired. Paste the license key from your Gumroad receipt to unlock (free for existing buyers).';
export const normCode = (k) => String(k || '').trim().toUpperCase().replace(/\s+/g, '');
export const codeKey = async (product, code) => `unlockcode:${product}:${await sha256hex(`unlock:${product}:${normCode(code)}`)}`;

export async function postUnlock(req, env, { fetchImpl = fetch } = {}) {
    if (!rateLimit(`unlock:${clientIp(req)}`, 60, 300000)) throw new HttpError(429, 'Too many attempts. Wait a few minutes.');
    const b = await readJson(req, 2048);
    const product = String(b.product || '').toLowerCase();
    if (!Object.hasOwn(UNLOCK_PRODUCTS, product)) throw new HttpError(400, 'Unknown product.');
    const raw = String(b.key || '').trim();
    if (raw.length < 6 || raw.length > 120) throw new HttpError(400, 'Paste the license key from your Gumroad receipt.');
    if (RETIRED_FORMAT.test(normCode(raw))) throw new HttpError(403, RETIRED_MSG);   // pre-Oct-2026 codes (IB-…, SF-…): never valid
    if (CODE_FORMAT.test(normCode(raw)) && await env.KV.get(await codeKey(product, raw))) return { ok: true, product, via: 'code' };
    const pid = UNLOCK_PRODUCTS[product];
    if (pid) {
        const body = new URLSearchParams({ product_id: pid, license_key: raw, increment_uses_count: 'false' });
        let r, j = null;
        try { r = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); j = await r.json().catch(() => null); }
        catch { throw new HttpError(502, 'Could not reach Gumroad to check the key. Try again in a minute.'); }
        if (j && j.success === true) {
            const e = evaluatePurchase(j.purchase || {});
            if (e.ok) return { ok: true, product, via: 'license' };
            throw new HttpError(403, e.reason || 'This license is no longer active.');
        }
        if (r && r.status >= 500) throw new HttpError(502, 'Gumroad is not answering right now. Try again in a minute.');
    }
    throw new HttpError(403, 'That key is not valid for this product. Paste the license key from your Gumroad receipt.');
}
