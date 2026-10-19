// /thanks/?session_id=cs_... : shows the StackGrade key issued by the Stripe webhook (GET /v1/stripe/session on the
// StackGrade API reads our own KV record) and activates it in this browser. The key can be re-displayed for 24 hours,
// so the session id stays in the address bar (reloading works). Sandbox sessions (cs_test_) are read from the staging API.
import { CONFIG } from './config.js';
import { activate } from './license.js';
const $ = (id) => document.getElementById(id);
const sid = new URLSearchParams(location.search).get('session_id') || '';
const msg = (t) => { $('ty-msg').textContent = t; };
async function look() {
    const api = /^cs_test_/.test(sid) ? 'https://api-staging.stackgrade.workers.dev' : CONFIG.api;
    const r = await fetch(`${api}/v1/stripe/session?id=${encodeURIComponent(sid)}`); return r.json();
}
async function run() {
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(sid)) { msg('Thanks for your purchase. Open this page from the checkout to see your key. Lost it? Email support@forthire.com with your Stripe receipt.'); return; }
    msg('Payment received. Getting your key…');
    let j = null;
    for (let i = 0; i < 12; i++) { try { j = await look(); } catch { j = null; } if (j?.status === 'ready') break; await new Promise((r) => setTimeout(r, 2500)); }
    if (!j || j.status !== 'ready') { msg((j && j.message) || 'Payment received. Your key is not ready yet. Refresh this page in a minute.'); return; }
    $('ty-key').textContent = j.key; $('ty-box').hidden = false;
    msg(`${j.test ? '[TEST] ' : ''}Thanks for buying ${j.name}. ${j.emailed ? 'We also sent it to your email.' : ''}`.trim());
    if ($('ty-note')) $('ty-note').textContent = 'Save this key, it is your proof of purchase. Lost it? Email support@forthire.com with your Stripe receipt.';
    // Sandbox keys only exist on the staging API, so they are shown but not activated against production.
    if (j.test && !/staging/.test(CONFIG.api)) { $('ty-act').textContent = '[TEST] Sandbox key: activate it against the staging API.'; return; }
    const a = await activate(j.key).catch(() => null);
    $('ty-act').textContent = a?.ok ? `Activated in this browser (${a.plan}).` : 'Paste the key in the dashboard to activate.';
}
$('ty-copy')?.addEventListener('click', () => navigator.clipboard?.writeText($('ty-key').textContent).then(() => { $('ty-copy').textContent = 'Copied'; }));
run();
