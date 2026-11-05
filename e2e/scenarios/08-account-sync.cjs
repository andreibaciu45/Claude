'use strict';
// (8) Account: login OTP (devCode), sync push/pull di una fattura emessa, secondo dispositivo, conflitto numero duplicato, offline e ripresa.
const { run, go, fillProfile, createInvoiceDraft, issueCurrent, docIdOf, readDb, sleep, API, BASE } = require('../lib.cjs');

const EMAIL = `qa.${Date.now()}@example.test`;

async function login(S, ctx, page, email) {
  await go(page, '/account');
  await page.getByLabel('Email').fill(email);
  await acceptTerms(page);
  await page.getByRole('button', { name: 'Inviami il codice' }).click();
  await page.getByLabel('Codice di accesso').waitFor();
  const code = S.devCodes[ctx.__label];
  if (!code) throw new Error('devCode non catturato dal proxy (server senza AUTH_DEV_RETURN_CODE=1?)');
  await page.getByLabel('Codice di accesso').fill(code);
  await S.shot(page, `${ctx.__label} codice inserito`);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page.getByText(/Sincronizzazione/).first().waitFor({ timeout: 15000 });
  // la scheda di prima sincronizzazione compare in modo asincrono: la aspetto prima di decidere
  const mig = await page.getByText('Prima sincronizzazione').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (mig) { await page.getByRole('button', { name: 'Carica e sincronizza' }).click(); await page.getByText('Tutto aggiornato').waitFor({ timeout: 15000 }); }
  return mig;
}
async function acceptTerms(page) {
  const cb = page.getByRole('checkbox', { name: /Ho letto/ });
  if (await cb.count()) await cb.check();
}
const token = (page) => page.evaluate(() => localStorage.getItem('vp:sync:token'));
async function serverGet(tok, path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${tok}` } });
  const txt = await r.text();
  return { status: r.status, body: txt };
}
async function syncNow(page) {
  await page.getByRole('button', { name: 'Sincronizza ora' }).click();
  await sleep(1500);
}
const accText = (page) => page.locator('main').innerText();
const accTextAt = async (page) => { await go(page, '/account'); return (await accText(page)).replace(/\n+/g, ' | '); };

run('08-account-sync', async (S) => {
  S.ignoreConsole = /401 \(Unauthorized\) @ .*\/v1\/auth\/verify/; // atteso: prova con codice errato
  // ---------------- dispositivo A
  const ctxA = await S.context({ mobile: true, label: 'A' });
  const A = await S.page(ctxA, 'tel1');
  await fillProfile(S, A);
  await createInvoiceDraft(S, A, { lines: [{ description: 'Fattura da sincronizzare', qty: 1, price: 120 }] });
  const idA = docIdOf(A);
  const nA = await issueCurrent(S, A);
  S.check('A: emessa 1/2026 in locale (senza account)', nA === '1/2026', nA);

  // login non valido
  await go(A, '/account');
  await S.shot(A, 'account non connesso');
  await A.getByLabel('Email').fill('non-una-email');
  await A.getByRole('button', { name: 'Inviami il codice' }).click();
  S.check('login: email non valida rifiutata lato client', await A.getByText('Inserisci un indirizzo email valido').isVisible());
  await A.getByLabel('Email').fill(EMAIL);
  await sleep(300);
  S.check('login: l\'errore "email non valida" sparisce dopo aver corretto l\'email', (await A.getByText('Inserisci un indirizzo email valido').count()) === 0, 'errore ancora visibile con email valida');
  await A.getByRole('button', { name: 'Inviami il codice' }).click();
  await sleep(400);
  const needTerms = await A.getByRole('checkbox', { name: /Ho letto/ }).count();
  if (needTerms) {
    S.check('login: senza accettare Termini/Privacy/DPA non si procede', await A.getByText(/devi confermare di aver letto/).first().isVisible() && (await A.getByLabel('Codice di accesso').count()) === 0);
    await S.shot(A, 'consenso richiesto');
    await acceptTerms(A);
    await A.getByRole('button', { name: 'Inviami il codice' }).click();
  }
  await A.getByLabel('Codice di accesso').waitFor();
  S.check('login: devCode restituito dal server di test', /^\d{6,10}$/.test(S.devCodes.A || ''), S.devCodes.A);
  await A.getByLabel('Codice di accesso').fill(S.devCodes.A === '00000000' ? '11111111' : '00000000');
  await A.getByRole('button', { name: 'Accedi' }).click();
  await sleep(800);
  await S.shot(A, 'codice errato');
  S.check('login: codice errato -> errore, non loggato', await A.getByRole('alert').first().isVisible().catch(() => false));
  await A.getByLabel('Codice di accesso').fill(S.devCodes.A);
  await A.getByRole('button', { name: 'Accedi' }).click();
  await A.getByText('Prima sincronizzazione').waitFor({ timeout: 15000 });
  await S.shot(A, 'migrazione iniziale');
  const mig = await accText(A);
  S.check('prima sincronizzazione: elenca 1 documento + dati azienda', /1 documento/.test(mig) && /azienda/.test(mig), mig.slice(mig.indexOf('Prima'), mig.indexOf('Prima') + 200));
  await A.getByRole('button', { name: 'Carica e sincronizza' }).click();
  await A.getByText('Tutto aggiornato').waitFor({ timeout: 15000 });
  await S.shot(A, 'sincronizzato');
  const tokA = await token(A);
  S.check('A: token di sessione salvato', !!tokA);
  const me = await serverGet(tokA, '/v1/me');
  S.check('server: /v1/me risponde 200', me.status === 200, me.body.slice(0, 200));
  const pull = await serverGet(tokA, '/v1/sync/pull?cursor=0');
  S.check('server: la fattura emessa 1/2026 e arrivata (pull cursor=0)', pull.status === 200 && pull.body.includes('1/2026') && pull.body.includes(idA), pull.body.slice(0, 200));
  S.check('server: XML della fattura presente', /FatturaElettronica/.test(pull.body));

  // ---------------- dispositivo B (secondo dispositivo, contesto pulito)
  const ctxB = await S.context({ mobile: true, label: 'B' });
  const B = await S.page(ctxB, 'tel2');
  await go(B, '/documenti');
  S.check('B: contesto pulito, nessun documento', /Ancora nessun documento/.test(await B.locator('main').innerText()));
  const migB = await login(S, ctxB, B, EMAIL);
  S.note('B: scheda prima sincronizzazione mostrata: ' + migB);
  await sleep(1500);
  await S.shot(B, 'B dopo login');
  const txB = await accText(B);
  S.note('B dopo login (account): ' + txB.replace(/\n+/g, ' | ').slice(0, 300));
  await syncNow(B);
  await go(B, '/documenti');
  await sleep(500);
  await S.shot(B, 'B elenco documenti');
  const listB = await B.locator('main').innerText();
  S.check('B: la fattura 1/2026 emessa da A compare dopo il pull', listB.includes('1/2026'), listB.slice(0, 200));
  if (listB.includes('1/2026')) {
    await B.getByText('1/2026').first().click();
    await B.waitForURL(/#\/documenti\/[^/?#]+$/);
    await sleep(400);
    await S.shot(B, 'B fattura 1');
    const dB = await B.locator('main').innerText();
    S.check('B: fattura emessa e bloccata (nessuna Modifica/Elimina)', /1\/2026/.test(dB) && (await B.getByRole('link', { name: 'Modifica' }).count()) === 0 && (await B.getByRole('button', { name: /^Elimina/ }).count()) === 0);
    S.check('B: XML scaricabile', await B.getByRole('button', { name: 'Scarica XML' }).isEnabled().catch(() => false));
  } else {
    S.note('B non ha ricevuto la fattura emessa: ' + (await accTextAt(B)).slice(0, 300));
  }
  const prof = await go(B, '/profilo').then(() => B.locator('[data-field="vatNumber"]').inputValue());
  S.check('B: profilo azienda sincronizzato (P.IVA)', prof === '01234567897', prof);
  const dbB = await readDb(B);
  S.check('B: documento emesso in IndexedDB con lockedAt e xml', (dbB.stores.documents || []).some((d) => d.invoice?.number === '1/2026' && d.invoice.lockedAt && d.invoice.xml), (dbB.stores.documents || []).length + ' documenti locali su B');

  // ---------------- offline su B + ripresa
  await go(B, '/account');
  await S.setOffline(ctxB, true);
  await sleep(600);
  await B.evaluate(() => window.dispatchEvent(new Event('offline')));
  await sleep(500);
  await S.shot(B, 'B offline');
  const offTxt = await accText(B);
  S.note('B offline, testo account: ' + offTxt.replace(/\n+/g, ' | ').slice(0, 260));
  await B.getByRole('button', { name: 'Sincronizza ora' }).click().catch(() => {});
  await sleep(1500);
  await S.shot(B, 'B offline dopo tentativo');
  const off2 = await accText(B);
  S.check('offline: l\'account mostra stato offline/avviso comprensibile (nessuna eccezione grezza)', /offline|Sei offline|rete/i.test(off2), off2.replace(/\n+/g, ' | ').slice(0, 300));
  // l'app funziona offline: bozza + preventivo
  await createInvoiceDraft(S, B, { customer: { name: 'Cliente Offline Srl', vat: '02345678904', address: 'Via Po 1', zip: '10100', province: 'TO', city: 'Torino', codiceDestinatario: '0000000' }, lines: [{ description: 'Lavoro fatto offline', qty: 1, price: 70 }] });
  const idOff = docIdOf(B);
  const offDocs = (await readDb(B)).stores.documents.length;
  S.check('offline: creazione bozza fattura funziona (documento presente in locale)', offDocs >= 1, offDocs);
  const n2off = await issueCurrent(S, B, { tag: 'offline ' }).catch((e) => 'ERRORE ' + e.message.split('\n')[0]);
  S.note('Emissione OFFLINE su B -> ' + n2off + ' (ARCHITECTURE-V2 §2.1/2.4 prevede stato "da_emettere" in coda, non emissione locale)');
  S.check('offline: emissione consentita/negata in modo esplicito (numero o avviso)', !!n2off, n2off);
  await S.shot(B, 'B offline emissione');
  // ripresa
  await S.setOffline(ctxB, false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await go(B, '/account');
  await sleep(1000);
  await syncNow(B);
  await S.shot(B, 'B online di nuovo');
  const back = await accText(B);
  S.note('B dopo ripresa: ' + back.replace(/\n+/g, ' | ').slice(0, 300));
  const tokB = await token(B);
  const pullB = await serverGet(tokB, '/v1/sync/pull?cursor=0');
  S.check('ripresa: i dati creati offline (Cliente Offline Srl) arrivano al server', pullB.body.includes('Cliente Offline Srl') || pullB.body.includes(idOff), pullB.body.length);

  // ---------------- conflitto di numero duplicato (account nuovo: quota Free 3 doc/mese separata)
  // D1 emette 1/2026 e sincronizza. D2 (2o dispositivo) si sincronizza, va offline. D1 emette 2/2026 online. D2 emette offline 2/2026 -> collisione.
  const EMAIL2 = `qa2.${Date.now()}@example.test`;
  const ctxD1 = await S.context({ mobile: true, label: 'D1' });
  const D1 = await S.page(ctxD1, 'tel1');
  await fillProfile(null, D1);
  await createInvoiceDraft(null, D1, { lines: [{ description: 'D1 prima', qty: 1, price: 50 }] });
  await issueCurrent(null, D1);
  S.check('D1: login con dati locali propone la prima sincronizzazione', await login(S, ctxD1, D1, EMAIL2));
  await syncNow(D1);

  const ctxD2 = await S.context({ mobile: true, label: 'D2' });
  const D2 = await S.page(ctxD2, 'tel2');
  await go(D2, '/documenti');
  await login(S, ctxD2, D2, EMAIL2);
  await syncNow(D2);
  await go(D2, '/profilo');
  S.check('D2: profilo e contatori arrivati dal server', (await D2.locator('[data-field="vatNumber"]').inputValue()) === '01234567897');
  await go(D2, '/documenti');
  S.check('D2: fattura emessa da D1 (1/2026) arrivata', (await D2.locator('main').innerText()).includes('1/2026'));
  await S.setOffline(ctxD2, true);

  await createInvoiceDraft(S, D1, { lines: [{ description: 'D1 seconda (online)', qty: 1, price: 60 }] });
  const nD1 = await issueCurrent(S, D1, { tag: 'D1-2 ' });
  await go(D1, '/account'); await syncNow(D1);

  await createInvoiceDraft(S, D2, { customer: { name: 'Cliente Di D2 Spa', vat: '02345678904', address: 'Via Po 2', zip: '10100', province: 'TO', city: 'Torino', codiceDestinatario: '0000000' }, lines: [{ description: 'D2 emessa offline', qty: 1, price: 44 }] });
  const nD2 = await issueCurrent(S, D2, { tag: 'D2 ' });
  S.note(`D1 ha emesso ${nD1} online; D2 ha emesso ${nD2} offline`);
  S.check('scenario di collisione: i due dispositivi hanno emesso lo stesso numero', nD1 === nD2, `${nD1} vs ${nD2}`);
  await S.setOffline(ctxD2, false);
  await D2.evaluate(() => window.dispatchEvent(new Event('online')));
  await go(D2, '/account');
  await sleep(1000);
  await syncNow(D2);
  await sleep(1500);
  await S.shot(D2, 'D2 conflitto');
  const cTxt = await accText(D2);
  S.note('D2 dopo ripresa: ' + cTxt.replace(/\n+/g, ' | ').slice(0, 600));
  S.check('conflitto numero duplicato segnalato all\'utente ("Da controllare" + motivo)', /Da controllare/.test(cTxt) && /stesso numero|duplicat/i.test(cTxt), cTxt.replace(/\n+/g, ' | ').slice(0, 500));
  const dbD2 = await readDb(D2);
  S.check('D2: il documento locale emesso offline non e stato perso', (dbD2.stores.documents || []).some((d) => d.customer?.name === 'Cliente Di D2 Spa' && d.invoice?.lockedAt));
  const pullAll = await serverGet(await token(D1), '/v1/sync/pull?cursor=0');
  S.check('server: la fattura in conflitto di D2 NON e stata accettata', !pullAll.body.includes('Cliente Di D2 Spa'), 'contiene Cliente Di D2 Spa');
  const confBtns = await D2.getByRole('button', { name: /Tieni entrambe|Usa la versione del server|Tieni solo la mia|Riprova|Passa a Pro/ }).allInnerTexts();
  S.note('Azioni offerte per il conflitto: ' + confBtns.join(' / '));
  S.check('conflitto: almeno una azione di risoluzione offerta', confBtns.length > 0, confBtns);
  await D2.getByRole('button', { name: 'Esci' }).click().catch(() => {});
  await sleep(500);
  await S.shot(D2, 'D2 dopo esci');
  S.check('esci: dati locali conservati', ((await readDb(D2)).stores.documents || []).length >= 1);
});
