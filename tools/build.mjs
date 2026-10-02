// Generates the static HTML pages, sitemap.xml, robots.txt and llms.txt. Run: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const P = '/stackgrade/';
const TODAY = new Date().toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TOOLS = [
    ['', 'Full grade'],
    ['dmarc-checker/', 'DMARC checker'],
    ['spf-checker/', 'SPF checker'],
    ['dkim-checker/', 'DKIM checker'],
    ['email-provider-lookup/', 'Email provider lookup'],
    ['security-headers-checker/', 'Security headers checker'],
];

const HOW = `<section id="how" class="how">
    <h2>How StackGrade works</h2>
    <div class="cols">
      <div><h3>Email authentication · 50 pts</h3><p>SPF (including the 10-lookup limit), DMARC policy, DKIM keys at common selectors, and MX. These decide whether Gmail and Yahoo trust your mail, and whether scammers can spoof you.</p></div>
      <div><h3>Website security · 35 pts</h3><p>HTTPS redirect, HSTS, Content-Security-Policy, clickjacking protection, X-Content-Type-Options, Referrer-Policy and cookie flags, using Mozilla's public HTTP Observatory scan.</p></div>
      <div><h3>Domain health · 15 pts</h3><p>Expiry date and registrar transfer lock from the official registry (RDAP). Domain age, email provider, tech stack and hiring signals are shown but not scored.</p></div>
    </div>
    <h3>Honest by design</h3>
    <p>If a check can't run (the registry has no RDAP, the site blocks scanners, a lookup times out), we show <b>Not checked</b> with the reason and leave it out of the score. We never guess. The full rubric is <a href="https://github.com/299nhs7sjg-netizen/stackgrade#scoring-rubric">public</a>.</p>
    <h3>Privacy</h3>
    <p>There is no StackGrade server. Your browser asks public services directly: Google Public DNS / Cloudflare DNS, the domain's registry RDAP server, Mozilla HTTP Observatory (its scan history is public) and public job boards (Greenhouse, Lever, Ashby, Workable). We store nothing and run no analytics.</p>
  </section>`;

function page({ slug, title, desc, h1, sub, focus, focusTitle, faq = [], intro = '', extraTool = '', og, examples = ['github.com', 'stripe.com', 'bbc.co.uk', 'example.com'], noindex = false, body, mode, showHow = true }) {
    const url = SITE + slug;
    const depth = slug.split('/').filter(Boolean).length;
    const faqLd = faq.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })) })}</script>` : '';
    const appLd = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebApplication', name: h1 === 'How healthy is your domain?' ? 'StackGrade' : `StackGrade ${focusTitle || h1}`, url, applicationCategory: 'SecurityApplication', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, description: desc })}</script>`;
    const nav = mode === 'widget' ? '' : `<header class="top">
  <a class="brand" href="${P}"><img src="${P}assets/favicon.svg" alt="" width="28" height="28"> StackGrade</a>
  <nav><a href="${P}#how">How it works</a><a href="${P}agency-widget/">For agencies</a><a href="https://github.com/299nhs7sjg-netizen/stackgrade#scoring-rubric">Scoring</a></nav>
</header>`;
    const toolsNav = mode === 'widget' || slug.startsWith('badge') || slug.startsWith('agency') ? '' : `<nav class="tools" aria-label="Checks">${TOOLS.map(([s, n]) => `<a href="${P}${s}"${s === slug ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
    const tool = body || `<section class="hero" id="hero">
    <h1>${esc(h1)}</h1>${mode === 'widget' ? '<p class="sub"><span id="wby" hidden></span></p>' : `
    <p class="sub">${sub}</p>`}
    <form id="form" class="search" autocomplete="off">
      <label for="q" class="sr">Domain</label>
      <input id="q" name="d" type="text" inputmode="url" placeholder="yourcompany.com" spellcheck="false" autocapitalize="off" required>
      <button type="submit" id="go">${mode === 'widget' ? 'Check' : focus ? 'Check' : 'Grade it'}</button>
    </form>${extraTool}
    ${mode === 'widget' ? '' : `<p class="examples">Try: ${examples.map((d) => `<a href="?d=${d}">${d}</a>`).join(' ')}</p>`}
    <p id="err" class="err" role="alert" hidden></p>
    ${toolsNav}
  </section>
  <section id="result" class="result" hidden aria-live="polite"></section>`;
    const faqHtml = faq.length ? `<section class="seo faq"><h2>Frequently asked questions</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</section>` : '';
    const footer = mode === 'widget'
        ? `<p class="wfoot">Powered by <a href="${SITE}?ref=widget" target="_blank" rel="noopener">StackGrade</a> · free website &amp; email health grade</p>`
        : `<footer class="foot">
  <p><a href="${P}">Full grade</a> · <a href="${P}dmarc-checker/">DMARC</a> · <a href="${P}spf-checker/">SPF</a> · <a href="${P}dkim-checker/">DKIM</a> · <a href="${P}email-provider-lookup/">Email provider</a> · <a href="${P}security-headers-checker/">Security headers</a> · <a href="${P}badge/">Badge</a> · <a href="${P}agency-widget/">Agency widget</a></p>
  <p>StackGrade (beta) · free, no signup · <a href="https://github.com/299nhs7sjg-netizen/stackgrade">Source &amp; rubric</a> · <a href="https://github.com/299nhs7sjg-netizen/stackgrade/issues">Report a wrong result</a></p>
</footer>`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="StackGrade">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}assets/og/${og}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f172a">
<link rel="icon" href="${P}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${P}assets/style.css">
${appLd}
${faqLd}
</head>
<body${focus ? ` data-focus="${focus}" data-focus-title="${esc(focusTitle)}"` : ''}${mode ? ` data-mode="${mode}"` : ''}>
${nav}
<main>
  ${tool}
  ${intro ? `<section class="seo">${intro}</section>` : ''}
  ${faqHtml}
  ${showHow && mode !== 'widget' ? HOW : ''}
