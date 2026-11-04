import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, clearLocalData, exportBackup, getStorageSummary, importAuditEntries, importBackup, listCatalog, listDocuments, parseBackup, verifyStorageIntegrity,
} from './index';
import { DB_NAME, getBackend, migrateDocumentV1 } from './db';
import { sha256Hex } from './invoices';
import { searchCustomers } from './customerModel';
import type { AuditEntry, CatalogItem, QuoteDocument } from '../types';
import { draftData, lineData } from './testkit';

/**
 * Volumi reali: 5.000 documenti e 2.000 voci di catalogo. I limiti sono larghi (macchine lente, CI): servono a
 * intercettare regressioni di ordine di grandezza (es. O(n^2)), non a misurare. I tempi vengono stampati.
 */
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const N_DOCS = 5000;
const N_CAT = 2000;
const N_ISSUED = 1500;
const times: Record<string, number> = {};
const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const r = await fn();
  times[name] = Math.round(performance.now() - t0);
  return r;
};

const catalogItem = (i: number): CatalogItem => ({
  id: `k${i}`, name: `Articolo ${i % 97} ${['tubo', 'raccordo', 'valvola', 'caldaia', 'cavo'][i % 5]} ${i}`, aliases: [`alias${i}`, `sinonimo ${i}`],
  unit: 'pz', price: (i % 500) + 0.5, vat: 22, kind: 'materiale', createdAt: i, updatedAt: i,
});

async function seed(): Promise<void> {
  const xmlBase = '<FatturaElettronica>' + 'x'.repeat(1500) + '</FatturaElettronica>';
  const docs: QuoteDocument[] = [];
  const audit: AuditEntry[] = [];
  for (let i = 0; i < N_DOCS; i++) {
    const month = String((i % 12) + 1).padStart(2, '0');
    const date = `2026-${month}-${String((i % 27) + 1).padStart(2, '0')}`;
    const lines = [lineData('a', 10 + (i % 90), 1 + (i % 4)), lineData('b', 5, 2)];
    if (i < N_ISSUED) {
      const xml = `${xmlBase}<n>${i}</n>`;
      const d = draftData(`doc${i}`, date, lines, { number: `${i + 1}/2026`, status: 'emessa', customer: { id: `c${i % 300}`, name: `Cliente ${i % 300} Srl` }, createdAt: i, updatedAt: i }, {
        seq: i + 1, number: `${i + 1}/2026`, year: 2026, sectional: 'FT', lockedAt: 1000 + i, issuedAt: 1000 + i, xml, xmlSha256: await sha256Hex(xml), progressivoInvio: `P${i}`, fileName: `IT01234567897_${i}.xml`,
      });
      docs.push(d);
      audit.push({ id: `a${String(i).padStart(6, '0')}`, at: 1000 + i, docId: d.id, action: 'issue', actor: 'user', detail: 'Emessa', xmlSha256: d.invoice!.xmlSha256 });
    } else if (i % 2) {
      docs.push({ ...draftData(`doc${i}`, date, lines, { number: `PRev-${i}`, createdAt: i, updatedAt: i, customer: { id: `c${i % 300}`, name: `Cliente ${i % 300} Srl` } }), type: 'preventivo', invoice: undefined, status: 'inviato' });
    } else {
      docs.push(draftData(`doc${i}`, date, lines, { createdAt: i, updatedAt: i, customer: { id: `c${i % 300}`, name: `Cliente ${i % 300} Srl` } }));
    }
  }
  await getBackend().transact('readwrite', async (t) => {
    await t.putProfile({ ...(await import('./db')).defaultProfile(), businessName: 'Perf Srl', vatNumber: '01234567897', invoiceYearCounters: { 'FT-2026': N_ISSUED } });
    for (let i = 0; i < N_CAT; i++) await t.put('catalog', catalogItem(i));
    for (const d of docs) await t.put('documents', d);
    for (const a of audit) await t.add('audit', a);
  });
}

beforeAll(async () => {
  await __resetStorageForTests();
  await deleteDB(DB_NAME);
  await timed('seed', seed);
}, 120_000);
afterAll(() => { console.log('[perf storage]', JSON.stringify(times)); });

