// /thanks/?session_id=cs_... : shows the StackGrade key issued by the Stripe webhook (GET /v1/stripe/session on the
// StackGrade API reads our own KV record) and activates it in this browser. Falls back to "check your email".
import { CONFIG } from './config.js';
import { activate } from './license.js';
const $ = (id) => document.getElementById(id);
const sid = new URLSearchParams(location.search).get('session_id') || '';
const msg = (t) => { $('ty-msg').textContent = t; };
async function look() {
    const r = await fetch(`${CONFIG.api}/v1/stripe/session?id=${encodeURIComponent(sid)}`); return r.json();
}
async function run() {
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(sid)) { msg('Thanks for your purchase. Your key is in the receipt email we sent you.'); return; }
    try { history.replaceState(null, '', location.pathname); } catch {}
    msg('Payment received. Getting your key…');
    let j = null;
    for (let i = 0; i < 12; i++) { try { j = await look(); } catch { j = null; } if (j?.status === 'ready') break; await new Promise((r) => setTimeout(r, 2500)); }
    if (!j || j.status !== 'ready') { msg((j && j.message) || 'Payment received. Your key is on its way: check your email in a few minutes.'); return; }
    $('ty-key').textContent = j.key; $('ty-box').hidden = false;
    msg(`${j.test ? '[TEST] ' : ''}Thanks for buying ${j.name}. ${j.emailed ? 'Keep this key: we also sent it to your email.' : 'Copy this key and keep it somewhere safe: you need it on other devices.'}`);
    const a = await activate(j.key).catch(() => null);
    $('ty-act').textContent = a?.ok ? `Activated in this browser (${a.plan}).` : 'Paste the key in the dashboard to activate.';
}
$('ty-copy')?.addEventListener('click', () => navigator.clipboard?.writeText($('ty-key').textContent).then(() => { $('ty-copy').textContent = 'Copied'; }));
run();
