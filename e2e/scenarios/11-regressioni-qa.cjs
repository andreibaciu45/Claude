'use strict';
// (11) Regressioni dei bug QA corretti: BUG-01 (importo/bollo nella conferma vocale), BUG-02 (edit inesistente dopo emessa),
// BUG-04 (toast mai sopra i pulsanti di conferma), BUG-07 (errore email nel login).
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, sleep } = require('../lib.cjs');

run('11-regressioni-qa', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page); // forfettario: bollo 2 EUR a carico dell'emittente (default)

  // BUG-01: la scheda di conferma vocale usa gli stessi totali del documento
  const id = await createInvoiceDraft(S, page, { lines: [{ description: 'Lavoro da 80', qty: 1, price: 80 }] });
  const docText = await page.locator('main').innerText();
  S.check('documento: totale 80,00 euro', /80,00/.test(docText) && !/82,00/.test(docText), docText.slice(0, 300));
  await page.locator('.vc-fab').click();
  const input = page.getByLabel('Scrivi un comando');
  await input.waitFor();
  await input.fill('emetti la fattura');
  await input.press('Enter');
  await page.locator('.vc-hold').waitFor();
  await S.shot(page, 'scheda conferma vocale');
  const card = (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' | ');
  S.check('scheda vocale: importo 80,00 (non 82,00)', /80,00/.test(card) && !/82,00/.test(card), card);
  S.check('scheda vocale: bollo indicato a carico dell\'emittente', /bollo/i.test(card) && /a tuo carico|emittente/i.test(card), card);
  await page.getByRole('dialog').locator('button.icon-btn[aria-label="Chiudi"]').click();
  await sleep(300);

  // emissione manuale, poi BUG-04: il toast non intercetta il pulsante della scheda NC
  const n = await issueCurrent(S, page);
  S.check('emessa 1/2026', n === '1/2026', n);
  await page.getByRole('button', { name: 'Annulla con nota di credito' }).click();
  const d = page.getByRole('dialog', { name: 'Annulla con nota di credito' });
  await d.waitFor();
  await S.shot(page, 'scheda NC con toast');
  const probe = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('.toast')];
    const btn = document.querySelector('.sheet .hold-btn');
    if (!btn) return { err: 'nessun hold-btn' };
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { toasts: toasts.length, noPointer: toasts.every((t) => getComputedStyle(t).pointerEvents === 'none'), hit: el ? el.className : null, overToast: !!(el && el.closest('.toast')) };
  });
  S.check('toast: pointer-events none', probe.toasts === 0 || probe.noPointer, JSON.stringify(probe));
  S.check('toast: il centro del pulsante a pressione prolungata non e\' coperto da un toast', !probe.err && !probe.overToast, JSON.stringify(probe));
  await d.locator('button.icon-btn[aria-label="Chiudi"]').click().catch(() => page.keyboard.press('Escape'));
  await sleep(300);

  // BUG-02: da edit di una emessa a edit inesistente senza ricaricare
  await go(page, `/?edit=${id}`);
  await sleep(500);
  S.check('edit emessa: non modificabile', /non modificabile/i.test(await page.locator('main').innerText()));
  await page.evaluate(() => { location.hash = '#/?edit=non-esiste-xyz'; });
  await sleep(600);
  const t = await page.locator('main').innerText();
  await S.shot(page, 'edit inesistente dopo emessa');
  S.check('edit inesistente (navigazione interna): "non trovato", non "non modificabile"', /non trovato/i.test(t) && !/non modificabile/i.test(t), t.slice(0, 200));

  // BUG-07: login, l'errore sparisce correggendo l'email
  const ctx2 = await S.context({ mobile: true });
  const A = await S.page(ctx2);
  await go(A, '/account');
  await A.getByLabel('Email').fill('non-una-email');
  await A.getByRole('button', { name: 'Inviami il codice' }).click();
  S.check('login: email non valida rifiutata', await A.getByText('Inserisci un indirizzo email valido').isVisible());
  await A.getByLabel('Email').fill('qa.regressioni@example.test');
  await sleep(300);
  S.check('login: errore sparito dopo la correzione', (await A.getByText('Inserisci un indirizzo email valido').count()) === 0);
  await S.shot(A, 'login errore azzerato');
});
