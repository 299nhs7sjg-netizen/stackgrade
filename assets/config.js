// Public StackGrade configuration. Contains NO secrets: everything here is visible to every visitor.
// A plan with an empty productId cannot be activated; a plan with an empty checkoutUrl shows no buy button.
export const CONFIG = {
    agencyKit: {
        productId: "nexe9SLeFPs0uJlyO6EYkw==",   // Gumroad product ID (public; used for license verification)
        checkoutUrl: "https://greenlight5868.gumroad.com/l/stackgrade-agency-kit",   // Gumroad checkout ($29 one-time)
    },
    tiers: {
        pro:        { productId: "yQKekf6hTcpoK_7Xp83jPg==", checkoutUrl: "https://greenlight5868.gumroad.com/l/xzxoay", monthly: 19, yearly: 190 },
        agency:     { productId: "SDoHJkCBWhp7MOLhe3RhXQ==", checkoutUrl: "https://greenlight5868.gumroad.com/l/vmdksq", monthly: 49, yearly: 490 },
        agencyplus: { productId: "O0PyQiJuzM8-c9NCThQKzQ==", checkoutUrl: "https://greenlight5868.gumroad.com/l/ktoyhl", monthly: 99, yearly: 990 },
    },
    // StackGrade API (Cloudflare Worker, free tier): monitoring, alerts, lead capture, page fingerprinting.
    api: "https://api.stackgrade.workers.dev",
    // Stripe payment links (live). ON: new purchases go through Stripe; the key is shown on /thanks/.
    // Gumroad keys bought earlier keep verifying (tiers.*.productId / checkoutUrl stay; checkoutUrl is the fallback when false).
    stripeCheckout: true,
    stripe: {
        agencyKit: "https://buy.stripe.com/dRm7sN86d7ptfl4amCaR208",
        pro: { monthly: "https://buy.stripe.com/eVq5kFcmt115gp8dyOaR209", yearly: "https://buy.stripe.com/fZuaEZ5Y5cJNeh00M2aR20a" },
        agency: { monthly: "https://buy.stripe.com/28E5kF5Y5fVZc8S0M2aR20b", yearly: "https://buy.stripe.com/dRmeVf5Y59xBeh0fGWaR20c" },
        agencyplus: { monthly: "https://buy.stripe.com/3cI00ldqxaBFeh07aqaR20d", yearly: "https://buy.stripe.com/fZuaEZ2LTh03a0KbqGaR20e" },
    },
    billingPortalUrl: "https://billing.stripe.com/p/login/00w14p9ah5hl2yi3YeaR200",   // Stripe customer portal login (live)
};
