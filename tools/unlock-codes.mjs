#!/usr/bin/env node
// Mint unlock codes for the GreenTools product sites. Plaintext goes ONLY to a local 0600 file; KV gets SHA-256 hashes
// (unlockcode:<product>:<sha256("unlock:<product>:<CODE>")>), which POST /v1/unlock checks. Nothing here is secret.
//   node tools/unlock-codes.mjs --namespace <kv id> --out <file> [--per 10] [--products blotout,docburn,...]
// Retiring a code = deleting its KV key. Codes that were never written to KV (e.g. the old public IB-* lists) are invalid.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { UNLOCK_PRODUCTS, codeKey } from '../worker/src/unlock.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const NS = arg('--namespace'); const OUT = arg('--out'); const PER = Number(arg('--per', 10));
const PRODUCTS = (arg('--products') || Object.keys(UNLOCK_PRODUCTS).join(',')).split(',');
if (!NS || !OUT || !process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) { console.error('usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/unlock-codes.mjs --namespace <id> --out <file> [--per N]'); process.exit(2); }
const PREFIX = { blotout: 'BLO', docburn: 'DOC', lockfit: 'LCK', metagone: 'MTG', snapfit: 'SNF', imagebuff: 'IMB' };
const AL = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 32 symbols, no 0/O/1/I
const group = () => [...crypto.randomBytes(4)].map((b) => AL[b & 31]).join('');
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const rows = [];
for (const p of PRODUCTS) {
    if (!Object.hasOwn(UNLOCK_PRODUCTS, p)) throw new Error('unknown product ' + p);
    out[p] = out[p] || [];
    for (let i = 0; i < PER; i++) { const c = `GT-${PREFIX[p]}-${group()}-${group()}-${group()}-${group()}`; out[p].push({ code: c, created: new Date().toISOString() }); rows.push({ key: await codeKey(p, c), value: '1' }); }
}
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${NS}/bulk`, { method: 'PUT', headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(rows) });
const j = await r.json(); if (!j.success) { console.error('KV bulk write failed', JSON.stringify(j.errors)); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', { mode: 0o600 }); fs.chmodSync(OUT, 0o600);
console.log(`wrote ${rows.length} code hashes to KV ${NS} (${PRODUCTS.length} products x ${PER}); plaintext -> ${OUT} (0600)`);
