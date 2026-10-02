// Agency Kit UI helpers shared by the result page and the agency-widget page.
import { status, activate, deactivate, isConfigured, checkoutUrl } from './license.js';
import { buyLink, plan } from './plans.js';
import { keyHelpHtml, wireKeyHelp, autoNormalize } from './keyhelp.js';

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
        el.innerHTML = `<div class="kit kit-on"><b>${esc(st.plan)} license active.</b> White-label widget and PDF reports${st.leads ? ' and lead capture' : ''} are unlocked on this browser.${st.grace ? ' (Gumroad could not be reached; we will re-check soon.)' : ''} <a href="/stackgrade/app/">Open dashboard</a> <button type="button" class="btn kit-off">Remove license from this browser</button></div>`;
        el.querySelector('.kit-off').onclick = () => { deactivate(); kitStatus(true); renderKitPanel(el, { onUnlock, onLock }); onLock(); };
        return st;
    }
    if (st.licensed) {
        el.innerHTML = `<div class="kit"><b>Your ${esc(st.plan)} license is active</b> (monitoring in the <a href="/stackgrade/app/">dashboard</a>), but white-label features need the Agency Kit, Agency or Agency+. ${buyLink('agency', `Upgrade to Agency, ${plan('agency').price}`)} ${buyLink('agencykit', 'Get the Agency Kit, $29', 'btn')}
          <button type="button" class="btn kit-off">Use a different key</button></div>`;
        el.querySelector('.kit-off').onclick = () => { deactivate(); kitStatus(true); renderKitPanel(el, { onUnlock, onLock }); onLock(); };
        return st;
    }
    const configured = st.configured;
    el.innerHTML = `<div class="kit">
      <p class="kit-h"><span class="pill info">Agency Kit / Agency</span> White-label widget (your logo, colors and call to action, no "Powered by"), white-label PDF reports and lead capture.</p>
      ${buy ? `<p><a class="btn btn-acc" href="${esc(buy)}" target="_blank" rel="noopener">${BUY_LABEL}</a> ${buyLink('agency', `Agency plan, ${plan('agency').price}`, 'btn')} <span class="d">The Agency Kit is a one-time purchase; Agency adds monitoring of 200 domains. Your license key arrives in the Gumroad receipt. <a href="/stackgrade/pricing/">Compare plans</a></span></p>` : '<p class="kit-soon"><b>Coming soon.</b> Agency Kit is not on sale yet.</p>'}
      <form class="kit-form" autocomplete="off"><label>License key (Agency Kit, Agency or Agency+) <input type="text" class="kit-key" placeholder="${configured ? 'XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX' : 'Available when Agency Kit launches'}" ${configured ? '' : 'disabled'} spellcheck="false"></label>
      <button class="btn" type="submit" ${configured ? '' : 'disabled'}>Activate</button></form>
      <div class="kit-msgbox" role="status">${st.reason && configured ? `<p class="kit-msg">${esc(st.reason)}</p>` : ''}</div>
    </div>`;
    const form = el.querySelector('.kit-form');
    autoNormalize(el.querySelector('.kit-key'));
    form.onsubmit = async (e) => {
        e.preventDefault();
        const box = el.querySelector('.kit-msgbox'); const input = el.querySelector('.kit-key');
        box.innerHTML = '<p class="kit-msg">Checking your license with Gumroad…</p>';
        const r = await activate(input.value);
        if (r.ok) { kitStatus(true); await renderKitPanel(el, { onUnlock, onLock }); onUnlock(); return; }
        if (!r.definitive) { box.innerHTML = `<p class="kit-msg">${esc(r.reason)}</p>`; return; }
        box.innerHTML = keyHelpHtml(r.reason, { page: el.closest('.modal') ? 'pdf' : 'agency-widget' });
        wireKeyHelp(box, { getKey: () => input.value, reason: r.reason, page: el.closest('.modal') ? 'pdf' : 'agency-widget' });
    };
    return st;
}
