// Gumroad POST /v2/licenses/verify response fixtures. Copied from published sources; only placeholders changed.
//
// DOCUMENTED: the example response on Gumroad's API docs (https://gumroad.com/api#licenses, "Verify a license"),
//   rendered from antiwork/gumroad app/javascript/components/ApiDocumentation/Endpoints/Licenses.tsx.
//   It is a monthly membership (subscription_id + recurrence) with all subscription_* fields null.
// RECORDED: a real membership response used as a stub in grodowski/undercover-ci
//   (https://github.com/grodowski/undercover-ci/blob/d8015ef823aee4fa59a76e5dbf374862010da3c2/spec/lib/gumroad/validate_license_spec.rb):
//   yearly membership, seller test purchase ("test": true), variants as a string, and NO subscription_ended_at
//   or chargebacked keys at all (missing, not null).
// Server code that produces the shape: antiwork/gumroad app/controllers/api/v2/licenses_controller.rb
//   (purchase = payload_for_ping_notification merged with as_json_for_license whitelist), app/models/purchase.rb
//   #as_json_for_license (subscription_* only for recurring products; chargebacked/refunded only for one-time),
//   app/modules/purchase/ping_notification.rb (test: true only when purchaser == seller; disputed/dispute_won).

export const DOCUMENTED_MEMBERSHIP = {
    success: true,
    uses: 3,
    purchase: {
        seller_id: 'kL0psVL2admJSYRNs-OCMg==',
        product_id: '32-nPAicqbLj8B_WswVlMw==',
        product_name: 'licenses demo product',
        permalink: 'QMGY',
        product_permalink: 'https://sahil.gumroad.com/l/pencil',
        email: 'customer@example.com',
        price: 0,
        gumroad_fee: 0,
        currency: 'usd',
        quantity: 1,
        discover_fee_charged: false,
        can_contact: true,
        referrer: 'direct',
        card: { visual: null, type: null },
        order_number: 524459935,
        sale_id: 'FO8TXN-dbxYaBdahG97Y-Q==',
        sale_timestamp: '2021-01-05T19:38:56Z',
        purchaser_id: '5550321502811',
        subscription_id: 'GDzW4_aBdQc-o7Gbjng7lw==',
        variants: '',
        license_key: '85DB562A-C11D4B06-A2335A6B-8C079166',
        is_multiseat_license: false,
        ip_country: 'United States',
        recurrence: 'monthly',
        is_gift_receiver_purchase: false,
        refunded: false,
        disputed: false,
        dispute_won: false,
        id: 'FO8TXN-dvaYbBbahG97a-Q==',
        created_at: '2021-01-05T19:38:56Z',
        custom_fields: [],
        chargebacked: false,
        subscription_ended_at: null,
        subscription_cancelled_at: null,
        subscription_failed_at: null,
    },
};

export const RECORDED_TEST_MEMBERSHIP = {
    success: true,
    uses: 3,
    purchase: {
        seller_id: 'xxxx',
        product_id: 'xxxx',
        product_name: 'UndercoverCI - Private Repositories',
        permalink: 'xxxx',
        product_permalink: 'https://gum.co/xxxx',
        email: 'help@undercover-ci.com',
        price: 4900,
        currency: 'usd',
        quantity: 1,
        order_number: 123,
        sale_id: 'xxxx',
        sale_timestamp: '2020-09-19T12:55:06Z',
        purchaser_id: 'xxxx',
        subscription_id: 'xxxx',
        variants: '(Organisation)',
        test: true,
        license_key: 'xxxxkey',
        ip_country: 'Germany',
        recurrence: 'yearly',
        is_gift_receiver_purchase: false,
        refunded: false,
        disputed: false,
        dispute_won: false,
        id: 'xxxx',
        created_at: '2020-09-19T12:55:06Z',
        custom_fields: [],
        subscription_cancelled_at: null,
        subscription_failed_at: null,
    },
};

// Documented 404 bodies (licenses_controller.rb).
export const NOT_FOUND = { success: false, message: 'That license does not exist for the provided product.' };
export const DISABLED = { success: false, message: 'This license key has been disabled.' };
export const REVOKED = { success: false, message: 'Access to the purchase associated with this license has expired.' };
