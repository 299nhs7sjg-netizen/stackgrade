import { grade, score, parseInput, toUnicode, GROUPS, WEIGHTS } from './checks.js';
import { verifyForWidget, decodeConfig, checkoutUrl, isConfigured, STORE_KEY, tierCheckout } from './license.js';
import { CONFIG } from './config.js';
import { plansLine, buyLink, ALERTS_NOTE } from './plans.js';

const SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const BODY = document.body.dataset;
const FOCUS = (BODY.focus || '').split(',').filter(Boolean);
const WIDGET = BODY.mode === 'widget';
const COMPACT_DEFAULT = WIDGET && new URLSearchParams(location.search).get('mode') !== 'full';
// White-label state for the widget (Agency Kit). Only set after the license verifies with Gumroad.
let WL = null;
let showAll = false; // white-label widgets replace the StackGrade "See full report" link with an inline "Show all checks"
const compact = () => COMPACT_DEFAULT && !showAll;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { A: '#16a34a', B: '#65a30d', C: '#ca8a04', D: '#ea580c', F: '#dc2626' };
const LABEL = { pass: 'Pass', warn: 'Warn', fail: 'Fail', skip: 'Not checked', info: 'Info' };
const ORDER = ['email', 'web', 'domain', 'signals'];
const STATUS_ORDER = { fail: 0, warn: 1, skip: 2, pass: 3, info: 4 };
const GROUP_PTS = { email: 50, web: 35, domain: 15 };
let runId = 0;
let current = null;

function ring(scoreVal, letterVal, provisional) {
    if (compact()) return ringSmall(scoreVal, letterVal);
    const r = 56; const c = 2 * Math.PI * r;
    const pct = scoreVal == null ? 0 : scoreVal / 100;
    const col = COLORS[letterVal] || '#94a3b8';
    return `<div class="ring" role="img" aria-label="Grade ${esc(letterVal || 'pending')}, ${scoreVal ?? '?'} out of 100">
      <svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}"/></svg>
      <div class="l"><b style="color:${col}">${esc(letterVal || '…')}</b><span>${scoreVal ?? '–'}/100${provisional ? '*' : ''}</span></div></div>`;
}

function ringSmall(v, l) {
    const col = COLORS[l] || '#94a3b8'; const r = 40; const c = 2 * Math.PI * r;
    return `<div class="ring" style="width:100px;height:100px" role="img" aria-label="Grade ${esc(l || 'pending')}, ${v ?? '?'} out of 100"><svg width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="10"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c * ((v || 0) / 100)} ${c}"/></svg><div class="l"><b style="color:${col};font-size:34px">${esc(l || '…')}</b><span>${v ?? '–'}/100</span></div></div>`;
}
function codeBlock(text) {
    return `<div class="code"><code>${esc(text)}</code><button class="btn copy" type="button" data-copy="${esc(text)}">Copy</button></div>`;
}

function checkCard(c) {
    let extra = '';
    if (c.id === 'stack' && c.tech?.length) extra += `<div class="tech">${c.tech.map((t) => `<span title="Detected via ${esc(t.by.join(', '))}">${esc(t.name)}${t.version ? ' ' + esc(t.version) : ''}<em>${esc(t.category)}</em></span>`).join('')}</div>`;
    if (c.id === 'hiring' && c.jobs?.length) extra += `<p class="d">${c.jobs.map((j) => `<a href="${esc(j.url)}" target="_blank" rel="noopener nofollow">${esc(j.provider)} board</a> (${j.count} roles, ${esc(j.confidence)} match)`).join(' · ')}</p>`;
    const fix = c.fix ? `<details${c.status === 'fail' ? ' open' : ''}><summary>How to fix</summary><p>${esc(c.fix)}</p>${c.record ? codeBlock(c.record) : ''}</details>` : '';
    const w = WEIGHTS[c.id];
    const pts = w ? (c.status === 'skip' ? ` · ${w} pts, excluded` : ` · ${Math.round(w * (c.points || 0) * 10) / 10}/${w} pts`) : ' · not scored';
    return `<article class="check ${c.status}">
      <div class="ch"><h3>${esc(c.title)}</h3><span class="pill ${c.status}">${LABEL[c.status]}</span></div>
      <p>${esc(c.summary)}</p>
      ${c.details ? `<p class="d">${esc(c.details)}</p>` : ''}
      ${c.value ? `<div class="val">${esc(c.value)}</div>` : ''}
      ${extra}${fix}
      <div class="src">${esc(c.source || '')}${pts}</div>
    </article>`;
}

