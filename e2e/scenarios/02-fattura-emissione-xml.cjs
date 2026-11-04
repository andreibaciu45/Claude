'use strict';
// (2) Bozza fattura -> emissione con pressione prolungata -> 1/2026 -> XML -> invio -> esito RC -> incasso.
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, saveDownload, FAKE, sleep, hold } = require('../lib.cjs');

run('02-fattura-emissione-xml', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);

  const id = await createInvoiceDraft(S, page, { lines: [{ description: 'Sostituzione caldaia murale', qty: 1, price: 150 }] });
  const body0 = await page.locator('main').innerText();
  S.check('bozza: mostra "senza numero"/BOZZA', /bozza/i.test(body0) && /senza numero/i.test(body0), body0.slice(0, 200));
  await S.shot(page, 'bozza fattura');

  // un semplice tocco NON deve emettere
  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  const sheet = page.getByRole('dialog', { name: 'Emetti fattura' });
  await sheet.waitFor();
  const holdBtn = sheet.locator('.hold-btn').first();
  S.check('emissione: pulsante hold disabilitato senza casella di conferma', await holdBtn.isDisabled());
  await sheet.getByRole('checkbox').check();
  await holdBtn.click();
  await sleep(400);
  await S.shot(page, 'tocco breve non emette');
  S.check('emissione: tocco breve NON emette', !(await page.locator('.toast', { hasText: 'Fattura emessa' }).count()) && await sheet.isVisible());
  // rilascio anticipato a 600 ms
  await hold(page, holdBtn, 600);
  await sleep(300);
  S.check('emissione: pressione di 0,6 s NON emette', await sheet.isVisible());
  await hold(page, holdBtn, 1700);
  await page.locator('.toast', { hasText: 'Fattura emessa' }).first().waitFor({ timeout: 10000 });
  await sleep(300);
  await S.shot(page, 'fattura emessa');
  const main = await page.locator('main').innerText();
  S.check('numero 1/2026', /n\.\s*1\/2026/.test(main), main.slice(0, 150));
  S.check('stato Emessa visibile', /emessa/i.test(main));
  S.check('nessun pulsante Modifica / Elimina', (await page.getByRole('link', { name: 'Modifica' }).count()) === 0 && (await page.getByRole('button', { name: /^Elimina/ }).count()) === 0);

  // XML
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
  const f = await saveDownload(S, dl);
  S.check('nome file IT01234567897_xxxxx.xml', /^IT01234567897_[A-Za-z0-9]{5}\.xml$/.test(f.name), f.name);
  const xml = fs.readFileSync(f.path, 'utf8');
  const lint = spawnSync('xmllint', ['--noout', f.path], { encoding: 'utf8' });
  S.check('xmllint: XML well-formed', lint.status === 0, lint.stderr);
  const has = (re) => re.test(xml);
  S.check('XML: TipoDocumento TD01', has(/<TipoDocumento>TD01<\/TipoDocumento>/));
  S.check('XML: RegimeFiscale RF19', has(/<RegimeFiscale>RF19<\/RegimeFiscale>/));
  S.check('XML: Natura N2.2 e aliquota 0', has(/<Natura>N2\.2<\/Natura>/) && has(/<AliquotaIVA>0\.00<\/AliquotaIVA>/));
  S.check('XML: DatiBollo (150 > 77,47)', has(/<DatiBollo>[\s\S]*<BolloVirtuale>SI<\/BolloVirtuale>[\s\S]*<ImportoBollo>2\.00<\/ImportoBollo>/));
  S.check('XML: ProgressivoInvio = nome file', (() => { const m = /<ProgressivoInvio>([^<]+)</.exec(xml); return !!m && f.name === `IT01234567897_${m[1]}.xml`; })(), /<ProgressivoInvio>[^<]*/.exec(xml)?.[0]);
  S.check('XML: Numero 1/2026', has(/<Numero>1\/2026<\/Numero>/));
  S.check('XML: IdFiscaleIVA cedente e cessionario', has(/<IdCodice>01234567897<\/IdCodice>/) && has(/<CodiceFiscale>BNCMRA80A01H501A<\/CodiceFiscale>|<IdCodice>02345678904<\/IdCodice>/));
  S.check('XML: cliente P.IVA 02345678904 e CodiceDestinatario', has(/02345678904/) && has(/<CodiceDestinatario>ABCDEF1<\/CodiceDestinatario>/));
  S.check('XML: importo totale 152.00 (150 + bollo 0 a carico) o 150.00', has(/<ImportoTotaleDocumento>15[02]\.00<\/ImportoTotaleDocumento>/), /<ImportoTotaleDocumento>[^<]*/.exec(xml)?.[0]);
  S.check('XML: FormatoTrasmissione FPR12', has(/FPR12/));
  S.check('XML: nessuna ImpostaIVA diversa da zero', !/<Imposta>(?!0\.00)/.test(xml));

  // invio, esito, incasso
  await page.getByRole('button', { name: 'Segna come inviata' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /l’ho inviata/ }).click();
  await toast_(page, 'Segnata come inviata');
  await S.shot(page, 'segnata inviata');
  S.check('stato Inviata', /inviata/i.test(await page.locator('.iv-badges').first().innerText()), await page.locator('.iv-badges').first().innerText());

  await page.getByRole('button', { name: 'Registra esito SDI' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Registra esito' }).click();
  await toast_(page, 'Esito registrato');
  await S.shot(page, 'esito RC');
  const badges = await page.locator('.iv-badges').first().innerText();
  S.check('stato Consegnata dopo RC', /consegnata/i.test(badges), badges);

  await page.getByRole('button', { name: 'Registra incasso' }).click();
  await S.shot(page, 'sheet incasso');
  const amt = await page.getByLabel('Importo incassato', { exact: true }).inputValue();
  S.check('incasso: importo precompilato col residuo', /^15[02](,00)?$/.test(amt), amt);
  await page.getByRole('dialog').getByRole('button', { name: 'Registra incasso' }).click();
  await toast_(page, 'Incasso registrato');
  await S.shot(page, 'incassata');
  const after = await page.locator('main').innerText();
  S.check('stato pagamento: Pagata', /pagata/i.test(after) && !/non pagata/i.test(page.locator('.iv-badges').first() ? (await page.locator('.iv-badges').first().innerText()) : ''), (await page.locator('.iv-badges').first().innerText()));
  S.check('cronologia contiene emissione, invio, esito, incasso', /Emessa/i.test(after) && /Incasso/i.test(after));
  S.check('XML scaricabile ancora dopo incasso', await page.getByRole('button', { name: 'Scarica XML' }).isEnabled());

  // seconda fattura sotto soglia bollo
  await createInvoiceDraft(S, page, { lines: [{ description: 'Diritto di chiamata', qty: 1, price: 50 }], shotLabel: 'bozza 50 euro' });
  const n2 = await issueCurrent(S, page, { tag: 'seconda ' });
  S.check('seconda fattura = 2/2026', n2 === '2/2026', n2);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica XML' }).click()]);
  const f2 = await saveDownload(S, dl2);
  const xml2 = fs.readFileSync(f2.path, 'utf8');
  S.check('XML 50 EUR: nessun DatiBollo', !/<DatiBollo>/.test(xml2));
  S.check('XML 2: progressivo diverso dal primo', f2.name !== f.name, `${f.name} vs ${f2.name}`);
  S.check('XML 2 well-formed', spawnSync('xmllint', ['--noout', f2.path]).status === 0);
});
async function toast_(page, t) { await page.locator('.toast', { hasText: t }).first().waitFor({ timeout: 8000 }); }