describe(`prestazioni storage: ${N_DOCS} documenti, ${N_CAT} voci di catalogo`, () => {
  it('listDocuments ordinata per data', async () => {
    const docs = await timed('listDocuments', listDocuments);
    expect(docs).toHaveLength(N_DOCS);
    for (let i = 1; i < docs.length; i++) expect(docs[i - 1].date >= docs[i].date).toBe(true);
    expect(times.listDocuments).toBeLessThan(4000);
  });

  it('listCatalog ordinata e ricerca locale sul catalogo e sulla rubrica', async () => {
    const cat = await timed('listCatalog', listCatalog);
    expect(cat).toHaveLength(N_CAT);
    for (let i = 1; i < cat.length; i++) expect(cat[i - 1].name.localeCompare(cat[i].name, 'it', { sensitivity: 'base' })).toBeLessThanOrEqual(0);
    expect(times.listCatalog).toBeLessThan(2000);
    const book = Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, name: `Cliente ${i} Srl`, vatNumber: '' }));
    const hits = await timed('searchCustomers', async () => searchCustomers('cliente 19', book, 6));
    expect(hits.length).toBeGreaterThan(0);
    expect(times.searchCustomers).toBeLessThan(1000);
    const found = await timed('searchCatalog', async () => cat.filter((c) => c.name.toLowerCase().includes('valvola 9') || c.aliases.some((a) => a.includes('sinonimo 19'))));
    expect(found.length).toBeGreaterThan(0);
  });

  it('getStorageSummary e controllo di integrità', async () => {
    const s = await timed('summary', getStorageSummary);
    expect(s).toMatchObject({ documents: N_DOCS, catalog: N_CAT, invoicesIssued: N_ISSUED });
    expect(times.summary).toBeLessThan(3000);
    const r = await timed('integrity', verifyStorageIntegrity);
    expect(r.ok).toBe(true);
    expect(r.counts.issuedInvoices).toBe(N_ISSUED);
    expect(times.integrity).toBeLessThan(15_000);
  });

  it('backup, parse e ripristino (sostituzione) con tutti i dati', async () => {
    const json = await timed('exportBackup', exportBackup);
    expect(json.length).toBeGreaterThan(1_000_000);
    expect(times.exportBackup).toBeLessThan(6000);
    const parsed = await timed('parseBackup', async () => parseBackup(json));
    expect(parsed.documents).toHaveLength(N_DOCS);
    expect(times.parseBackup).toBeLessThan(4000);
    const res = await timed('importBackup', () => importBackup(json));
    expect(res.warnings).toEqual([]);
    expect(times.importBackup).toBeLessThan(25_000);
    expect(await listDocuments()).toHaveLength(N_DOCS);
    expect(await listCatalog()).toHaveLength(N_CAT);
  });

  it('migrazione v1 -> v2 di 5.000 documenti (funzione di migrazione)', async () => {
    const v1: QuoteDocument[] = Array.from({ length: N_DOCS }, (_, i) => ({
      id: `m${i}`, type: i % 2 ? 'fattura' : 'preventivo', number: `N${i}`, date: '2025-05-05', customer: { id: 'c', name: 'X' }, lines: [], status: (i % 3 ? 'pagato' : 'bozza') as never, createdAt: i, updatedAt: i,
    }));
    const out = await timed('migrateV1', async () => v1.map((d) => migrateDocumentV1(d)).filter(Boolean));
    expect(out.length).toBeGreaterThan(N_DOCS / 2);
    expect(times.migrateV1).toBeLessThan(2000);
  });

  it('importAuditEntries di 2.000 voci e cancellazione completa con backup di sicurezza', async () => {
    const entries: AuditEntry[] = Array.from({ length: 2000 }, (_, i) => ({ id: `r${String(i).padStart(6, '0')}`, at: 5000 + i, docId: `doc${i}`, action: 'edit', actor: 'user', detail: 'remota' }));
    const r = await timed('importAudit', () => importAuditEntries(entries));
    expect(r).toEqual({ added: 2000, skipped: 0 });
    expect(times.importAudit).toBeLessThan(8000);
    const again = await timed('importAuditAgain', () => importAuditEntries(entries));
    expect(again).toEqual({ added: 0, skipped: 2000 });
    const c = await timed('clearLocalData', () => clearLocalData({ confirm: 'CANCELLA-DATI-LOCALI' }));
    expect(c.cleared).toMatchObject({ documents: N_DOCS, catalog: N_CAT });
    expect(parseBackup(c.backupJson!).documents).toHaveLength(N_DOCS);
    expect(await listDocuments()).toHaveLength(0);
    expect(times.clearLocalData).toBeLessThan(10_000);
  });

  it('migrazione REALE di un database v1 con 5.000 documenti e 2.000 voci all\'apertura (upgrade a v3)', async () => {
    await __resetStorageForTests();
    await deleteDB(DB_NAME);
    const old = await openDB(DB_NAME, 1, { upgrade(db) { db.createObjectStore('profile'); db.createObjectStore('catalog', { keyPath: 'id' }); db.createObjectStore('documents', { keyPath: 'id' }); } });
    const tx = old.transaction(['catalog', 'documents'], 'readwrite');
    for (let i = 0; i < N_CAT; i++) tx.objectStore('catalog').put(catalogItem(i));
    for (let i = 0; i < N_DOCS; i++) {
      tx.objectStore('documents').put({
        id: `v${i}`, type: i % 2 ? 'fattura' : 'preventivo', number: `N${i}`, date: '2025-05-05', customer: { id: `c${i % 200}`, name: `Cliente ${i % 200} Srl` },
        lines: [lineData('a', 10)], status: i % 3 ? 'pagato' : 'bozza', createdAt: i, updatedAt: i,
      });
    }
    await tx.done;
    old.close();
    const docs = await timed('migrazioneReale', listDocuments); // la prima lettura apre il DB e fa l'upgrade
    expect(docs).toHaveLength(N_DOCS);
    expect(times.migrazioneReale).toBeLessThan(30_000);
    const invoices = docs.filter((d) => d.type === 'fattura');
    expect(invoices.every((d) => d.invoice?.legacy === true && d.status === 'bozza')).toBe(true);
    expect(docs.some((d) => (d.status as string) === 'pagato')).toBe(false);
    const sum = await getStorageSummary();
    expect(sum).toMatchObject({ documents: N_DOCS, catalog: N_CAT, customers: 200, invoicesIssued: 0 });
  });
});
