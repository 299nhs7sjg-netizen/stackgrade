// StackGrade dashboard (/stackgrade/app/): monitors, alerts, webhook and leads, via the StackGrade API.
import { CONFIG } from './config.js';
import { activate, status, deactivate, STORE_KEY } from './license.js';
import { plan, buyLink, PAID, PLAN_FEATURES, ALERTS_NOTE } from './plans.js';
import { keyHelpHtml, wireKeyHelp, autoNormalize } from './keyhelp.js';

const API = CONFIG.api;
const FREE_KEY = 'sg-free-token';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
const licenseKey = () => { try { return JSON.parse(ls.get(STORE_KEY) || 'null')?.key || null; } catch { return null; } };
let token = null; let me = null;

async function api(path, { method = 'GET', body, raw = false } = {}) {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw) return r;
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
}
const msg = (el, text, ok = false) => { el.textContent = text || ''; el.style.color = ok ? '#15803d' : '#b91c1c'; };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
function localTime(h, m) { const d = new Date(); d.setUTCHours(h, m, 0, 0); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function showKeyHelp(reason, key) {
    const box = $('#signin-msg');
    box.style.color = ''; box.innerHTML = keyHelpHtml(reason, { page: 'app' });
    wireKeyHelp(box, { getKey: () => key || $('#lickey').value, reason, page: 'app' });
}
autoNormalize($('#lickey'));
function renderSignIn(error = '') {
    $('#signin').hidden = false; $('#dash').hidden = true;
    msg($('#signin-msg'), error);
}
async function start() {
    const lic = licenseKey(); const free = ls.get(FREE_KEY);
    token = lic || free;
    if (!token) return renderSignIn();
    try {
        me = (await api('/v1/me')).account;
    } catch (e) {
        if (e.status === 403 && lic) { deactivate(); renderSignIn(); return showKeyHelp(`Your license is not active: ${e.message}`, lic); }
        return renderSignIn(`Could not load your account: ${e.message}`);
    }
    const add = new URLSearchParams(location.search).get('add');
    if (add && !$('#addq').value) $('#addq').value = add;
    $('#signin').hidden = true; $('#dash').hidden = false;
    renderPlan();
    await Promise.all([loadMonitors(), loadAlerts(), me.leads ? loadLeads() : null]);
    $('#leads-sec').hidden = !me.leads;
}
function renderPlan() {
    const freeTok = ls.get(FREE_KEY);
    $('#plan').innerHTML = `<b>${esc(me.plan)}</b> plan · ${me.used} of ${me.monitors} domain${me.monitors === 1 ? '' : 's'} · checked ${esc(me.frequency)}${me.lockAt ? ` · membership ends ${esc(new Date(me.lockAt).toLocaleDateString())}` : ''}
      ${me.paused ? `<p class="kit-msg">Monitoring is paused: ${esc(me.paused)}</p>` : ''}
      ${me.kind === 'free' ? `<p class="d">Your free token (keep it to use this monitor on another device): <code>${esc(freeTok)}</code></p>` : ''}
      <p class="d">${esc(ALERTS_NOTE)}</p>`;
    $('#upsell').innerHTML = upsellHtml(me.tier);
}
function upsellHtml(tier) {
    const higher = PAID.filter((t) => ['free', 'agencykit'].includes(tier) || (tier === 'pro' && t !== 'pro') || (tier === 'agency' && t === 'agencyplus'));
    const cards = higher.map((t) => { const p = plan(t); return p.checkout ? `<div class="pcard"><h3>${esc(p.name)}</h3><p class="pprice">$${p.monthly}<small>/mo</small> <span class="d">or $${p.yearly}/yr</span></p><ul>${PLAN_FEATURES[t].map((f) => `<li>${esc(f)}</li>`).join('')}</ul>${buyLink(t, `Get ${p.name}`)}</div>` : ''; }).join('');
    return cards ? `<h2>Upgrade</h2><div class="pcards">${cards}</div><p class="d">After buying, paste the license key from your Gumroad receipt above (Use a license key). ${esc(ALERTS_NOTE)} <a href="/stackgrade/pricing/">Compare plans</a></p>` : '';
}

function snapSummary(s) {
    if (!s) return '<span class="d">First check running…</span>';
    const bits = [];
    bits.push(`DMARC: ${esc(s.dmarcPolicy || '?')}`);
    bits.push(`SPF: ${s.spf ? 'yes' : 'missing'}`);
    bits.push(`DKIM: ${s.dkim?.length ? esc(s.dkim.join(', ')) : 'not found at common selectors'}`);
    if (s.web) bits.push(`Observatory: ${esc(s.web.grade || '?')}`);
    if (s.tech) bits.push(`${s.tech.length} technologies`);
    if (s.expires) bits.push(`expires ${esc(s.expires)}`);
    if (s.hiring) bits.push(`hiring: ${s.hiring.count} on ${esc(s.hiring.provider)}`);
    if (s.errors?.length) bits.push(`<span class="d">not checked last time: ${esc(s.errors.join(', '))}</span>`);
    return bits.join(' · ');
}
async function loadMonitors() {
    const box = $('#monitors');
    try {
        const j = await api('/v1/monitors');
        if (!j.monitors.length) { box.innerHTML = '<p class="d">No monitored domains yet. Add one above.</p>'; return; }
        box.innerHTML = j.monitors.map((m) => `<article class="check mon"><div class="ch"><h3><a href="/stackgrade/?d=${encodeURIComponent(m.domain)}">${esc(m.domain)}</a></h3>
            <button class="btn mdel" type="button" data-id="${m.id}" data-d="${esc(m.domain)}">Remove</button></div>
            <p>${snapSummary(m.snapshot)}</p>
            <p class="d">Checked ${m.frequency}${m.frequency === 'weekly' ? ` on ${DAYS[m.checkWeekdayUtc]}s (UTC)` : ''} around ${localTime(m.checkHourUtc, m.checkMinuteUtc)} your time · first check ${when(m.firstCheckedAt)} · last change ${when(m.lastChangeAt)}</p></article>`).join('');
    } catch (e) { box.innerHTML = `<p class="kit-msg">${esc(e.message)}</p>`; }
}
async function loadAlerts() {
    const box = $('#alerts');
    try {
        const j = await api('/v1/alerts');
        box.innerHTML = j.alerts.length ? `<ul class="alerts">${j.alerts.map((a) => `<li class="sev-${esc(a.severity)}"><span class="pill ${a.severity === 'high' ? 'fail' : a.severity === 'medium' ? 'warn' : 'info'}">${esc(a.severity)}</span> <b>${esc(a.d)}</b>: ${esc(a.title)} <span class="d">${when(a.at)}</span>${a.from || a.to ? `<details><summary>Details</summary><p class="d">Before: <code>${esc(a.from ?? '—')}</code><br>After: <code>${esc(a.to ?? '—')}</code></p></details>` : ''}</li>`).join('')}</ul>`
            : '<p class="d">No changes detected yet. The first check of each domain sets the baseline; later checks report what changed.</p>';
    } catch (e) { box.innerHTML = `<p class="kit-msg">${esc(e.message)}</p>`; }
}
async function loadLeads() {
    const box = $('#leads');
    try {
        const j = await api('/v1/leads');
        box.innerHTML = j.leads.length ? `<p class="d">${j.count} lead${j.count === 1 ? '' : 's'}.</p><div class="tablewrap"><table class="leads"><tr><th>Date</th><th>Name</th><th>Email</th><th>Domain</th><th>Grade</th><th></th></tr>${j.leads.slice(0, 500).map((l) => `<tr><td>${esc(when(l.at))}</td><td>${esc(l.name)}</td><td>${esc(l.email)}</td><td>${esc(l.domain || '')}</td><td>${esc(l.grade || '')}${l.score != null ? ` (${l.score})` : ''}</td><td><button class="btn ldel" type="button" data-e="${esc(l.email)}">Delete</button></td></tr>`).join('')}</table></div>`
            : '<p class="d">No leads yet. Turn on "Collect leads" in the <a href="/stackgrade/agency-widget/">widget builder</a> and update the snippet on your site.</p>';
    } catch (e) { box.innerHTML = `<p class="kit-msg">${esc(e.message)}</p>`; }
}

$('#licform').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg($('#signin-msg'), 'Checking your license with Gumroad…', true);
    const r = await activate($('#lickey').value);
    if (!r.ok) { if (r.definitive) showKeyHelp(r.reason); else msg($('#signin-msg'), r.reason); return; }
    start();
});
$('#freebtn').addEventListener('click', async () => {
    try {
        const r = await fetch(`${API}/v1/free/token`, { method: 'POST' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        ls.set(FREE_KEY, j.token); start();
    } catch (e) { msg($('#signin-msg'), `Could not start: ${e.message}`); }
});
$('#freeform').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#freetok').value.trim(); if (!/^sgf_[0-9a-f]{32}$/.test(t)) return msg($('#signin-msg'), 'That is not a free monitor token.'); ls.set(FREE_KEY, t); start(); });
$('#signout').addEventListener('click', () => { if (licenseKey()) deactivate(); ls.del(FREE_KEY); token = null; renderSignIn(); });
$('#addform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const domains = $('#addq').value.split(/[\s,]+/).filter(Boolean);
    try { const j = await api('/v1/monitors', { method: 'POST', body: { domains } }); msg($('#addmsg'), `Added ${j.added.length}${j.skipped.length ? `, already monitored: ${j.skipped.join(', ')}` : ''}. The first check runs now and takes about a minute.`, true); $('#addq').value = ''; me.used += j.added.length; renderPlan(); setTimeout(loadMonitors, 1500); setTimeout(loadMonitors, 45000); }
    catch (err) { msg($('#addmsg'), err.message); }
});
document.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.classList.contains('mdel')) {
        if (!confirm(`Stop monitoring ${t.dataset.d}?`)) return;
        try { await api(`/v1/monitors/${t.dataset.id}`, { method: 'DELETE' }); me.used--; renderPlan(); loadMonitors(); } catch (err) { alert(err.message); }
    } else if (t.classList.contains('ldel')) {
        if (!confirm(`Delete the lead ${t.dataset.e}?`)) return;
        try { await api(`/v1/leads?email=${encodeURIComponent(t.dataset.e)}`, { method: 'DELETE' }); loadLeads(); } catch (err) { alert(err.message); }
    }
});
$('#hookform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/v1/webhook', { method: 'PUT', body: { url: $('#hookurl').value.trim(), format: $('#hookfmt').value } }); msg($('#hookmsg'), 'Webhook saved.', true); }
    catch (err) { msg($('#hookmsg'), err.message); }
});
$('#hooktest').addEventListener('click', async () => {
    try { const j = await api('/v1/webhook/test', { method: 'POST' }); msg($('#hookmsg'), j.result?.status ? `Test sent (HTTP ${j.result.status}).` : `Test failed: ${j.result?.error}`, !!j.result?.status); }
    catch (err) { msg($('#hookmsg'), err.message); }
});
$('#hookdel').addEventListener('click', async () => { try { await api('/v1/webhook', { method: 'DELETE' }); msg($('#hookmsg'), 'Webhook removed.', true); $('#hookurl').value = ''; } catch (err) { msg($('#hookmsg'), err.message); } });
$('#csv').addEventListener('click', async () => {
    const r = await api('/v1/leads?format=csv', { raw: true });
    if (!r.ok) return alert(`Export failed (HTTP ${r.status})`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'stackgrade-leads.csv'; a.click();
});
$('#refresh').addEventListener('click', () => { loadMonitors(); loadAlerts(); if (me?.leads) loadLeads(); });
start();
