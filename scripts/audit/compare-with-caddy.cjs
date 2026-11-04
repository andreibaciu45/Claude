'use strict';
/**
 * Prova di fedelta': avvia il VERO Caddy (binario `caddy`, env CADDY_BIN o nel PATH) con infra/Caddyfile.nodocker
 * (percorso della PWA e upstream adattati a localhost) e confronta, per un elenco di URL, gli header di risposta con quelli di
 * serve-with-headers.cjs. Serve a garantire che il server di prova applichi davvero cio' che applica Caddy.
 *   node scripts/audit/compare-with-caddy.cjs --dist <build> [--api http://127.0.0.1:8798]
 * Esce con 1 se ci sono differenze. Se Caddy non c'e', esce con 2 (non eseguito).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { parseCaddyfile, createServer } = require('./serve-with-headers.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..', '..');
const dist = path.resolve(arg('dist', path.join(ROOT, 'dist')));
const api = arg('api', 'http://127.0.0.1:8798');
const caddy = process.env.CADDY_BIN || 'caddy';
if (spawnSync(caddy, ['version']).status !== 0) { console.log('caddy non trovato (imposta CADDY_BIN): confronto NON eseguito'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-cmp-'));
const src = fs.readFileSync(path.join(ROOT, 'infra/Caddyfile.nodocker'), 'utf8');
const apiHost = new URL(api).host;
const cf = path.join(tmp, 'Caddyfile');
fs.writeFileSync(cf, src.replace(/\/opt\/vocepreventivo\/current\/dist/g, dist).replace(/127\.0\.0\.1:8787/g, apiHost));
const CP = 4194, SP = 4195;
const proc = spawn(caddy, ['run', '--config', cf, '--adapter', 'caddyfile'], { env: { ...process.env, DOMAIN: `http://127.0.0.1:${CP}`, ACME_EMAIL: 'a@example.test', XDG_DATA_HOME: tmp, XDG_CONFIG_HOME: tmp }, stdio: 'ignore' });
const mine = createServer({ dist, cfg: parseCaddyfile(src), api });

const get = (port, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { 'Accept-Encoding': 'identity' } }, (r) => { r.resume(); r.on('end', () => resolve({ status: r.statusCode, h: r.headers })); }).on('error', (e) => resolve({ status: 0, h: {}, err: e.message }));
});
const SKIP = new Set(['date', 'etag', 'last-modified', 'content-length', 'content-type', 'connection', 'keep-alive', 'x-request-id', 'vary', 'accept-ranges', 'transfer-encoding', 'origin-agent-cluster', 'x-dns-prefetch-control', 'x-download-options', 'x-xss-protection']);
const norm = (r) => Object.entries(r.h).filter(([k]) => !SKIP.has(k)).map(([k, v]) => `${k}: ${String(v).replace(/^(no-store), \1$/, '$1')}`).sort().join('\n');

(async () => {
  await new Promise((r) => mine.listen(SP, '127.0.0.1', r));
  for (let i = 0; i < 40 && !(await get(CP, '/')).status; i++) await new Promise((r) => setTimeout(r, 250));
  let bad = 0;
  for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/icon-192.png', '/icon.svg', '/apple-touch-icon.png', '/offline.html', '/legal/privacy.html', '/guide/', '/documenti/x', '/assets/non-esiste.js', '/v1/me', '/health']) {
    const a = await get(CP, p), b = await get(SP, p);
    const same = a.status === b.status && norm(a) === norm(b);
    if (!same) { bad++; console.log(`DIFF ${p}  (caddy ${a.status} / prova ${b.status})\n--- caddy\n${norm(a)}\n--- prova\n${norm(b)}`); } else console.log(`ok   ${p}  ${a.status}`);
  }
  proc.kill(); mine.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `\n${bad} differenze` : '\nIl server di prova coincide con Caddy sugli header verificati');
  process.exit(bad ? 1 : 0);
})();
