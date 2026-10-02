import { chromium } from '/home/box/.local/lib/node_modules/playwright/index.mjs';
const base = 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const errors = [];
for (const [d, vp, file] of [['stripe.com', { width: 1280, height: 900 }, 'desk'], ['daringfireball.net', { width: 390, height: 844 }, 'mobile'], ['thisdomaindoesnotexist-zz9q.com', { width: 390, height: 844 }, 'nx']]) {
  const page = await browser.newPage({ viewport: vp });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${d}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${d}: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`${base}?d=${d}`);
  await page.waitForSelector('.rerun, .notice', { timeout: 90000 }).catch(() => errors.push(`${d}: timeout`));
  console.log(d, 'done in', Date.now() - t0, 'ms', await page.title());
  await page.screenshot({ path: `/tmp/ui-${file}.png`, fullPage: true });
  await page.close();
}
// invalid input
const page = await browser.newPage();
await page.goto(base); await page.fill('#q', '10.0.0.1'); await page.click('#go');
console.log('err:', await page.textContent('#err'));
await browser.close();
console.log('errors:', errors);