</main>
${footer}
${body && !body.includes('id="form"') ? '' : `<script type="module" src="${P}assets/app.js"></script>`}
</body>
</html>
`;
    const out = path.join(ROOT, slug, 'index.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    return { slug, noindex };
}

export const PAGES = [];
const add = (o) => PAGES.push({ ...o, ...page(o) });

add({ slug: '', og: 'home', title: 'StackGrade: free website & email health grade (SPF, DKIM, DMARC, headers)',
    desc: 'Enter any domain and get a 0-100 health grade in seconds: SPF, DKIM, DMARC, security headers, domain expiry and tech stack, with plain-English fixes. Free, no signup.',
    h1: 'How healthy is your domain?', sub: 'A free 0–100 grade for email authentication, website security and domain health, with plain-English fixes. No signup.' });

add({ slug: 'dmarc-checker/', og: 'dmarc', focus: 'dmarc', focusTitle: 'DMARC check',
    title: 'Free DMARC checker: test your DMARC record and policy | StackGrade',
    desc: 'Check any domain\'s DMARC record in seconds: policy (none, quarantine, reject), reporting address, pct and subdomain policy, with a plain-English fix and a copy-paste record.',
    h1: 'DMARC checker', sub: 'Look up a domain\'s DMARC record, see whether it actually stops spoofing, and get a copy-paste fix. Free, no signup.',
    intro: `<h2>What this DMARC check looks at</h2>
