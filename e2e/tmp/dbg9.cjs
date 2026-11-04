const { run, go, fillProfile, createInvoiceDraft, sleep } = require('../lib.cjs');
run('dbg9', async (S) => {
  const ctx = await S.context({ mobile: true }); const page = await S.page(ctx);
  await fillProfile(null, page);
  await createInvoiceDraft(null, page, { lines: [{ description: 'x', qty: 1, price: 80 }] });
  const m = () => page.evaluate(() => { const vw=document.documentElement.clientWidth; const out=[]; for (const e of document.querySelectorAll('body *')) { const r=e.getBoundingClientRect(); if (r.right>vw+1) out.push(e.tagName+'.'+(e.className||'').toString().slice(0,30)+' r='+Math.round(r.right)+' pos='+getComputedStyle(e).position); if(out.length>8)break;} return {sw:document.documentElement.scrollWidth, vw, bsw: document.body.scrollWidth, inner: innerWidth, out}; });
  console.log('draft page', JSON.stringify(await m()));
  await page.locator('.vc-fab').click(); await page.getByLabel('Scrivi un comando').fill('emetti la fattura'); await page.getByLabel('Scrivi un comando').press('Enter'); await sleep(900);
  console.log('sw>vw', JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body, body *')].filter(e=>e.scrollWidth>391).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,40)+' sw='+e.scrollWidth+' cw='+e.clientWidth).slice(0,10)))); console.log('inner', JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('.dv-paper *')].filter(e=>e.scrollWidth>e.clientWidth+2||e.getBoundingClientRect().right>380).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,30)+' sw='+e.scrollWidth+' cw='+e.clientWidth+' r='+Math.round(e.getBoundingClientRect().right)+' txt='+(e.textContent||'').slice(0,30)).slice(0,10)))); console.log('html css', await page.evaluate(()=>[getComputedStyle(document.documentElement).overflowX,getComputedStyle(document.body).overflowX])); console.log('voice card', JSON.stringify(await m()));
  await page.screenshot({path:'e2e/tmp/vc.png', fullPage:false});
});
