// Generates static 1200x630 share cards into assets/og/. Run: node tools/og.mjs
import { chromium } from 'playwright';   // npm i -g playwright (or set NODE_PATH)
const CARDS = {
    home: ['How healthy is your domain?', 'Free 0–100 grade for SPF, DKIM, DMARC, security headers and domain expiry, with plain-English fixes.', 'A', '97'],
    dmarc: ['DMARC checker', 'Is your domain protected from spoofing? Check your DMARC policy and get a copy-paste fix.', 'p=', 'reject'],
    spf: ['SPF record checker', 'Validate your SPF record and the 10 DNS-lookup limit, counted through every include.', 'SPF', '~all'],
    dkim: ['DKIM checker', 'Find DKIM keys at about 40 common selectors, or test your own selector.', 'DKIM', 'key'],
    provider: ['What email provider does this domain use?', 'Google Workspace, Microsoft 365, Zoho or something else? See it from public MX and SPF records.', 'MX', 'lookup'],
    headers: ['Security headers checker', 'HTTPS, HSTS, CSP, clickjacking protection and more, with copy-paste fixes.', 'HSTS', 'CSP'],
    widget: ['Free audit widget for agencies', 'Embed a website & email health grader on your site. Copy-paste, free.', '</>', 'embed'],
    badge: ['Show your grade', 'A "Graded A" badge that turns grey if your grade drops.', 'A', 'badge'],
};
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
for (const [k, [h, sub, big, small]] of Object.entries(CARDS)) {
    const bigSize = big.length <= 1 ? 150 : big.length <= 3 ? 96 : 76;
    await p.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#0f172a;font-family:system-ui,sans-serif;color:#fff;display:flex;align-items:center;padding:0 80px;box-sizing:border-box">
<div style="flex:none;width:300px;height:300px;border-radius:50%;border:28px solid #16a34a;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;margin-right:70px"><div style="font-size:${bigSize}px;font-weight:800;color:#22c55e;line-height:1">${big.replace(/</g, '&lt;')}</div><div style="font-size:30px;color:#cbd5e1;margin-top:6px">${small}</div></div>
<div><div style="font-size:30px;font-weight:800;color:#22c55e;margin-bottom:18px">StackGrade</div>
<div style="font-size:${h.length > 30 ? 54 : 64}px;font-weight:800;line-height:1.05;margin-bottom:22px">${h}</div>
<div style="font-size:30px;color:#cbd5e1;line-height:1.35">${sub}</div></div></body></html>`);
    await p.screenshot({ path: `assets/og/${k}.png` });
}
await b.close();
console.log('ok');
