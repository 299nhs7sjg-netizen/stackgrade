// Plan names, prices and upsell snippets shared by the report, agency-widget page, dashboard and pricing page.
import { CONFIG } from './config.js';
import { TIERS } from './tiers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const https = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : '');
export const ALERTS_NOTE = 'Email alerts coming soon; alerts via in-app feed and webhooks today.';
export const PLAN_FEATURES = {
    free: ['1 domain, checked weekly', 'Change alerts in the dashboard feed', 'Webhook alerts (Slack, Discord or JSON)'],
    pro: ['25 domains, checked daily', 'Change alerts: SPF, DMARC, DKIM, MX, security headers, tech stack, expiry, hiring', 'Dashboard feed + webhooks (Slack, Discord or JSON)'],
    agency: ['200 domains, checked daily', 'Everything in Pro', 'White-label widget (your logo, colors, button; no "Powered by")', 'White-label PDF reports', 'Lead capture from your widget (CSV export)'],
    agencyplus: ['1,000 domains, checked daily', 'Everything in Agency'],
    agencykit: ['One-time purchase', 'White-label widget and PDF reports', 'Lead capture from your widget', 'Monitoring: 1 domain, weekly (as Free)'],
};
export function plan(tier) {
    const t = CONFIG.tiers?.[tier] || {};
    const st = CONFIG.stripeCheckout ? CONFIG.stripe || {} : null;   // Stripe links only when the flag is on
    if (tier === 'agencykit') return { tier, name: TIERS.agencykit.name, price: '$29 one-time', checkout: https(st ? st.agencyKit : CONFIG.agencyKit?.checkoutUrl) };
    return { tier, name: TIERS[tier]?.name, monthly: t.monthly, yearly: t.yearly, price: t.monthly ? `$${t.monthly}/mo or $${t.yearly}/yr` : '', checkout: https(st ? st[tier]?.monthly : t.checkoutUrl), checkoutYearly: st ? https(st[tier]?.yearly) : '' };
}
export const PAID = ['pro', 'agency', 'agencyplus'];
// Monthly + yearly buttons for a subscription plan (one button when there is no yearly link).
export function buyLinks(tier, name, cls = 'btn btn-acc') {
    const p = plan(tier);
    if (!p.checkout) return '';
    if (!p.checkoutYearly) return buyLink(tier, `Get ${name || p.name}, ${p.price}`, cls);
    const c2 = cls.replace('btn-acc', '').trim() || 'btn';
    return `<a class="${cls}" href="${esc(p.checkout)}" target="_blank" rel="noopener">${esc(`${name || p.name} monthly, $${p.monthly}`)}</a> <a class="${c2}" href="${esc(p.checkoutYearly)}" target="_blank" rel="noopener">${esc(`Yearly, $${p.yearly}`)}</a>`;
}
export function buyLink(tier, label, cls = 'btn btn-acc') {
    const p = plan(tier);
    return p.checkout ? `<a class="${cls}" href="${esc(p.checkout)}" target="_blank" rel="noopener">${esc(label || `Get ${p.name}, ${p.price}`)}</a>` : '';
}
// One line listing the paid monitoring plans (only plans that can be bought are linked).
export function plansLine() {
    const parts = PAID.map((t) => { const p = plan(t); if (!p.price) return ''; const n = `<b>${esc(p.name)}</b> ${esc(p.price)}: ${esc(PLAN_FEATURES[t][0])}`; return p.checkout ? `<a href="${esc(p.checkout)}" target="_blank" rel="noopener">${n}</a>` : n; }).filter(Boolean);
    return parts.join(' · ');
}
