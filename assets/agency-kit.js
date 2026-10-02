// Agency Kit UI helpers shared by the result page and the agency-widget page.
import { status, activate, deactivate, isConfigured, checkoutUrl } from './license.js';

export const BRAND_KEY = 'sg-agency-brand';
export const BUY_LABEL = 'Get the Agency Kit, $29';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let statusP = null;
export function kitStatus(force = false) {
    if (!statusP || force) statusP = status().catch(() => ({ unlocked: false, configured: isConfigured() }));
    return statusP;
}
export function loadBrand() { try { return JSON.parse(localStorage.getItem(BRAND_KEY) || '{}') || {}; } catch { return {}; } }
export function saveBrand(b) { try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)); } catch { /* ignore */ } }

// Renders the lock / unlock panel into `el`. Calls onUnlock() after a successful activation.
export async function renderKitPanel(el, { onUnlock = () => {}, onLock = () => {} } = {}) {
    const st = await kitStatus();
    const buy = checkoutUrl();
    if (st.unlocked) {
        el.innerHTML = `<div class="kit kit-on"><b>Agency Kit active.</b> White-label widget and PDF reports are unlocked on this browser.${st.grace ? ' (Gumroad could not be reached; we will re-check soon.)' : ''} <button type="button" class="btn kit-off">Remove license from this browser</button></div>`;
        el.querySelector('.kit-off').onclick = () => { deactivate(); kitStatus(true); renderKitPanel(el, { onUnlock, onLock }); onLock(); };
        return st;
    }
    const configured = st.configured;
    el.innerHTML = `<div class="kit">
      <p class="kit-h"><span class="pill info">Agency Kit</span> White-label widget (your logo, colors and call to action, no "Powered by") and white-label PDF reports.</p>
      ${buy ? `<p><a class="btn btn-acc" href="${esc(buy)}" target="_blank" rel="noopener">${BUY_LABEL}</a> <span class="d">One-time purchase via Gumroad. Your license key arrives in the Gumroad receipt.</span></p>` : '<p class="kit-soon"><b>Coming soon.</b> Agency Kit is not on sale yet.</p>'}
      <form class="kit-form" autocomplete="off"><label>License key <input type="text" class="kit-key" placeholder="${configured ? 'XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX' : 'Available when Agency Kit launches'}" ${configured ? '' : 'disabled'} spellcheck="false"></label>
      <button class="btn" type="submit" ${configured ? '' : 'disabled'}>Activate</button></form>
      <p class="kit-msg" role="status">${st.reason && configured ? esc(st.reason) : ''}</p>
    </div>`;
    const form = el.querySelector('.kit-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const msg = el.querySelector('.kit-msg');
        msg.textContent = 'Checking your license with Gumroad…';
        const r = await activate(el.querySelector('.kit-key').value);
        if (r.ok) { kitStatus(true); await renderKitPanel(el, { onUnlock, onLock }); onUnlock(); }
        else msg.textContent = r.reason;
    };
    return st;
}
