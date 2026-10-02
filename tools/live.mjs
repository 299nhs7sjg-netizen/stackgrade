import { chromium } from '/home/box/.local/lib/node_modules/playwright/index.mjs';
const base = process.env.BASE || 'https://299nhs7sjg-netizen.github.io/stackgrade/';
const domains = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const results = [];
async function one(d) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  let firstGrade = null;
  await page.goto(`${base}?d=${encodeURIComponent(d)}`);
  const poll = setInterval(async () => { if (firstGrade == null) { const t = await page.textContent('.ring .l span').catch(() => null); if (t && /^\d/.test(t)) firstGrade = Date.now() - t0; } }, 250);
  await page.waitForSelector('.rerun, .notice, #err:not([hidden])', { timeout: 100000 }).catch(() => errs.push('timeout'));
  clearInterval(poll);
  const ms = Date.now() - t0;
  const data = await page.evaluate(() => ({
    title: document.title,
    err: document.querySelector('#err:not([hidden])')?.textContent || null,
    notice: document.querySelector('.notice')?.innerText?.split('\n').slice(0, 2).join(' ') || null,
    cov: document.querySelector('.cov')?.textContent || null,
    checks: [...document.querySelectorAll('.check')].map((c) => ({ t: c.querySelector('h3').textContent, s: c.querySelector('.pill').textContent, p: c.querySelector('p').textContent })),
  }));
  results.push({ d, ms, firstGrade, errs, ...data });
  await page.close();
}
const queue = [...domains];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
await browser.close();
import('node:fs').then((fs) => fs.writeFileSync('/tmp/live.json', JSON.stringify(results, null, 1)));
for (const r of results) {
  console.log(`\n## ${r.d} | ${r.title} | first grade ${r.firstGrade}ms, final ${r.ms}ms ${r.errs.length ? 'ERRS ' + r.errs.join(';') : ''}`);
  if (r.err) console.log('  input error:', r.err);
  if (r.notice) console.log('  notice:', r.notice);
  if (r.cov) console.log('  ', r.cov);
  for (const c of r.checks) if (c.s !== 'Pass') console.log(`  [${c.s}] ${c.t}: ${c.p.slice(0, 150)}`);
}
