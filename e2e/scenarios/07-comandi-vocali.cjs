'use strict';
// (7) Comandi vocali testuali dal widget ("Scrivi un comando"): nessuna azione irreversibile senza conferma esplicita.
const { run, go, fillProfile, addSampleCatalog, createInvoiceDraft, docIdOf, hold, sleep, readDb } = require('../lib.cjs');

const statusOf = async (page, id) => {
  const db = await readDb(page);
  const d = (db.stores.documents || []).find((x) => x.id === id);
  return d ? { status: d.status, number: d.invoice?.number || d.number, locked: !!d.invoice?.lockedAt } : null;
};

run('07-comandi-vocali', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);
  await addSampleCatalog(S, page, 'Idraulico');

  const say = async (text, { label } = {}) => {
    const input = page.getByLabel('Scrivi un comando').or(page.getByLabel('Scrivi la frase di conferma')).first();
    if (!(await input.isVisible().catch(() => false))) {
      if (!(await page.locator('.vc-fab').isVisible())) await go(page, '/documenti'); // il FAB e nascosto in alcune schermate (es. dettatura)
      await page.locator('.vc-fab').click();
      await input.waitFor();
    }
    await input.fill(text);
    await input.press('Enter');
    await sleep(900);
    await S.shot(page, label || `voce ${text}`);
  };
  const sheetText = async () => (await page.getByRole('dialog').innerText().catch(() => '')).replace(/\n+/g, ' | ');
  const closeSheet = async () => { if (await page.getByRole('dialog').count()) { await page.getByRole('dialog').locator('button.icon-btn[aria-label="Chiudi"]').click(); await sleep(300); } };

  // --- FAB: dimensione e apertura
  await go(page, '/documenti');
  const fab = await page.locator('.vc-fab').boundingBox();
  S.check('FAB voce: target >= 44px', fab.width >= 44 && fab.height >= 44, fab);
  await page.locator('.vc-fab').click();
  await page.getByRole('dialog').waitFor();
  await S.shot(page, 'widget aperto');
  S.check('widget: campo "Scrivi un comando" presente', await page.getByLabel('Scrivi un comando').isVisible());
  S.note('Testo del widget aperto (headless): ' + (await sheetText()).slice(0, 260));
  await closeSheet();

  // --- 1) nuova fattura per Rossi due ore di manodopera
  await go(page, '/documenti');
  await say('nuova fattura per Rossi due ore di manodopera', { label: 'nuova fattura per Rossi' });
  await sleep(600);
  const url1 = page.url();
  const body1 = await page.locator('main').innerText();
  S.note(`Dopo "nuova fattura per Rossi...": url=${url1.replace(/^.*#/, '#')} ; main="${body1.slice(0, 200).replace(/\n+/g, ' | ')}"`);
  const docsAfter = (await readDb(page)).stores.documents || [];
  S.check('"nuova fattura per Rossi ...": crea una bozza di fattura (cliente Rossi, righe manodopera)', docsAfter.length === 1 && docsAfter[0].type === 'fattura' && docsAfter[0].status === 'bozza' && /rossi/i.test(docsAfter[0].customer.name) && docsAfter[0].lines.length >= 1, JSON.stringify(docsAfter.map((d) => ({ t: d.type, s: d.status, c: d.customer.name, l: d.lines.map((x) => `${x.qty} ${x.unit} ${x.description}`) }))));
  S.check('"nuova fattura": nessun numero assegnato', docsAfter.every((d) => !d.invoice?.number));
  S.check('"nuova fattura": ha aperto/proposto la bozza (undo o navigazione)', /documenti\/|edit=/.test(url1) || (await page.locator('.vc-undo').count()) > 0);
  const undoBtn = page.locator('.vc-undo').getByRole('button', { name: 'Annulla' });
  if (await undoBtn.count()) { await undoBtn.click(); await sleep(500); const n = ((await readDb(page)).stores.documents || []).length; S.check('"Annulla" dal toast rimuove la bozza creata a voce', n === 0, n); }

  // --- 2) emetti senza bozza corrente
  await go(page, '/documenti');
  await say('emetti la fattura', { label: 'emetti senza bozze' });
  S.check('"emetti la fattura" senza fatture da emettere: messaggio, nessuna emissione', !(await page.getByRole('button', { name: /Tieni premuto/ }).count()) || /non|nessun/i.test(await sheetText()), await sheetText());
  await closeSheet();

  // --- 3) bozza valida D1
  const d1 = await createInvoiceDraft(S, page, { lines: [{ description: 'Manodopera idraulico', qty: 2, price: 40 }] });
  await say('emetti la fattura', { label: 'emetti D1 scheda conferma' });
  const t1 = await sheetText();
  S.check('"emetti la fattura": mostra scheda di conferma con pressione prolungata', (await page.locator('.vc-hold').count()) === 1, t1.slice(0, 300));
  S.check('"emetti la fattura" senza conferma NON emette', (await statusOf(page, d1))?.status === 'bozza');
  // un semplice si' non basta
  await say('sì', { label: 'si non basta' });
  S.check('"sì" nella scheda NON emette', (await statusOf(page, d1))?.status === 'bozza', await sheetText());
  await say('ok', { label: 'ok non basta' });
  S.check('"ok" nella scheda NON emette', (await statusOf(page, d1))?.status === 'bozza');
  await say('conferma', { label: 'conferma generico' });
  S.check('"conferma" generico NON emette', (await statusOf(page, d1))?.status === 'bozza', await sheetText());
  // pressione breve
  const hb = page.locator('.vc-hold');
  await hb.click(); await sleep(300);
  S.check('tocco breve sul pulsante hold della scheda NON emette', (await statusOf(page, d1))?.status === 'bozza');
  await hold(page, hb, 500); await sleep(300);
  S.check('pressione 0,5 s NON emette', (await statusOf(page, d1))?.status === 'bozza');
  // chiusura scheda -> nessuna emissione
  await closeSheet();
  S.check('chiudere la scheda NON emette', (await statusOf(page, d1))?.status === 'bozza');
  // ora con pressione prolungata
  await say('emetti la fattura', { label: 'emetti D1 di nuovo' });
  await hold(page, page.locator('.vc-hold'), 1600);
  await sleep(1200);
  await S.shot(page, 'D1 emessa a voce');
  const s1 = await statusOf(page, d1);
  S.check('"emetti la fattura" + pressione prolungata: emessa 1/2026', s1?.locked && s1.number === '1/2026', JSON.stringify(s1));

  // --- 4) frase esplicita "conferma emissione"
  const d2 = await createInvoiceDraft(S, page, { lines: [{ description: 'Seconda voce', qty: 1, price: 60 }] });
  await say('emetti la fattura', { label: 'emetti D2 scheda' });
  await say('conferma emissione', { label: 'frase conferma emissione' });
  await sleep(1200);
  const s2 = await statusOf(page, d2);
  S.check('frase esplicita "conferma emissione" (scheda visibile) emette 2/2026', s2?.locked && s2.number === '2/2026', JSON.stringify(s2));

  // --- 5) storno a voce
  await go(page, '/documenti');
  await say('annulla la fattura 1 con nota di credito', { label: 'storno fattura 1 scheda' });
  const tn = await sheetText();
  S.check('"annulla la fattura 1 con nota di credito": scheda di conferma esplicita', (await page.locator('.vc-hold').count()) === 1, tn.slice(0, 300));
  S.check('storno senza conferma NON emette la NC', ((await readDb(page)).stores.documents || []).filter((d) => d.invoice?.tipoDocumento === 'TD04').length === 0);
  await say('sì', { label: 'storno si non basta' });
  S.check('"sì" NON conferma lo storno', ((await readDb(page)).stores.documents || []).filter((d) => d.invoice?.tipoDocumento === 'TD04').length === 0);
  await say('conferma emissione', { label: 'storno frase sbagliata' });
  S.check('frase "conferma emissione" NON conferma uno storno (frase diversa)', ((await readDb(page)).stores.documents || []).filter((d) => d.invoice?.tipoDocumento === 'TD04').length === 0, await sheetText());
  await closeSheet();
  await say('annulla la fattura 1 con nota di credito', { label: 'storno fattura 1 di nuovo' });
  await hold(page, page.locator('.vc-hold'), 1600);
  await sleep(1500);
  await S.shot(page, 'storno eseguito');
  const all = (await readDb(page)).stores.documents || [];
  const nc = all.filter((d) => d.invoice?.tipoDocumento === 'TD04');
  S.check('storno a voce con pressione prolungata: NC1/2026 creata', nc.length === 1 && nc[0].invoice.number === 'NC1/2026', JSON.stringify(nc.map((d) => d.invoice.number)));
  S.check('fattura 1 ora "stornata"', all.find((d) => d.id === d1)?.status === 'stornata');
  S.check('la fattura 2 e rimasta intatta', all.find((d) => d.id === d2)?.status === 'emessa');

  // --- 6) comandi distruttivi su documenti emessi
  await go(page, `/documenti/${d2}`);
  await say('elimina la fattura', { label: 'elimina fattura emessa' });
  S.check('"elimina la fattura" su fattura emessa: non la cancella', !!(await statusOf(page, d2)), await sheetText());
  await closeSheet();
  await say('elimina la bozza', { label: 'elimina bozza su emessa' });
  S.check('"elimina la bozza" sulla pagina di una emessa: non la cancella', !!(await statusOf(page, d2)), await sheetText());
  await closeSheet();
  await say('annulla la fattura 99 con nota di credito', { label: 'storno 99 inesistente' });
  S.check('storno di fattura inesistente: errore, nessuna scheda di emissione', (await page.locator('.vc-hold').count()) === 0, await sheetText());
  await closeSheet();
  await say('emetti metti la fattura', { label: 'frase ambigua' });
  S.check('frase ambigua "emetti metti la fattura": nessuna emissione immediata', ((await readDb(page)).stores.documents || []).length === 3);
  await closeSheet();
});
