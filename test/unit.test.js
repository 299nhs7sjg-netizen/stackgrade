import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, registrable, score, letter, detectStack } from '../assets/checks.js';

test('parseInput normalizes domains, URLs and emails', () => {
    assert.equal(parseInput('Example.COM').domain, 'example.com');
    assert.equal(parseInput('https://www.stripe.com/pricing?x=1').domain, 'stripe.com');
    assert.equal(parseInput('bob@github.com').domain, 'github.com');
    assert.equal(parseInput('mail.google.com.').domain, 'mail.google.com');
    assert.equal(parseInput('bücher.de').domain, 'xn--bcher-kva.de');
    assert.equal(parseInput('example.com:8080').domain, 'example.com');
});
test('parseInput rejects garbage, IPs and reserved names', () => {
    for (const bad of ['', 'hello world', '192.168.1.1', '[::1]', '2001:db8::1', 'localhost', 'foo', 'printer.local', 'a..b', '-bad-.com', 'http://']) {
        assert.ok(parseInput(bad).error, `should reject ${JSON.stringify(bad)}`);
    }
});
test('registrable handles 2nd-level ccTLDs', () => {
    assert.equal(registrable('www.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(registrable('mail.google.com'), 'google.com');
    assert.equal(registrable('abc.net.au'), 'abc.net.au');
    assert.equal(registrable('heise.de'), 'heise.de');
});
test('score renormalizes over checks that ran', () => {
    const s = score([
        { id: 'spf', group: 'email', status: 'pass', points: 1 },
        { id: 'dmarc', group: 'email', status: 'fail', points: 0 },
        { id: 'dkim', group: 'email', status: 'skip', points: null },
        { id: 'hsts', group: 'web', status: 'skip', points: null },
        { id: 'stack', group: 'signals', status: 'info', points: null },
    ]);
    assert.equal(s.coverage, 35);           // 15 + 20
    assert.equal(s.score, Math.round(100 * 15 / 35));
    assert.equal(s.skippedWeight, 18);      // dkim 10 + hsts 8
    assert.equal(score([]).score, null);
});
test('letters', () => { assert.equal(letter(90), 'A'); assert.equal(letter(89), 'B'); assert.equal(letter(59), 'F'); });
test('stack detection from headers + DNS', () => {
    const { tech, leaks } = detectStack({ headers: { server: 'nginx/1.18.0', 'x-powered-by': 'PHP/7.4.3' }, mxHosts: ['aspmx.l.google.com'], txt: ['v=spf1 include:sendgrid.net ~all'], ns: ['ada.ns.cloudflare.com'] });
    const names = tech.map((t) => t.name);
    for (const n of ['Google Workspace', 'SendGrid', 'Cloudflare DNS']) assert.ok(names.includes(n), n);
    assert.equal(leaks.length, 2);
});