<p>We read the TXT record at <code>_dmarc.yourdomain.com</code> using public DNS-over-HTTPS. If you enter a subdomain without its own record, we check the organizational domain too, and use its <code>sp=</code> policy if one is set.</p>
<ul><li><b>Pass:</b> <code>p=reject</code> or <code>p=quarantine</code> covering 100% of mail.</li>
<li><b>Warning:</b> <code>p=none</code> (monitoring only), or <code>pct</code> below 100.</li>
<li><b>Fail:</b> no record, more than one record, or an invalid policy.</li></ul>
<p>The same lookup also runs the rest of the StackGrade checks (SPF, DKIM, security headers and domain expiry), so you see the full picture below.</p>`,
    faq: [
        ['What is DMARC?', 'DMARC (Domain-based Message Authentication, Reporting and Conformance) is a DNS TXT record at _dmarc.yourdomain.com. It tells receiving mail servers what to do with messages that claim to be from your domain but fail SPF and DKIM alignment: deliver them (p=none), send them to spam (p=quarantine) or block them (p=reject). It also tells them where to send reports.'],
        ['Do I need DMARC for Gmail and Yahoo?', 'Yes, if you send in bulk. Since 2024, Google and Yahoo require bulk senders (roughly 5,000+ messages a day to their users) to publish a DMARC record (p=none is the minimum), plus SPF and DKIM. Smaller senders must have SPF or DKIM, and DMARC is strongly recommended.'],
        ['Is p=none good enough?', 'p=none is a safe first step because it only collects reports. It does not stop anyone from spoofing your domain. Once the reports show that all your real email passes SPF or DKIM, move to p=quarantine and then p=reject.'],
        ['What should my first DMARC record look like?', 'A common starting point is: <code>v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com</code>. Use a mailbox you actually read (or a DMARC report service), because reports arrive daily as XML attachments.'],
        ['Why does the checker say "more than one DMARC record"?', 'Receivers ignore DMARC entirely when there are two or more v=DMARC1 TXT records at _dmarc. Merge them into one.'],
        ['How long until a DMARC change shows up?', 'DNS changes usually appear within minutes. Records can take up to their TTL (often 1 hour, sometimes up to 24 hours) to update everywhere. Use Re-check to run the lookup again.'],
    ] });

add({ slug: 'spf-checker/', og: 'spf', focus: 'spf', focusTitle: 'SPF check',
    title: 'Free SPF record checker: validate SPF and the 10-lookup limit | StackGrade',
    desc: 'Validate any domain\'s SPF record: syntax, multiple records, +all/~all/-all, and the 10 DNS-lookup limit counted through every include. Plain-English fixes, free.',
    h1: 'SPF record checker', sub: 'Validate a domain\'s SPF record, count its DNS lookups through every include, and get a fix you can paste. Free, no signup.',
    intro: `<h2>What this SPF check looks at</h2>
<ul><li>Exactly one TXT record starting with <code>v=spf1</code> (two or more is a permanent error).</li>
<li>The final <code>all</code> rule: <code>-all</code> or <code>~all</code> pass, <code>?all</code> or a missing all is a warning, <code>+all</code> fails.</li>
<li>The <b>10 DNS-lookup limit</b>: every <code>include:</code>, <code>a</code>, <code>mx</code>, <code>ptr</code>, <code>exists</code> and <code>redirect=</code> counts, including the ones nested inside your includes. Above 10, SPF fails for every message.</li>
<li>Broken includes that point to a domain without a single valid SPF record.</li></ul>`,
    faq: [
        ['What is an SPF record?', 'SPF (Sender Policy Framework) is a DNS TXT record that lists the servers and services allowed to send email for your domain, for example <code>v=spf1 include:_spf.google.com ~all</code>. Receivers compare the sending server with this list.'],
        ['Should I use ~all or -all?', 'Both are fine. ~all (soft fail) is the common choice, and once DMARC is enforced, receivers act on the DMARC policy anyway. -all (hard fail) is stricter and suits domains that are sure every sender is listed, or that never send email at all.'],
        ['What is the SPF 10-lookup limit?', 'RFC 7208 limits SPF evaluation to 10 DNS-querying mechanisms (include, a, mx, ptr, exists, redirect), counted recursively. Going over causes a "permerror", and many receivers treat the message as failing SPF. Remove unused services or replace includes with ip4:/ip6: ranges.'],
        ['Can I have two SPF records?', 'No. A domain must have only one SPF record. If you add a new email service, add its include to the existing record instead of creating a second one.'],
        ['My domain does not send email. Do I need SPF?', 'Yes, it is good practice: publish <code>v=spf1 -all</code> so nobody can pass SPF as your domain, together with a DMARC record set to p=reject.'],
        ['Does SPF alone stop spoofing?', 'No. SPF checks the hidden envelope sender, not the From address people see. DMARC ties SPF and DKIM to the visible From domain, so you need DMARC to actually stop spoofing.'],
    ] });

add({ slug: 'dkim-checker/', og: 'dkim', focus: 'dkim', focusTitle: 'DKIM check',
    title: 'Free DKIM checker: find DKIM records and test your selector | StackGrade',
    desc: 'Find a domain\'s DKIM public keys at about 40 common selectors (google, selector1, selector2, k1, s1 and more) or test your own selector. Free, honest results.',
    h1: 'DKIM checker', sub: 'Probe about 40 common DKIM selectors, or enter your own selector to test it. Free, no signup.',
    extraTool: `<div class="selrow"><label for="sel">Selector (optional):</label><input id="sel" name="s" type="text" placeholder="e.g. google, selector1" spellcheck="false" autocapitalize="off"></div>`,
    intro: `<h2>How this DKIM check works</h2>
