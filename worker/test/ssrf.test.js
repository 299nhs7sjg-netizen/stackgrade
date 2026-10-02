import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, isPrivateV4, isPrivateV6, checkResolves, safeFetch } from '../src/ssrf.js';
import { jres } from './helpers.js';

test('checkUrl blocks IP literals, internal names, odd schemes/ports and credentials', () => {
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f000001/',
        'http://metadata.google.internal/', 'http://printer.local/', 'http://intranet/', 'ftp://example.com/', 'file:///etc/passwd', 'http://example.com:8080/', 'https://user:pw@example.com/', 'gopher://example.com/', 'http://foo.corp/'])
        assert.ok(checkUrl(u).error, u);
    assert.equal(checkUrl('https://stripe.com/').host, 'stripe.com');
    assert.equal(checkUrl('http://example.org:80/').host, 'example.org');
});
test('private address detection (v4 and v6, including mapped/NAT64/6to4)', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1'])
        assert.equal(isPrivateV4(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.1']) assert.equal(isPrivateV4(ip), false, ip);
    for (const ip of ['::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:0a00:0001::1', '2001:db8::1', 'ff02::1'])
        assert.equal(isPrivateV6(ip), true, ip);
    for (const ip of ['2606:4700::6810:84e5', '2a00:1450:4001:81c::200e']) assert.equal(isPrivateV6(ip), false, ip);
});
const dohMock = (map) => async (url) => {
    const u = new URL(url); const name = u.searchParams.get('name'); const type = u.searchParams.get('type');
    const ips = (map[name] || {})[type] || [];
    return jres(200, { Status: 0, Answer: ips.map((ip) => ({ type: type === 'A' ? 1 : 28, data: ip })) });
};
test('hostnames resolving to private addresses are rejected (DNS rebinding style)', async () => {
    const f = dohMock({ 'evil.example.com': { A: ['93.184.216.34', '10.0.0.5'] }, 'meta.attacker.io': { A: ['169.254.169.254'] }, 'v6.attacker.io': { AAAA: ['::1'] }, 'ok.site.com': { A: ['93.184.216.34'] } });
    assert.match((await checkResolves('evil.example.com', f)).error, /private/);
    assert.match((await checkResolves('meta.attacker.io', f)).error, /private/);
    assert.match((await checkResolves('v6.attacker.io', f)).error, /private/);
    assert.equal((await checkResolves('ok.site.com', f)).ok, true);
    assert.match((await checkResolves('nothing.site.com', f)).error, /does not resolve/);
});
test('safeFetch re-validates every redirect hop and caps the body', async () => {
    const dns = dohMock({ 'a.site.com': { A: ['93.184.216.34'] }, 'b.site.com': { A: ['192.168.0.10'] } });
    const f = async (url, init) => {
        if (url.includes('dns')) return dns(url);
        if (url.startsWith('https://a.site.com/redir-ip')) return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
        if (url.startsWith('https://a.site.com/redir-private')) return new Response('', { status: 301, headers: { location: 'https://b.site.com/' } });
        if (url.startsWith('https://a.site.com/big')) return new Response('x'.repeat(600000), { headers: { 'content-type': 'text/html' } });
        throw new Error(`unexpected fetch ${url}`);
    };
    const r1 = await safeFetch('https://a.site.com/redir-ip', { fetchImpl: f }); assert.equal(r1.ok, false); assert.equal(r1.blocked, true);
    const r2 = await safeFetch('https://a.site.com/redir-private', { fetchImpl: f }); assert.equal(r2.ok, false); assert.match(r2.error, /private/);
    const r3 = await safeFetch('https://a.site.com/big', { fetchImpl: f }); assert.equal(r3.ok, true); assert.equal(r3.html.length, 262144);
});
