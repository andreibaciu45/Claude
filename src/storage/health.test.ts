// REV-DB1: nessun ripiego silenzioso in memoria dopo che lo storage persistente era stato aperto.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, getDocument, getStorageHealth, getStorageStatus, issueInvoice, listDocuments, recordPayment, retryStorage,
  saveCatalogItem, saveDocument, setInvoiceCounterStart, createCreditNote, recordSdiEvent, StorageUnavailableError, subscribeStorageStatus,
} from './index';
import { __setBackoffForTests, DB_NAME } from './db';
import { draftData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const dom = (name: string) => Object.assign(new Error(name), { name }) as Error;
const proto = () => (globalThis as unknown as { IDBDatabase: { prototype: { transaction: (...a: unknown[]) => unknown } } }).IDBDatabase.prototype;
const item = (id: string) => ({ id, name: id, aliases: [], unit: 'pz' as const, price: 1, vat: 22, kind: 'materiale' as const, createdAt: 1, updatedAt: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB(DB_NAME);
  await seedProfile();
  await saveDocument(draftData('f1', '2026-03-10'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('connessione chiusa dopo un\'apertura riuscita', () => {
  it('l\'emissione NON riesce in silenzio in memoria: StorageUnavailableError e nessun numero assegnato', async () => {
    expect(getStorageHealth()).toBe('ok');
    vi.spyOn(proto(), 'transaction').mockImplementation(() => { throw dom('InvalidStateError'); });
    await expect(issueInvoice('f1')).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(getStorageHealth()).toBe('unavailable');
    expect(getStorageStatus().persistent).toBe(false);
    expect(getStorageStatus().memoryOnly).toBe(false);
    vi.restoreAllMocks();
    // al ritorno dell'archivio il documento è ancora una bozza SENZA numero e il contatore non si è mosso
    expect(await retryStorage()).toBe(true);
    expect(getStorageHealth()).toBe('ok');
    const d = await getDocument('f1');
    expect(d?.status).toBe('bozza');
    expect(d?.invoice?.seq).toBeUndefined();
    const issued = await issueInvoice('f1');
    expect(issued.invoice?.number).toBe('1/2026');
  });

  it('la lettura non restituisce un archivio vuoto: lancia', async () => {
    vi.spyOn(proto(), 'transaction').mockImplementation(() => { throw dom('InvalidStateError'); });
    await expect(listDocuments()).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('un guasto passeggero (una sola transazione) si ripara da solo riaprendo la connessione', async () => {
    const orig = proto().transaction;
    let n = 0;
    vi.spyOn(proto(), 'transaction').mockImplementation(function (this: unknown, ...a: unknown[]) {
      if (n++ === 0) throw dom('InvalidStateError');
      return orig.apply(this, a);
    });
    expect((await listDocuments()).map((d) => d.id)).toEqual(['f1']);
    expect(getStorageHealth()).toBe('ok');
  });

  it('tutte le scritture fiscali lanciano StorageUnavailableError con archivio non persistente', async () => {
    const issued = await issueInvoice('f1');
    vi.spyOn(proto(), 'transaction').mockImplementation(() => { throw dom('InvalidStateError'); });
    const errs = await Promise.allSettled([
      issueInvoice('f1'),
      createCreditNote('f1', { reason: 'errore' }),
      setInvoiceCounterStart('FT', 2026, 10),
      recordSdiEvent('f1', { at: Date.now(), type: 'INVIO', channel: 'portale_ade' }),
      recordPayment('f1', { date: '2026-03-11', amount: 1 }),
    ]);
    for (const e of errs) {
      expect(e.status).toBe('rejected');
      expect((e as PromiseRejectedResult).reason).toBeInstanceOf(StorageUnavailableError);
    }
    expect(issued.invoice?.number).toBe('1/2026');
  });

  it('riapertura automatica con backoff quando il guasto passa', async () => {
    __setBackoffForTests(10);
    const spy = vi.spyOn(proto(), 'transaction').mockImplementation(() => { throw dom('InvalidStateError'); });
    await expect(listDocuments()).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(getStorageStatus().retrying).toBe(true);
    spy.mockRestore();
    for (let i = 0; i < 100 && getStorageHealth() !== 'ok'; i++) await sleep(20);
    expect(getStorageHealth()).toBe('ok');
    expect((await listDocuments()).length).toBe(1);
  });
});

describe('errori di scrittura (spazio pieno, transazione annullata)', () => {
  it('QuotaExceededError: errore esplicito, stato "degraded", niente memoria; torna "ok" al prossimo salvataggio riuscito', async () => {
    const OS = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const origPut = OS.put;
    const spy = vi.spyOn(OS, 'put').mockImplementation(() => { throw dom('QuotaExceededError'); });
    const err = await saveCatalogItem(item('a')).catch((e) => e);
    expect(err).toBeInstanceOf(StorageUnavailableError);
    expect(err.reason).toBe('quota');
    expect(getStorageHealth()).toBe('degraded');
    expect(getStorageStatus().message).toContain('Spazio esaurito');
    spy.mockRestore();
    OS.put = origPut;
    await saveCatalogItem(item('b'));
    expect(getStorageHealth()).toBe('ok');
    const { listCatalog } = await import('./index');
    expect((await listCatalog()).map((i) => i.id)).toEqual(['b']); // la voce 'a' non è finita da nessuna parte
  });

  it('transazione annullata al commit: errore esplicito e nulla di scritto', async () => {
    const OS = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const origPut = OS.put;
    vi.spyOn(OS, 'put').mockImplementation(function (this: { transaction: { abort(): void } }, ...a: unknown[]) {
      const r = origPut.apply(this, a);
      this.transaction.abort();
      return r;
    });
    await expect(saveCatalogItem(item('a'))).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(getStorageHealth()).toBe('degraded');
    vi.restoreAllMocks();
    const { listCatalog } = await import('./index');
    expect(await listCatalog()).toEqual([]);
  });

  it('un errore di dominio (vincolo, validazione) NON altera lo stato di salute', async () => {
    await issueInvoice('f1');
    await expect(issueInvoice('f1')).rejects.not.toBeInstanceOf(StorageUnavailableError);
    expect(getStorageHealth()).toBe('ok');
  });
});

describe('versionchange da un\'altra scheda', () => {
  it('la nostra connessione si chiude, lo stato diventa unavailable e le emissioni sono bloccate', async () => {
    await listDocuments(); // apre
    __setBackoffForTests(100000);
    const other = await openDB(DB_NAME, 4); // "altra scheda" con versione più nuova: scatena versionchange
    await sleep(20);
    expect(getStorageHealth()).toBe('unavailable');
    await expect(issueInvoice('f1')).rejects.toBeInstanceOf(StorageUnavailableError);
    other.close();
    expect(getStorageStatus().memoryOnly).toBe(false);
  });
});

describe('IndexedDB assente fin dall\'inizio (navigazione privata di vecchi browser)', () => {
  it('bozze e preventivi usabili in memoria, emissione BLOCCATA, stato unavailable con avviso', async () => {
    await __resetStorageForTests();
    const real = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    try {
      const events: number[] = [];
      const off = subscribeStorageStatus(() => events.push(1));
      await saveDocument(draftData('m1', '2026-03-10')); // bozza: ok
      await saveDocument({ ...draftData('q1', '2026-03-10'), type: 'preventivo', invoice: undefined, number: 'PRev-0001' });
      expect((await listDocuments()).map((d) => d.id).sort()).toEqual(['m1', 'q1']);
      const st = getStorageStatus();
      expect(st.health).toBe('unavailable');
      expect(st.reason).toBe('no-indexeddb');
      expect(st.memoryOnly).toBe(true);
      expect(st.message).toContain('non verranno salvati');
      expect(events.length).toBeGreaterThan(0);
      await expect(issueInvoice('m1')).rejects.toMatchObject({ name: 'StorageUnavailableError' });
      await expect(setInvoiceCounterStart('FT', 2026, 5)).rejects.toBeInstanceOf(StorageUnavailableError);
      expect((await listDocuments()).find((d) => d.id === 'm1')?.status).toBe('bozza');
      off();
    } finally { vi.stubGlobal('indexedDB', real); }
  });
});

describe('spazio libero e persistenza', () => {
  it('chiede navigator.storage.persist() una volta e avvisa sotto 50 MB', async () => {
    await __resetStorageForTests();
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => false, estimate: async () => ({ quota: 1_000_000_000, usage: 980_000_000 }) } });
    await listDocuments();
    await listDocuments();
    await sleep(20);
    expect(persist).toHaveBeenCalledTimes(1);
    const st = getStorageStatus();
    expect(st.persisted).toBe(true);
    expect(st.lowSpace).toBe(true);
    expect(st.health).toBe('degraded');
    expect(st.reason).toBe('low-space');
    // le scritture restano consentite
    expect((await issueInvoice('f1')).invoice?.number).toBe('1/2026');
  });
  it('con molto spazio libero resta ok', async () => {
    await __resetStorageForTests();
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 5_000_000_000, usage: 1_000_000 }) } });
    await listDocuments();
    await sleep(20);
    expect(getStorageHealth()).toBe('ok');
  });
});
