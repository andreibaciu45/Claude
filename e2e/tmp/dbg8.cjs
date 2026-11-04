const { run, go, fillProfile, createInvoiceDraft, issueCurrent, readDb, sleep, API } = require('../lib.cjs');
const E = `qa3.${Date.now()}@example.test`;
async function login(S, ctx, page, email) {
  await go(page, '/account');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Inviami il codice' }).click();
  await page.getByLabel('Codice a 6 cifre').waitFor();
  await page.getByLabel('Codice a 6 cifre').fill(S.devCodes[ctx.__label]);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await page.getByText(/Sincronizzazione/).first().waitFor({ timeout: 15000 });
}
run('dbg8', async (S) => {
  const c1 = await S.context({ mobile: true, label: 'D1' }); const D1 = await S.page(c1);
  await fillProfile(null, D1);
  await createInvoiceDraft(null, D1, { lines: [{ description: 'x', qty: 1, price: 50 }] });
  await issueCurrent(null, D1);
  await login(S, c1, D1, E);
  console.log('D1 txt', (await D1.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,200));
  if (await D1.getByText('Prima sincronizzazione').count()) await D1.getByRole('button', { name: 'Carica e sincronizza' }).click();
  await sleep(3000);
  const tok = await D1.evaluate(() => localStorage.getItem('vp:sync:token'));
  const r = await (await fetch(API + '/v1/sync/pull?cursor=0', { headers: { Authorization: 'Bearer ' + tok } })).text();
  console.log('server has profile?', /01234567897/.test(r), r.slice(0, 300));
  const c2 = await S.context({ mobile: true, label: 'D2' }); const D2 = await S.page(c2);
  await go(D2, '/documenti'); await login(S, c2, D2, E);
  await sleep(2000);
  console.log('D2 txt', (await D2.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,300));
  const db = await readDb(D2); console.log(JSON.stringify(db.stores.profile||db.stores).slice(0,300));
});