<p>DKIM public keys live at <code>&lt;selector&gt;._domainkey.yourdomain.com</code>, and DNS has no way to list them, so the selector has to be known or guessed. We look up about 40 selectors that common providers use (Google Workspace uses <code>google</code>, Microsoft 365 uses <code>selector1</code>/<code>selector2</code>, Mailchimp <code>k1</code>–<code>k3</code>, SendGrid <code>s1</code>/<code>s2</code>, and others), plus any selector you enter.</p>
<p><b>Honest results:</b> if no key is found at common selectors, we say so and leave DKIM out of the score. "Not found" does not prove DKIM is missing. If you enter your own selector and no key exists there, the check fails, because mail signed with it will fail DKIM.</p>`,
    faq: [
        ['What is DKIM?', 'DKIM (DomainKeys Identified Mail) adds a cryptographic signature to each email. Receivers fetch the public key from DNS at selector._domainkey.yourdomain.com and verify that the message was really sent by your domain and was not changed in transit.'],
        ['How do I find my DKIM selector?', 'Open an email you sent, view the original message or headers, and find the DKIM-Signature header. The s= value is the selector and d= is the signing domain. Enter that selector above to test it.'],
        ['Why does the checker say "not found (inconclusive)"?', 'Some providers, such as Amazon SES, Salesforce and some Google domains, use random or dated selector names that cannot be guessed. Without the selector, nobody can look up the key, so we do not count it against you.'],
        ['What does an empty p= mean?', 'A DKIM record with an empty p= value means the key has been revoked. It is correct for retired selectors, and for domains that never send email.'],
        ['How do I set up DKIM for Google Workspace or Microsoft 365?', 'Google Workspace: Admin console > Apps > Google Workspace > Gmail > Authenticate email, generate a key, add the TXT record, then click Start authentication. Microsoft 365: Microsoft Defender portal > Email authentication settings > DKIM, then publish the two CNAME records it shows and enable signing.'],
        ['Is a 1024-bit DKIM key still OK?', '2048-bit keys are recommended today. Many providers still use 1024-bit keys, which are accepted, but rotate to 2048-bit when your provider supports it.'],
    ] });

add({ slug: 'email-provider-lookup/', og: 'provider', focus: 'provider,mx', focusTitle: 'Email provider',
    title: 'What email provider does a domain use? Free MX lookup | StackGrade',
    desc: 'Find out who hosts a company\'s email (Google Workspace, Microsoft 365, Zoho, Proton and more) from its MX records, plus which services its SPF record lets send as it.',
    h1: 'What email provider does this domain use?', sub: 'See who hosts a domain\'s email from its MX records, and which services are allowed to send as it. Free, no signup.',
    examples: ['stripe.com', 'github.com', 'spiegel.de', 'linear.app'],
    intro: `<h2>How we identify the email provider</h2>
<p>The <b>MX records</b> say which servers receive mail for a domain. For example, <code>aspmx.l.google.com</code> means Google Workspace, and <code>*.mail.protection.outlook.com</code> means Microsoft 365. If the MX points to a security gateway (Proofpoint, Mimecast, Barracuda), the mailbox provider behind it is not visible in DNS, and we say so.</p>
<p>The <b>SPF record</b> lists services allowed to send as the domain, such as SendGrid, Mailchimp, Salesforce or HubSpot. It shows who <i>may</i> send, not who actually does.</p>`,
    faq: [
        ['How can I tell if a company uses Google Workspace or Microsoft 365?', 'Look at its MX records. Google Workspace MX hosts end in google.com or googlemail.com (for example aspmx.l.google.com or smtp.google.com). Microsoft 365 MX hosts end in mail.protection.outlook.com.'],
        ['Why does it say a security gateway?', 'Many larger companies route incoming mail through a filtering service such as Proofpoint or Mimecast first. Their MX records point to the gateway, so DNS does not reveal the actual mailbox provider.'],
        ['Is this information private?', 'No. MX and SPF records are public DNS records that every mail server on the internet reads to deliver email. This tool reads only those public records.'],
        ['What does "no mail servers" mean?', 'The domain has no MX records, so mail sent to it will not be delivered. A "null MX" (0 .) means the owner has explicitly stated the domain does not receive email.'],
    ] });

add({ slug: 'security-headers-checker/', og: 'headers', focus: 'https,hsts,csp,xfo,xcto,referrer,cookies', focusTitle: 'Security headers',
    title: 'Free security headers checker: HSTS, CSP, X-Frame-Options and more | StackGrade',
    desc: 'Check a website\'s HTTP security headers: HTTPS redirect, HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and cookie flags, with fixes.',
    h1: 'Security headers checker', sub: 'Check HTTPS, HSTS, CSP, clickjacking protection and more for any website, with copy-paste fixes. Free, no signup.',
    intro: `<h2>What this check looks at</h2>
