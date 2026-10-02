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

## Agency Kit (paid)

### What is the Agency Kit?

A paid add-on, sold through Gumroad for **$29 (one-time purchase)**, that unlocks a **white-label widget** (your logo, name, brand color and call-to-action button, with the option to hide "Powered by StackGrade") and **white-label PDF reports** of any result, with your logo, name and colors and no StackGrade branding. [Get the Agency Kit, $29](https://greenlight5868.gumroad.com/l/stackgrade-agency-kit). Setup steps: [Agency Kit setup guide](https://299nhs7sjg-netizen.github.io/stackgrade/agency-kit/).

### How does licensing work?

After purchase, Gumroad emails you a license key. Paste it into the Agency Kit panel on the agency-widget page or the PDF report dialog. Your browser checks the key directly with Gumroad's public license API and stores the result in your browser's local storage. It re-checks at most once a day. The kit locks again if the purchase is refunded, charged back or disputed (and, if it is ever sold as a membership, when that membership is cancelled, ended or has a failed payment; one-time purchases are never affected by this). There is no other way to unlock it. You can use the same key on your other devices and browsers by pasting it there too.

### Is the white-label widget enforcement secure?

Honestly: only partly. StackGrade has no server, so the widget checks your license with Gumroad from the visitor's browser (once per page load) before it removes our branding. Your license key is visible in your page source, and someone who edits the page could bypass the check. Treat it as a convenience check, not DRM, and keep your key to your own sites.

### Can I get a refund?

Refunds are handled through Gumroad under Gumroad's refund policy; contact us via the Gumroad product page. A refunded purchase stops unlocking the Agency Kit at its next daily check.

## Privacy

### What data does StackGrade collect?

None about the domains you check. There is no StackGrade server: all checks run in your browser, which queries public services directly. They are Google Public DNS or Cloudflare DNS (DNS-over-HTTPS), the domain's registry via RDAP, Mozilla HTTP Observatory (its scan history is public), and public job boards (Greenhouse, Lever, Ashby, Workable). We store nothing. Page views are counted with GoatCounter (open source, no cookies, no personal data); only the page path is sent, never the domain you check. Agency Kit license checks go from your browser straight to Gumroad.

### What is stored in my browser?

Mozilla scan results are cached in local storage for an hour, to save time on re-checks. If you use the Agency Kit, your license key, its last verification time and your branding settings are kept in local storage on your device. Clear your site data to remove them.
