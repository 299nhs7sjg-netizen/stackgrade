import { grade, score, parseInput, GROUPS, WEIGHTS } from './checks.js';

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
    const r = 56; const c = 2 * Math.PI * r;
    const pct = scoreVal == null ? 0 : scoreVal / 100;
    const col = COLORS[letterVal] || '#94a3b8';
    return `<div class="ring" role="img" aria-label="Grade ${esc(letterVal || 'pending')}, ${scoreVal ?? '?'} out of 100">
      <svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}"/></svg>
      <div class="l"><b style="color:${col}">${esc(letterVal || '…')}</b><span>${scoreVal ?? '–'}/100${provisional ? '*' : ''}</span></div></div>`;
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
    const shareUrl = `${location.origin}${location.pathname}?d=${encodeURIComponent(rep.domain)}`;
    const shareText = s.letter ? `${rep.domain} scored ${s.letter} (${s.score}/100) on StackGrade's website & email health check` : `Website & email health check for ${rep.domain}`;
    let html = `<div class="summary">${ring(s.score, s.letter, provisional)}
      <div><h2 class="sum-h">${esc(rep.domain)}${provisional ? '<span class="prov">Checking…</span>' : ''}</h2>
      <p class="cov">${s.score == null ? 'Waiting for results…' : `Graded on ${s.coverage} of 100 points.`}${skipped && done ? ` ${skipped} points could not be checked and are left out (see "Not checked" below).` : ''}${provisional && s.score != null ? ' *Provisional until every check finishes.' : ''}</p>
      ${done && s.coverage < 70 ? `<p class="cov"><span class="prov">Partial grade</span> Only ${s.coverage} of 100 points could be checked, so treat this grade with care.</p>` : ''}
      ${rep.org && rep.org !== rep.domain ? `<p class="cov">You entered a subdomain. Email and website checks are for ${esc(rep.domain)}; registration checks are for ${esc(rep.org)}.</p>` : ''}
      <div class="bars">${bars}</div>
      ${done ? `<div class="share"><button class="btn" type="button" id="copylink" data-url="${esc(shareUrl)}">Copy link</button>
        ${navigator.share ? '<button class="btn" type="button" id="nshare">Share</button>' : ''}
        <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}">Post on X</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}">LinkedIn</a>
        ${s.letter ? '<button class="btn" type="button" id="card">Download grade card</button>' : ''}
        <button class="btn" type="button" id="rerun">Re-check</button></div>` : ''}
      </div></div>`;
    for (const g of ORDER) {
        const cs = rep.checks.filter((c) => c.group === g).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        const gs = s.groups?.[g];
        const head = GROUP_PTS[g] ? `<small>${gs?.score != null ? `${gs.score}/100` : ''}${GROUP_PTS[g] ? ` · ${GROUP_PTS[g]} pts of grade` : ''}</small>` : '<small>not scored</small>';
        html += `<section class="group"><h2>${esc(GROUPS[g])} ${head}</h2>${cs.map(checkCard).join('')}`;
        if (pendingGroups.includes(g)) html += `<div class="pending"><span class="spin"></span>${g === 'web' ? 'Scanning website security with Mozilla HTTP Observatory (usually a few seconds, up to a minute for some sites)…' : 'Checking…'}</div>`;
        html += '</section>';
    }
    if (done && rep.observatory?.url) html += `<p class="d" style="color:var(--mut);font-size:13px;margin-top:14px">Website security data: <a href="${esc(rep.observatory.url)}" target="_blank" rel="noopener">Mozilla HTTP Observatory report for ${esc(rep.observatory.host)}</a>. Grade calculated by StackGrade v${esc(rep.version)} on ${esc(new Date(rep.finishedAt).toLocaleString())}.</p>`;
    el.innerHTML = html;
}

function renderNonexistent(r) {
    const el = $('#result');
    el.hidden = false;
    const reg = r.registered === false ? 'The registry says it is <b>not registered</b>, so it may be available to buy.' : r.registered ? 'The registry lists it as registered, but it has no DNS records (it is not set up).' : '';
    el.innerHTML = `<div class="notice"><h2 class="sum-h">${esc(r.domain)}</h2><p><b>This domain does not exist in DNS</b>, so there is nothing to grade. ${reg}</p><p class="d" style="color:var(--mut)">Check the spelling, or try the main domain (for example <code>company.com</code> instead of a subdomain).</p></div>`;
}

async function run(input, { push = true } = {}) {
    const p = parseInput(input);
    const err = $('#err');
    if (p.error) { err.textContent = p.error; err.hidden = false; $('#result').hidden = true; return; }
    err.hidden = true;
    $('#q').value = p.domain;
    const url = `${location.pathname}?d=${encodeURIComponent(p.domain)}`;
    if (push && location.search !== `?d=${encodeURIComponent(p.domain)}`) history.pushState({ d: p.domain }, '', url);
    document.title = `${p.domain} health grade · StackGrade`;
    const id = ++runId;
    $('#go').disabled = true;
    render({ domain: p.domain, checks: [] }, false);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const rep = await grade(p.domain, { onUpdate: (r) => { if (id === runId) render(r, false); } });
        if (id !== runId) return;
        if (rep.error) { err.textContent = rep.error; err.hidden = false; $('#result').hidden = true; return; }
        if (rep.nonexistent) { renderNonexistent(rep); return; }
        current = rep;
        render(rep, true);
        document.title = `${rep.domain}: ${rep.letter} (${rep.score}/100) · StackGrade`;
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
    while (x.measureText(rep.domain).width > 640 && size > 28) { size -= 4; x.font = `bold ${size}px system-ui, sans-serif`; }
    x.fillText(rep.domain, 500, 170);
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
    if (t.classList.contains('copy') || t.id === 'copylink') {
        const text = t.dataset.copy || t.dataset.url;
        try { await navigator.clipboard.writeText(text); const o = t.textContent; t.textContent = 'Copied!'; setTimeout(() => { t.textContent = o; }, 1500); } catch { prompt('Copy this:', text); }
    } else if (t.id === 'nshare' && current) {
        navigator.share({ title: `${current.domain}: ${current.letter} on StackGrade`, url: `${location.origin}${location.pathname}?d=${encodeURIComponent(current.domain)}` }).catch(() => {});
    } else if (t.id === 'card' && current) gradeCard(current);
    else if (t.id === 'rerun' && current) run(current.domain, { push: false });
    else if (t.matches('.examples a')) { e.preventDefault(); run(new URL(t.href).searchParams.get('d')); }
});
$('#form').addEventListener('submit', (e) => { e.preventDefault(); run($('#q').value); });
window.addEventListener('popstate', () => { const d = new URLSearchParams(location.search).get('d'); if (d) run(d, { push: false }); else { $('#result').hidden = true; $('#q').value = ''; } });
const initial = new URLSearchParams(location.search).get('d');
if (initial) run(initial, { push: false });
