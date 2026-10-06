// Small helpers shared by the Worker modules.
export const ALLOWED_ORIGINS = ['https://299nhs7sjg-netizen.github.io', 'https://forthire.com', 'https://www.forthire.com', 'https://ciphire.pages.dev', 'http://localhost:8765',
    // GreenTools product sites on Cloudflare Pages (POST /v1/unlock)
    'https://blotout.pages.dev', 'https://docburn.pages.dev', 'https://lockfit.pages.dev', 'https://metagone.pages.dev', 'https://snapfit-app.pages.dev', 'https://greentools.pages.dev', 'https://greentools-hub.pages.dev'];

export const GT_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?(blotout|docburn|lockfit|metagone|snapfit-app|greentools|greentools-hub)\.pages\.dev$/;
export function cors(req) {
    const o = req.headers.get('origin');
    const gt = o && GT_ORIGIN.test(o);   // GreenTools sites incl. their Pages preview (staging) aliases
    const h = { 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'origin' };
    if (o && (ALLOWED_ORIGINS.includes(o) || gt)) h['access-control-allow-origin'] = o;
    return h;
}
export function json(req, data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(req), ...extra } });
}
export const err = (req, status, message, extra = {}) => json(req, { ok: false, error: message, ...extra }, status);

export async function sha256hex(s) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomId(bytes = 16) {
    const a = crypto.getRandomValues(new Uint8Array(bytes));
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function hashInt(s) { // FNV-1a, stable slot assignment
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
}
export async function readJson(req, max = 16384) {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > max) throw new HttpError(413, 'Request body too large.');
    const text = await req.text();
    if (text.length > max) throw new HttpError(413, 'Request body too large.');
    try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Body must be JSON.'); }
}
export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

// Per-isolate rate limiter (best effort: each Cloudflare isolate keeps its own counters; no KV writes).
const buckets = new Map();
export function rateLimit(key, limit, windowMs, now = Date.now()) {
    const b = buckets.get(key);
    if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); if (buckets.size > 5000) buckets.clear(); return true; }
    b.n++;
    return b.n <= limit;
}
export const clientIp = (req) => req.headers.get('cf-connecting-ip') || 'unknown';

export function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}$/i;
