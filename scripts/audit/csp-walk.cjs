'use strict';
/**
 * Percorso guidato dell'app (home, dettatura testuale, listino, profilo, preventivo+PDF, fattura+emissione+XML+PDF,
 * documenti, backup, account con login OTP, pagine statiche) dietro gli header REALI dei Caddyfile,
 * raccogliendo TUTTE le violazioni CSP (evento `securitypolicyviolation`) + errori di console/pageerror.
 *
 *   # 1) build:            npx vite build --outDir /percorso/dist
 *   # 2) server con header: node scripts/audit/serve-with-headers.cjs --dist /percorso/dist --port 4190
 *   # 3) API locale (:8798) con AUTH_DEV_RETURN_CODE=1 (solo test; vedi scripts/qa/env.cjs)
 *   # 4) E2E_BASE=http://127.0.0.1:4190 node scripts/audit/csp-walk.cjs
 *
 * Riusa gli helper della suite e2e/ (dati SOLO fittizi: P.IVA 01234567897, CF BNCMRA80A01H501A, cliente 02345678904).
 * Esce con 1 se c'e' almeno una violazione CSP. Risultato in e2e/out/csp-walk/result.json.
 */
const fs = require('fs');
const L = require('../../e2e/lib.cjs');
const { run, go, fillProfile, addSampleCatalog, createInvoiceDraft, issueCurrent, saveDownload, sleep } = L;

run('csp-walk', async (S) => {
  const violations = [];
  const ctx = await S.context({ mobile: true });
  await ctx.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error('CSPVIOLATION ' + JSON.stringify({ dir: e.violatedDirective, blocked: e.blockedURI, src: e.sourceFile, line: e.lineNumber, sample: e.sample }));
    });
  });
  const page = await S.page(ctx);
  page.on('console', (m) => { if (/CSPVIOLATION|Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  const step = async (name, fn) => { const n0 = violations.length; await fn(); S.check(`CSP pulita: ${name}`, violations.length === n0, violations.slice(n0)); };

  // intestazioni della risposta principale
  const r = await page.goto(L.BASE + '/');
  const h = r.headers();
  S.check('header presenti', ['content-security-policy', 'strict-transport-security', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'x-content-type-options', 'referrer-policy'].every((k) => h[k]), Object.keys(h));
  S.check("CSP senza 'unsafe-inline' / 'unsafe-eval'", !/unsafe-eval/.test(h['content-security-policy']) && !/style-src[^;]*'unsafe-inline'/.test(h['content-security-policy']) && !/script-src[^;]*'unsafe-inline'/.test(h['content-security-policy']));

  const pol = await page.evaluate(() => { const fp = document.featurePolicy; return fp ? { mic: fp.allowsFeature('microphone'), cam: fp.allowsFeature('camera'), geo: fp.allowsFeature('geolocation') } : null; });
  S.check('Permissions-Policy effettiva: microfono si, camera/geolocalizzazione no', !pol || (pol.mic && !pol.cam && !pol.geo), pol);
  S.check('crossOriginIsolated non richiesto, COOP attivo (window.opener nullo)', await page.evaluate(() => window.opener === null));

  await step('home + dettatura testuale', async () => {
    await go(page, '/');
    await page.getByLabel('Testo del preventivo').fill('preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera');
    await page.getByRole('button', { name: 'Interpreta' }).click();
    await page.getByRole('heading', { name: /Righe \(/ }).waitFor();
  });
  await step('profilo (P.IVA/CF fittizi)', async () => { await fillProfile(S, page); });
  await step('catalogo', async () => { await addSampleCatalog(S, page, 'Idraulico'); await go(page, '/clienti'); await go(page, '/info'); });
  await step('preventivo + PDF', async () => {
    await go(page, '/');
    await page.getByLabel('Testo del preventivo').fill('preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera');
    await page.getByRole('button', { name: 'Interpreta' }).click();
    await page.getByRole('heading', { name: /Righe \(/ }).waitFor();
    await page.getByRole('button', { name: 'Genera preventivo' }).click();
    await page.waitForURL(/#\/documenti\/[^/?#]+$/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica PDF/ }).click()]);
    const f = await saveDownload(S, dl, 'preventivo.pdf');
    S.check('PDF preventivo scaricato (%PDF)', fs.readFileSync(f.path).subarray(0, 5).toString() === '%PDF-');
  });
  await step('fattura: bozza, emissione, XML e PDF', async () => {
    await createInvoiceDraft(S, page, { lines: [{ description: 'Sostituzione caldaia murale', qty: 1, price: 150 }] });
    await issueCurrent(S, page);
    const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
    const fx = await saveDownload(S, x);
    S.check('XML scaricato', /^IT01234567897_.*\.xml$/.test(fx.name) && fs.readFileSync(fx.path, 'utf8').includes('<p:FatturaElettronica') || fs.readFileSync(fx.path, 'utf8').includes('FatturaElettronica'), fx.name);
    const [p] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica PDF/ }).click()]);
    const fp = await saveDownload(S, p, 'fattura.pdf');
    S.check('PDF fattura scaricato (%PDF)', fs.readFileSync(fp.path).subarray(0, 5).toString() === '%PDF-');
  });
  await step('documenti, backup (export), listino', async () => {
    await go(page, '/documenti');
    await go(page, '/backup');
    const exp = page.getByRole('button', { name: /Scarica backup|Esporta/i }).first();
    if (await exp.count()) { const [d] = await Promise.all([page.waitForEvent('download').catch(() => null), exp.click()]); if (d) await saveDownload(S, d, 'backup.json'); }
    await go(page, '/catalogo');
  });
  await step('account: login OTP con API locale (same-origin /v1)', async () => {
    await go(page, '/account');
    await page.getByLabel('Email').fill(`csp.${Date.now()}@example.test`);
    const cb = page.getByRole('checkbox', { name: /Ho letto/ }); if (await cb.count()) await cb.check();
    await page.getByRole('button', { name: 'Inviami il codice' }).click();
    await page.getByLabel('Codice a 6 cifre').waitFor();
    const code = S.devCodes[ctx.__label];
    S.check('API raggiunta: codice OTP di sviluppo ricevuto', !!code);
    await page.getByLabel('Codice a 6 cifre').fill(code);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await page.getByText(/Sincronizzazione/).first().waitFor({ timeout: 15000 });
    const mig = await page.getByText('Prima sincronizzazione').waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (mig) { await page.getByRole('button', { name: 'Carica e sincronizza' }).click(); await page.getByText('Tutto aggiornato').waitFor({ timeout: 15000 }); }
  });
  await step('pagine statiche (legali, guide, prodotto, offline)', async () => {
    for (const p of ['/legal/privacy.html', '/legal/termini.html', '/legal/dpa.html', '/legal/cookie.html', '/legal/subprocessors.html', '/guide/', '/prodotto.html', '/offline.html']) {
      const res = await page.goto(L.BASE + p); S.check(`GET ${p} = 200`, res.status() === 200, res.status()); await sleep(150);
    }
  });
  S.check('violazioni CSP totali = 0', violations.length === 0, violations.slice(0, 10));
});