<p>We request a public scan from <a href="https://developer.mozilla.org/en-US/observatory" rel="noopener">Mozilla HTTP Observatory</a> and read its test results for seven areas: the HTTP-to-HTTPS redirect, Strict-Transport-Security (HSTS), Content-Security-Policy, clickjacking protection (X-Frame-Options or CSP frame-ancestors), X-Content-Type-Options, Referrer-Policy and cookie flags.</p>
<p><b>Honest results:</b> if the site blocks the scanner (for example with HTTP 403), or the scan fails or times out, every header shows as <b>Not checked</b>, because the headers it saw may not be what real visitors get. Scans for very popular sites can take up to a minute. Observatory's scan history is public.</p>`,
    faq: [
        ['Which security headers matter most?', 'Start with an HTTPS redirect and Strict-Transport-Security (HSTS), then X-Content-Type-Options: nosniff, clickjacking protection (CSP frame-ancestors or X-Frame-Options), and Referrer-Policy. A Content-Security-Policy gives the most protection against cross-site scripting, but takes the most care to set up.'],
        ['How do I add security headers?', 'It depends on your host. Cloudflare: Transform Rules > Modify Response Header. Netlify: a _headers file. Vercel: headers in vercel.json. Nginx: add_header lines. Apache: Header set in .htaccess. WordPress hosts often have a security plugin that adds them.'],
        ['Will a Content-Security-Policy break my site?', 'It can, if it blocks scripts you rely on. Start with the Content-Security-Policy-Report-Only header to see what would be blocked, then switch to enforcing. StackGrade counts report-only as a warning.'],
        ['Why does it say "Not checked: HTTP 403"?', 'The site answered the scanner with an error, which usually means bot protection. The headers in an error page are often different from the real site, so we do not grade them.'],
        ['Is X-XSS-Protection still needed?', 'No. Modern browsers removed the XSS auditor, and Mozilla dropped the test. Use a Content-Security-Policy instead.'],
    ] });

// ---- widget (embeddable) ----
add({ slug: 'widget/', og: 'widget', mode: 'widget', noindex: true,
    title: 'Website & email health check · StackGrade', desc: 'Free website and email health check.',
    h1: 'Free website & email health check' });

// ---- agency widget docs ----
const demoSrc = `${SITE}widget/?agency=Acme%20Web%20Studio`;
add({ slug: 'agency-widget/', og: 'widget', showHow: false,
    title: 'Free website audit widget for agencies | StackGrade',
    desc: 'Embed a free website & email health grader on your agency site. Visitors grade their domain (SPF, DKIM, DMARC, security headers, expiry) without leaving your page. Copy-paste embed, free.',
    body: `<section class="hero"><h1>Free audit widget for agencies</h1>
<p class="sub">Put a website &amp; email health grader on your own site. Visitors check their domain without leaving your page: a natural conversation starter for web, email and IT agencies. Free, no signup.</p></section>
<section class="seo">
<h2>1. Copy the embed code</h2>
<p><b>Script (recommended, resizes automatically):</b></p>
<code class="snippet">&lt;script src="${SITE}widget.js" data-agency="Your Agency Name" data-color="0f172a" async&gt;&lt;/script&gt;</code>
<p><b>Or a plain iframe:</b></p>
<code class="snippet">&lt;iframe src="${SITE}widget/?agency=Your%20Agency%20Name" title="Website &amp; email health check" style="width:100%;max-width:760px;height:900px;border:0" loading="lazy"&gt;&lt;/iframe&gt;</code>
<h3>Options</h3>
<ul><li><code>data-agency</code> / <code>?agency=</code>: your name, shown as "by Your Agency Name" (up to 60 characters).</li>
<li><code>data-color</code> / <code>?color=</code>: button color as a 6-digit hex value without the #.</li>
<li><code>data-domain</code> / <code>?d=</code>: optional domain to grade straight away.</li></ul>
<p>The free widget shows "Powered by StackGrade" with a link back. Lead capture (collecting the visitor's email for you) is not available yet.</p>
<h2>2. Live demo</h2>
<iframe src="${demoSrc}" title="StackGrade widget demo" style="width:100%;height:760px;border:1px solid #e2e8f0;border-radius:12px;background:#fff" loading="lazy"></iframe>
<h2>Privacy</h2>
<p>The widget runs entirely in the visitor's browser and stores nothing. It queries public DNS, registry RDAP, Mozilla HTTP Observatory and public job boards, exactly like the main site.</p>
</section>` });

