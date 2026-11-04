'use strict';
/**
 * Libreria comune della suite E2E di VocePreventivo (QA).
 * - NON modifica il codice dell'app: guida solo la UI con Playwright.
 * - Dati fiscali SOLO fittizi con checksum valido (vedi FAKE).
 * - Il backend locale (porta 8798) e' raggiunto dalla PWA (porta 4180) tramite un proxy di test
 *   (context.route su '**\/v1/**'): in produzione lo fa il reverse proxy (Caddy), vite preview no.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4180';
const API = process.env.E2E_API || 'http://127.0.0.1:8798';
const OUT = path.join(ROOT, 'out');
const TMP = path.join(ROOT, 'tmp');

/** Dati fittizi con checksum validi. */
const FAKE = {
  sellerVat: '01234567897',
  sellerCf: 'BNCMRA80A01H501A',
  customerVat: '02345678904',
  seller: { businessName: 'Bianchi Mario Impianti', ownerName: 'Mario Bianchi', address: 'Via Roma 1', zip: '00100', province: 'RM', city: 'Roma', email: 'mario.bianchi@example.test', phone: '3331234567' },
  customer: { name: 'Rossi Costruzioni Srl', vat: '02345678904', address: 'Via Milano 10', zip: '20100', province: 'MI', city: 'Milano', codiceDestinatario: 'ABCDEF1' },
};

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

class Scenario {
  constructor(name) {
    this.name = name;
    this.dir = path.join(OUT, name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(TMP, { recursive: true });
    this.n = 0;
    this.checks = [];
    this.errors = [];
    this.notes = [];
    this.devCodes = {};
    this.lastPage = null;
    this.contexts = [];
  }

  log(...a) { console.log(`  [${this.name}]`, ...a); }
  note(t) { this.notes.push(t); this.log('nota:', t); }

  /** Registra un controllo. ok=false => il scenario e' FAIL (da classificare: bug app o errore script). */
  check(name, ok, detail) {
    const rec = { name, ok: !!ok, detail: detail === undefined ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) };
    this.checks.push(rec);
    console.log(`  ${rec.ok ? 'ok  ' : 'FAIL'} ${name}${rec.ok || !rec.detail ? '' : '  -> ' + rec.detail.slice(0, 300)}`);
    return rec.ok;
  }

  async shot(page, label) {
    this.lastPage = page;
    const file = path.join(this.dir, `${String(++this.n).padStart(2, '0')}-${slug(label)}.png`);
    try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { this.log('screenshot fallito', label, e.message); }
    return file;
  }

  /** Nuovo contesto browser (= dispositivo/profilo pulito). */
  async context(opts = {}) {
    const vp = opts.viewport || VIEWPORTS.phone;
    const ctx = await this.browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      isMobile: !!opts.mobile && vp.width < 700,
      hasTouch: !!opts.mobile && vp.width < 700,
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
      acceptDownloads: true,
      serviceWorkers: opts.serviceWorkers || 'block',
    });
    ctx.__label = opts.label || `ctx${this.contexts.length + 1}`;
    ctx.__apiDown = false;
    ctx.__offline = false;
    ctx.__api = [];
    await ctx.route('**/v1/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.origin === API || !u.pathname.startsWith('/v1/')) return route.continue();
      if (ctx.__apiDown) return route.abort('internetdisconnected');
      try {
        const headers = { ...req.headers() };
        for (const h of ['host', 'content-length', 'origin', 'referer', 'connection']) delete headers[h];
        const body = req.postDataBuffer();
        const r = await fetch(API + u.pathname + u.search, { method: req.method(), headers, body: body && req.method() !== 'GET' ? body : undefined });
        const buf = Buffer.from(await r.arrayBuffer());
        const rh = {};
        r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) rh[k] = v; });
        const entry = { method: req.method(), path: u.pathname, status: r.status };
        if (u.pathname.endsWith('/auth/request') && r.status === 200) {
          try { const j = JSON.parse(buf.toString('utf8')); if (j.devCode) this.devCodes[ctx.__label] = j.devCode; } catch { /* ignora */ }
        }
        ctx.__api.push(entry);
        await route.fulfill({ status: r.status, headers: rh, body: buf });
      } catch (e) {
        ctx.__api.push({ method: req.method(), path: u.pathname, status: 0, error: e.message });
        await route.abort('connectionrefused');
      }
    });
    this.contexts.push(ctx);
    return ctx;
  }

  /** Simula la perdita di rete di un dispositivo (browser + proxy API). */
  async setOffline(ctx, off) {
    ctx.__offline = off;
    ctx.__apiDown = off;
    await ctx.setOffline(off);
  }

  async page(ctx, label) {
    const page = await ctx.newPage();
    const tag = `${ctx.__label}${label ? '/' + label : ''}`;
    const push = (kind, text) => {
      if (this.ignoreConsole && this.ignoreConsole.test(text)) return;
      if (ctx.__offline && /Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR|NetworkError|Load failed/i.test(text)) return; // atteso in offline
      this.errors.push(`[${tag}] ${kind}: ${text}`);
    };
    page.on('console', (m) => { if (m.type() === 'error') push('console.error', m.text() + (m.location()?.url ? ` @ ${m.location().url}` : '')); });
    page.on('pageerror', (e) => push('pageerror', e.message));
    page.on('dialog', (d) => { this.log('dialog', d.type(), d.message().slice(0, 80)); d.accept().catch(() => {}); });
    this.lastPage = page;
    return page;
  }

  finish() {
    const failed = this.checks.filter((c) => !c.ok);
    const res = { name: this.name, status: failed.length ? 'FAIL' : 'PASS', checks: this.checks, consoleErrors: this.errors, notes: this.notes };
    fs.writeFileSync(path.join(this.dir, 'result.json'), JSON.stringify(res, null, 2));
    console.log(`${res.status} ${this.name} (${this.checks.length - failed.length}/${this.checks.length} controlli)`);
    return res;
  }
}

