# StackGrade FAQ

StackGrade is a free website and email health grader. Enter a domain and get a 0–100 grade (A–F) for email authentication, website security and domain health, with plain-English fixes. This page is generated from [`docs/FAQ.md`](https://github.com/299nhs7sjg-netizen/stackgrade/blob/main/docs/FAQ.md).

## How grading works

### How is the grade calculated?

Each check is worth a fixed number of points, out of 100 in total:

- **Email authentication (50 points):** DMARC 20, SPF 15, DKIM 10, MX 5.
- **Website security (35 points):** HTTPS redirect 10, HSTS 8, Content-Security-Policy 6, clickjacking protection 4, X-Content-Type-Options 3, Referrer-Policy 2, cookie security 2.
- **Domain health (15 points):** expiry 10, registrar transfer lock 5.

A pass earns full points, a warning usually earns half (a missing transfer lock earns 30%), and a fail earns none. The score is the share of points earned out of the points that could actually be checked. Letters: **A** is 90 or more, **B** 80 or more, **C** 70 or more, **D** 60 or more, and **F** below 60. The full rubric is in the [README](https://github.com/299nhs7sjg-netizen/stackgrade#scoring-rubric).

### Which checks are shown but not scored?

Email provider, advanced email security (MTA-STS, TLS-RPT, BIMI), domain age, tech stack, software version disclosure and the hiring signal. They are useful context, but they do not say whether a domain is set up safely, so they never change the grade.

### What does "Not checked" mean?

A check could not run, so we show **Not checked** with the reason and leave its points out of the score instead of guessing. Common reasons: the registry does not publish RDAP data (many country-code domains), the website blocks Mozilla's scanner (for example with HTTP 403), a scan timed out, or no DKIM key was found at the common selectors (DNS cannot list selectors, so "not found" proves nothing).

### What does "Partial grade" mean?

If fewer than 70 of the 100 points could be checked, the grade is labelled **Partial grade**. The letter is still calculated honestly from what ran, but it rests on less evidence, so treat it with care. The result shows exactly how many points were graded ("Graded on 85 of 100 points").

### Why did my grade change when I re-checked?

DNS changes, new headers and registry updates show up on the next check. Website security results come from Mozilla HTTP Observatory and are cached in your browser for an hour; **Re-check** asks for a fresh scan.

## What each check means

### SPF record

A DNS TXT record that lists the servers allowed to send email for your domain. We check that there is exactly one `v=spf1` record, how it ends (`-all` or `~all` pass, `?all` or no `all` warns, `+all` fails), and that it stays within the **10 DNS-lookup limit**, counted through every nested include.

### DMARC policy

A TXT record at `_dmarc.yourdomain.com` that tells receivers what to do with mail that fails SPF and DKIM alignment. `p=reject` or `p=quarantine` at 100% passes; `p=none` (monitoring only) or `pct` below 100 warns; a missing, duplicated or invalid record fails.

### DKIM signing keys

Public keys at `selector._domainkey.yourdomain.com` that let receivers verify your signatures. We probe about 40 common selectors, plus any selector you enter on the [DKIM checker](https://299nhs7sjg-netizen.github.io/stackgrade/dkim-checker/). If nothing is found at common selectors, DKIM is **Not checked**, not failed.

### Mail servers (MX)

Whether the domain has mail servers that can receive email (or an explicit "null MX" saying it receives none).

### HTTPS, HSTS and security headers

From a public Mozilla HTTP Observatory scan: an HTTP-to-HTTPS redirect, `Strict-Transport-Security`, `Content-Security-Policy`, clickjacking protection (`frame-ancestors` or `X-Frame-Options`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Secure`/`HttpOnly`/`SameSite` cookie flags.

### Domain expiry and transfer lock

From the official registry via RDAP: when the domain expires (a warning within 30 days, a fail once expired) and whether the registrar transfer lock (`clientTransferProhibited`) is on.

## How to fix common issues

### How do I fix SPF?

Keep a single record that includes every service that sends as you, for example `v=spf1 include:_spf.google.com include:sendgrid.net ~all`. If you have two records, merge them. If you are over 10 lookups, remove services you no longer use or replace includes with `ip4:`/`ip6:` ranges. A domain that never sends email should publish `v=spf1 -all`.

### How do I fix DMARC?

Start with `v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com` and read the reports for a few weeks. Once all your real mail passes SPF or DKIM, move to `p=quarantine`, then `p=reject`. Never publish two DMARC records.

### How do I fix DKIM?

Turn on DKIM signing in your email provider and publish the record it gives you. Google Workspace: Admin console > Apps > Google Workspace > Gmail > Authenticate email. Microsoft 365: Microsoft Defender portal > Email authentication settings > DKIM (two CNAME records). Use 2048-bit keys where your provider supports them. If your provider uses an unusual selector, find it in the `s=` value of the `DKIM-Signature` header of an email you sent and enter it in the DKIM checker.

### How do I add security headers?

It depends on your host. Cloudflare: Rules > Transform Rules > Modify Response Header. Netlify: a `_headers` file. Vercel: `headers` in `vercel.json`. Nginx: `add_header`. Apache: `Header set` in `.htaccess`. A good baseline:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: frame-ancestors 'self'
```

Roll out a full `Content-Security-Policy` in report-only mode first so it does not break your site.

## Badges

### How do StackGrade badges work?

Listed domains graded **B or better** get an SVG badge at `/stackgrade/badge/<domain>.svg` with the date of its last check. The badge turns **grey** if the grade drops below the claimed level or fewer than 70 points could be checked. Self-serve badge requests are not open yet; badges currently exist only for the demo domains in `domains.json`.

## The widget

### Can I embed StackGrade on my site?

Yes. The free widget is one script tag (see [For agencies](https://299nhs7sjg-netizen.github.io/stackgrade/agency-widget/)). Visitors grade their domain without leaving your page. It shows your agency name and button color, the grade, category scores and the top 5 problems with fixes, plus "Powered by StackGrade". It runs in the visitor's browser like the main site.

## Plans and monitoring

### What plans are there?

The grader, the free widget and 1 monitored domain are free. Paid plans are sold through Gumroad, monthly or yearly (yearly costs 10 months):

- **Free**: 1 domain, checked weekly. Alerts in the dashboard and via webhook.
- **Pro, $19/month or $190/year**: 25 domains, checked daily, with alerts in the dashboard and via webhooks. [Get Pro](https://greenlight5868.gumroad.com/l/xzxoay)
- **Agency, $49/month or $490/year**: 200 domains checked daily, plus the white-label widget, white-label PDF reports and lead capture. [Get Agency](https://greenlight5868.gumroad.com/l/vmdksq)
- **Agency+, $99/month or $990/year**: 1,000 domains checked daily, plus everything in Agency. [Get Agency+](https://greenlight5868.gumroad.com/l/ktoyhl)
- **Agency Kit, $29 one-time**: white-label widget, PDF reports and lead capture, with no monitoring beyond the free domain. [Get the Agency Kit](https://greenlight5868.gumroad.com/l/stackgrade-agency-kit)

Email alerts coming soon; alerts via in-app feed and webhooks today. Compare plans on the [pricing page](https://299nhs7sjg-netizen.github.io/stackgrade/pricing/).

### What does monitoring check?

On every check, StackGrade takes a snapshot of each domain and compares it with the previous one. The snapshot covers:

- the SPF record and the DMARC record and policy;
- DKIM keys at common selectors (google, selector1, selector2, k1, s1, default);
- MX records;
- the Mozilla HTTP Observatory grade and each security-header test;
- the technologies detected on the homepage;
- the domain's expiry date and transfer lock;
- open roles on public job boards.

You get an alert when something changes, for example when DMARC drops from reject to none, an SPF include is removed, HSTS disappears, a new analytics script appears, or the domain is within 30 days of expiry. The first check sets the baseline. If a source cannot be reached, that part is treated as unknown and never reported as a change.

### How do I get alerts?

Alerts appear in the [monitoring dashboard](https://299nhs7sjg-netizen.github.io/stackgrade/app/). You can also add a webhook (Slack, Discord or any https URL that accepts JSON), and every change is posted to it as soon as it is found. Email alerts are coming soon. StackGrade cannot send email yet, because no free email service can deliver to any address without a paid account or our own mail domain.

### How do I start monitoring?

Open the [monitoring dashboard](https://299nhs7sjg-netizen.github.io/stackgrade/app/):

- **Free:** click **Start free**. You get a private token, saved in your browser. Copy it if you want to use it on another device. Each network can create one free monitor per week.
- **Paid plans:** paste the license key from your Gumroad receipt.

Then add your domains. Each domain gets a fixed daily or weekly check time.

### What happens when I cancel, or my payment fails?

You can cancel a membership in Gumroad at any time. Your plan keeps working until the end of the period you already paid for, then monitoring pauses and white-label features lock. If the end of the period cannot be worked out, access locks when the cancellation is recorded. A membership with a failed payment, or one Gumroad marks as ended, locks right away. So does any purchase that is refunded, charged back or disputed. Licenses are re-checked with Gumroad at least once a day.

### My license key is not accepted. What should I check?

- **Use the key for the right product.** Each plan has its own key. A Pro key works in the monitoring dashboard but does not unlock white-label features.
- **Copy the whole key.** It has four groups of 8 letters and numbers, like `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`. Spaces, line breaks and a "License key:" label are removed automatically.
- **Do not use the order number** or receipt ID; they are different from the license key.

You can find the key in your Gumroad receipt email (under "License key") or in your [Gumroad library](https://app.gumroad.com/library). If it still fails, use **Contact support** under the error message, or reply to your Gumroad receipt email.

### Can I upgrade?

Yes. Buy the higher plan and paste its license key. If one key is valid for several StackGrade products, the highest plan applies. Monitors are tied to the key you used, so domains added with a free token or another key must be added again under the new key.

### Can I get a refund?

Refunds are handled through Gumroad under Gumroad's refund policy; contact us via the Gumroad product page. A refunded purchase stops working at its next license check (at most a day later).

## White-label widget, PDF reports and lead capture

### What do the Agency plans and the Agency Kit unlock?

A **white-label widget** (your logo, name, brand color and call-to-action button, with the option to hide "Powered by StackGrade"), **white-label PDF reports** of any result, and **lead capture**. Any of these licenses unlocks them: Agency, Agency+ or the one-time Agency Kit. A Pro license covers monitoring only. Setup steps: [Agency Kit setup guide](https://299nhs7sjg-netizen.github.io/stackgrade/agency-kit/).

### How does licensing work?

After purchase, Gumroad emails you a license key. Paste it into the license panel on the [agency-widget page](https://299nhs7sjg-netizen.github.io/stackgrade/agency-widget/), the PDF report dialog, or the [monitoring dashboard](https://299nhs7sjg-netizen.github.io/stackgrade/app/). Your browser checks the key with Gumroad's public license API, and the StackGrade API checks it again for monitoring and leads. Both re-check at most once a day. You can use the same key on your other devices and browsers by pasting it there too.

### What is lead capture?

Turn on **Collect leads** in the widget builder. After a visitor sees their result, the widget shows a short "Want help fixing this?" form: name, email and a consent checkbox. Submissions are saved with the domain and grade, and you can see them in your dashboard and download them as CSV. You are responsible for contacting people lawfully. Visitors can remove their email with the [removal form](https://299nhs7sjg-netizen.github.io/stackgrade/remove/).

### Is the white-label widget enforcement secure?

Honestly: only partly. The widget checks your license with Gumroad from the visitor's browser (once per page load) before it removes our branding. Your license key is visible in your page source, and someone who edits the page could bypass the check. Treat it as a convenience check, not DRM, and keep your key to your own sites. Lead capture is checked by the StackGrade API, so it only stores leads for valid licenses.

## Privacy

### What data does StackGrade collect?

Grading runs in your browser, which queries public services directly: Google Public DNS or Cloudflare DNS (DNS-over-HTTPS), the domain's registry via RDAP, Mozilla HTTP Observatory (its scan history is public), and public job boards (Greenhouse, Lever, Ashby, Workable). For the tech-stack scan, the StackGrade API (a Cloudflare Worker) fetches the graded site's public homepage. The result is cached briefly in memory and not stored, and graded domains are not logged.

If you use monitoring, the API stores your monitored domains, their latest snapshots and recent changes, and your webhook URL. Your license key is stored only as a one-way hash. Lead capture stores what visitors submit, for the agency that collected it. Page views are counted with GoatCounter (open source, no cookies, no personal data); only the page path is sent, never the domain you check. Full details are in the [privacy policy](https://299nhs7sjg-netizen.github.io/stackgrade/privacy/).

### What is stored in my browser?

Mozilla scan results are cached in local storage for an hour, to save time on re-checks. If you use a license or a free monitor token, the key or token, its last verification time and your branding settings are kept in local storage on your device. Clear your site data to remove them.

### How do I remove my data?

Use the [removal request form](https://299nhs7sjg-netizen.github.io/stackgrade/remove/) to remove your email from all agency lead lists, or to stop monitoring of a domain you own. Removing a monitor in the dashboard deletes its stored data.
