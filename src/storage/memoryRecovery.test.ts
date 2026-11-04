// RIFINITURE-3 / REV2-A1: recupero dei dati scritti in memoria dopo un'apertura iniziale fallita.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, exportBackup, getStorageStatus, listCatalog, listCustomers, listDocuments, retryStorage, saveCatalogItem, saveDocument, upsertCustomer,
} from './index';
import { DB_NAME, __setBackoffForTests } from './db';
import { draftData } from './testkit';
import type { QuoteDocument } from '../types';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quote = (id: string, over: Partial<QuoteDocument> = {}): QuoteDocument => ({ ...draftData(id, '2026-03-10'), type: 'preventivo', invoice: undefined, number: `PRev-${id}`, ...over });
const item = (id: string, name: string) => ({ id, name, aliases: [], unit: 'pz' as const, price: 1, vat: 22, kind: 'materiale' as const, createdAt: 1, updatedAt: 1 });

/** Occupa il database con una versione più nuova: l'apertura iniziale fallisce (VersionError) e l'app passa in memoria. */
async function failFirstOpen() {
  const blocker = await openDB(DB_NAME, 9);
  blocker.close();
  __setBackoffForTests(100000);
}
/** "Sblocca" l'archivio: elimina il database finto alla v9 così la riapertura riesce con lo schema reale. */
const unblock = () => deleteDB(DB_NAME);

beforeEach(async () => { await __resetStorageForTests(); await deleteDB(DB_NAME); });
afterEach(() => { vi.restoreAllMocks(); });

describe('recupero dei dati scritti in memoria', () => {
  it('alla riapertura riuscita trasferisce preventivi, bozze, rubrica e listino, con avviso leggibile', async () => {
    await failFirstOpen();
    await saveDocument(quote('q1'));
    await saveDocument(draftData('b1', '2026-03-11'));
    await saveCatalogItem(item('k1', 'Tubo'));
    await upsertCustomer({ id: 'c9', name: 'Verdi Spa', vatNumber: '02345678904' });
    expect(getStorageStatus().memoryOnly).toBe(true);

    await unblock();
    expect(await retryStorage()).toBe(true);
    await sleep(50);

    const docs = await listDocuments();
    expect(docs.map((d) => d.id).sort()).toEqual(['b1', 'q1']); // id preservati
    expect((await listCatalog()).map((c) => c.id)).toEqual(['k1']);
    expect((await listCustomers()).some((c) => c.name === 'Verdi Spa')).toBe(true);
    const st = getStorageStatus();
    expect(st.reason).toBe('memory-recovered');
    expect(st.message).toContain('Abbiamo recuperato 2 documenti creati mentre l\'archivio non era disponibile');
    expect(st.memoryOnly).toBe(false);
  });

  it('non sovrascrive dati con lo stesso id: tiene entrambi', async () => {
    await failFirstOpen();
    await saveDocument(quote('q1', { notes: 'scritto in memoria' }));
    // nel frattempo l'archivio vero ha già un documento con lo STESSO id
    await deleteDB(DB_NAME);
    const real = await openDB(DB_NAME, 3, { upgrade(d) {
      d.createObjectStore('profile'); d.createObjectStore('catalog', { keyPath: 'id' }); d.createObjectStore('customers', { keyPath: 'id' });
      const docs = d.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('byType', 'type'); docs.createIndex('byStatus', 'status'); docs.createIndex('byDate', 'date');
      docs.createIndex('byTypeStatusDate', ['type', 'status', 'date']);
      docs.createIndex('byInvoiceNumber', ['invoice.sectional', 'invoice.year', 'invoice.seq'], { unique: true });
      const a = d.createObjectStore('audit', { keyPath: 'id' }); a.createIndex('byDoc', 'docId'); a.createIndex('byAt', 'at');
    } });
    await real.put('documents', quote('q1', { notes: 'già nell\'archivio' }));
    real.close();
    expect(await retryStorage()).toBe(true);
    await sleep(50);
    const docs = await listDocuments();
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.id === 'q1')?.notes).toBe('già nell\'archivio');
    expect(docs.find((d) => d.id !== 'q1')?.notes).toBe('scritto in memoria');
  });

  it('mai trasferire fatture emesse eventualmente presenti in memoria', async () => {
    await failFirstOpen();
    await saveDocument(quote('q1'));
    // simula (per errore di un altro modulo) una fattura con lockedAt nella memoria
    const issued = draftData('f1', '2026-03-10', undefined, { status: 'emessa', number: 'FT-1' }, { number: '1/2026', seq: 1, lockedAt: 5 });
    const { getBackend } = await import('./db');
    await getBackend().transact('readwrite', (t) => t.put('documents', issued));
    await unblock();
    await retryStorage();
    await sleep(50);
    expect((await listDocuments()).map((d) => d.id)).toEqual(['q1']);
  });

  it('se il trasferimento fallisce la memoria NON viene svuotata, avviso + backup di emergenza con i dati', async () => {
    await failFirstOpen();
    await saveDocument(quote('q1'));
    await unblock();
    const idb = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const spy = vi.spyOn(idb, 'put').mockImplementation(() => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); });
    await retryStorage();
    await sleep(50);
    expect(getStorageStatus().reason).toBe('recovery-failed');
    expect(getStorageStatus().message).toContain('backup di emergenza');
    const backup = JSON.parse(await exportBackup()) as { documents: { id: string }[] };
    expect(backup.documents.map((d) => d.id)).toContain('q1');
    // ripristinato il disco, "Riprova" completa il trasferimento
    spy.mockRestore();
    expect(await retryStorage()).toBe(true);
    await sleep(50);
    expect((await listDocuments()).map((d) => d.id)).toEqual(['q1']);
    expect(getStorageStatus().reason).toBe('memory-recovered');
  });

  it('senza lavoro in memoria nessun avviso', async () => {
    await failFirstOpen();
    await unblock();
    await retryStorage();
    await sleep(30);
    expect(getStorageStatus().health).toBe('ok');
  });
});
