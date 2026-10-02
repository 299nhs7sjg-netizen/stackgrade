import { chromium } from '/home/box/.local/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const SHOTS = process.env.SHOTS || '/tmp/pt';
const cases = [
  ['', 'bücher.de', 'idn'],
  ['dmarc-checker/', 'daringfireball.net', 'dmarc'],
  ['spf-checker/', 'github.com', 'spf'],
  ['dkim-checker/', 'github.com&s=google', 'dkim'],
  ['dkim-checker/', 'daringfireball.net&s=google', 'dkim-fail'],
  ['email-provider-lookup/', 'stripe.com', 'provider'],
  ['security-headers-checker/', 'heise.de', 'headers'],
  ['widget/', 'linear.app&agency=Acme%20%3Cb%3EWeb%3C/b%3E&color=7c3aed', 'widget'],
];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const [vpName, vp] of [['desk', { width: 1280, height: 900 }], ['mob', { width: 390, height: 844 }]]) {
  for (const [slug, q, name] of cases) {
    const p = await b.newPage({ viewport: vp });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const t0 = Date.now();
    await p.goto(`${BASE}${slug}?d=${q}`);
    await p.waitForSelector('#rerun, .notice, a.btn[href*="ref=widget"]', { timeout: 100000 }).catch(() => errs.push('timeout'));
    const info = await p.evaluate(() => ({
      title: document.title, h1: document.querySelector('h1')?.textContent, q: document.querySelector('#q')?.value,
      sumh: document.querySelector('.sum-h')?.textContent,
      spot: [...document.querySelectorAll('.spot .check')].map((c) => `${c.querySelector('h3').textContent}=${c.querySelector('.pill').textContent}: ${c.querySelector('p').textContent.slice(0, 110)}`),
      wby: document.querySelector('#wby')?.textContent, wbyHtml: document.querySelector('#wby')?.innerHTML,
      acc: getComputedStyle(document.documentElement).getPropertyValue('--acc'),
      powered: document.querySelector('.wfoot a')?.href, overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }));
    if (vpName === 'desk' || name === 'widget' || name === 'dkim') console.log(`\n[${vpName}] ${slug}?d=${q} ${Date.now() - t0}ms ${errs.join(';')}`, JSON.stringify(info));
    else console.log(`[${vpName}] ${name} ${Date.now() - t0}ms overflowX=${info.overflowX} ${errs.join(';')}`);
    await p.screenshot({ path: `${SHOTS}-${vpName}-${name}.png` });
    await p.close();
  }
}
// badge page
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto(`${BASE}badge/`); await p.waitForTimeout(1500);
await p.fill('#bq', 'https://www.github.com'); await p.click('#bform button'); await p.waitForTimeout(300);
console.log('\nbadge:', await p.textContent('#bout'), '| list imgs:', await p.$$eval('#blist img', (a) => a.map((i) => i.naturalWidth)));
await p.fill('#bq', 'daringfireball.net'); await p.click('#bform button'); await p.waitForTimeout(300);
console.log('badge2:', await p.textContent('#bout'));
await p.screenshot({ path: `${SHOTS}-mob-badge.png`, fullPage: true });
await b.close();
