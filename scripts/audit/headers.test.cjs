'use strict';
/**
 * Test statici (nessun browser, nessuna rete): `node --test scripts/audit/headers.test.cjs`
 * Opzionale: DIST=<build> verifica anche gli hash degli stili inline (csp-hashes.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCaddyfile, diffConfigs } = require('./serve-with-headers.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const A = parseCaddyfile(read('infra/Caddyfile'));
const B = parseCaddyfile(read('infra/Caddyfile.nodocker'));
const h = (c, n) => (c.headers.find(([k]) => k.toLowerCase() === n.toLowerCase()) || [])[1];
const directive = (csp, n) => { const m = new RegExp('(?:^|;)\\s*' + n + '\\s+([^;]*)').exec(csp); return m ? m[1].trim() : null; };

test('i due Caddyfile hanno header e cache identici', () => assert.deepEqual(diffConfigs(A, B), []));

for (const [name, C] of [['Caddyfile', A], ['Caddyfile.nodocker', B]]) {
  const csp = h(C, 'Content-Security-Policy');
  test(`${name}: CSP senza unsafe-inline/unsafe-eval e con le direttive chiave`, () => {
    assert.ok(csp, 'CSP assente');
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(directive(csp, 'script-src'), /unsafe-inline/);
    assert.doesNotMatch(directive(csp, 'style-src'), /unsafe-inline/);
    assert.equal(directive(csp, 'object-src'), "'none'");
    assert.equal(directive(csp, 'frame-ancestors'), "'none'");
    assert.equal(directive(csp, 'base-uri'), "'none'");
    assert.equal(directive(csp, 'form-action'), "'self'");
    assert.equal(directive(csp, 'connect-src'), "'self'");
    assert.equal(directive(csp, 'worker-src'), "'self'");
    assert.equal(directive(csp, 'default-src'), "'self'");
    assert.doesNotMatch(csp, /\*|https?:/, 'nessuna origine esterna/jolly');
  });
  test(`${name}: Permissions-Policy (microfono solo self), HSTS senza preload, altri header`, () => {
    const pp = h(C, 'Permissions-Policy');
    assert.match(pp, /microphone=\(self\)/);
    for (const f of ['camera', 'geolocation', 'payment']) assert.match(pp, new RegExp(f + '=\\(\\)'));
    assert.doesNotMatch(h(C, 'Strict-Transport-Security'), /preload/);
    assert.match(h(C, 'Strict-Transport-Security'), /max-age=(\d+)/);
    assert.equal(h(C, 'X-Content-Type-Options'), 'nosniff');
    assert.equal(h(C, 'Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(h(C, 'Cross-Origin-Resource-Policy'), 'same-origin');
    assert.equal(h(C, 'Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.equal(h(C, 'X-Frame-Options'), 'DENY');
    assert.ok(C.removed.includes('Server'));
  });
  test(`${name}: regole di cache`, () => {
    assert.equal(C.cache.api, 'no-store');
    assert.match(C.cache.assets, /immutable/);
    assert.equal(C.cache.sw, 'no-cache');
    assert.equal(C.cache.html, 'no-cache');
    assert.match(C.cache.static, /max-age=\d{1,6}$/);
  });
}

test('sw.js: non intercetta ne\' mette in cache l\'API, ignora il cross-origin', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /isApiPath\(url\.pathname\)\) return/);
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
  assert.match(sw, /Authorization/);
  assert.doesNotMatch(sw, /cache\.addAll\(\[?\s*['"]\/v1/);
});

if (process.env.DIST) {
  const { check } = require('./csp-hashes.cjs');
  for (const f of ['infra/Caddyfile', 'infra/Caddyfile.nodocker']) {
    test(`${f}: hash degli stili inline allineati alla build`, () => assert.deepEqual(check(path.resolve(process.env.DIST), path.join(ROOT, f)).problems, []));
  }
}
