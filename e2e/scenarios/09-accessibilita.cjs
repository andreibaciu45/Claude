'use strict';
// (9) Accessibilita di base: scroll orizzontale, target touch >= 44px, focus visibile, nomi accessibili; nessun errore in console.
const { run, go, fillProfile, addSampleCatalog, createInvoiceDraft, issueCurrent, docIdOf, VIEWPORTS, sleep } = require('../lib.cjs');

const AUDIT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}[${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28)}]`;
  const vw = document.documentElement.clientWidth;
  const overflowPx = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw; // body e html hanno overflow-x:hidden: misuro anche body.scrollWidth
  const offenders = [];
  if (overflowPx > 0) {
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const ox = getComputedStyle(el).overflowX;
      if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') offenders.push(`${desc(el)} right=${Math.round(r.right)}`);
      else if (el.scrollWidth > el.clientWidth + 2 && ox === 'visible' && el.children.length) offenders.push(`${desc(el)} scrollWidth=${el.scrollWidth}>client=${el.clientWidth} (pseudo-elemento/contenuto in overflow)`);
      if (offenders.length >= 6) break;
    }
  }
  const small = [];
  const nameless = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=radio], [role=button]')) {
    if (!vis(el)) continue;
    let target = el;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) target = el.closest('label') || el;
    const r = target.getBoundingClientRect();
    const isLink = el.tagName === 'A' && !el.classList.contains('btn') && !el.classList.contains('nav-link') && !el.classList.contains('dl-link') && !el.classList.contains('brand');
    const inline = isLink && !!el.closest('p, li, footer, small, span, .iv-links, .iv-issue');
    if ((r.width < 43.5 || r.height < 43.5) && !inline) small.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.labels && el.labels.length ? 'label' : '') || el.textContent || '').trim();
    if (!name && el.tagName !== 'INPUT') nameless.push(desc(el));
    if (el.tagName === 'INPUT' && !name && !el.getAttribute('placeholder')) nameless.push(desc(el));
  }
  const smallLinks = [];
  for (const el of document.querySelectorAll('a[href]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.height < 43.5) && el.closest('footer, p, li, .iv-links')) smallLinks.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const h1 = document.querySelectorAll('h1').length;
  return { overflowPx, offenders, small, nameless, smallLinks, h1, title: document.title, lang: document.documentElement.lang, imgNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length };
};

async function focusAudit(page, max = 14) {
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  const bad = [];
  let seen = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
      const shadow = cs.boxShadow && cs.boxShadow !== 'none';
      const border = false;
      const label = `${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 24)}]`;
      return { ok: outline || !!shadow || border, label, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: (cs.boxShadow || '').slice(0, 30) };
    });
    if (!r) continue;
    seen++;
    if (!r.ok) bad.push(`${r.label} outline=${r.outline} shadow=${r.shadow}`);
  }
  return { seen, bad };
}

run('09-accessibilita', async (S) => {
  const ctx = await S.context({ mobile: true });
  const page = await S.page(ctx);
  await fillProfile(null, page);
  await addSampleCatalog(null, page, 'Idraulico');
  const draftId = await createInvoiceDraft(null, page, { lines: [{ description: 'Bozza per audit', qty: 1, price: 120 }] });
  await page.getByRole('button', { name: 'Elimina bozza' }).waitFor();
  // fattura emessa
  await createInvoiceDraft(null, page, { lines: [{ description: 'Emessa per audit', qty: 1, price: 120 }] });
  const issuedId = docIdOf(page);
  await issueCurrent(null, page);
  await sleep(500);
  // quote
  await go(page, '/');
  await page.getByLabel('Testo del preventivo').fill('preventivo per Mario Rossi, due ore di manodopera');
  await page.getByRole('button', { name: 'Interpreta' }).click();
  await page.getByRole('heading', { name: /Righe \(/ }).waitFor();
  await page.getByRole('button', { name: 'Genera preventivo' }).click();
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  const quoteId = docIdOf(page);

  const routes = [
    ['home', '/'], ['documenti', '/documenti'], ['bozza fattura', `/documenti/${draftId}`], ['fattura emessa', `/documenti/${issuedId}`],
    ['preventivo', `/documenti/${quoteId}`], ['catalogo', '/catalogo'], ['profilo', '/profilo'], ['backup', '/backup'], ['account', '/account'], ['info landing', '/info'],
    ['modifica bozza', `/?edit=${draftId}`],
  ];
  const agg = { overflow: [], small: [], nameless: [], focus: [], meta: [] };
  const perVp = [['phone 390x844', VIEWPORTS.phone], ['tablet 768x1024', VIEWPORTS.tablet], ['desktop 1280x800', VIEWPORTS.desktop]];
  for (const [vpName, vp] of perVp) {
    await page.setViewportSize(vp);
    for (const [name, r] of routes) {
      await go(page, r);
      await sleep(450);
      const a = await page.evaluate(AUDIT);
      if (vpName.startsWith('phone')) await S.shot(page, `${name}`);
      if (a.overflowPx > 0) agg.overflow.push(`${vpName} ${name}: +${a.overflowPx}px ${a.offenders.join('; ')}`);
      if (vp.width < 700) {
        if (a.small.length) agg.small.push(`${name}: ${a.small.join('; ')}`);
        if (a.smallLinks.length) S.note(`link piccoli (<44px, solo nota) in ${name}: ${a.smallLinks.slice(0, 4).join('; ')}`);
      }
      if (a.nameless.length) agg.nameless.push(`${vpName} ${name}: ${a.nameless.join('; ')}`);
      if (vpName.startsWith('phone')) {
        if (a.h1 === 0 && name !== 'info landing') S.note(`nessun <h1> in ${name}`);
        if (a.lang !== 'it') agg.meta.push(`lang=${a.lang}`);
        if (!a.title) agg.meta.push(`titolo vuoto in ${name}`);
        if (a.imgNoAlt) agg.meta.push(`${a.imgNoAlt} img senza alt in ${name}`);
        const f = await focusAudit(page);
        if (f.seen < 3) S.note(`focus: solo ${f.seen} elementi raggiunti con Tab in ${name}`);
        if (f.bad.length) agg.focus.push(`${name}: ${f.bad.join('; ')}`);
      }
    }
  }
  S.check('nessuno scroll orizzontale (tutte le pagine, 3 viewport)', agg.overflow.length === 0, agg.overflow);
  S.check('target touch >= 44x44 px su pulsanti/campi (390px, tutte le pagine)', agg.small.length === 0, agg.small);
  S.check('tutti i controlli hanno un nome accessibile', agg.nameless.length === 0, agg.nameless);
  S.check('focus da tastiera visibile su tutti gli elementi provati', agg.focus.length === 0, agg.focus);
  S.check('lang="it", titolo, alt immagini', agg.meta.length === 0, agg.meta);

  // stati con sheet aperti (390)
  await page.setViewportSize(VIEWPORTS.phone);
  const sheets = [];
  const probe = async (label) => {
    await sleep(350);
    const a = await page.evaluate(AUDIT);
    await S.shot(page, label);
    if (a.overflowPx > 0) sheets.push(`${label}: overflow +${a.overflowPx} ${a.offenders.join('; ')}`);
    const small = a.small.filter((x) => true);
    if (small.length) sheets.push(`${label}: target piccoli ${small.join('; ')}`);
    return a;
  };
  await go(page, `/documenti/${draftId}`);
  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  await probe('sheet emissione');
  const dlg = page.getByRole('dialog');
  S.check('sheet: ha role=dialog, aria-modal e titolo', (await dlg.getAttribute('aria-modal')) === 'true' && !!(await dlg.getAttribute('aria-labelledby')));
  const f1 = await focusAudit(page, 8);
  S.check('sheet emissione: focus visibile', f1.bad.length === 0, f1.bad);
  await page.keyboard.press('Escape');
  await sleep(250);
  S.check('sheet: Escape lo chiude', (await page.getByRole('dialog').count()) === 0);
  await go(page, `/documenti/${issuedId}`);
  await page.getByRole('button', { name: 'Annulla con nota di credito' }).click();
  await probe('sheet nota credito');
  await page.getByRole('radio', { name: 'Storno parziale' }).click();
  await probe('sheet nota credito parziale');
  await page.keyboard.press('Escape');
  await go(page, '/documenti');
  await page.locator('.vc-fab').click();
  await probe('widget voce');
  await page.getByLabel('Scrivi un comando').fill('emetti la fattura');
  await page.getByLabel('Scrivi un comando').press('Enter');
  await sleep(700);
  await probe('widget voce conferma o messaggio');
  await page.keyboard.press('Escape');
  S.check('sheet/widget (emissione, NC, voce): nessun overflow e nessun target <44px', sheets.length === 0, sheets);

  // HoldButton da tastiera: Spazio tenuto premuto
  await go(page, `/documenti/${draftId}`);
  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  const d2 = page.getByRole('dialog');
  await d2.getByRole('checkbox').check();
  const hb = d2.locator('.hold-btn').first();
  await hb.focus();
  await page.keyboard.down('Space');
  await sleep(300);
  S.check('HoldButton: tenendo Spazio compare avanzamento (non conferma subito)', (await page.locator('.toast', { hasText: 'Fattura emessa' }).count()) === 0);
  await page.keyboard.up('Space');
  await sleep(300);
  S.check('HoldButton: rilascio anticipato da tastiera non emette', (await page.locator('.toast', { hasText: 'Fattura emessa' }).count()) === 0);
  const alt = d2.getByText('Non riesco a tenere premuto');
  S.check('HoldButton: alternativa accessibile (parola CONFERMO) presente', await alt.isVisible());
  await page.keyboard.press('Escape');

  // prefers-reduced-motion / dark: solo screenshot di controllo del contrasto
  await page.emulateMedia({ colorScheme: 'dark' });
  await go(page, `/documenti/${issuedId}`);
  await sleep(400);
  await S.shot(page, 'fattura emessa dark');
  await page.emulateMedia({ colorScheme: 'light' });
});
