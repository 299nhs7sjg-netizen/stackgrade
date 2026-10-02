// Agency Kit UI test (Chrome). BASE defaults to local server. Mocked unlock uses Playwright routes on api.gumroad.com.
import { chromium } from '/home/box/.local/lib/node_modules/playwright/index.mjs';
import { encodeConfig } from '../assets/license.js';
const BASE = process.env.BASE || 'http://localhost:8765/stackgrade/';
const SHOTS = process.env.SHOTS || '/workspace/shots';
const DOMAIN = process.env.DOMAIN || 'example.com';
const FAKE = 'FAKE0000-FAKE0000-FAKE0000-FAKE0000';
const TOK = await encodeConfig({ name: 'Fake Agency', color: 'ff0000', cta: 'Call us', ctaUrl: 'https://example.com', hidePowered: true }, FAKE);
const out = []; const ok = (name, cond, extra = '') => { out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const LOGO = 'https://logo.test.invalid/logo.svg';
async function mocked(ctx) {
    await ctx.route('https://api.gumroad.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ success: true, uses: 1, purchase: { refunded: false, chargebacked: false, disputed: false, subscription_cancelled_at: null } }) }));
    await ctx.route(LOGO, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#7c3aed"/><text x="10" y="27" fill="#fff" font-size="20">ACME</text></svg>' }));
}
// 1. Locked agency page, real Gumroad rejects a fake key
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
    const gum = []; p.on('response', (r) => { if (r.url().includes('api.gumroad.com')) gum.push(r.status()); });
    await p.goto(BASE + 'agency-widget/'); await p.waitForSelector('#kithero a, #kithero span');
    ok('hero CTA text', (await p.textContent('#kithero')).includes('Get the Agency Kit, $29'));
    ok('hero CTA href', (await p.getAttribute('#kithero a', 'href')) === 'https://greenlight5868.gumroad.com/l/stackgrade-agency-kit');
    ok('panel CTA', (await p.textContent('#kitpanel')).includes('Get the Agency Kit, $29'));
    ok('no Coming soon', !(await p.textContent('body')).includes('Coming soon'));
    ok('paid fields disabled', await p.$eval('input[name=logo]', (e) => e.disabled));
    await p.waitForFunction(() => document.querySelector('#wlsnip').textContent.length > 10);
    ok('free snippet has no license', !(await p.textContent('#wlsnip')).includes('data-license'));
    await p.fill('.kit-key', FAKE); await p.click('.kit-form button');
    await p.waitForFunction(() => !/Checking/.test(document.querySelector('.kit-msg').textContent) && document.querySelector('.kit-msg').textContent.length > 3, null, { timeout: 20000 });
    const msg = await p.textContent('.kit-msg');
    ok('fake key rejected by real Gumroad API', gum.length > 0 && !(await p.$('.kit-on')), `HTTP ${gum.join(',')} msg="${msg}"`);
    ok('nothing stored', (await p.evaluate(() => localStorage.getItem('sg-agency-kit'))) === null);
    await p.screenshot({ path: `${SHOTS}/kit-locked.png`, fullPage: true });
    await ctx.close();
}
// 2. Widget with fake license + matching config stays branded (real Gumroad)
{
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const logs = []; p.on('console', (m) => logs.push(m.text()));
    await p.goto(`${BASE}widget/?agency=Fake%20Agency#lic=${FAKE}&cfg=${encodeURIComponent(TOK)}`);
    await p.waitForTimeout(4000);
    ok('widget fake key keeps Powered by', !!(await p.$('.wfoot')), logs.filter((l) => l.includes('Agency Kit')).join(' | '));
    ok('widget fake key no logo', !(await p.$('.wl-logo')));
    await ctx.close();
}
// 3. Mocked valid license: builder, widget preview, PDF
{
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await mocked(ctx); const p = await ctx.newPage();
    await p.goto(BASE + 'agency-widget/'); await p.waitForSelector('.kit-key');
    await p.fill('.kit-key', 'TEST-VALID-KEY'); await p.click('.kit-form button'); await p.waitForSelector('.kit-on');
    ok('mock valid unlocks', true);
    ok('paid fields enabled', !(await p.$eval('input[name=logo]', (e) => e.disabled)));
    await p.fill('input[name=agency]', 'Acme Web Studio'); await p.fill('input[name=logo]', LOGO);
    await p.$eval('input[name=color]', (e) => { e.value = '#7c3aed'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.fill('input[name=cta]', 'Book a free audit'); await p.fill('input[name=ctaUrl]', 'https://example.com/contact');
    await p.check('input[name=hidePowered]');
    await p.waitForFunction(() => document.querySelector('#wlsnip').textContent.includes('Acme') && document.querySelector('#wlsnip').textContent.includes('data-license'), null, { timeout: 5000 });
    const snip = await p.textContent('#wlsnip');
    ok('white-label snippet', /data-license="TEST-VALID-KEY" data-config="[\w-]+\.[0-9a-f]{12}"/.test(snip), snip);
    const fr = p.frameLocator('#wlprev');
    await fr.locator('.wl-logo').waitFor({ timeout: 10000 });
    ok('preview logo shown', true);
    ok('preview Powered by hidden', (await fr.locator('.wfoot').count()) === 0);
    await p.screenshot({ path: `${SHOTS}/kit-builder-unlocked.png`, fullPage: true });
    // PDF
    await p.goto(`${BASE}?d=${DOMAIN}`); await p.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await p.waitForSelector('.rerun', { timeout: 150000 });
    ok('no kit upsell when licensed', (await p.$$('.kitbuy-inline, .kitbuy-box')).length === 0);
    ok('licensed: Add to my monitors', (await p.textContent('.plan-upsell')).includes('Add to my monitors'));
    await p.click('.wlpdf'); await p.waitForFunction(() => window.__printed === 1, null, { timeout: 8000 });
    ok('print called once', true);
    await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: `${SHOTS}/kit-report.pdf`, format: 'A4' });
    await ctx.close();
}
// 4. Locked report page: upsells + PDF modal
{
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const p = await ctx.newPage();
    await p.goto(`${BASE}?d=${DOMAIN}`); await p.waitForSelector('.rerun', { timeout: 150000 });
    ok('inline upsell near PDF', (await p.textContent('.kitbuy-inline')) === 'Get the Agency Kit, $29');
    ok('inline Agency upsell', (await p.locator('.kitbuy-inline').nth(1).getAttribute('href')) === 'https://greenlight5868.gumroad.com/l/vmdksq');
    const pu = await p.textContent('.plan-upsell');
    ok('plan upsell: free monitor + prices + alerts note', pu.includes('Monitor 1 domain free') && pu.includes('$19/mo or $190/yr') && pu.includes('$49/mo or $490/yr') && pu.includes('$99/mo or $990/yr') && pu.includes('Email alerts coming soon; alerts via in-app feed and webhooks today'), pu);
    ok('tech card uses API fingerprint', (await p.textContent('#result')).includes('StackGrade API') || (await p.textContent('#result')).includes('Page fingerprinting not checked'));
    ok('next-steps box upsell', (await p.textContent('.kitbuy-box')).includes('Get the Agency Kit, $29'));
    await p.click('.wlpdf'); await p.waitForSelector('.modal .kit');
    ok('PDF modal CTA', (await p.textContent('.modal')).includes('Get the Agency Kit, $29'));
    await p.screenshot({ path: `${SHOTS}/kit-pdf-modal-mobile.png` });
    await ctx.close();
}
// 5. FAQ + guide pages
for (const s of ['faq/', 'agency-kit/']) {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const r = await p.goto(BASE + s); ok(`${s} HTTP ${r.status()}`, r.status() === 200);
    await p.screenshot({ path: `${SHOTS}/${s.replace('/', '')}.png`, fullPage: false });
    await ctx.close();
}
await b.close();
console.log(out.join('\n'));
