import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzePage, evidence } from '../src/fingerprint.js';

test('detects CMS, analytics and frameworks from tags', () => {
    const html = `<!doctype html><html lang="en"><head><meta name="generator" content="WordPress 6.6.2">
<link rel="stylesheet" href="/wp-content/themes/x/style.css"><script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ"></script>
<script src="https://js.hs-scripts.com/123.js"></script></head><body><script>window.dataLayer=[];</script></body></html>`;
    const r = analyzePage({ html, headers: { server: 'nginx/1.18.0' }, cookies: [] });
    const names = r.tech.map((t) => t.name);
    assert.ok(names.includes('WordPress'), names.join());
    assert.ok(names.some((n) => /Google (Analytics|Tag Manager)/.test(n)), names.join());
    assert.equal(r.tech.find((t) => t.name === 'WordPress').version, '6.6.2');
    assert.ok(r.leaks.some((l) => l.startsWith('Server: nginx/1.18')));
});
test('evidence() stays small on a huge page (CPU budget)', () => {
    const big = `<html><head><script src="/a.js"></script></head><body>${'<p>lorem ipsum dolor</p>'.repeat(40000)}</body></html>`;
    const ev = evidence(big);
    assert.ok(ev.length < 5000);
    const t = process.hrtime.bigint();
    for (let i = 0; i < 10; i++) analyzePage({ html: big });
    const ms = Number(process.hrtime.bigint() - t) / 10 / 1e6;
    assert.ok(ms < 8, `analyzePage took ${ms} ms`);
});
