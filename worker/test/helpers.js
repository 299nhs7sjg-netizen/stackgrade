export function kv() {
    const m = new Map(); const meta = new Map(); const stats = { reads: 0, writes: 0, deletes: 0, lists: 0 };
    return {
        m, stats,
        async get(k, type) { stats.reads++; const v = m.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v, opt = {}) { stats.writes++; m.set(k, String(v)); if (opt.metadata) meta.set(k, opt.metadata); },
        async delete(k) { stats.deletes++; m.delete(k); meta.delete(k); },
        async list({ prefix = '', limit = 1000 } = {}) { stats.lists++; return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }; },
    };
}
export const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export function ctx() { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.allSettled(p) }; }
export const req = (method, path, { body, token, ip = '1.2.3.4', origin = 'https://299nhs7sjg-netizen.github.io' } = {}) => new Request(`https://api.stackgrade.workers.dev${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
