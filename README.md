# StackGrade (beta)

**Free website & email health grade.** Enter a domain and get a 0–100 grade in a few seconds, covering email authentication (SPF, DKIM, DMARC, MX), website security headers, and domain health (expiry, transfer lock). Every check comes with a plain-English fix.

Live: **https://299nhs7sjg-netizen.github.io/stackgrade/** · Link to a result with `?d=example.com` (or `/stackgrade/r/example.com`).

## How it works (no backend)

Everything runs in the visitor's browser. The browser calls these public, CORS-enabled services directly:

| Data | Source |
|---|---|
| SPF, DMARC, DKIM, MX, MTA-STS, TLS-RPT, BIMI, TXT/NS for stack detection | DNS-over-HTTPS: `dns.google`, falling back to `cloudflare-dns.com` |
| Domain registration, expiry, transfer lock | The registry's own RDAP server, found through the IANA bootstrap file (`data.iana.org/rdap/dns.json`), plus a short list of official servers that are not in the bootstrap yet (.io, .sh, .ac, .me, .co, .us, .so) |
| HTTPS redirect, HSTS, CSP, clickjacking, X-Content-Type-Options, Referrer-Policy, cookies; response headers for stack detection | [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory) public API v2 (`POST /api/v2/scan`, `GET /api/v2/analyze`). Its scan history is public. |
| Hiring signal | Public job-board APIs: Greenhouse, Lever, Ashby, Workable |

We do not use CORS proxies. There is no StackGrade server, no database and no analytics.

## Scoring rubric

The grade is the share of available points earned, **renormalized over the checks that actually ran**:

`score = round(100 × Σ(weight × points) / Σ(weight of checks that ran))`

`points` is 1 for a pass, a partial value for a warning (listed below), and 0 for a fail. A check that cannot run is marked **Not checked**, shown with the reason, and left out of both sums. Examples: the registry has no RDAP, the site returns 4xx to the scanner, a timeout, or DKIM is not found at common selectors. When fewer than 70 of the 100 points could be checked, the result is labeled **Partial grade**.

Letter grades: **A** 90–100 · **B** 80–89 · **C** 70–79 · **D** 60–69 · **F** below 60.

### Email authentication (50 points)

| Check | Weight | Pass (1.0) | Warn | Fail (0) |
|---|---|---|---|---|
| SPF | 15 | Exactly one `v=spf1` record ending in `~all` or `-all`, with 10 or fewer DNS lookups (counted recursively through `include:`/`redirect=`) | 0.5: `?all`, no `all`, a broken nested include, or no SPF on a name with no MX whose DMARC is already enforced | Missing, more than one record, `+all`, or more than 10 lookups |
| DMARC | 20 | `p=reject` (1.0; 0.9 without `rua=`) or `p=quarantine` (0.85; 0.75 without `rua=`) | `p=none` (0.4; 0.3 without `rua=`). `pct<100` multiplies by 0.7 and shows a warning | Missing, more than one record, or an invalid `p=` |
| DKIM | 10 | A valid key at one of ~40 common selectors (google, selector1/2, k1–k3, s1/s2, default, mail, dkim, zmail, fm1–3, protonmail, mandrill, cm, …), or all keys revoked on a domain that sends no mail | – | Never failed. "Not found" means **Not checked** (excluded), because providers can use selectors that can't be guessed |
| MX | 5 | MX records present, or a null MX (`0 .`) | 0.5: no MX at all | – |

Subdomains inherit DMARC from the organizational domain (using `sp=` when it is set). MTA-STS, TLS-RPT and BIMI are shown as a bonus but not scored.

### Website security (35 points), from Mozilla HTTP Observatory test results

| Check | Weight | Observatory test |
|---|---|---|
| HTTPS & redirect | 10 | `redirection` |
| HSTS | 8 | `strict-transport-security` (max-age under 6 months is a warning) |
| Content-Security-Policy | 6 | `content-security-policy` (a policy with unsafe sources is a warning; missing or report-only is a fail) |
| Clickjacking protection | 4 | `x-frame-options` (or CSP `frame-ancestors`) |
| X-Content-Type-Options | 3 | `x-content-type-options` |
| Referrer-Policy | 2 | `referrer-policy` |
| Cookie security | 2 | `cookies` (no cookies counts as a pass) |

Pass = 1.0, warn = 0.5, fail = 0. A test that Observatory fails with a score modifier above −10 counts as a warning. If the scanner errors, times out (100 s), or the site answers it with HTTP 4xx/5xx (often bot blocking), **all seven are Not checked**, because the headers may not be what real visitors get. If the bare domain doesn't respond, `www.` is tried.

### Domain health (15 points), from registry RDAP

| Check | Weight | Pass | Warn | Fail |
|---|---|---|---|---|
| Expiry | 10 | Expires in more than 30 days | 0.5: expires within 30 days (fine if auto-renew is on) | Expired, or in redemption / pending delete |
| Transfer lock | 5 | Has a `client/server transfer prohibited` status | 0.3: no lock on a gTLD | – (ccTLDs without the status are **Not checked**, because many registries don't publish it) |

### Shown but never scored
- **Domain age** (from RDAP)
- **Tech stack**, detected from DNS (MX, NS, TXT verification records) plus homepage response headers and cookies, using StackGrade's own signatures (shared with the Website Tech Stack Detector Actor). Full HTML fingerprinting is **not checked yet** because it needs a server.
- **Software version disclosure** (`Server` / `X-Powered-By` headers that include versions)
- **Hiring signal**: a Greenhouse/Lever/Ashby/Workable board named after the domain. It counts only when job links point to the domain (confirmed), or when the board name or job text matches the company name (likely).

### Never graded
- Domains that don't exist in DNS (NXDOMAIN). The result says whether the registry lists the domain as registered.
- IP addresses, single-label names and reserved or private names (`.local`, `.test`, `localhost` …). These are rejected at input.

## Known limitations
- **.de and some other ccTLDs** have no public RDAP, so expiry and lock are Not checked for them.
- **DKIM** with custom selectors (Amazon SES, Salesforce, Google's own dated selectors and others) can't be discovered from DNS, so it is excluded rather than failed.
- Observatory results are cached in the visitor's browser for 1 hour (**Re-check** skips the cache).
- **Observatory** sometimes takes 20–75 s to return details for very popular hosts. Email and domain results appear first, with a provisional grade.
- Observatory scans the homepage only. A new result is available at most once per 60 s per host.

## Development

```
npm test                                  # offline unit tests
node tools/batch.mjs github.com bbc.co.uk  # live end-to-end grading in Node 20+
python3 -m http.server 8765               # then open http://localhost:8765/?d=github.com
```

`assets/checks.js` is the whole engine (only `fetch`, so it runs the same in Node and the browser). `assets/app.js` is the UI.
