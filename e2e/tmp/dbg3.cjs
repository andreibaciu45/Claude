const { run, go, fillProfile, createInvoiceDraft, issueCurrent, hold, sleep } = require('../lib.cjs');
run('dbg3', async (S) => {
  const ctx = await S.context({ mobile: true }); const page = await S.page(ctx);
  await fillProfile(null, page);
  await createInvoiceDraft(null, page, { lines: [{ description: 'Posa', qty: 2, price: 100 }, { description: 'Rub', qty: 1, price: 80 }] });
  await issueCurrent(null, page);
  await page.getByRole('button', { name: 'Annulla con nota di credito' }).click();
  const d = page.getByRole('dialog', { name: 'Annulla con nota di credito' });
  await d.getByLabel(/Motivo dell/).fill('Reso parziale');
  await d.getByRole('radio', { name: 'Storno parziale' }).click();
  await d.getByRole('checkbox', { name: /Storna riga 1/ }).check();
  const b = d.locator('.hold-btn').first();
  console.log(await b.boundingBox(), await b.isDisabled());
  console.log(await page.evaluate(()=>{const bb=document.querySelector('.sheet .hold-btn').getBoundingClientRect();const e=document.elementFromPoint(bb.x+bb.width/2,bb.y+bb.height/2);const sh=document.querySelector('.sheet').getBoundingClientRect();return [e.className,e.tagName,JSON.stringify(sh)]}));await S.shot(page,'x');await hold(page, b);
  for (let i=0;i<10;i++){ console.log(await page.locator('.toast').allInnerTexts(), page.url()); await sleep(500); }
});
