import { parseInput, toUnicode } from './checks.js';
const SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const out = document.querySelector('#bout');
let index = [];
async function load() {
    try { index = await (await fetch('index.json', { cache: 'no-cache' })).json(); } catch { index = []; }
    document.querySelector('#blist').innerHTML = index.length ? index.map((b) => `<p><a href="${SITE}?d=${encodeURIComponent(toUnicode(b.domain))}"><img src="${esc(b.domain)}.svg" alt="StackGrade badge for ${esc(toUnicode(b.domain))}" height="20"></a> ${esc(toUnicode(b.domain))}: claimed ${esc(b.claim)}, currently ${esc(b.letter ?? 'n/a')} (${b.score ?? '–'}/100), checked ${esc(String(b.checkedAt).slice(0, 10))}</p>`).join('') : '<p>No badges yet.</p>';
}
function snippet(d) {
    const name = toUnicode(d);
    return `<a href="${SITE}?d=${encodeURIComponent(name)}"><img src="${SITE}badge/${d}.svg" alt="StackGrade website &amp; email health grade for ${name}" height="20"></a>`;
}
document.querySelector('#bform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = parseInput(document.querySelector('#bq').value);
    if (p.error) { out.textContent = p.error; return; }
    const b = index.find((x) => x.domain === p.domain);
    if (!b) {
        out.innerHTML = `${esc(toUnicode(p.domain))} has no badge yet. Self-serve requests are not open yet. <a href="${SITE}?d=${encodeURIComponent(toUnicode(p.domain))}">See its current grade</a>.`;
        return;
    }
    out.innerHTML = `<img src="${esc(p.domain)}.svg" alt="" height="20"><br>Status: <b>${esc(b.status)}</b>. Embed code:<code class="snippet" style="text-align:left;margin-top:8px">${esc(snippet(p.domain))}</code>`;
});
load();
