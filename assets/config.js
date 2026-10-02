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
};
