// Friendly help when a pasted license key is not accepted, plus a "Contact support" form (POST /v1/support).
// Used by the dashboard (/app/), the license panel on /agency-widget/ and the PDF report dialog.
import { CONFIG } from './config.js';
import { normalizeKey } from './tiers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The seller's Gumroad storefront, derived from the configured checkout URLs (never hard-coded).
export function sellerUrl(cfg = CONFIG) {
    const u = [cfg.tiers?.pro?.checkoutUrl, cfg.tiers?.agency?.checkoutUrl, cfg.agencyKit?.checkoutUrl].find((x) => /^https:\/\/[a-z0-9-]+\.gumroad\.com\//i.test(x || ''));
    return u ? new URL(u).origin + '/' : 'https://gumroad.com/';
}
const NOT_FOUND = /does not exist|not valid|enter the license key|order number|email address|looks like/i;

// Returns HTML for the message area. `reason` is the message from Gumroad / our checks.
export function keyHelpHtml(reason, { page = '' } = {}) {
    const nf = NOT_FOUND.test(reason || '');
    const seller = sellerUrl();
    return `<div class="keyhelp" data-page="${esc(page)}">
  <p class="kit-msg"><b>${esc(reason || 'That key was not accepted.')}</b></p>
  ${nf ? `<p>Common causes:</p>
  <ul>
    <li><b>Key from a different product.</b> Each StackGrade plan has its own key. Pro keys work in the dashboard but do not unlock white-label features; Agency, Agency+ and Agency Kit keys do.</li>
    <li><b>Extra characters.</b> We remove spaces and line breaks automatically, but check that the whole key was copied: four groups of 8 letters and numbers, like <code>XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX</code>.</li>
    <li><b>Order number or receipt ID instead of the key.</b> The receipt also shows an order number; that is not the license key.</li>
  </ul>
  <p><b>Where to find your key:</b> open your Gumroad receipt email and look for <b>License key</b>, or go to your <a href="https://app.gumroad.com/library" target="_blank" rel="noopener">Gumroad library</a>, open the StackGrade product, and copy the key shown there.</p>` : ''}
  <p>Still stuck? <button type="button" class="btn kh-open">Contact support</button> or reply to your Gumroad receipt email (it reaches the seller), or use the <a href="${esc(seller)}" target="_blank" rel="noopener">seller's Gumroad page</a>.</p>
  <form class="kh-form builder" hidden autocomplete="off">
    <label>Your email (so we can reply) <input type="email" name="email" required maxlength="200"></label>
    <label>What happened? <textarea name="message" required minlength="5" maxlength="2000" rows="3"></textarea></label>
    <label class="row"><input type="checkbox" name="sendLast4" checked> Include the last 4 characters of the key I pasted (never the full key)</label>
    <label class="hp" aria-hidden="true">Leave empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
    <p><button class="btn btn-acc" type="submit">Send to support</button> <span class="kh-status d" role="status"></span></p>
  </form>
</div>`;
}

// Wire up the form inside `root`. getKey() returns the key the user pasted (only its last 4 characters are sent).
export function wireKeyHelp(root, { getKey = () => '', reason = '', page = '' } = {}) {
    const box = root.querySelector('.keyhelp'); if (!box) return;
    const form = box.querySelector('.kh-form'); const status = box.querySelector('.kh-status');
    const opened = Date.now();
    box.querySelector('.kh-open').onclick = () => { form.hidden = false; form.email.focus(); };
    form.onsubmit = async (e) => {
        e.preventDefault();
        const k = normalizeKey(getKey());
        status.textContent = 'Sending…';
        try {
            const r = await fetch(`${CONFIG.api}/v1/support`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.email.value, message: form.message.value, keyLast4: form.sendLast4.checked && k ? k.slice(-4) : '', page, reason: String(reason).slice(0, 300), website: form.website.value, elapsedMs: Date.now() - opened }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok) { form.innerHTML = `<p class="kit-on" style="padding:8px">${esc(j.message || 'Thanks, we got your message.')}</p>`; }
            else status.textContent = `${j.error || `Could not send (HTTP ${r.status}).`} You can also reply to your Gumroad receipt email.`;
        } catch { status.textContent = 'Could not reach the StackGrade API. Please reply to your Gumroad receipt email instead.'; }
    };
}

// Normalise a key input as soon as something is pasted into it, and on blur.
export function autoNormalize(input) {
    if (!input) return;
    const fix = () => { const n = normalizeKey(input.value); if (n !== input.value) input.value = n; };
    input.addEventListener('paste', () => setTimeout(fix, 0));
    input.addEventListener('blur', fix);
}
