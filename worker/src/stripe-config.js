// Stripe catalog for GreenTools (micro-tools) and StackGrade. Public IDs only (payment link and price IDs are not
// secrets). Every value starting with "PLACEHOLDER" is ignored until it is replaced with the real ID.
//
// How a sale is matched: checkout.session.completed carries `payment_link` (plink_...). That is the primary key.
// Price IDs are used for customer.subscription.updated (plan changes made in the customer portal) and as a fallback
// when an event carries line items. Fill both, for live and sandbox.
//
// kind "gt": a GreenTools key GT-<TOOL>-XXXX-XXXX-XXXX-XXXX that unlocks `products` through POST /v1/unlock.
// kind "sg": a StackGrade key SG-<PLAN>-XXXX-XXXX-XXXX-XXXX that resolves to `tier` (assets/tiers.js TIERS).
export const GT_TOOLS = ['snapfit', 'blotout', 'lockfit', 'metagone', 'docburn'];

export const CATALOG = [
    { id: 'gt-snapfit', kind: 'gt', name: 'SnapFit lifetime unlock', products: ['snapfit'], prefix: 'GT-SNAPFIT', site: 'https://snapfit-app.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_SNAPFIT_LIVE', price: 'PLACEHOLDER_PRICE_SNAPFIT_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_SNAPFIT_TEST', price: 'PLACEHOLDER_PRICE_SNAPFIT_TEST' } },
    { id: 'gt-blotout', kind: 'gt', name: 'BlotOut lifetime unlock', products: ['blotout'], prefix: 'GT-BLOTOUT', site: 'https://blotout.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_BLOTOUT_LIVE', price: 'PLACEHOLDER_PRICE_BLOTOUT_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_BLOTOUT_TEST', price: 'PLACEHOLDER_PRICE_BLOTOUT_TEST' } },
    { id: 'gt-lockfit', kind: 'gt', name: 'LockFit lifetime unlock', products: ['lockfit'], prefix: 'GT-LOCKFIT', site: 'https://lockfit.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_LOCKFIT_LIVE', price: 'PLACEHOLDER_PRICE_LOCKFIT_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_LOCKFIT_TEST', price: 'PLACEHOLDER_PRICE_LOCKFIT_TEST' } },
    { id: 'gt-metagone', kind: 'gt', name: 'MetaGone lifetime unlock', products: ['metagone'], prefix: 'GT-METAGONE', site: 'https://metagone.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_METAGONE_LIVE', price: 'PLACEHOLDER_PRICE_METAGONE_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_METAGONE_TEST', price: 'PLACEHOLDER_PRICE_METAGONE_TEST' } },
    { id: 'gt-docburn', kind: 'gt', name: 'DocBurn lifetime unlock', products: ['docburn'], prefix: 'GT-DOCBURN', site: 'https://docburn.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_DOCBURN_LIVE', price: 'PLACEHOLDER_PRICE_DOCBURN_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_DOCBURN_TEST', price: 'PLACEHOLDER_PRICE_DOCBURN_TEST' } },
    { id: 'gt-allaccess', kind: 'gt', name: 'GreenTools All-Access (all 5 tools, lifetime)', products: GT_TOOLS, prefix: 'GT-ALLACCESS', site: 'https://greentools.pages.dev',
      live: { plink: 'PLACEHOLDER_PLINK_ALLACCESS_LIVE', price: 'PLACEHOLDER_PRICE_ALLACCESS_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_ALLACCESS_TEST', price: 'PLACEHOLDER_PRICE_ALLACCESS_TEST' } },
    { id: 'sg-agencykit', kind: 'sg', name: 'StackGrade Agency Kit', tier: 'agencykit', prefix: 'SG-KIT', site: 'https://299nhs7sjg-netizen.github.io/stackgrade',
      live: { plink: 'PLACEHOLDER_PLINK_SG_KIT_LIVE', price: 'PLACEHOLDER_PRICE_SG_KIT_LIVE' }, sandbox: { plink: 'PLACEHOLDER_PLINK_SG_KIT_TEST', price: 'PLACEHOLDER_PRICE_SG_KIT_TEST' } },
    ...['pro', 'agency', 'agencyplus'].flatMap((t) => ['monthly', 'yearly'].map((iv) => {
        const T = t.toUpperCase(), I = iv === 'monthly' ? 'MONTHLY' : 'YEARLY';
        return { id: `sg-${t}-${iv}`, kind: 'sg', name: `StackGrade ${t === 'pro' ? 'Pro' : t === 'agency' ? 'Agency' : 'Agency+'} (${iv})`, tier: t, interval: iv, prefix: `SG-${T}`, site: 'https://299nhs7sjg-netizen.github.io/stackgrade',
            live: { plink: `PLACEHOLDER_PLINK_SG_${T}_${I}_LIVE`, price: `PLACEHOLDER_PRICE_SG_${T}_${I}_LIVE` }, sandbox: { plink: `PLACEHOLDER_PLINK_SG_${T}_${I}_TEST`, price: `PLACEHOLDER_PRICE_SG_${T}_${I}_TEST` } };
    })),
];

const real = (v) => typeof v === 'string' && v && !v.startsWith('PLACEHOLDER');
// id -> { entry, livemode } for every filled-in payment link and price ID.
export function catalogIndex(catalog = CATALOG) {
    const m = new Map();
    for (const e of catalog) for (const [mode, livemode] of [['live', true], ['sandbox', false]]) for (const f of ['plink', 'price']) if (real(e[mode]?.[f])) m.set(e[mode][f], { entry: e, livemode });
    return m;
}
export const isPlaceholder = (v) => !real(v);
