// Agency-widget page: white-label widget builder (Agency Kit).
import { kitStatus, renderKitPanel, loadBrand, saveBrand, BUY_LABEL } from './agency-kit.js';
import { cleanBrand, encodeConfig, STORE_KEY, checkoutUrl } from './license.js';

const SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const $ = (s) => document.querySelector(s);
const f = $('#wlform');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readForm() {
    return { name: f.agency.value, logo: f.logo.value, color: f.color.value, cta: f.cta.value, ctaUrl: f.ctaUrl.value, hidePowered: f.hidePowered.checked, leads: f.leads.checked };
}
function fill(b) {
    f.agency.value = b.name || ''; f.logo.value = b.logo || ''; f.color.value = b.color ? `#${b.color}` : '#0f172a';
    f.cta.value = b.cta || ''; f.ctaUrl.value = b.ctaUrl || ''; f.hidePowered.checked = !!b.hidePowered; f.leads.checked = !!b.leads;
}
function storedKey() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null')?.key || ''; } catch { return ''; } }

async function update() {
    const st = await kitStatus();
    renderHero(st);
    const raw = readForm();
    const b = cleanBrand(raw);
    saveBrand(b); // also used by the white-label PDF report on result pages
    const warn = [];
    if (raw.logo.trim() && !b.logo) warn.push('Logo URL must start with https://.');
    if (raw.ctaUrl.trim() && !b.ctaUrl) warn.push('Button link must start with https://.');
    $('#wlwarn').textContent = warn.join(' ');
    const q = new URLSearchParams();
    if (b.name) q.set('agency', b.name);
    if (b.color) q.set('color', b.color);
    let snippet; let hash = '';
    if (st.unlocked) {
        const key = storedKey();
        const tok = await encodeConfig(b, key);
        hash = `#lic=${encodeURIComponent(key)}&cfg=${encodeURIComponent(tok)}`;
        snippet = `<script src="${SITE}widget.js"${b.name ? ` data-agency="${esc(b.name)}"` : ''}${b.color ? ` data-color="${b.color}"` : ''} data-license="${esc(key)}" data-config="${tok}" async></script>`;
        $('#wlnote').innerHTML = 'White-label snippet. It contains your license key, which anyone viewing your page source can see (see the note below).';
    } else {
        snippet = `<script src="${SITE}widget.js"${b.name ? ` data-agency="${esc(b.name)}"` : ''}${b.color ? ` data-color="${b.color}"` : ''} async></script>`;
        $('#wlnote').innerHTML = 'Free snippet: your name and color only, with "Powered by StackGrade". The logo, button and branding removal need the Agency Kit.';
    }
    $('#wlsnip').textContent = snippet;
    $('#wlcopy').dataset.copy = snippet;
    const src = `${SITE.replace('https://299nhs7sjg-netizen.github.io', location.origin)}widget/?${q}${hash}`;
    const fr = $('#wlprev');
    if (fr.dataset.src !== src) { fr.dataset.src = src; fr.src = 'about:blank'; setTimeout(() => { fr.src = src; }, 0); }
    for (const el of document.querySelectorAll('.paid')) el.disabled = !st.unlocked;
    const lc = f.leads; lc.disabled = !st.unlocked || !st.leads;
}

fill(loadBrand());
let t;
f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 400); });
f.addEventListener('submit', (e) => e.preventDefault());
$('#wlcopy').addEventListener('click', async (e) => {
    const b = e.currentTarget; const text = b.dataset.copy;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { prompt('Copy this:', text); }
});
const panel = $('#kitpanel');
function renderHero(st) {
    const buy = checkoutUrl();
    const hero = $('#kithero');
    if (!hero) return;
    if (st.unlocked) hero.innerHTML = '<b>Agency Kit active</b> on this browser: build your white-label snippet below.';
    else if (buy) hero.innerHTML = `<a class="btn btn-acc" href="${esc(buy)}" target="_blank" rel="noopener">${esc(BUY_LABEL)}</a> <span class="d">White-label widget + white-label PDF reports. One-time purchase. <a href="/stackgrade/agency-kit/">Setup guide</a></span>`;
    else hero.innerHTML = '<span class="kit-soon"><b>Agency Kit coming soon:</b> white-label widget and PDF reports.</span>';
}
renderKitPanel(panel, { onUnlock: update, onLock: update }).then(update);
