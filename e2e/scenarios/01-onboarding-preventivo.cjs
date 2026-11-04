'use strict';
// (1) Onboarding profilo forfettario + catalogo esempio + dettatura testuale -> preventivo -> PDF scaricato e controllato.
const { execFileSync } = require('child_process');
const { run, go, fillProfile, addSampleCatalog, saveDownload, VIEWPORTS, sleep, FAKE } = require('../lib.cjs');

run('01-onboarding-preventivo', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);

  await go(page, '/');
  await S.shot(page, 'home primo avvio');
  S.check('home: campo testo e Interpreta presenti', await page.getByLabel('Testo del preventivo').isVisible() && await page.getByRole('button', { name: 'Interpreta' }).isVisible());
  S.check('home: avviso catalogo vuoto', await page.getByText('Il tuo catalogo è vuoto').first().isVisible());

  await fillProfile(S, page);
  await page.reload();
  await go(page, '/profilo');
  const vat = await page.locator('[data-field="vatNumber"]').inputValue();
  S.check('profilo persistito dopo ricarica (P.IVA)', vat === FAKE.sellerVat, vat);
  S.check('profilo: forfettario ancora spuntato', await page.getByRole('checkbox', { name: /Regime forfettario/ }).isChecked());

  // P.IVA non valida deve essere respinta
  await page.locator('[data-field="vatNumber"]').fill('01234567890');
  await page.getByRole('button', { name: 'Salva dati azienda' }).click();
  await S.shot(page, 'piva non valida');
  S.check('profilo: P.IVA con checksum errato rifiutata', await page.getByText('Partita IVA non valida').first().isVisible());
  await page.locator('[data-field="vatNumber"]').fill(FAKE.sellerVat);
  await page.getByRole('button', { name: 'Salva dati azienda' }).click();

  await addSampleCatalog(S, page, 'Idraulico');
  const nItems = await page.locator('ul[aria-label="Voci del listino"] li').count();
  S.check('catalogo: voci di esempio create (>=15)', nItems >= 15, nItems);

  // dettatura testuale
  await go(page, '/');
  const txt = 'preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera';
  await page.getByLabel('Testo del preventivo').fill(txt);
  await S.shot(page, 'testo dettato');
  await page.getByRole('button', { name: 'Interpreta' }).click();
  await page.getByRole('heading', { name: /Righe \(/ }).waitFor();
  await S.shot(page, 'righe interpretate');
  const nLines = await page.locator('article.qe-line').count();
  S.check('interpretazione: 2 righe', nLines === 2, nLines);
  const cust = await page.locator('#qe-customer').inputValue();
  S.check('interpretazione: cliente "Mario Rossi"', /mario rossi/i.test(cust), cust);
  const body = await page.locator('main').innerText();
  S.check('totale preventivo 104,50 € (3 m x 9,50 + 2 h x 38)', /104,50/.test(body), body.match(/TOTALE[^\n]*\n?[^\n]*/)?.[0]);
  S.check('forfettario: nessuna riga IVA nel riepilogo', !/IVA 22%/.test(body) || /senza IVA/.test(body));

  await page.getByRole('button', { name: 'Genera preventivo' }).click();
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  await page.getByText('Anteprima', { exact: false }).first().waitFor().catch(() => {});
  await S.shot(page, 'preventivo generato');
  const view = await page.locator('main').innerText();
  S.check('preventivo: numero assegnato (non bozza senza numero)', /n\.\s*\S*\d/.test(view), view.slice(0, 120));

  // PDF
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica PDF/ }).click()]);
  const f = await saveDownload(S, dl, 'preventivo.pdf');
  S.check('PDF scaricato con estensione .pdf', /\.pdf$/i.test(f.name), f.name);
  let text = '';
  try { text = execFileSync('pdftotext', ['-layout', f.path, '-'], { encoding: 'utf8' }); } catch (e) { S.note('pdftotext non disponibile: ' + e.message); }
  if (text) {
    S.check('PDF: contiene "PREVENTIVO"', /PREVENTIVO/i.test(text));
    S.check('PDF: contiene cliente', /Mario Rossi/.test(text));
    S.check('PDF: contiene ragione sociale', text.includes(FAKE.seller.businessName));
    S.check('PDF: contiene P.IVA venditore', text.includes(FAKE.sellerVat));
    S.check('PDF: contiene descrizioni righe', /Tubo rame/i.test(text) && /Manodopera/i.test(text));
    S.check('PDF: contiene totale 104,50', /104,50/.test(text), text.match(/TOTALE.*/)?.[0]);
    S.check('PDF: dicitura regime forfettario', /forfettari/i.test(text));
    S.check('PDF: nessuna IVA 22% esposta', !/IVA 22/.test(text));
  }
  const bytes = require('fs').readFileSync(f.path);
  S.check('PDF: header %PDF valido', bytes.subarray(0, 5).toString() === '%PDF-');

  // elenco documenti
  await go(page, '/documenti');
  await S.shot(page, 'elenco documenti');
  S.check('documenti: preventivo in elenco', await page.getByText('Mario Rossi').first().isVisible());

  // altri viewport
  for (const [nm, vp] of [['tablet', VIEWPORTS.tablet], ['desktop', VIEWPORTS.desktop]]) {
    await page.setViewportSize(vp);
    await go(page, '/documenti');
    await S.shot(page, `documenti ${nm}`);
    await page.getByText('Mario Rossi').first().click();
    await page.waitForURL(/#\/documenti\/[^/?#]+$/);
    await sleep(300);
    await S.shot(page, `preventivo ${nm}`);
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    S.check(`nessuno scroll orizzontale (${nm})`, ow <= 0, ow);
    await go(page, '/');
    await S.shot(page, `home ${nm}`);
  }
});
