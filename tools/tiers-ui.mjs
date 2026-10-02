// Tier / dashboard / pricing / removal UI test (Chrome). BASE defaults to the local server.
// Free flow uses the LIVE API; paid flows mock Gumroad (per product) and the API with Playwright routes.
import { chromium } from '/home/box/.local/lib/node_modules/playwright/index.mjs';
import { CONFIG } from '../assets/config.js';
const BASE = process.env.BASE || 'http://localhost:8765/stackgrade/';
const SHOTS = process.env.SHOTS || '/workspace/shots';
const API = CONFIG.api;
const NOTE = 'Email alerts coming soon; alerts via in-app feed and webhooks today';
const out = []; const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const PID = { pro: CONFIG.tiers.pro.productId, agency: CONFIG.tiers.agency.productId, agencyplus: CONFIG.tiers.agencyplus.productId, agencykit: CONFIG.agencyKit.productId };
// Gumroad mock: the key is valid only for the listed products.
async function gumroad(ctx, valid, purchase = {}) {
    await ctx.route('https://api.gumroad.com/**', (r) => {
        const pid = new URLSearchParams(r.request().postData() || '').get('product_id');
        const hit = valid.some((t) => PID[t] === pid);
        r.fulfill({ status: hit ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(hit ? { success: true, uses: 1, purchase: { refunded: false, chargebacked: false, disputed: false, subscription_cancelled_at: null, subscription_ended_at: null, subscription_failed_at: null, created_at: new Date().toISOString(), recurrence: 'monthly', ...purchase } } : { success: false, message: 'That license does not exist for the provided product.' }) });
    });
}
// 1. Pricing page
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
    const r = await p.goto(BASE + 'pricing/'); ok('pricing HTTP 200', r.status() === 200);
    const t = await p.textContent('main');
    for (const s of ['$19', 'or $190/yr', '$49', 'or $490/yr', '$99', 'or $990/yr', '$29', NOTE, '25 domains, checked daily', '200 domains, checked daily', '1,000 domains, checked daily']) ok(`pricing shows "${s}"`, t.includes(s));
    const hrefs = await p.$$eval('.pcard a', (as) => as.map((a) => a.href));
    for (const u of [CONFIG.tiers.pro.checkoutUrl, CONFIG.tiers.agency.checkoutUrl, CONFIG.tiers.agencyplus.checkoutUrl, CONFIG.agencyKit.checkoutUrl]) ok(`pricing buy link ${u}`, hrefs.includes(u));
    ok('pricing Start free links to app', hrefs.some((h) => h.endsWith('/stackgrade/app/')));
    await p.screenshot({ path: `${SHOTS}/pricing.png`, fullPage: true });
    await ctx.close();
}
// 2. Terms / privacy / remove / faq pages + footer links
for (const s of ['terms/', 'privacy/', 'remove/', 'faq/', 'app/']) {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const r = await p.goto(BASE + s); ok(`${s} HTTP ${r.status()}`, r.status() === 200);
    if (s === 'faq/') { const t = await p.textContent('main'); ok('faq has plans + note', t.includes('What plans are there?') && t.includes(NOTE) && t.includes('$990/year')); }
    if (s === 'privacy/') ok('privacy mentions homepage fetch', (await p.textContent('main')).includes('fetches that site\'s public homepage'));
    await ctx.close();
}
// 3. Free flow against the LIVE API: start free, add a monitor
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
    await p.goto(`${BASE}app/?add=example.org`); await p.waitForSelector('#freebtn', { state: 'visible' });
    ok('app shows upsell + note before sign-in', (await p.textContent('#signin')).includes(NOTE) && (await p.textContent('#signin')).includes('$49'));
    await p.click('#freebtn'); await p.waitForSelector('#dash:not([hidden])', { timeout: 15000 });
    const plan = await p.textContent('#plan');
    ok('free token created (live API)', /sgf_[0-9a-f]{32}/.test(plan) && plan.includes('Free'), plan.slice(0, 120));
    ok('?add= prefilled', (await p.inputValue('#addq')) === 'example.org');
    await p.click('#addform button');
    await p.waitForFunction(() => document.querySelector('#addmsg').textContent.length > 3, null, { timeout: 15000 });
    const am = await p.textContent('#addmsg');
    ok('add free monitor (live API)', am.startsWith('Added 1') || am.includes('One free monitor per network'), am);
    await p.waitForTimeout(2500);
    ok('monitor listed or limit explained', (await p.textContent('#monitors')).includes('example.org') || am.includes('One free monitor per network'));
    ok('dashboard upsell cards', (await p.$$('#upsell .pcard')).length === 3);
    await p.fill('#hookurl', 'http://127.0.0.1/hook'); await p.click('#hookform button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#hookmsg').textContent.length > 3);
    const hm = await p.textContent('#hookmsg');
    ok('webhook SSRF rejected (live API)', hm.includes('public https') || (am.includes('One free monitor per network') && hm.includes('Add a monitor first')), hm);
    await p.screenshot({ path: `${SHOTS}/app-free.png`, fullPage: true });
    // clean up: delete the monitor
    if (await p.$('.mdel')) { p.once('dialog', (d) => d.accept()); await p.click('.mdel'); await p.waitForTimeout(2500); ok('monitor deleted (live API)', !(await p.textContent('#monitors')).includes('example.org')); }
    await ctx.close();
}
// 4. Pro key on the agency-widget page: activates, does not unlock white-label
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await gumroad(ctx, ['pro']); const p = await ctx.newPage();
    await p.goto(BASE + 'agency-widget/'); await p.waitForSelector('.kit-key');
    ok('agency page plan cards', (await p.$$('.pcard')).length === 3 && (await p.textContent('main')).includes(NOTE));
    await p.fill('.kit-key', 'PRO-TEST-KEY-0001'); await p.click('.kit-form button');
    await p.waitForFunction(() => /Pro license is active/.test(document.querySelector('#kitpanel').textContent), null, { timeout: 10000 }).catch(() => {});
    const t = await p.textContent('#kitpanel');
    ok('Pro key: active but no white-label', t.includes('Your Pro license is active') && t.includes('need the Agency Kit, Agency or Agency+'), t.slice(0, 160));
    ok('Pro key: paid fields stay disabled', await p.$eval('input[name=logo]', (e) => e.disabled));
    ok('Pro key: leads box disabled', await p.$eval('input[name=leads]', (e) => e.disabled));
    await ctx.close();
}
// 5. Key valid for Agency Kit + Agency+ -> highest tier (Agency+) wins; leads checkbox enabled; snippet carries leads
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await gumroad(ctx, ['agencykit', 'agencyplus']); const p = await ctx.newPage();
    await p.goto(BASE + 'agency-widget/'); await p.waitForSelector('.kit-key');
    await p.fill('.kit-key', 'AGP-TEST-KEY-0001'); await p.click('.kit-form button'); await p.waitForSelector('.kit-on');
    ok('Agency+ wins over Agency Kit', (await p.textContent('.kit-on')).includes('Agency+ license active'), await p.textContent('.kit-on'));
    ok('leads box enabled', !(await p.$eval('input[name=leads]', (e) => e.disabled)));
    await p.check('input[name=leads]'); await p.fill('input[name=agency]', 'Lead Co');
    await p.waitForFunction(() => document.querySelector('#wlsnip').textContent.includes('data-license'));
    const fr = p.frameLocator('#wlprev');
    // Mock the API for the preview's lead POST.
    await ctx.route(`${API}/v1/leads`, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }));
    await fr.locator('#q').fill('example.com'); await fr.locator('#go').click();
    await fr.locator('.leadform').waitFor({ timeout: 150000 });
    ok('lead form shown in white-label widget', true);
    const lf = await fr.locator('.leadform').textContent();
    ok('lead form privacy text', lf.includes('privacy') || lf.includes('Privacy'), lf.slice(0, 200));
    await p.waitForTimeout(2600);
    await fr.locator('.leadform input[name=name]').fill('Test Person'); await fr.locator('.leadform input[name=email]').fill('test.person@example.com');
    await fr.locator('.leadform input[type=checkbox]').check();
    const post = p.waitForRequest((r) => r.url() === `${API}/v1/leads` && r.method() === 'POST', { timeout: 10000 });
    await fr.locator('.leadform button').click();
    const body = JSON.parse((await post).postData());
    ok('lead POST carries license/domain/consent, honeypot empty', body.license === 'AGP-TEST-KEY-0001' && body.domain === 'example.com' && body.consent === true && !body.website, JSON.stringify(body).slice(0, 200));
    await p.screenshot({ path: `${SHOTS}/agency-leads.png`, fullPage: true });
    await ctx.close();
}
// 6. Paid dashboard (API mocked): Agency plan shows leads + CSV
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await gumroad(ctx, ['agency']);
    const J = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    await ctx.route(`${API}/v1/**`, (r) => {
        const u = new URL(r.request().url());
        if (u.pathname === '/v1/me') return J(r, { ok: true, account: { kind: 'license', tier: 'agency', plan: 'Agency', monitors: 200, frequency: 'daily', whiteLabel: true, leads: true, webhooks: true, used: 1, paused: null, lockAt: null } });
        if (u.pathname === '/v1/monitors') return J(r, { ok: true, monitors: [{ id: 'abcdefabcdef', domain: 'github.com', frequency: 'daily', checkHourUtc: 3, checkMinuteUtc: 15, snapshot: { dmarcPolicy: 'reject', spf: 'v=spf1 ...', dkim: ['google'], web: { grade: 'B+' }, tech: ['Contentful'], expires: '2026-10-09', errors: [] }, firstCheckedAt: new Date().toISOString(), lastChangeAt: new Date().toISOString() }] });
        if (u.pathname === '/v1/alerts') return J(r, { ok: true, alerts: [{ d: 'github.com', severity: 'high', title: 'DMARC policy weakened: reject → none', at: new Date().toISOString(), from: 'reject', to: 'none' }] });
        if (u.pathname === '/v1/leads' && u.searchParams.get('format') === 'csv') return r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: 'at,name,email\n2026-10-01,A,a@example.com\n' });
        if (u.pathname === '/v1/leads') return J(r, { ok: true, count: 1, leads: [{ at: new Date().toISOString(), name: 'A', email: 'a@example.com', domain: 'example.com', grade: 'C', score: 72 }] });
        return J(r, { ok: true });
    });
    const p = await ctx.newPage();
    await p.goto(BASE + 'app/'); await p.waitForSelector('#lickey', { state: 'visible' });
    await p.fill('#lickey', 'AGENCY-KEY'); await p.click('#licform button');
    await p.waitForSelector('#dash:not([hidden])', { timeout: 10000 });
    ok('agency dashboard plan', (await p.textContent('#plan')).includes('Agency'));
    ok('agency alerts render', (await p.textContent('#alerts')).includes('DMARC policy weakened'));
    ok('agency leads section visible', await p.isVisible('#leads-sec') && (await p.textContent('#leads')).includes('a@example.com'));
    const dl = p.waitForEvent('download'); await p.click('#csv'); const d = await dl;
    ok('CSV download', d.suggestedFilename() === 'stackgrade-leads.csv');
    ok('agency upsell shows Agency+ only', (await p.$$('#upsell .pcard')).length === 1);
    await p.screenshot({ path: `${SHOTS}/app-agency.png`, fullPage: true });
    await ctx.close();
}
// 7. Refunded key is rejected in the dashboard (mocked Gumroad)
{
    const ctx = await b.newContext(); await gumroad(ctx, ['pro'], { refunded: true }); const p = await ctx.newPage();
    await p.goto(BASE + 'app/'); await p.waitForSelector('#lickey', { state: 'visible' });
    await p.fill('#lickey', 'REFUNDED-KEY'); await p.click('#licform button');
    await p.waitForFunction(() => /refund/i.test(document.querySelector('#signin-msg').textContent), null, { timeout: 10000 }).catch(() => {});
    ok('refunded key rejected', /refund/i.test(await p.textContent('#signin-msg')), await p.textContent('#signin-msg'));
    await ctx.close();
}
// 8. Removal form against the LIVE API
{
    const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.goto(BASE + 'remove/'); await p.fill('input[name=value]', 'removal-e2e-test@example.com');
    await p.click('#rmform button'); await p.waitForFunction(() => /Done|Could not/.test(document.querySelector('#rmmsg').textContent), null, { timeout: 15000 });
    ok('removal request (live API)', (await p.textContent('#rmmsg')).startsWith('Done'), await p.textContent('#rmmsg'));
    await ctx.close();
}
await b.close();
console.log(out.join('\n'));
