'use strict';
// (10) Numero di partenza: imposto "ultimo usato = 14" dal Profilo, emetto -> 15/2026. Avvisi e conferme.
// Dati FITTIZI: P.IVA 01234567897, CF BNCMRA80A01H501A, cliente P.IVA 02345678904. Preview su porta 4183.
const { run, go, fillProfile, createInvoiceDraft, issueCurrent } = require('../lib.cjs');

run('10-numero-di-partenza', async (S) => {
  const year = new Date().getFullYear();
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);

  await go(page, '/profilo');
  const field = page.getByLabel('Ultimo numero già usato per fatture');
  const card = page.getByTestId('numbering-card');
  S.check('spiegazione e avviso di errore fiscale visibili', /ultimo numero che hai usato/.test(await card.innerText()) && /errore fiscale/.test(await card.innerText()));
  S.check('i vecchi campi sono spiegati come "di cortesia"', /Vecchi documenti di cortesia/.test(await page.locator('main').innerText()));

  await field.fill('14/2026');
  S.check('input con anno: errore chiaro', /solo cifre/.test(await card.innerText()));
  await field.fill('14');
  await S.shot(page, 'numero 14 inserito');
  await page.getByRole('button', { name: 'Imposta numero di partenza' }).click();
  const dlg = page.getByRole('dialog', { name: 'Conferma il numero di partenza' });
  await dlg.waitFor();
  S.check('conferma mostra la prossima 15/' + year, (await dlg.innerText()).includes(`15/${year}`));
  S.check('senza spunta non si conferma', await dlg.getByRole('button', { name: 'Conferma e imposta' }).isDisabled());
  await dlg.getByRole('checkbox').check();
  await S.shot(page, 'conferma numero di partenza');
  await dlg.getByRole('button', { name: 'Conferma e imposta' }).click();
  await page.locator('.toast', { hasText: `n. 15/${year}` }).first().waitFor({ timeout: 8000 });

  await createInvoiceDraft(S, page, { lines: [{ description: 'Intervento idraulico', qty: 1, price: 120 }] });
  const n = await issueCurrent(S, page, { tag: 'dopo partenza ' });
  S.check(`prima emissione = 15/${year}`, n === `15/${year}`, n);
  await createInvoiceDraft(S, page, { lines: [{ description: 'Secondo lavoro', qty: 1, price: 60 }] });
  S.check(`seconda = 16/${year}`, (await issueCurrent(S, page)) === `16/${year}`);

  // sotto l'emesso: bloccato
  await go(page, '/profilo');
  await page.getByLabel('Ultimo numero già usato per fatture').fill('10');
  await page.getByRole('button', { name: 'Imposta numero di partenza' }).click({ force: true }).catch(() => {});
  S.check('sotto il massimo emesso: errore e nessuna conferma', /hai già emesso fino al n\./.test(await page.getByTestId('numbering-card').innerText()) && (await page.getByRole('dialog').count()) === 0);

  // registro attività globale
  await go(page, '/documenti');
  await page.getByRole('button', { name: 'Registro attività' }).click();
  const log = page.getByRole('dialog', { name: 'Registro attività' });
  await log.waitFor();
  const t = await log.innerText();
  S.check('registro: voce di numerazione ed emissioni leggibili', /Numero di partenza impostato/.test(t) && /Emessa/.test(t), t.slice(0, 200));
  await S.shot(page, 'registro attivita');
});
