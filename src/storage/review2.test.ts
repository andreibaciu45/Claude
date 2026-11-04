// Revisione di secondo giro (docs/CODE-REVIEW-2.md): test di regressione per db.ts / migrazione v3 / backup / rubrica.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { __resetStorageForTests, getStorageStatus, listCustomers, listDocuments } from './index';
import { DB_NAME } from './db';
import { draftData } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Crea un database alla versione 2 (schema v2 reale) con alcuni documenti e lascia aperta la connessione, come farebbe una scheda col codice vecchio. */
async function openV2WithData() {
  const db = await openDB(DB_NAME, 2, {
    upgrade(d) {
      d.createObjectStore('profile');
      d.createObjectStore('catalog', { keyPath: 'id' });
      const docs = d.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('byType', 'type'); docs.createIndex('byStatus', 'status'); docs.createIndex('byDate', 'date');
      docs.createIndex('byTypeStatusDate', ['type', 'status', 'date']);
      docs.createIndex('byInvoiceNumber', ['invoice.sectional', 'invoice.year', 'invoice.seq'], { unique: true });
      const a = d.createObjectStore('audit', { keyPath: 'id' });
      a.createIndex('byDoc', 'docId'); a.createIndex('byAt', 'at');
    },
  });
  await db.put('documents', draftData('q1', '2026-03-10'));
  await db.put('documents', draftData('q2', '2026-03-11', undefined, { customer: { id: 'x', name: 'Verdi Spa', vatNumber: '02345678904' } }));
  return db;
}

beforeEach(async () => { await __resetStorageForTests(); await deleteDB(DB_NAME); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('migrazione v3 con una seconda scheda ancora alla v2', () => {
  it('l\'apertura resta in attesa (stato "blocked"), nulla si perde e la migrazione parte appena l\'altra scheda chiude', async () => {
    const old = await openV2WithData();
    const p = listDocuments();
    await sleep(60);
    expect(getStorageStatus().reason).toBe('blocked');
    old.close();
    const docs = await p;
    expect(docs.map((d) => d.id).sort()).toEqual(['q1', 'q2']);
    expect((await listCustomers()).length).toBeGreaterThan(0);
    expect(getStorageStatus().health).toBe('ok');
  });

  it('REV2-DB1: tornando sulla scheda (visibilitychange) durante l\'attesa NON si apre una seconda connessione che resta orfana', async () => {
    const old = await openV2WithData();
    const p = listDocuments();
    await sleep(40);
    // l'utente passa all'altra scheda e torna: il gestore di visibilità tenta una riapertura
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    if (!process.env.NO_VIS) { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); }
    await sleep(20);
    old.close();
    await p;
    await sleep(40);
    // una scheda con codice più nuovo vuole eliminare/aggiornare il database: TUTTE le nostre connessioni devono chiudersi
    let blockedForever = false;
    const done = new Promise<boolean>((res) => {
      const rq = indexedDB.deleteDatabase(DB_NAME);
      rq.onsuccess = () => res(true);
      rq.onerror = () => res(false);
      rq.onblocked = () => { blockedForever = true; };
    });
    const ok = await Promise.race([done, sleep(800).then(() => false)]);
    expect(ok, blockedForever ? 'deleteDatabase bloccato da una connessione orfana' : 'timeout').toBe(true);
  });
});
