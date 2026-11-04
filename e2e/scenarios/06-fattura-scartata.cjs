'use strict';
// (6) Fattura scartata dallo SDI (NS): stato, avvisi, azioni disponibili, rinvio.
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, sleep } = require('../lib.cjs');
const tst = async (page, t) => page.locator('.toast', { hasText: t }).first().waitFor({ timeout: 8000 });

run('06-fattura-scartata', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);
  await createInvoiceDraft(S, page, { lines: [{ description: 'Lavoro soggetto a scarto', qty: 1, price: 200 }] });
  const id = docIdOf(page);
  const n = await issueCurrent(S, page);
  S.check('emessa 1/2026', n === '1/2026', n);

  await page.getByRole('button', { name: 'Segna come inviata' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /l’ho inviata/ }).click();
  await tst(page, 'Segnata come inviata');

  await page.getByRole('button', { name: 'Registra esito SDI' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox').first().selectOption('NS');
  await dlg.getByLabel(/Codici di scarto/).fill('00311, 00400');
  await dlg.getByLabel(/Nota/).fill('Scarto di prova');
  await S.shot(page, 'esito NS');
  await dlg.getByRole('button', { name: 'Registra esito' }).click();
  await tst(page, 'Esito registrato');
  await sleep(400);
  await S.shot(page, 'fattura scartata');
  const panel = await page.locator('main').innerText();
  const badges = await page.locator('.iv-badges').first().innerText();
  S.check('stato mostrato: Scartata', /scartata/i.test(badges), badges);
  S.check('avviso scarto visibile (testo dedicato)', /scart/i.test(await page.locator('.iv-meaning').first().innerText()) , await page.locator('.iv-meaning').first().innerText());
  S.check('cronologia riporta codici di scarto 00311, 00400', /00311/.test(panel) && /00400/.test(panel));
  S.check('NS: la fattura mantiene il numero 1/2026', /1\/2026/.test(panel));
  S.check('NS: nessun pulsante Modifica/Elimina (resta immutabile)', (await page.getByRole('link', { name: 'Modifica' }).count()) === 0 && (await page.getByRole('button', { name: /^Elimina/ }).count()) === 0);
  S.check('NS: nessun "Registra incasso" su fattura scartata', (await page.getByRole('button', { name: 'Registra incasso' }).count()) === 0);
  S.check('NS: l\'XML e ancora scaricabile', await page.getByRole('button', { name: 'Scarica XML' }).isEnabled());
  S.check('NS: azione "Segna come rinviata" offerta', await page.getByRole('button', { name: 'Segna come rinviata' }).isVisible());
  const hasRule = /5 giorni|cinque giorni/i.test(panel);
  S.check('NS: l\'app spiega il rinvio entro 5 giorni (CONTRACT-V2: stesso numero/data)', hasRule, 'testo mostrato: ' + (/Se lo scarto[^\n]*/.exec(panel)?.[0] || '(nessuno)'));
  S.check('NS: avviso "non ancora disponibile" non contraddice l\'azione Segna come rinviata', !/non è ancora disponibile/.test(panel), /Se lo scarto[^\n]*/.exec(panel)?.[0]);
  S.check('NS: nessun pulsante "Annulla con nota di credito" (non emessa)', (await page.getByRole('button', { name: /Annulla con nota/ }).count()) === 0);

  // un nuovo documento dopo lo scarto: numero successivo
  await createInvoiceDraft(S, page, { lines: [{ description: 'Altra', qty: 1, price: 20 }] });
  const n2 = await issueCurrent(S, page, { tag: 'dopo-scarto ' });
  S.check('dopo uno scarto, la fattura successiva e 2/2026 (il numero 1 resta riservato al rinvio)', n2 === '2/2026', n2);

  // rinvio
  await go(page, `/documenti/${id}`);
  await page.getByRole('button', { name: 'Segna come rinviata' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /l’ho inviata/ }).click();
  await tst(page, 'Segnata come inviata');
  await S.shot(page, 'rinviata');
  S.check('dopo rinvio: stato Inviata', /inviata/i.test(await page.locator('.iv-badges').first().innerText()), await page.locator('.iv-badges').first().innerText());
  await page.getByRole('button', { name: 'Registra esito SDI' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Registra esito' }).click();
  await tst(page, 'Esito registrato');
  await sleep(300);
  S.check('rinvio + RC: Consegnata', /consegnata/i.test(await page.locator('.iv-badges').first().innerText()));
  const tl = await page.locator('main').innerText();
  S.check('cronologia contiene INVIO, NS, INVIO, RC (>= 4 eventi SDI)', (tl.match(/Inviata allo SDI|Segnata come inviata|Inviata/gi) || []).length >= 2, tl.slice(tl.indexOf('Cronologia'), tl.indexOf('Cronologia') + 600).replace(/\n+/g, ' | '));
  await S.shot(page, 'cronologia');

  // MC e poi NC possibile
  await go(page, '/documenti');
  await S.shot(page, 'elenco');
});
