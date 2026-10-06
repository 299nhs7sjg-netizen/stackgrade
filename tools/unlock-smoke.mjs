#!/usr/bin/env node
// Smoke test POST /v1/unlock: every retired public code (old app.js VALID_KEYS + demo keys, read from a local file) must
// be rejected; one current code per product (optional, from the 0600 codes file) must be accepted.
//   node tools/unlock-smoke.mjs <base> --retired <retired.json> [--codes <codes.json>]
// Read-only (the endpoint does one KV read per call). Prints counts only, never codes.
import fs from 'node:fs';
const a = process.argv.slice(2); const base = a.find((x) => /^https?:/.test(x)).replace(/\/$/, '');
const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ''; };
const retired = JSON.parse(fs.readFileSync(arg('--retired'), 'utf8'));
const codes = arg('--codes') ? JSON.parse(fs.readFileSync(arg('--codes'), 'utf8')) : {};
const post = async (product, key) => { for (;;) { const r = await fetch(base + '/v1/unlock', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://blotout.pages.dev' }, body: JSON.stringify({ product, key }) }); if (r.status !== 429) return { status: r.status, j: await r.json().catch(() => ({})), cors: r.headers.get('access-control-allow-origin') }; await new Promise((z) => setTimeout(z, 61000)); } };
let bad = 0; const per = {};
for (const [product, list] of Object.entries(retired)) {
    per[product] = { retired: list.length, rejected: 0 };
    for (const k of list) { const r = await post(product, k); if (r.status === 403 && r.j.ok === false) per[product].rejected++; else { bad++; console.log(`  FAIL retired code accepted or odd status for ${product}: ${r.status}`); } }
    if (codes[product]?.length) { const r = await post(product, codes[product][codes[product].length - 1].code); per[product].current = r.status === 200 && r.j.ok ? 'accepted' : `FAIL ${r.status}`; if (!(r.status === 200 && r.j.ok)) bad++; if (r.cors !== 'https://blotout.pages.dev') { bad++; console.log('  FAIL cors header ' + r.cors); } }
}
console.log(JSON.stringify(per, null, 1));
console.log(bad ? `[unlock-smoke] FAILED ${bad}` : '[unlock-smoke] all retired codes rejected' + (Object.keys(codes).length ? ', current codes accepted' : ''));
process.exit(bad ? 1 : 0);
