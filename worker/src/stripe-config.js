// Stripe catalog for GreenTools (micro-tools) and StackGrade. Public IDs only (payment link and price IDs are not
// secrets). Every value starting with "PLACEHOLDER" is ignored until it is replaced with the real ID.
//
// How a sale is matched: checkout.session.completed carries `payment_link` (plink_...). That is the primary key.
// Fallback: metadata.product (slug) + metadata.interval, set on every link. Price IDs map subscription.updated.
//
// kind "gt": a GreenTools key GT-<TOOL>-XXXX-XXXX-XXXX-XXXX that unlocks `products` through POST /v1/unlock.
// kind "sg": a StackGrade key SG-<PLAN>-XXXX-XXXX-XXXX-XXXX that resolves to `tier` (assets/tiers.js TIERS).
import { STRIPE_IDS } from './stripe-ids.js';
export const GT_TOOLS = ['snapfit', 'blotout', 'lockfit', 'metagone', 'docburn'];
const SG_SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade';

const ID = (slug, iv) => ({ live: STRIPE_IDS.live[`${slug}:${iv}`], sandbox: STRIPE_IDS.sandbox[`${slug}:${iv}`] });
const GT = (tool, slug, name, site) => ({ id: `gt-${tool}`, kind: 'gt', slug, name, products: tool === 'allaccess' ? GT_TOOLS : [tool], prefix: `GT-${tool.toUpperCase()}`, site, ...ID(slug, 'once') });
export const CATALOG = [
    GT('snapfit', 'snapfit', 'SnapFit lifetime unlock', 'https://snapfit-app.pages.dev'),
    GT('blotout', 'blotout', 'BlotOut lifetime unlock', 'https://blotout.pages.dev'),
    GT('lockfit', 'lockfit', 'LockFit lifetime unlock', 'https://lockfit.pages.dev'),
    GT('metagone', 'metagone', 'MetaGone lifetime unlock', 'https://metagone.pages.dev'),
    GT('docburn', 'docburn', 'DocBurn lifetime unlock', 'https://docburn.pages.dev'),
    GT('allaccess', 'greentools-all-access', 'GreenTools All-Access (all 5 tools, lifetime)', 'https://greentools.pages.dev'),
    { id: 'sg-agencykit', kind: 'sg', slug: 'stackgrade-agency-kit', name: 'StackGrade Agency Kit', tier: 'agencykit', prefix: 'SG-KIT', site: SG_SITE, ...ID('stackgrade-agency-kit', 'once') },
    ...[['pro', 'stackgrade-pro', 'Pro'], ['agency', 'stackgrade-agency', 'Agency'], ['agencyplus', 'stackgrade-agency-plus', 'Agency+']].flatMap(([t, slug, label]) => [['monthly', 'month'], ['yearly', 'year']].map(([iv, k]) => (
        { id: `sg-${t}-${iv}`, kind: 'sg', slug, name: `StackGrade ${label} (${iv})`, tier: t, interval: iv, prefix: `SG-${t.toUpperCase()}`, site: SG_SITE, ...ID(slug, k) }))),
];

const real = (v) => typeof v === 'string' && v && !v.startsWith('PLACEHOLDER');
// id -> { entry, livemode } for every filled-in payment link and price ID.
export function catalogIndex(catalog = CATALOG) {
    const m = new Map();
    for (const e of catalog) for (const [mode, livemode] of [['live', true], ['sandbox', false]]) for (const f of ['plink', 'price']) if (real(e[mode]?.[f])) m.set(e[mode][f], { entry: e, livemode });
    return m;
}
export const isPlaceholder = (v) => !real(v);
