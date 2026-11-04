// Prova su una COPIA: node --test mobile/scripts/csp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { injectCsp, buildCsp } from './csp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const API = 'https://app.example.test/v1';
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>html{margin:0}</style></head><body><div id="root" style="color:red"></div><script type="module" src="/assets/a.js"></script></body></html>';

test('CSP senza unsafe-inline/eval, con hash e API assoluta', () => {
  const out = injectCsp(HTML, API);
  const csp = /content="([^"]+)"/.exec(out)[1];
  assert.ok(!/unsafe-eval/.test(csp) && !/'unsafe-inline'/.test(csp));
  assert.match(csp, /connect-src 'self' https:\/\/app\.example\.test(;|$)/);
  assert.match(csp, /style-src 'self' 'sha256-/);
  assert.match(csp, /style-src-attr 'unsafe-hashes' 'sha256-/);
  assert.match(csp, /script-src 'self'(;|$)/);
});

test('idempotente e sostituisce la meta precedente', () => {
  const a = injectCsp(HTML, API);
  assert.equal(injectCsp(a, API), a);
  const b = injectCsp(a, 'https://altro.example.test/v1');
  assert.equal((b.match(/Content-Security-Policy/g) || []).length, 1);
  assert.match(b, /altro\.example\.test/);
});

test('rifiuta API relativa o http', () => {
  assert.throws(() => buildCsp(HTML, '/v1'));
  assert.throws(() => buildCsp(HTML, 'http://x.example.test/v1'));
  assert.throws(() => buildCsp(HTML, undefined));
});

test('patch-native su una copia: inietta, e al secondo giro non cambia nulla', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pn-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const f of ['patch-native.mjs', 'csp.mjs']) copyFileSync(join(here, f), join(dir, 'scripts', f));
    const idx = join(dir, 'android/app/src/main/assets/public/index.html');
    mkdirSync(dirname(idx), { recursive: true });
    writeFileSync(idx, HTML);
    const run = () => spawnSync('node', ['scripts/patch-native.mjs', `--api-url=${API}`], { cwd: dir, encoding: 'utf8' });
    const r1 = run(); assert.equal(r1.status, 0, r1.stderr);
    const once = readFileSync(idx, 'utf8');
    assert.match(once, /Content-Security-Policy/);
    const r2 = run(); assert.equal(r2.status, 0, r2.stderr);
    assert.equal(readFileSync(idx, 'utf8'), once);
    const r3 = spawnSync('node', ['scripts/patch-native.mjs'], { cwd: dir, encoding: 'utf8', env: { ...process.env, VITE_API_URL: '' } });
    assert.equal(r3.status, 1);
    assert.ok(existsSync(idx));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