// ---- badge page ----
add({ slug: 'badge/', og: 'badge', showHow: false,
    title: 'StackGrade badge: show your website & email health grade | StackGrade',
    desc: 'An embeddable "Graded A" badge for domains with a StackGrade grade of B or better. The badge turns grey if the grade drops below the level it claims.',
    body: `<section class="hero"><h1>StackGrade badge (beta)</h1>
<p class="sub">Show visitors that your email and website security are in good shape. Badges are only issued to domains graded <b>B or better</b>, and turn <b>grey</b> if the grade drops below the claimed level.</p>
<form id="bform" class="search" autocomplete="off"><label for="bq" class="sr">Domain</label><input id="bq" type="text" placeholder="yourcompany.com" spellcheck="false" autocapitalize="off" required><button type="submit">Find badge</button></form>
<p id="bout" class="sub" style="margin-top:16px"></p></section>
<section class="seo">
<h2>How badges work</h2>
<ul><li>Each listed domain is re-graded by StackGrade's Node script, using the same check engine as this site, and gets <code>/badge/&lt;domain&gt;.svg</code> plus a JSON file with the details.</li>
<li><b>Colors:</b> green or lime means the current grade meets the claimed level. Grey means the grade dropped below the claim, or fewer than 70 of 100 points could be checked.</li>
<li>The badge shows the date of its last check, so a stale badge is visible.</li></ul>
<h2>Getting a badge</h2>
<p>Self-serve badge requests are <b>not open yet</b>. Badges currently exist only for the demo domains in <a href="https://github.com/299nhs7sjg-netizen/stackgrade/blob/main/domains.json">domains.json</a>. Daily automatic re-checks will be switched on together with self-serve requests.</p>
<h2>Listed domains</h2><div id="blist">Loading…</div>
</section>
<script type="module" src="${P}assets/badge-page.js"></script>` });

// ---- sitemap / robots / llms ----
const indexable = PAGES.filter((p) => !p.noindex);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((p) => `  <url><loc>${SITE}${p.slug}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /stackgrade/widget/

Sitemap: ${SITE}sitemap.xml
`);
fs.writeFileSync(path.join(ROOT, 'llms.txt'), `# StackGrade

> StackGrade is a free website and email health grader. Enter a domain and get a 0-100 grade (A-F) in seconds, covering email authentication (SPF, DKIM, DMARC, MX), website security headers (via Mozilla HTTP Observatory) and domain health (expiry and transfer lock from registry RDAP), with plain-English fixes. No signup, no server: checks run in the visitor's browser. Checks that cannot run are shown as "Not checked" and excluded from the score.

Link to a result: ${SITE}?d=example.com

## Tools
- [Full grade](${SITE}): SPF, DKIM, DMARC, MX, security headers, domain expiry and lock, tech stack, hiring signal
- [DMARC checker](${SITE}dmarc-checker/): DMARC policy, reporting, pct and subdomain policy
- [SPF checker](${SITE}spf-checker/): SPF syntax and the 10 DNS-lookup limit, counted recursively
- [DKIM checker](${SITE}dkim-checker/): probes about 40 common selectors or a custom selector (?d=example.com&s=selector)
- [Email provider lookup](${SITE}email-provider-lookup/): mailbox provider from MX, authorized senders from SPF
- [Security headers checker](${SITE}security-headers-checker/): HTTPS redirect, HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, cookies
- [Agency widget](${SITE}agency-widget/): free embeddable grader with "Powered by StackGrade"
- [Badge](${SITE}badge/): "Graded A/B" SVG badge for listed domains

## Scoring
- [Scoring rubric and data sources](https://github.com/299nhs7sjg-netizen/stackgrade#scoring-rubric): email 50 points, website security 35, domain 15; A >= 90, B >= 80, C >= 70, D >= 60, F < 60
`);
console.log('built', PAGES.map((p) => p.slug || '/').join(' '));
