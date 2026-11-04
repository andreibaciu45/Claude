'use strict';
// (3) Nota di credito totale/parziale: stornata, NC1/2026, XML TD04 + DatiFattureCollegate; parziale oltre residuo rifiutata.
const fs = require('fs');
const { spawnSync } = require('child_process');
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, saveDownload, docIdOf, hold, sleep } = require('../lib.cjs');

async function openCredit(page) {
  await page.getByRole('button', { name: 'Annulla con nota di credito' }).click();
  const d = page.getByRole('dialog', { name: 'Annulla con nota di credito' });
  await d.waitFor();
  return d;
}
async function anyToast(page, re, t = 8000) {
  await page.locator('.toast', { hasText: re }).first().waitFor({ timeout: t });
  return page.locator('.toast', { hasText: re }).first().innerText();
}

run('03-nota-di-credito', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);

  // ---- storno totale
  await createInvoiceDraft(S, page, { lines: [{ description: 'Impianto idraulico bagno', qty: 1, price: 300 }] });
  const origId = docIdOf(page);
  const n1 = await issueCurrent(S, page);
  S.check('fattura 1/2026', n1 === '1/2026', n1);

  let d = await openCredit(page);
  await S.shot(page, 'sheet nota di credito');
  const holdBtn = d.locator('.hold-btn').first();
  S.check('NC: senza motivo il pulsante e disabilitato', await holdBtn.isDisabled());
  await d.getByLabel(/Motivo dell/).fill('Importo errato');
  await sleep(200);
  S.check('NC: con motivo il pulsante e abilitato', await holdBtn.isEnabled());
  await holdBtn.click(); await sleep(300);
  S.check('NC: un tocco non emette', await d.isVisible());
  await hold(page, holdBtn);
  const msg = await anyToast(page, 'Nota di credito emessa');
  S.check('NC numero NC1/2026', /NC1\/2026/.test(msg), msg);
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  const ncId = docIdOf(page);
  S.check('navigato alla NC (id diverso)', ncId && ncId !== origId);
  await sleep(300);
  await S.shot(page, 'nota di credito emessa');
  const ncText = await page.locator('main').innerText();
  S.check('NC: etichetta "Nota di credito" e link alla fattura originale', /Nota di credito/i.test(ncText) && /Rettifica la fattura n\. 1\/2026/.test(ncText), ncText.slice(0, 300));
  S.check('NC: nessun pulsante "Registra incasso" / "Annulla con nota"', (await page.getByRole('button', { name: /Registra incasso|Annulla con nota/ }).count()) === 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
  const f = await saveDownload(S, dl, 'NC-totale.xml');
  const xml = fs.readFileSync(f.path, 'utf8');
  S.check('NC XML well-formed', spawnSync('xmllint', ['--noout', f.path]).status === 0);
  S.check('NC XML: TD04', /<TipoDocumento>TD04<\/TipoDocumento>/.test(xml));
  S.check('NC XML: Numero NC1/2026', /<Numero>NC1\/2026<\/Numero>/.test(xml), /<Numero>[^<]*/.exec(xml)?.[0]);
  S.check('NC XML: DatiFattureCollegate -> 1/2026', /<DatiFattureCollegate>[\s\S]*<IdDocumento>1\/2026<\/IdDocumento>/.test(xml));
  S.check('NC XML: causale con motivo', /Importo errato/.test(xml));
  S.check('NC XML: RF19 e N2.2', /RF19/.test(xml) && /N2\.2/.test(xml));
  S.check('NC XML: importo 300.00 positivo', /<ImportoTotaleDocumento>30[02]\.00</.test(xml), /<ImportoTotaleDocumento>[^<]*/.exec(xml)?.[0]);
  S.check('NC XML: nome file IT01234567897_xxxxx.xml con progressivo 00002', /^IT01234567897_00002\.xml$/.test(f.name), f.name);

  // originale stornata
  await go(page, `/documenti/${origId}`);
  await sleep(300);
  await S.shot(page, 'originale stornata');
  const orig = await page.locator('main').innerText();
  S.check('originale: stato "Stornata"', /stornata/i.test(await page.locator('.iv-badges').first().innerText()), await page.locator('.iv-badges').first().innerText());
  S.check('originale: link "Stornata dalla nota di credito n. NC1/2026"', /Stornata dalla nota di credito n\. NC1\/2026/.test(orig));
  S.check('originale stornata: nessun secondo storno / incasso / modifica', (await page.getByRole('button', { name: /Annulla con nota|Registra incasso|Elimina/ }).count()) === 0 && (await page.getByRole('link', { name: 'Modifica' }).count()) === 0);

  // ---- storno parziale
  await createInvoiceDraft(S, page, { lines: [{ description: 'Posa piastrelle', qty: 2, price: 100 }, { description: 'Fornitura rubinetti', qty: 1, price: 80 }], shotLabel: 'bozza 2 righe' });
  const inv2 = docIdOf(page);
  const n2 = await issueCurrent(S, page, { tag: 'f2 ' });
  S.check('seconda fattura 2/2026 (la NC non consuma FT)', n2 === '2/2026', n2);

  // parziale riga 1 (2 x 100 = 200)
  d = await openCredit(page);
  await d.getByLabel(/Motivo dell/).fill('Reso parziale');
  await d.getByRole('radio', { name: 'Storno parziale' }).click();
  await d.getByRole('checkbox', { name: /Storna riga 1/ }).check();
  await S.shot(page, 'parziale riga 1');
  await hold(page, d.locator('.hold-btn').first());
  const m2 = await anyToast(page, 'Nota di credito emessa');
  S.check('NC parziale numero NC2/2026', /NC2\/2026/.test(m2), m2);
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  await sleep(300);
  const [dlp] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
  const fp = await saveDownload(S, dlp, 'NC-parziale.xml');
  const xp = fs.readFileSync(fp.path, 'utf8');
  S.check('NC parziale XML: TD04 + DatiFattureCollegate 2/2026', /TD04/.test(xp) && /<IdDocumento>2\/2026<\/IdDocumento>/.test(xp));
  S.check('NC parziale XML: una sola riga di 200.00', (xp.match(/<DettaglioLinee>/g) || []).length === 1 && /<PrezzoTotale>200\.00</.test(xp));

  await go(page, `/documenti/${inv2}`);
  await sleep(300);
  S.check('originale 2 resta "Emessa" (storno solo parziale)', !/stornata/i.test(await page.locator('.iv-badges').first().innerText()), await page.locator('.iv-badges').first().innerText());

  // di nuovo la stessa riga -> oltre il residuo: rifiutata
  d = await openCredit(page);
  await d.getByLabel(/Motivo dell/).fill('Doppio storno');
  await d.getByRole('radio', { name: 'Storno parziale' }).click();
  await d.getByRole('checkbox', { name: /Storna riga 1/ }).check();
  await hold(page, d.locator('.hold-btn').first());
  const err = await anyToast(page, /non riuscita|supera/i).catch(() => '');
  await S.shot(page, 'parziale oltre residuo');
  S.check('NC parziale oltre il residuo rifiutata (messaggio d\'errore)', /supera|non riuscita/i.test(err), err);
  S.check('nessuna NC3 creata: ancora sulla fattura', /#\/documenti\/[^/?#]+$/.test(page.url()) && docIdOf(page) === inv2);
  await page.keyboard.press('Escape');

  // storno totale dopo uno parziale: deve essere rifiutato
  d = await openCredit(page).catch(() => null);
  if (d) {
    await d.getByLabel(/Motivo dell/).fill('Storno totale dopo parziale');
    await hold(page, d.locator('.hold-btn').first());
    const e2 = await anyToast(page, /non riuscita|già|parzial/i).catch(() => '');
    await S.shot(page, 'totale dopo parziale');
    S.check('storno TOTALE dopo uno parziale rifiutato', /non riuscita|parzial|già/i.test(e2), e2);
    await page.keyboard.press('Escape');
  }

  // completa con riga 2 -> stornata
  d = await openCredit(page);
  await d.getByLabel(/Motivo dell/).fill('Reso restante');
  await d.getByRole('radio', { name: 'Storno parziale' }).click();
  await d.getByRole('checkbox', { name: /Storna riga 2/ }).check();
  await hold(page, d.locator('.hold-btn').first());
  const m3 = await anyToast(page, 'Nota di credito emessa');
  S.check('terza NC = NC3/2026', /NC3\/2026/.test(m3), m3);
  await go(page, `/documenti/${inv2}`);
  await sleep(300);
  S.check('originale 2 diventa "Stornata" a storno completo', /stornata/i.test(await page.locator('.iv-badges').first().innerText()), await page.locator('.iv-badges').first().innerText());
  await S.shot(page, 'originale 2 stornata');

  // elenco
  await go(page, '/documenti');
  await S.shot(page, 'elenco con NC');
  const list = await page.locator('main').innerText();
  S.check('elenco: mostra NC1/2026, NC2/2026, NC3/2026', ['NC1/2026', 'NC2/2026', 'NC3/2026'].every((x) => list.includes(x)));
});
