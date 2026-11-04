'use strict';
// (4) Immutabilita: fattura emessa senza modifica/eliminazione (anche via /?edit=ID); bozza cancellabile.
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, sleep, readDb } = require('../lib.cjs');

run('04-immutabilita', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(S, page);

  // bozza: modificabile ed eliminabile
  const draftId = await createInvoiceDraft(S, page, { lines: [{ description: 'Bozza da cancellare', qty: 1, price: 40 }] });
  S.check('bozza: link Modifica presente', await page.getByRole('link', { name: 'Modifica' }).isVisible());
  S.check('bozza: pulsante "Elimina bozza" presente', await page.getByRole('button', { name: 'Elimina bozza' }).isVisible());
  await go(page, `/?edit=${draftId}`);
  await page.getByText('Modifica bozza di fattura').waitFor();
  await S.shot(page, 'modifica bozza');
  await page.getByLabel('Descrizione riga 1').fill('Bozza modificata');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await page.locator('.toast', { hasText: 'Modifiche salvate' }).first().waitFor();
  await sleep(300);
  S.check('bozza: modifica salvata', (await page.locator('main').innerText()).includes('Bozza modificata'));
  await page.getByRole('button', { name: 'Elimina bozza' }).click();
  await S.shot(page, 'conferma elimina bozza');
  await page.getByRole('button', { name: 'Sì, elimina' }).click();
  await page.waitForURL(/#\/documenti$/);
  await sleep(300);
  await S.shot(page, 'bozza eliminata');
  S.check('bozza eliminata: sparita dall\'elenco', !(await page.locator('main').innerText()).includes('Rossi Costruzioni'));
  await go(page, `/documenti/${draftId}`);
  S.check('bozza eliminata: URL diretto "non trovato"', await page.getByText('Documento non trovato').isVisible());

  // fattura emessa
  const id = await createInvoiceDraft(S, page, { lines: [{ description: 'Lavoro da non toccare', qty: 1, price: 120 }] });
  const n = await issueCurrent(S, page);
  S.check('emessa 1/2026 (la bozza cancellata non ha consumato il numero)', n === '1/2026', n);
  await sleep(300);
  S.check('emessa: nessun link/pulsante Modifica', (await page.getByRole('link', { name: /Modifica/ }).count()) === 0 && (await page.getByRole('button', { name: /Modifica/ }).count()) === 0);
  S.check('emessa: nessun pulsante Elimina', (await page.getByRole('button', { name: /Elimina|Cancella/ }).count()) === 0);
  S.check('emessa: nessun pulsante "Salva modifiche"', (await page.getByRole('button', { name: /Salva modifiche/ }).count()) === 0);
  S.check('emessa: testo "non si può modificare né eliminare"', /non si può modificare né eliminare/.test(await page.locator('main').innerText()));
  const html = await page.content();
  S.check('emessa: nessun link /?edit= nella pagina', !/#\/\?edit=/.test(html));

  // rotta di modifica forzata
  for (const q of [`/?edit=${id}`, `/?edit=${id}&focus=customer.name`, `/?edit=${id}&focus=lines%5B0%5D`]) {
    await go(page, q);
    await sleep(500);
    await S.shot(page, 'edit forzato ' + q.slice(0, 30));
    const t = await page.locator('main').innerText();
    S.check(`rotta ${q}: blocco "non modificabile"`, /non modificabile/i.test(t), t.slice(0, 150));
    S.check(`rotta ${q}: nessun campo di modifica/salvataggio`, (await page.getByRole('button', { name: /Salva modifiche|Salva bozza/ }).count()) === 0 && (await page.locator('#qe-customer').count()) === 0);
  }
  // un id inesistente
  await go(page, '/?edit=non-esiste');
  await sleep(400);
  { const t = await page.locator('main').innerText(); await S.shot(page, 'edit id inesistente'); S.check('edit con id inesistente (navigazione interna): messaggio non trovato', /non trovato/i.test(t), t.slice(0, 200));
    await page.reload(); await sleep(500);
    const t2 = await page.locator('main').innerText();
    S.check('edit con id inesistente (dopo ricarica): messaggio non trovato', /non trovato/i.test(t2), t2.slice(0, 200)); }

  // duplicazione = nuova bozza, l'originale resta
  await go(page, `/documenti/${id}`);
  await page.getByRole('button', { name: 'Duplica come bozza' }).click();
  await page.waitForURL((u) => !u.href.endsWith(id));
  await sleep(400);
  await S.shot(page, 'duplicata come bozza');
  const t2 = await page.locator('main').innerText();
  S.check('duplicato: e una bozza senza numero', /senza numero/i.test(t2), t2.slice(0, 120));

  // DB: la fattura emessa e' ancora li e bloccata
  const db = await readDb(page);
  const doc = (db.stores?.documents || []).find((d) => d.id === id);
  S.check('IndexedDB: fattura emessa presente con lockedAt', !!doc?.invoice?.lockedAt, db.name + ' stores=' + Object.keys(db.stores || {}).join(','));
  S.check('IndexedDB: bozza cancellata assente', !(db.stores?.documents || []).some((d) => d.id === draftId));
  // lista documenti: nessun "Elimina" per fattura emessa
  await go(page, '/documenti');
  await S.shot(page, 'elenco');
  S.check('elenco: nessun pulsante elimina diretto', (await page.getByRole('button', { name: /Elimina/ }).count()) === 0);
});
