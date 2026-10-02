// Removal / privacy request form (/stackgrade/remove/).
import { CONFIG } from './config.js';
const f = document.getElementById('rmform'); const out = document.getElementById('rmmsg');
const started = Date.now();
f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = f.kind.value; const value = f.value.value.trim();
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { out.textContent = 'Enter a valid email address.'; return; }
    if (kind === 'domain' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) { out.textContent = 'Enter a domain like example.com.'; return; }
    out.textContent = 'Sending…';
    try {
        const r = await fetch(`${CONFIG.api}/v1/removal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, value, website: f.website.value, elapsedMs: Date.now() - started }) });
        const j = await r.json().catch(() => ({}));
        out.textContent = r.ok ? (j.message || 'Done. Your request has been processed.') : `Could not process the request: ${j.error || `HTTP ${r.status}`}`;
        if (r.ok) f.reset();
    } catch { out.textContent = 'Could not reach the StackGrade API. Please try again later.'; }
});
