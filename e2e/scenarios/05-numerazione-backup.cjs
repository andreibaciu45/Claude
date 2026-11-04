'use strict';
// (5) Numerazione senza buchi, ricarica, backup/ripristino: i contatori non tornano indietro.
const fs = require('fs');
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, sleep, readDb, saveDownload, BASE } = require('../lib.cjs');

run('05-numerazione-backup', async (S) => {
  const ctx = await S.context({ mobile: true });
  let page = await S.page(ctx);
  await fillProfile(S, page);

  const nums = [];
  for (let i = 1; i <= 3; i++) {
    await createInvoiceDraft(S, page, { lines: [{ description: `Lavoro ${i}`, qty: 1, price: 10 * i + 5 }], shotLabel: `bozza ${i}` });
    nums.push(await issueCurrent(S, page, { tag: `f${i} ` }));
  }
  S.check('tre emissioni di seguito = 1/2026, 2/2026, 3/2026', nums.join(',') === '1/2026,2/2026,3/2026', nums.join(','));

  // bozza cancellata non consuma numeri
  await createInvoiceDraft(S, page, { lines: [{ description: 'Da cancellare', qty: 1, price: 9 }] });
  await page.getByRole('button', { name: 'Elimina bozza' }).click();
  await page.getByRole('button', { name: 'Sì, elimina' }).click();
  await page.waitForURL(/#\/documenti$/);
  await createInvoiceDraft(S, page, { lines: [{ description: 'Dopo cancellazione', qty: 1, price: 33 }] });
  const n4 = await issueCurrent(S, page, { tag: 'f4 ' });
  S.check('dopo cancellazione di una bozza il successivo e 4/2026 (nessun buco)', n4 === '4/2026', n4);

  // anteprima numero e campo profilo
  await createInvoiceDraft(S, page, { lines: [{ description: 'Anteprima', qty: 1, price: 12 }] });
  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  const prevTxt = await page.getByRole('dialog').innerText();
  S.check('scheda emissione: "Numero previsto" 5/2026', /Numero previsto\s*5\/2026/.test(prevTxt.replace(/\n+/g, ' ')), prevTxt.replace(/\n+/g, ' ').slice(0, 300));
  await page.keyboard.press('Escape');
  await go(page, '/profilo');
  const nextField = await page.getByLabel('Prossimo n. fattura').inputValue();
  S.note(`Profilo -> "Prossimo n. fattura" dopo 4 emissioni = ${nextField}`);
  S.check('profilo: "Prossimo n. fattura" coerente col contatore reale (5)', nextField === '5', nextField);

  // ricarica pagina: i contatori persistono
  await page.reload();
  await go(page, '/documenti');
  const list = await page.locator('main').innerText();
  S.check('dopo ricarica: i 4 numeri emessi sono in elenco', ['1/2026', '2/2026', '3/2026', '4/2026'].every((x) => list.includes(x)));

  // backup A (dopo 4 emissioni)
  await go(page, '/backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Scarica backup/ }).click()]);
  const bk = await saveDownload(S, dl, 'backup-A.json');
  await S.shot(page, 'backup scaricato');
  const json = JSON.parse(fs.readFileSync(bk.path, 'utf8'));
  S.check('backup: JSON valido con profile/documents', !!json.profile && Array.isArray(json.documents), Object.keys(json));
  S.check('backup: contiene i contatori annuali (FT-2026 = 4)', json.profile?.invoiceYearCounters?.['FT-2026'] === 4, JSON.stringify(json.profile?.invoiceYearCounters));
  S.check('backup: fatture emesse con XML incluse', json.documents.filter((d) => d.invoice?.xml).length === 4);

  // quinta fattura emessa DOPO il backup A
  await go(page, '/documenti');
  await page.getByRole('link', { name: 'Apri ed emetti' }).first().click();
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  const n5 = await issueCurrent(S, page, { tag: 'f5 ' });
  S.check('quinta = 5/2026', n5 === '5/2026', n5);

  // importa il backup vecchio nello stesso browser: il contatore NON deve tornare a 4
  await go(page, '/backup');
  await page.locator('input[aria-label="File di backup"]').setInputFiles(bk.path);
  await S.shot(page, 'conferma ripristino');
  await page.getByRole('button', { name: 'Sì, sostituisci i dati' }).click();
  await page.locator('.toast', { hasText: 'Dati ripristinati' }).first().waitFor();
  await S.shot(page, 'ripristinato (backup vecchio)');
  const warn = await page.locator('main').innerText();
  S.note('Avvisi dopo import backup vecchio: ' + (/Attenzione dopo il ripristino[\s\S]*/.exec(warn)?.[0] || 'nessuno').replace(/\n+/g, ' ').slice(0, 300));
  await go(page, '/documenti');
  const list2 = await page.locator('main').innerText();
  S.check('import backup vecchio: la 5/2026 emessa dopo il backup non e piu in elenco (dati sostituiti)', !list2.includes('5/2026'));
  await createInvoiceDraft(S, page, { lines: [{ description: 'Dopo import vecchio', qty: 1, price: 20 }] });
  const n6 = await issueCurrent(S, page, { tag: 'f6 ' });
  S.check('contatore non regredisce: dopo import del backup A il successivo e 6/2026 (non 5/2026 duplicato)', n6 === '6/2026', n6);

  // svuota IndexedDB (browser "nuovo") e ripristina da backup A
  await page.close();
  const tmp = await ctx.newPage();
  await tmp.goto(BASE + '/manifest.webmanifest');
  const wiped = await tmp.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    try { localStorage.clear(); } catch { /* ignora */ }
    return dbs.map((d) => d.name);
  });
  S.log('IndexedDB eliminati: ' + wiped.join(','));
  await tmp.close();
  page = await S.page(ctx, 'dopo-wipe');
  await go(page, '/documenti');
  await S.shot(page, 'dopo svuotamento');
  S.check('dopo svuotamento: nessun documento', /Ancora nessun documento/.test(await page.locator('main').innerText()));
  await go(page, '/backup');
  await page.locator('input[aria-label="File di backup"]').setInputFiles(bk.path);
  await page.getByRole('button', { name: 'Sì, sostituisci i dati' }).click();
  await page.locator('.toast', { hasText: 'Dati ripristinati' }).first().waitFor();
  await go(page, '/documenti');
  await S.shot(page, 'ripristinato dopo svuotamento');
  const list3 = await page.locator('main').innerText();
  S.check('ripristino da zero: 4 fatture tornano in elenco', ['1/2026', '2/2026', '3/2026', '4/2026'].every((x) => list3.includes(x)));
  const db = await readDb(page);
  const first = (db.stores.documents || []).find((d) => d.invoice?.number === '1/2026');
  S.check('ripristino: la fattura 1/2026 e ancora bloccata e ha l\'XML', !!first?.invoice?.lockedAt && !!first?.invoice?.xml);
  await createInvoiceDraft(S, page, { lines: [{ description: 'Dopo wipe', qty: 1, price: 20 }] });
  const n = await issueCurrent(S, page, { tag: 'f-wipe ' });
  S.check('dopo wipe+ripristino il successivo e 5/2026', n === '5/2026', n);

  // il campo "Prossimo n. fattura" del profilo influenza davvero la numerazione?
  await go(page, '/profilo');
  await page.getByLabel('Prossimo n. fattura').fill('50');
  await page.getByRole('button', { name: 'Salva dati azienda' }).click();
  await page.locator('.toast', { hasText: 'Dati azienda salvati' }).first().waitFor();
  await createInvoiceDraft(S, page, { lines: [{ description: 'Dopo prossimo 50', qty: 1, price: 20 }] });
  const n50 = await issueCurrent(S, page, { tag: 'f-50 ' });
  S.check('profilo "Prossimo n. fattura" = 50: la fattura successiva prende il 50 (campo effettivo)', n50 === '50/2026', `ottenuto ${n50}`);

  // backup corrotto
  await go(page, '/backup');
  fs.writeFileSync(require('path').join(S.dir, 'corrotto.json'), '{"nope":true');
  await page.locator('input[aria-label="File di backup"]').setInputFiles(require('path').join(S.dir, 'corrotto.json'));
  await sleep(400);
  await S.shot(page, 'backup corrotto');
  S.check('backup corrotto: errore chiaro e nessun ripristino', await page.getByRole('alert').first().isVisible().catch(() => false));
});
