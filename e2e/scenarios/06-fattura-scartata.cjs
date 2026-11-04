'use strict';
// (6) Fattura scartata dallo SDI (NS): stato, avvisi, azioni disponibili, rinvio.
const fs = require('fs');
const { run, go, saveDownload, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, sleep } = require('../lib.cjs');
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

  // XML originale (scartato) -> poi correzione con lo stesso numero/data
  const [dl0] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
  const x0 = fs.readFileSync((await saveDownload(S, dl0, 'xml-scartato.xml')).path, 'utf8');

  const hasCorrect = await page.getByRole('button', { name: 'Correggi e rinvia' }).count();
  S.check('NS entro 5 giorni: pulsante "Correggi e rinvia" (stesso numero/data)', hasCorrect === 1);
  if (hasCorrect) {
    await page.getByRole('button', { name: 'Correggi e rinvia' }).click();
    const d = page.getByRole('dialog', { name: 'Correggi e rinvia' });
    await d.waitFor();
    await S.shot(page, 'correggi e rinvia');
    await d.locator('[id="f-customer.address"]').fill('Via Torino 99');
    await d.getByRole('button', { name: 'Rigenera il file XML' }).click();
    await tst(page, 'File XML rigenerato');
    await sleep(400);
    await S.shot(page, 'xml rigenerato');
    const st = await page.locator('.iv-badges').first().innerText();
    S.note('Stato dopo "Rigenera il file XML": ' + st.replace(/\n/g, ' '));
    const [dl1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
    const f1 = await saveDownload(S, dl1, 'xml-corretto.xml');
    const x1 = fs.readFileSync(f1.path, 'utf8');
    const g = (x, t) => (new RegExp(`<${t}>([^<]*)<`).exec(x) || [])[1];
    S.check('XML corretto: stesso Numero e stessa Data', g(x0, 'Numero') === g(x1, 'Numero') && g(x0, 'Data') === g(x1, 'Data'), `${g(x0, 'Numero')}/${g(x0, 'Data')} -> ${g(x1, 'Numero')}/${g(x1, 'Data')}`);
    S.check('XML corretto: nuovo ProgressivoInvio e nuovo nome file', g(x0, 'ProgressivoInvio') !== g(x1, 'ProgressivoInvio') && f1.name !== 'IT01234567897_00001.xml', `${g(x0, 'ProgressivoInvio')} -> ${g(x1, 'ProgressivoInvio')} (${f1.name})`);
    S.check('XML corretto: contiene il nuovo indirizzo', /Via Torino 99/.test(x1));
    await page.getByRole('button', { name: 'Segna come inviata' }).or(page.getByRole('button', { name: 'Segna come rinviata' })).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /l’ho inviata/ }).click();
    await tst(page, 'Segnata come inviata');
    await page.getByRole('button', { name: 'Registra esito SDI' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Registra esito' }).click();
    await tst(page, 'Esito registrato');
    await sleep(300);
    S.check('correzione + rinvio + RC: Consegnata, numero invariato 1/2026', /consegnata/i.test(await page.locator('.iv-badges').first().innerText()) && /1\/2026/.test(await page.locator('main').innerText()));
    await S.shot(page, 'rinviata e consegnata');
    const hist = await page.locator('.iv-history').count();
    S.note('Storico file scartati (.iv-history) presente: ' + hist);
  }

  // seconda fattura scartata: "Rifai con un nuovo numero"
  await createInvoiceDraft(S, page, { lines: [{ description: 'Seconda da rifare', qty: 1, price: 90 }] });
  const id2 = docIdOf(page);
  const n2 = await issueCurrent(S, page, { tag: 'f2 ' });
  S.check('seconda fattura 2/2026', n2 === '2/2026', n2);
  await page.getByRole('button', { name: 'Segna come inviata' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /l’ho inviata/ }).click();
  await tst(page, 'Segnata come inviata');
  await page.getByRole('button', { name: 'Registra esito SDI' }).click();
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('NS');
  await page.getByRole('dialog').getByRole('button', { name: 'Registra esito' }).click();
  await tst(page, 'Esito registrato');
  await sleep(300);
  await page.getByRole('button', { name: /Rifai con un nuovo numero|Rifai come nuova fattura/ }).click();
  await S.shot(page, 'rifai con nuovo numero');
  await page.getByRole('button', { name: 'Crea la bozza collegata' }).click();
  await tst(page, 'Creata la nuova bozza collegata');
  await page.waitForFunction((x) => !location.hash.endsWith(x), id2);
  await sleep(400);
  await S.shot(page, 'bozza collegata');
  const t = await page.locator('main').innerText();
  S.check('bozza collegata: senza numero', /senza numero/i.test(t));
  S.check('bozza collegata: mostra il collegamento alla fattura scartata 2/2026', /2\/2026/.test(t) && /scartata/i.test(t), t.slice(0, 160).replace(/\n+/g, ' | '));
  const n3 = await issueCurrent(S, page, { tag: 'f3 ' });
  S.check('nuova fattura dopo scarto = 3/2026', n3 === '3/2026', n3);
  await go(page, `/documenti/${id2}`);
  await sleep(300);
  const t2 = await page.locator('main').innerText();
  S.check('la scartata mostra il link "Rifatta come nuova fattura n. 3/2026"', /Rifatta come nuova fattura n\. 3\/2026/.test(t2), t2.slice(0, 300));
  S.check('la scartata rifatta non offre piu "Correggi e rinvia" doppio / nuovo rifacimento', (await page.getByRole('button', { name: /Rifai con un nuovo numero|Rifai come nuova/ }).count()) === 0);
  await go(page, '/documenti');
  await S.shot(page, 'elenco');
});
