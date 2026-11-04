'use strict';
/**
 * Prova del service worker con Playwright, dietro gli header REALI dei Caddyfile (serve-with-headers.cjs).
 *   node scripts/audit/sw-audit.cjs --dist <cartella build> [--api http://127.0.0.1:8798]
 * Copia la build in una cartella temporanea (per poterne cambiare sw.js e simulare un aggiornamento di versione),
 * avvia il server con header sulla porta 4191 e verifica:
 *  1) installazione + attivazione; nessuna risposta /v1 o /health in nessuna cache (anche con Authorization);
 *  2) offline: shell dell'app, pagina legale gia' visitata, pagina sconosciuta -> offline.html (non la shell);
 *  3) aggiornamento di versione: cache vecchie (anche una finta v2 con /v1) cancellate, cache asset mantenuta,
 *     localStorage e IndexedDB intatti;
 *  4) nessuna violazione CSP e nessun errore in console.
 * Esce con 1 se un controllo fallisce.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { parseCaddyfile, createServer } = require('./serve-with-headers.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.resolve(arg('dist', path.join(ROOT, 'dist')));
const API = arg('api', 'http://127.0.0.1:8798');
const PORT = 4191;
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : '  -> ' + String(detail).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-audit-'));
  fs.cpSync(SRC, tmp, { recursive: true });
  const cfg = parseCaddyfile(fs.readFileSync(path.join(ROOT, 'infra/Caddyfile'), 'utf8'));
  const srv = createServer({ dist: tmp, cfg, api: API });
  await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'allow', acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|504)|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => console.error('CSPVIOLATION ' + e.violatedDirective + ' ' + e.blockedURI)); });

  try {
    // 1) installazione
    await page.goto(BASE + '/#/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // dopo clients.claim la pagina e' controllata comunque; reload per sicurezza
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const ver1 = await page.evaluate(async () => (await caches.keys()).sort());
    check('cache create: shell versionata + asset', ver1.some((k) => /^voceprev-shell-v\d+$/.test(k)), ver1);

    // dati utente di prova (devono sopravvivere all'aggiornamento)
    await page.evaluate(async () => {
      localStorage.setItem('audit:keep', 'si');
      await new Promise((res, rej) => { const r = indexedDB.open('audit-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put('dato', 'k'); t.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = rej; });
      // cache "vecchia" tipo v2 con una risposta API autenticata finta
      const old = await caches.open('voceprev-v2');
      await old.put('/v1/sync/pull?since=0', new Response('{"segreto":1}', { headers: { 'Content-Type': 'application/json' } }));
    });

    // chiamate API: con e senza Authorization, + /health
    await page.evaluate(async () => {
      await fetch('/v1/me', { headers: { Authorization: 'Bearer finto' } }).catch(() => {});
      await fetch('/v1/me').catch(() => {});
      await fetch('/v1/sync/pull?since=0', { headers: { Authorization: 'Bearer finto' } }).catch(() => {});
      await fetch('/health').catch(() => {});
    });
    await sleep(500);
    const keysAll = () => page.evaluate(async () => { const o = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) o.push(n + ' ' + new URL(r.url).pathname + new URL(r.url).search); } return o; });
    let all = await keysAll();
    const leak = all.filter((k) => /\/v1\/|\/health/.test(k) && !k.startsWith('voceprev-v2 '));
    check('nessuna risposta /v1 o /health nelle cache correnti', leak.length === 0, leak);
    check('shell precache presente (index.html, offline.html, manifest)', ['/index.html', '/offline.html', '/manifest.webmanifest'].every((p) => all.some((k) => k.endsWith(' ' + p))), all.slice(0, 12));
    check('asset hashati in cache voceprev-assets', all.some((k) => k.startsWith('voceprev-assets /assets/')), all.filter((k) => k.startsWith('voceprev-assets')).length);

    // visita una pagina legale ONLINE (verra' salvata), poi offline
    await page.goto(BASE + '/legal/privacy.html');
    check('pagina legale online con CSP attiva e senza errori', (await page.title()).length > 0);
    await page.goto(BASE + '/#/');
    await page.waitForSelector('#root *');

    // 2) offline
    await ctx.setOffline(true);
    await page.goto(BASE + '/#/documenti').catch(() => {});
    await page.reload().catch(() => {});
    await page.waitForSelector('#root *', { timeout: 8000 }).catch(() => {});
    check('offline: la shell dell\'app si apre e rende React', (await page.locator('#root *').count()) > 0 && !/Sei offline/.test(await page.content()));
    const rPriv = await page.goto(BASE + '/legal/privacy.html').catch((e) => ({ err: e }));
    check('offline: pagina legale gia\' visitata disponibile', rPriv && !rPriv.err && rPriv.status() === 200, rPriv && rPriv.err && rPriv.err.message);
    const rUnk = await page.goto(BASE + '/pagina-che-non-esiste').catch((e) => ({ err: e }));
    const txt = rUnk && !rUnk.err ? await page.content() : '';
    check('offline: rotta sconosciuta -> pagina offline (non la shell dell\'app)', /Sei offline/.test(txt) && (await page.locator('#root').count()) === 0, txt.slice(0, 120));
    const rApi = await page.evaluate(async () => { try { const r = await fetch('/v1/me'); return 'risposta ' + r.status; } catch (e) { return 'errore rete'; } });
    check('offline: l\'API NON e\' servita dalla cache (errore di rete)', rApi === 'errore rete', rApi);
    await ctx.setOffline(false);

    // 3) aggiornamento di versione
    const swPath = path.join(tmp, 'sw.js');
    const sw = fs.readFileSync(swPath, 'utf8');
    fs.writeFileSync(swPath, sw.replace(/const VERSION = '[^']+'/, "const VERSION = 'vTEST'"));
    await page.goto(BASE + '/#/');
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    for (let i = 0; i < 40; i++) { // attivazione: la nuova shell nasce all'install, le vecchie cache sparono all'activate
      const k = await page.evaluate(() => caches.keys());
      if (k.includes('voceprev-shell-vTEST') && !k.includes('voceprev-shell-v3') && !k.includes('voceprev-v2')) break;
      await sleep(400);
    }
    await sleep(800);
    const ver2 = await page.evaluate(async () => (await caches.keys()).sort());
    check('aggiornamento: nuova shell creata, vecchie shell e v2 cancellate', ver2.includes('voceprev-shell-vTEST') && !ver2.some((k) => /^voceprev-shell-v\d+$/.test(k)) && !ver2.includes('voceprev-v2'), ver2);
    check('aggiornamento: la cache asset sopravvive', ver2.includes('voceprev-assets'), ver2);
    const kept = await page.evaluate(async () => ({
      ls: localStorage.getItem('audit:keep'),
      idb: await new Promise((res) => { const r = indexedDB.open('audit-db'); r.onsuccess = () => { const q = r.result.transaction('s').objectStore('s').get('k'); q.onsuccess = () => { r.result.close(); res(q.result); }; }; r.onerror = () => res(null); }),
    }));
    check('aggiornamento: localStorage e IndexedDB intatti', kept.ls === 'si' && kept.idb === 'dato', kept);
    all = await keysAll();
    check('dopo l\'aggiornamento nessuna voce /v1 in cache', !all.some((k) => /\/v1\//.test(k)), all.filter((k) => /\/v1\//.test(k)));
    check('sw.js servito con Cache-Control: no-cache', (await (await ctx.request.get(BASE + '/sw.js')).headers())['cache-control'] === 'no-cache');
    check('nessuna violazione CSP / errore in console', problems.length === 0, problems.slice(0, 5));
  } catch (e) {
    failed++; console.log('FAIL eccezione script:', e.message.split('\n')[0]);
  }
  await browser.close();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} controlli FALLITI` : '\nTutti i controlli SW superati');
  process.exit(failed ? 1 : 0);
})();
