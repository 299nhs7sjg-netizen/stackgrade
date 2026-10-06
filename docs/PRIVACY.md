# Privacy policy

Last updated: October 1, 2026

StackGrade is a website and email health grader run by the StackGrade team (contact: the help form in the [StackGrade dashboard](https://299nhs7sjg-netizen.github.io/stackgrade/app/) or the [removal and privacy request form](https://299nhs7sjg-netizen.github.io/stackgrade/remove/)). This page explains what data StackGrade handles, where, and for how long. Questions or requests: use the [removal and privacy request form](https://299nhs7sjg-netizen.github.io/stackgrade/remove/) or [open an issue on GitHub](https://github.com/299nhs7sjg-netizen/stackgrade/issues).

## The free grader runs in your browser

When you grade a domain, your browser asks public services directly:

- **Google Public DNS or Cloudflare DNS** (DNS-over-HTTPS) for SPF, DMARC, DKIM and MX records.
- **The domain's registry** (RDAP) for expiry and transfer-lock data.
- **Mozilla HTTP Observatory** for security headers. Its scan history is public.
- **Public job boards** (Greenhouse, Lever, Ashby, Workable) for the hiring signal.

StackGrade does not receive these results and does not keep a record of which domains you grade.

## The StackGrade API

Some features use the StackGrade API, a Cloudflare Worker at `api.stackgrade.workers.dev`:

- **Tech-stack scan:** the domain you grade is sent to the API, which fetches that site's public homepage and reads its HTML tags to detect the CMS, analytics and scripts. The result is kept only in short-lived memory (up to 6 hours) to avoid repeat fetches. It is not written to storage.
- **License checks:** your Gumroad license key is sent to the API and checked with Gumroad. The API stores a one-way hash of the key as your account ID, plus your plan and the time of the last check. It does not store the key itself.
- **Monitoring:** for each domain you monitor, the API stores the domain, its latest snapshot (public DNS records, Mozilla Observatory results, detected technologies, expiry date, job board count) and its 25 most recent change events. If you set a webhook URL, it is stored so alerts can be sent to it.
- **Free monitor token:** the free plan uses a random token instead of a license. To limit abuse, the API stores a salted one-way hash of your network (the first three parts of your IPv4 address, or the IPv6 /48 prefix) for 7 days when you create a free monitor.
- **Rate limiting:** IP addresses are used briefly in memory to limit request rates. They are not stored.

## Lead capture (agency widgets)

Agencies on plans with lead capture can show a "Want help fixing this?" form in their widget. If you submit it, your **name, email, the domain you graded, its grade, your consent and the time** are stored for that agency, and only that agency can see or export them. The agency decides how to use your details and is responsible for doing so lawfully; StackGrade stores them on the agency's behalf. Leads are kept until the agency deletes them or you ask us to remove them.

## Payments

Payments, receipts, refunds and license keys are handled by **Gumroad**. StackGrade never sees your card details. Gumroad's privacy policy applies to your purchase.

When you buy, Gumroad notifies the StackGrade API of the sale. We keep a short record to confirm that your license works: a masked email (first letter and domain only), the product, price, plan, sale ID, the last 4 characters of the license key and the result of the license check.

## Support requests

If you use the **Contact support** form, we store your email, your message, the page you were on and, if you allow it, the last 4 characters of the key you pasted (never the full key). Support requests are deleted automatically after 180 days.

## Analytics

Page views are counted with **GoatCounter**, which is open source and uses no cookies or personal data. Only the page path is sent, never the domain you check.

## Data in your browser

Your browser keeps Mozilla scan results for an hour. If you use a license, it also keeps the license key, its last check time, your free monitor token and your widget branding. Clearing your site data removes all of them.

## Service providers

- Cloudflare (API hosting and storage)
- GitHub Pages (website hosting)
- Gumroad (payments and license keys)
- GoatCounter (cookieless page-view counts)

We do not sell personal data and show no ads.

## Your choices and removal requests

Use the [removal request form](https://299nhs7sjg-netizen.github.io/stackgrade/remove/) to:

- **Remove your email from agency lead lists.** Matching leads are deleted, and the address is blocked from being stored again.
- **Stop monitoring of a domain you own.** New monitors for the domain are refused, and existing monitors stop checking it.

Removing a monitor in the dashboard deletes its snapshot and events right away.

## Changes

If this policy changes, the date at the top will change too.
