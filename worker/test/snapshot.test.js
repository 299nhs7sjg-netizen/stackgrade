import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots, mergeSnapshot, sameSnapshot } from '../src/snapshot.js';

const base = { v: 1, errors: [], spf: 'v=spf1 include:_spf.google.com ~all', dmarc: 'v=DMARC1; p=reject', dmarcPolicy: 'reject', mx: ['aspmx.l.google.com'], dkim: ['google'],
    web: { grade: 'B', score: 70, tests: { https: 'pass', hsts: 'pass', csp: 'fail' } }, tech: ['WordPress'], expires: '2027-01-01', lock: true, hiring: { provider: 'Greenhouse', count: 10, url: 'x' } };
test('no change, no events; first snapshot has no events', () => {
    assert.deepEqual(diffSnapshots(base, structuredClone(base)), []);
    assert.deepEqual(diffSnapshots(null, base), []);
    assert.equal(sameSnapshot(base, structuredClone(base)), true);
});
test('detects weakened DMARC, removed SPF, MX/DKIM/header/tech/lock/hiring changes', () => {
    const cur = { ...structuredClone(base), spf: null, dmarc: 'v=DMARC1; p=none', dmarcPolicy: 'none', mx: ['mx.zoho.com'], dkim: [], web: { grade: 'C', score: 50, tests: { https: 'pass', hsts: 'fail', csp: 'fail' } }, tech: ['WordPress', 'HubSpot'], lock: false, hiring: { provider: 'Greenhouse', count: 30, url: 'x' } };
    const ev = diffSnapshots(base, cur);
    const t = ev.map((e) => `${e.type}:${e.severity}`);
    for (const want of ['spf:high', 'dmarc:high', 'mx:medium', 'dkim:medium', 'web-grade:medium', 'header:medium', 'tech:info', 'lock:high', 'hiring:info']) assert.ok(t.includes(want), `${want} in ${t}`);
    assert.equal(sameSnapshot(base, cur), false);
});
test('failed lookups carry the previous value forward (no false alerts)', () => {
    const cur = { v: 1, errors: ['web', 'tech', 'domain', 'spf'], dmarc: base.dmarc, dmarcPolicy: 'reject', mx: base.mx, dkim: base.dkim, hiring: base.hiring };
    const merged = mergeSnapshot(base, cur);
    assert.deepEqual(diffSnapshots(base, merged), []);
    assert.equal(merged.web.grade, 'B'); assert.equal(merged.spf, base.spf);
});
test('expiry: renewal is info, entering the 30-day window is high (once)', () => {
    const now = Date.parse('2026-12-10T00:00:00Z');
    assert.equal(diffSnapshots(base, { ...base, expires: '2028-01-01' }, now)[0].severity, 'info');
    const prevFar = { ...base, expires: '2026-12-25' };
    const ev = diffSnapshots({ ...prevFar, at: now - 86400000 }, { ...prevFar }, now);
    assert.equal(ev.length, 0); // was already "soon" in the previous snapshot too
    const ev2 = diffSnapshots({ ...base, expires: '2026-12-25', at: Date.parse('2026-11-20T00:00:00Z') }, { ...base, expires: '2026-12-25' }, Date.parse('2026-11-26T00:00:00Z'));
    assert.equal(ev2.length, 1); assert.equal(ev2[0].severity, 'high');
    const ev3 = diffSnapshots({ ...base, expires: '2026-12-25', at: Date.parse('2026-11-26T00:00:00Z') }, { ...base, expires: '2026-12-25' }, Date.parse('2026-11-27T00:00:00Z'));
    assert.equal(ev3.length, 0);
});