async function run(name, fn) {
  const S = new Scenario(name);
  console.log(`== ${name}`);
  S.browser = await chromium.launch();
  try {
    await fn(S);
  } catch (e) {
    S.check('ERRORE SCRIPT/eccezione non gestita: ' + String(e.message).split('\n')[0], false, (e.stack || '').split('\n').slice(0, 5).join(' | '));
    if (S.lastPage) { try { await S.shot(S.lastPage, 'eccezione'); } catch { /* ignora */ } }
  }
  S.check('nessun errore in console / pageerror', S.errors.length === 0, S.errors.slice(0, 5));
  await S.browser.close().catch(() => {});
  const r = S.finish();
  process.exit(r.status === 'PASS' ? 0 : 1);
}

/* ------------------------------------------------------------------ helper UI */

const url = (p) => `${BASE}/#${p}`;
async function go(page, p) {
  await page.goto(url(p));
  await page.waitForLoadState('domcontentloaded');
  await sleep(150);
  // la UI mostra uno Skeleton (aria-busy) mentre carica pagine lazy / dati: aspetto che sparisca
  await page.locator('.skeleton[aria-busy="true"], .qe-loading').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}
const docIdOf = (page) => (/#\/documenti\/([^/?#]+)/.exec(page.url()) || [])[1];

async function toast(page, text, timeout = 8000) {
  await page.locator('.toast', { hasText: text }).first().waitFor({ timeout });
}

/**
 * Il piano Free limita a 3 documenti NUOVI al mese (src/billing, limite morbido locale). Per creare piu documenti in uno scenario
 * si usa un orologio finto: ogni volta che compare la scheda "Limite del piano raggiunto" si passa al mese successivo
 * (restando nel 2026, cosi la numerazione annuale non riparte). Chiamare S.clock(page, 1) PRIMA della prima navigazione.
 */
async function useClock(page, month = 1) {
  page.__clkMonth = month;
  await page.clock.install({ time: new Date(Date.UTC(2026, month - 1, 10, 12, 0, 0)) });
}
async function bumpMonth(page) {
  if (!page.__clkMonth) throw new Error('Limite Free raggiunto (3 documenti/mese) e orologio finto non attivo: usare useClock() nello scenario');
  if (page.__clkMonth >= 11) throw new Error('orologio finto: mesi del 2026 esauriti');
  page.__clkMonth += 1;
  await page.clock.setSystemTime(new Date(Date.UTC(2026, page.__clkMonth - 1, 10, 12, 0, 0)));
}
async function gateVisible(page) {
  return page.getByRole('region', { name: 'Limite del piano raggiunto' }).waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
}

/** Pressione prolungata (HoldButton): mouse giu', attesa, su. */
async function hold(page, locator, ms = 1700) {
  // i toast (3,5 s) coprono la parte bassa della scheda e intercettano il puntatore (v. QA-REPORT): aspetto che spariscano
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('hold: pulsante senza bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
}

async function fillProfile(S, page, over = {}) {
  const p = { ...FAKE.seller, vat: FAKE.sellerVat, cf: FAKE.sellerCf, forfettario: true, ...over };
  await go(page, '/profilo');
  await page.getByLabel('Ragione sociale').fill(p.businessName);
  await page.getByLabel('Titolare').fill(p.ownerName);
  await page.locator('[data-field="vatNumber"]').fill(p.vat);
  await page.locator('[data-field="fiscalCode"]').fill(p.cf);
  await page.getByLabel('Indirizzo', { exact: true }).fill(p.address);
  await page.locator('[data-field="zip"]').fill(p.zip);
  await page.locator('[data-field="province"]').fill(p.province);
  await page.getByLabel('Comune').fill(p.city);
  await page.locator('[data-field="email"]').fill(p.email);
  await page.getByLabel('Telefono').fill(p.phone);
  await page.getByRole('checkbox', { name: /Regime forfettario/ }).setChecked(!!p.forfettario);
  if (S) await S.shot(page, 'profilo compilato');
  await page.getByRole('button', { name: 'Salva dati azienda' }).click();
  await toast(page, 'Dati azienda salvati');
  if (S) await S.shot(page, 'profilo salvato');
  return p;
}

async function addSampleCatalog(S, page, trade = 'Idraulico') {
  await go(page, '/catalogo');
  await page.getByRole('button', { name: 'Aggiungi voci di esempio' }).first().click();
  await page.getByRole('button', { name: trade, exact: true }).click();
  await toast(page, 'Aggiunte');
  if (S) await S.shot(page, 'catalogo esempio');
}

/**
 * Crea una bozza di fattura da UI. lines: [{description, qty, price}]. Ritorna l'id del documento.
 * customer: {name, vat, address, zip, province, city, codiceDestinatario}
 */
async function createInvoiceDraft(S, page, { customer = FAKE.customer, lines = [{ description: 'Lavori di manutenzione impianto', qty: 1, price: 150 }], shotLabel } = {}) {
  await go(page, '/');
  await Promise.race([
    page.getByRole('button', { name: 'Compila a mano' }).waitFor({ timeout: 6000 }).catch(() => {}),
    page.getByRole('region', { name: 'Limite del piano raggiunto' }).waitFor({ timeout: 6000 }).catch(() => {}),
  ]);
  if (await page.getByRole('region', { name: 'Limite del piano raggiunto' }).isVisible()) { await bumpMonth(page); await page.reload(); await sleep(300); }
  await page.getByRole('button', { name: 'Compila a mano' }).click();
  await page.getByRole('radio', { name: 'Fattura', exact: true }).click();
  await page.locator('#qe-customer').fill(customer.name);
  const f = (id) => page.locator(`[id="f-customer.${id}"]`);
  if (customer.vat) await f('vatNumber').fill(customer.vat);
  if (customer.fiscalCode) await f('fiscalCode').fill(customer.fiscalCode);
  if (customer.address) await f('address').fill(customer.address);
  if (customer.zip) await f('zip').fill(customer.zip);
  if (customer.province) await f('province').fill(customer.province);
  if (customer.city) await f('city').fill(customer.city);
  if (customer.codiceDestinatario) await f('codiceDestinatario').fill(customer.codiceDestinatario);
  for (let i = 0; i < lines.length; i++) {
    await page.getByRole('button', { name: '+ Riga libera' }).click();
    const n = i + 1;
    await page.getByLabel(`Descrizione riga ${n}`).fill(lines[i].description);
    await page.getByLabel(`Quantità riga ${n}`, { exact: true }).last().fill(String(lines[i].qty).replace('.', ','));
    await page.getByLabel(`Prezzo unitario riga ${n}`).fill(String(lines[i].price).replace('.', ','));
  }
  if (S) await S.shot(page, shotLabel || 'bozza fattura compilata');
  await page.getByRole('button', { name: 'Salva bozza fattura' }).click();
  await page.waitForURL(/#\/documenti\/[^/?#]+$/);
  await page.getByText('BOZZA', { exact: false }).first().waitFor();
  return docIdOf(page);
}

/** Dalla pagina di una bozza: Emetti -> spunta -> pressione prolungata. Ritorna il numero mostrato nel toast. */
async function issueCurrent(S, page, { tag = '' } = {}) {
  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  const sheet = page.getByRole('dialog', { name: 'Emetti fattura' });
  await sheet.waitFor();
  if (S) await S.shot(page, `${tag}scheda emissione`.trim());
  await sheet.getByRole('checkbox').check();
  await hold(page, sheet.locator('.hold-btn').first());
  const t = page.locator('.toast', { hasText: 'Fattura emessa' }).first();
  await t.waitFor({ timeout: 10000 });
  const msg = await t.innerText();
  if (S) await S.shot(page, `${tag}fattura emessa`.trim());
  return (/n\.\s*(\S+)/.exec(msg) || [])[1];
}

/** Legge l'IndexedDB 'vocepreventivo' del contesto pagina (sola lettura). */
async function readDb(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const out = { dbs: dbs.map((d) => d.name) };
    const name = dbs.map((d) => d.name).find((n) => /vocepreventivo|voce/i.test(n)) || dbs[0]?.name;
    if (!name) return out;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    out.name = name;
    out.stores = {};
    for (const s of Array.from(db.objectStoreNames)) {
      out.stores[s] = await new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    }
    db.close();
    return out;
  });
}

/** Salva un download in e2e/out/<scenario>/ e ritorna {path, name}. */
async function saveDownload(S, dl, name) {
  const file = path.join(S.dir, name || dl.suggestedFilename());
  await dl.saveAs(file);
  return { path: file, name: dl.suggestedFilename() };
}

module.exports = {
  BASE, API, OUT, TMP, FAKE, useClock, bumpMonth, gateVisible, VIEWPORTS, sleep, run, Scenario, go, url, docIdOf, toast, hold,
  fillProfile, addSampleCatalog, createInvoiceDraft, issueCurrent, readDb, saveDownload,
};