function render(rep, done) {
    const el = $('#result');
    el.hidden = false;
    const s = done ? rep : { ...rep, ...score(rep.checks) };
    const have = new Set(rep.checks.map((c) => c.group));
    const pendingGroups = done ? [] : ORDER.filter((g) => !have.has(g) || (g === 'email' && rep.checks.filter((c) => c.group === 'email').length < 4));
    const provisional = !done;
    const skipped = s.skippedWeight || 0;
    const bars = ['email', 'web', 'domain'].map((g) => {
        const gs = s.groups?.[g];
        const v = gs?.score;
        const lt = v == null ? null : v >= 90 ? 'A' : v >= 80 ? 'B' : v >= 70 ? 'C' : v >= 60 ? 'D' : 'F';
        return `<div class="bar"><span>${esc(GROUPS[g])}</span><span class="t"><i style="width:${v ?? 0}%;background:${COLORS[lt] || '#cbd5e1'}"></i></span><span class="n">${v ?? (pendingGroups.includes(g) ? '…' : 'n/a')}</span></div>`;
    }).join('');
    const name = rep.display || rep.domain;
    const shareUrl = WIDGET ? `${SITE}?d=${encodeURIComponent(name)}&ref=widget` : `${location.origin}${location.pathname}?d=${encodeURIComponent(name)}${selParam()}`;
    const shareText = s.letter ? `${name} scored ${s.letter} (${s.score}/100) on StackGrade's website & email health check` : `Website & email health check for ${name}`;
    let html = `<div class="summary">${ring(s.score, s.letter, provisional)}
      <div><h2 class="sum-h">${esc(name)}${name !== rep.domain ? ` <small class="puny">(${esc(rep.domain)})</small>` : ''}${provisional ? '<span class="prov">Checking…</span>' : ''}</h2>
      <p class="cov">${s.score == null ? 'Waiting for results…' : `Graded on ${s.coverage} of 100 points.`}${skipped && done ? (compact() ? ` ${skipped} not checked.` : ` ${skipped} points could not be checked and are left out (see "Not checked" below).`) : ''}${provisional && s.score != null ? ' *Provisional until every check finishes.' : ''}</p>
      ${done && s.coverage < 70 ? `<p class="cov"><span class="prov">Partial grade</span> Only ${s.coverage} of 100 points could be checked, so treat this grade with care.</p>` : ''}
      ${rep.org && rep.org !== rep.domain ? `<p class="cov">You entered a subdomain. Email and website checks are for ${esc(rep.domain)}; registration checks are for ${esc(rep.org)}.</p>` : ''}
      <div class="bars">${bars}</div>
      ${done && WIDGET && !compact() ? (WL ? wlCta() : `<div class="share"><a class="btn" target="_blank" rel="noopener" href="${esc(shareUrl)}">Open the full report</a></div>`) : ''}
      ${done && !WIDGET ? shareRow(shareUrl, shareText, s.letter, true) : ''}
      </div></div>`;
    if (compact()) {
        const probs = rep.checks.filter((c) => (c.status === 'fail' || c.status === 'warn') && WEIGHTS[c.id])
            .map((c) => ({ c, lost: WEIGHTS[c.id] * (1 - (c.points || 0)) }))
            .sort((a, b) => b.lost - a.lost).slice(0, 5);
        if (done) {
            html += probs.length
                ? `<section class="group"><h2>Top ${probs.length === 1 ? 'problem' : `${probs.length} problems`} to fix <small>by points lost</small></h2>${probs.map(({ c, lost }) => `<article class="check ${c.status} mini">
                    <div class="ch"><h3>${esc(c.title)}</h3><span class="pill ${c.status}">${LABEL[c.status]} · −${Math.round(lost * 10) / 10}</span></div>
                    <p>${esc(c.summary)}</p>${c.fix ? `<details><summary>How to fix</summary><p>${esc(c.fix)}</p>${c.record ? codeBlock(c.record) : ''}</details>` : ''}</article>`).join('')}</section>`
                : '<section class="group"><h2>No problems found <small>in the checks that ran</small></h2></section>';
            html += WL ? `<p class="seefull">${wlCta(true)}</p>` : `<p class="seefull"><a class="btn btn-acc" target="_blank" rel="noopener" href="${esc(shareUrl)}">See full report →</a></p>`;
            html += leadForm();
        } else html += '<div class="pending"><span class="spin"></span>Checking email, website security and domain…</div>';
        el.innerHTML = html;
        postHeight();
        return;
    }
    if (FOCUS.length) {
        const fc = FOCUS.map((id) => rep.checks.find((c) => c.id === id)).filter(Boolean);
        const spot = `<section class="group spot"><h2>${esc(BODY.focusTitle || 'Result')} <small>${esc(name)}</small></h2>${fc.map(checkCard).join('')}${fc.length < FOCUS.length && !done ? '<div class="pending"><span class="spin"></span>Checking…</div>' : ''}</section>`;
        html = spot + `<h2 class="full-h">Full report for ${esc(name)}</h2>` + html;
    }
    for (const g of ORDER) {
        const cs = rep.checks.filter((c) => c.group === g && !FOCUS.includes(c.id)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        const gs = s.groups?.[g];
        const head = GROUP_PTS[g] ? `<small>${gs?.score != null ? `${gs.score}/100` : ''}${GROUP_PTS[g] ? ` · ${GROUP_PTS[g]} pts of grade` : ''}</small>` : '<small>not scored</small>';
        html += `<section class="group"><h2>${esc(GROUPS[g])} ${head}</h2>${cs.map(checkCard).join('')}`;
        if (pendingGroups.includes(g)) html += `<div class="pending"><span class="spin"></span>${g === 'web' ? 'Scanning website security with Mozilla HTTP Observatory (usually a few seconds, up to a minute for some sites)…' : 'Checking…'}</div>`;
        html += '</section>';
    }
    if (done && rep.observatory?.url && !WL) html += `<p class="d" style="color:var(--mut);font-size:13px;margin-top:14px">Website security data: <a href="${esc(rep.observatory.url)}" target="_blank" rel="noopener">Mozilla HTTP Observatory report for ${esc(rep.observatory.host)}</a>. Grade calculated by StackGrade v${esc(rep.version)} on ${esc(new Date(rep.finishedAt).toLocaleString())}.</p>`;
    if (done && !WIDGET) html += `<section class="again"><h2>Share this report or check another domain</h2>${shareRow(shareUrl, shareText, s.letter, false)}</section>`;
    if (done && WL) html += `<div class="share">${wlCta()}</div>${leadForm()}`;
    el.innerHTML = html;
    postHeight();
}
// Lead capture (white-label widgets on plans with leads, when the agency switched it on in the builder).
let leadState = null; // null | 'sending' | 'sent' | error message
const T0 = Date.now();
function leadForm() {
    if (!WL?.leads || !current) return '';
    const who = esc(WL.name || 'This agency');
    if (leadState === 'sent') return `<section class="group leadbox"><h2>Thanks!</h2><p>${who} has your details and this report.</p></section>`;
    return `<section class="group leadbox"><h2>Want help fixing this?</h2><p>Send this report to ${who} and they will get back to you.</p>
      <form class="leadform" autocomplete="on"><input name="name" maxlength="80" placeholder="Your name" autocomplete="name">
      <input name="email" type="email" required maxlength="200" placeholder="Work email" autocomplete="email">
      <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="consent"><input type="checkbox" name="consent" required> ${who} may contact me about this report.</label>
      <button class="btn btn-acc" type="submit"${leadState === 'sending' ? ' disabled' : ''}>Send</button>
      ${leadState && leadState !== 'sending' ? `<p class="kit-msg">${esc(leadState)}</p>` : ''}
      <p class="d">${who} receives your name, email, and this domain and grade. They are stored only for ${who} by the StackGrade API (<a href="${SITE}privacy/" target="_blank" rel="noopener">privacy</a> · <a href="${SITE}remove/" target="_blank" rel="noopener">remove my data</a>).</p></form></section>`;
}
async function sendLead(form) {
    const f = new FormData(form);
    leadState = 'sending'; render(current, true);
    try {
        const r = await fetch(`${CONFIG.api}/v1/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ license: WL.lic, name: f.get('name'), email: f.get('email'), website: f.get('website'), consent: !!f.get('consent'), domain: current.domain, grade: current.letter, score: current.score, elapsedMs: Date.now() - T0 }) });
        const j = await r.json().catch(() => ({}));
        leadState = r.ok && j.ok ? 'sent' : (j.error || 'Could not send. Please try again.');
    } catch { leadState = 'Could not send. Please try again.'; }
    render(current, true);
}
document.addEventListener('submit', (e) => { if (e.target.matches?.('.leadform')) { e.preventDefault(); sendLead(e.target); } });
function wlCta(withAll = false) {
    const cta = WL.cta && WL.ctaUrl ? `<a class="btn btn-acc" target="_blank" rel="noopener" href="${esc(WL.ctaUrl)}">${esc(WL.cta)}</a>` : WL.cta ? `<span class="btn btn-acc" style="cursor:default">${esc(WL.cta)}</span>` : '';
    return `${withAll ? '<button class="btn showall" type="button">Show all checks</button> ' : ''}${cta}`;
}
function shareRow(url, text, letterVal, top) {
    return `<div class="share"><button class="btn btn-acc another" type="button">Check another domain</button>
        <button class="btn copylink" type="button" data-url="${esc(url)}">Copy link</button>
        ${navigator.share ? '<button class="btn nshare" type="button">Share</button>' : ''}
        <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">Post on X</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}">LinkedIn</a>
        ${top && letterVal ? '<button class="btn card" type="button">Download grade card</button>' : ''}
        ${top ? '<button class="btn rerun" type="button">Re-check</button>' : ''}
        ${top && letterVal ? `<button class="btn wlpdf" type="button" title="Agency Kit">White-label PDF report</button>${kitUpsell('kitbuy-inline')}` : ''}</div>
        ${!top ? planUpsell(url) + kitUpsell('kitbuy-box') : ''}`;
}
// Agency Kit upsell link (hidden when no checkout URL is configured, or when this browser already has a license).
function kitUpsell(cls) {
    const buy = checkoutUrl();
    let has = false; try { has = !!localStorage.getItem(STORE_KEY); } catch { /* ignore */ }
    if (!buy || !isConfigured() || has) return '';
    return cls === 'kitbuy-box'
        ? `<p class="kitbuy-box">For agencies: send this report as a PDF with your own logo and colors, and embed a white-label grader on your site. <a class="btn btn-acc" href="${esc(buy)}" target="_blank" rel="noopener">Get the Agency Kit, $29</a></p>`
        : `<a class="kitbuy-inline" href="${esc(buy)}" target="_blank" rel="noopener">Get the Agency Kit, $29</a>${buyLink('agency', 'or Agency, $49/mo', 'kitbuy-inline')}`;
}
// Monitoring upsell in the "share / next steps" box.
function planUpsell(url) {
    const d = current?.display || current?.domain || new URL(url).searchParams.get('d') || '';
    let licensed = false; try { licensed = !!localStorage.getItem(STORE_KEY); } catch { /* ignore */ }
    const add = `/stackgrade/app/?add=${encodeURIComponent(d)}`;
    if (licensed) return `<p class="plan-upsell"><b>Monitor ${esc(d)}</b> and get alerts when its email, security or tech setup changes. <a class="btn btn-acc" href="${add}">Add to my monitors</a></p>`;
    return `<div class="plan-upsell"><p style="margin:0 0 6px"><b>Know when ${esc(d)} changes.</b> Monitoring re-checks SPF, DMARC, DKIM, MX, security headers, tech stack, expiry and hiring, and alerts you to changes. <a class="btn btn-acc" href="${add}">Monitor 1 domain free</a></p>
      <p class="d" style="margin:0">${plansLine()}. ${esc(ALERTS_NOTE)} <a href="/stackgrade/pricing/">Compare plans</a></p></div>`;
}
function postHeight() {
    if (WIDGET && window.parent !== window) window.parent.postMessage({ type: 'stackgrade:height', height: document.documentElement.scrollHeight }, '*');
}
function selParam() {
    const v = document.querySelector('#sel')?.value.trim();
    return v ? `&s=${encodeURIComponent(v)}` : '';
}

function renderNonexistent(r) {
    const el = $('#result');
    el.hidden = false;
    const reg = r.registered === false ? 'The registry says it is <b>not registered</b>, so it may be available to buy.' : r.registered ? 'The registry lists it as registered, but it has no DNS records (it is not set up).' : '';
    el.innerHTML = `<div class="notice"><h2 class="sum-h">${esc(r.display || r.domain)}</h2><p><b>This domain does not exist in DNS</b>, so there is nothing to grade. ${reg}</p><p class="d" style="color:var(--mut)">Check the spelling, or try the main domain (for example <code>company.com</code> instead of a subdomain).</p></div>`;
    postHeight();
}

async function run(input, { push = true, fresh = false } = {}) {
    const p = parseInput(input);
    const err = $('#err');
    if (p.error) { err.textContent = p.error; err.hidden = false; $('#result').hidden = true; return; }
    err.hidden = true;
    const name = toUnicode(p.domain);
    $('#q').value = name;
    const selectors = (document.querySelector('#sel')?.value || '').split(/[\s,]+/).filter(Boolean).slice(0, 5);
    const search = `?d=${encodeURIComponent(name)}${selParam()}`;
    if (push && location.search !== search && !WIDGET) history.pushState({ d: name }, '', `${location.pathname}${search}`);
    if (!WIDGET) document.title = `${name}: ${BODY.focusTitle || 'health grade'} · StackGrade`;
    const id = ++runId;
    $('#go').disabled = true;
    render({ domain: p.domain, display: name, checks: [] }, false);
    if (!WIDGET) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const rep = await grade(p.domain, { fresh, dkimSelectors: selectors, api: CONFIG.api, onUpdate: (r) => { if (id === runId) render(r, false); } });
        if (id !== runId) return;
        if (rep.error) { err.textContent = rep.error; err.hidden = false; $('#result').hidden = true; return; }
        if (rep.nonexistent) { renderNonexistent(rep); return; }
        current = rep;
        render(rep, true);
        if (!WIDGET) document.title = `${rep.display}: ${BODY.focusTitle ? `${BODY.focusTitle} · ` : ''}${rep.letter} (${rep.score}/100) · StackGrade`;
    } catch (e) {
        if (id === runId) { err.textContent = `Something went wrong: ${e.message}. Please try again.`; err.hidden = false; }
    } finally { if (id === runId) $('#go').disabled = false; }
}

function gradeCard(rep) {
    const W = 1200; const H = 630;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#0f172a'; x.fillRect(0, 0, W, H);
    const col = COLORS[rep.letter];
    x.beginPath(); x.arc(250, 315, 170, 0, 2 * Math.PI); x.lineWidth = 28; x.strokeStyle = '#1e293b'; x.stroke();
    x.beginPath(); x.arc(250, 315, 170, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (rep.score / 100)); x.strokeStyle = col; x.lineCap = 'round'; x.stroke();
    x.fillStyle = col; x.font = 'bold 170px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(rep.letter, 250, 300);
    x.fillStyle = '#cbd5e1'; x.font = '600 36px system-ui, sans-serif'; x.fillText(`${rep.score}/100`, 250, 410);
    x.textAlign = 'left'; x.fillStyle = '#fff';
    let size = 64; x.font = `bold ${size}px system-ui, sans-serif`;
    while (x.measureText(rep.display || rep.domain).width > 640 && size > 28) { size -= 4; x.font = `bold ${size}px system-ui, sans-serif`; }
    x.fillText(rep.display || rep.domain, 500, 170);
    x.font = '600 30px system-ui, sans-serif';
    ['email', 'web', 'domain'].forEach((g, i) => {
        const v = rep.groups?.[g]?.score; const y = 270 + i * 70;
        x.fillStyle = '#94a3b8'; x.fillText(GROUPS[g], 500, y);
        x.fillStyle = '#fff'; x.textAlign = 'right'; x.fillText(v == null ? 'n/a' : `${v}`, 1120, y); x.textAlign = 'left';
    });
    x.fillStyle = '#22c55e'; x.font = 'bold 30px system-ui, sans-serif'; x.fillText('StackGrade', 500, 540);
    x.fillStyle = '#94a3b8'; x.font = '24px system-ui, sans-serif'; x.fillText('Free website & email health grade', 680, 540);
    const a = document.createElement('a');
    a.download = `stackgrade-${rep.domain}.png`; a.href = c.toDataURL('image/png'); a.click();
}

document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.classList.contains('copy') || t.classList.contains('copylink')) {
        const text = t.dataset.copy || t.dataset.url;
        try { await navigator.clipboard.writeText(text); const o = t.textContent; t.textContent = 'Copied!'; setTimeout(() => { t.textContent = o; }, 1500); } catch { prompt('Copy this:', text); }
    } else if (t.classList.contains('nshare') && current) {
        navigator.share({ title: `${current.display}: ${current.letter} on StackGrade`, url: `${location.origin}${location.pathname}?d=${encodeURIComponent(current.display)}${selParam()}` }).catch(() => {});
    } else if (t.classList.contains('card') && current) gradeCard(current);
    else if (t.classList.contains('showall') && current) { showAll = true; render(current, true); }
    else if (t.classList.contains('wlpdf') && current) pdfReport(current);
    else if (t.classList.contains('rerun') && current) run(current.domain, { push: false, fresh: true });
    else if (t.classList.contains('another')) {
        const q = $('#q'); q.value = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => q.focus({ preventScroll: true }), 300);
    }
    else if (t.matches('.examples a')) { e.preventDefault(); run(new URL(t.href, location.href).searchParams.get('d')); }
});
$('#form').addEventListener('submit', (e) => { e.preventDefault(); run($('#q').value); });
window.addEventListener('popstate', () => { const d = new URLSearchParams(location.search).get('d'); if (d) run(d, { push: false }); else { $('#result').hidden = true; $('#q').value = ''; } });
const params = new URLSearchParams(location.search);
if (params.get('s') && document.querySelector('#sel')) document.querySelector('#sel').value = params.get('s').slice(0, 200);
const initial = params.get('d');
if (initial) run(initial, { push: false });
if (WIDGET) { new ResizeObserver(postHeight).observe(document.body); postHeight(); }
if (WIDGET) {
    const agency = (params.get('agency') || '').trim().slice(0, 60);
    if (agency) { const el = document.querySelector('#wby'); if (el) { el.textContent = `by ${agency}`; el.hidden = false; } }
    const color = params.get('color') || '';
    if (/^[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--acc', `#${color}`);
    // Agency Kit white-label. The license key and signed-ish config arrive in the URL hash (never sent to the
    // web server). HONEST LIMIT: there is no backend, so this check runs in the visitor's browser. It verifies
    // the key with Gumroad's public API once per page load and only then removes StackGrade branding. Anyone
    // editing the page could bypass it; it stops casual misuse (e.g. a fake or refunded key), not a determined one.
    const h = new URLSearchParams(location.hash.slice(1));
    const lic = (h.get('lic') || '').trim(); const tok = h.get('cfg') || '';
    if (lic && tok) {
        (async () => {
            const brand = await decodeConfig(tok, lic);
            if (!brand) { console.info('StackGrade widget: white-label config does not match the license key; showing free branding.'); return; }
            const r = await verifyForWidget(lic);
            if (!r.ok) { console.info(`StackGrade widget: Agency Kit license not accepted (${r.reason}); showing free branding.`); return; }
            applyWhiteLabel({ ...brand, leads: !!(brand.leads && r.leadsOk), lic });
        })().catch(() => {});
    }
}
function applyWhiteLabel(brand) {
    WL = brand;
    if (brand.color) document.documentElement.style.setProperty('--acc', `#${brand.color}`);
    const by = document.querySelector('#wby');
    if (by && brand.name) { by.textContent = brand.name; by.hidden = false; by.style.fontWeight = '700'; }
    if (brand.logo && by) {
        const img = document.createElement('img');
        img.className = 'wl-logo'; img.alt = brand.name || ''; img.src = brand.logo; img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.remove(); img.onload = postHeight;
        by.parentNode.insertBefore(img, by);
    }
    if (brand.hidePowered) document.querySelector('.wfoot')?.remove();
    document.title = brand.name ? `Website & email health check · ${brand.name}` : 'Website & email health check';
    if (current) render(current, true);
    postHeight();
}

// ---- White-label PDF report (Agency Kit) ----
async function pdfReport(rep) {
    const kit = await import('./agency-kit.js');
    const st = await kit.kitStatus();
    if (st.unlocked) { printReport(rep, kit.loadBrand()); return; }
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="kit-t"><h2 id="kit-t">White-label PDF report</h2>
      <p>Download this report as a PDF with your agency's logo, name and colors, and no StackGrade branding. Part of the Agency Kit.</p>
      <div class="kit-slot"></div><p><button class="btn kit-close" type="button">Close</button></p></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.kit-close')) close(); });
    await kit.renderKitPanel(m.querySelector('.kit-slot'), { onUnlock: () => { close(); printReport(rep, kit.loadBrand()); } });
}
function printReport(rep, brand = {}) {
    const name = rep.display || rep.domain;
    const brandCol = /^[0-9a-f]{6}$/i.test(brand.color || '') ? `#${brand.color}` : '#0f172a';
    const gc = COLORS[rep.letter] || '#94a3b8';
    const strip = (t) => String(t ?? '').replace(/StackGrade/g, 'This report');
    const cats = ['email', 'web', 'domain'].map((g) => `<tr><td>${esc(GROUPS[g])}</td><td><b>${rep.groups?.[g]?.score ?? 'n/a'}</b>${rep.groups?.[g]?.score != null ? '/100' : ''}</td></tr>`).join('');
    const secs = ORDER.map((g) => {
        const cs = rep.checks.filter((c) => c.group === g).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        if (!cs.length) return '';
        return `<h3 class="pr-sec">${esc(GROUPS[g])}</h3>${cs.map((c) => `<div class="pr-check ${c.status}"><h4>${esc(c.title)}<span class="pr-st">${LABEL[c.status]}</span></h4>
          <p>${esc(strip(c.summary))}</p>${c.details ? `<p style="color:#475569">${esc(strip(c.details))}</p>` : ''}
          ${c.fix && c.status !== 'pass' && c.status !== 'info' ? `<div class="pr-fix"><b>How to fix:</b> ${esc(strip(c.fix))}${c.record ? `<br><code>${esc(c.record)}</code>` : ''}</div>` : ''}</div>`).join('')}`;
    }).join('');
    let el = document.querySelector('#print-report');
    if (!el) { el = document.createElement('div'); el.id = 'print-report'; document.body.appendChild(el); }
    el.style.setProperty('--brand', brandCol);
    el.style.setProperty('--gc', gc);
    const date = new Date(rep.finishedAt || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    el.innerHTML = `<div class="pr-head">${brand.logo ? `<img src="${esc(brand.logo)}" alt="" referrerpolicy="no-referrer">` : ''}${brand.name ? `<span class="pr-ag">${esc(brand.name)}</span>` : ''}</div>
      <h1 class="pr-title">Website &amp; email health report</h1>
      <p class="pr-meta">${esc(name)}${name !== rep.domain ? ` (${esc(rep.domain)})` : ''} · ${esc(date)}</p>
      <div class="pr-sum"><div class="pr-grade"><b>${esc(rep.letter)}</b><span>${rep.score}/100</span></div>
        <div><table class="pr-cats">${cats}</table><p class="pr-meta" style="margin:6px 0 0">Graded on ${rep.coverage} of 100 points.${rep.skippedWeight ? ` ${rep.skippedWeight} points could not be checked and are excluded.` : ''}${rep.coverage < 70 ? ' Partial grade: treat with care.' : ''}</p></div></div>
      ${secs}
      <p class="pr-foot">${brand.name ? `Prepared by ${esc(brand.name)}. ` : ''}Based on public DNS, registry (RDAP) and Mozilla HTTP Observatory data at the time of the check.</p>`;
    const prevTitle = document.title;
    document.title = `${brand.name ? `${brand.name} - ` : ''}${rep.domain} health report`;
    const img = el.querySelector('img');
    let printed = false;
    const go = () => { if (printed) return; printed = true; window.print(); setTimeout(() => { document.title = prevTitle; }, 500); };
    if (img && !img.complete) { img.onload = img.onerror = go; setTimeout(go, 3000); } else go();
}
