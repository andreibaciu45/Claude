/**
 * Test di regressione della revisione indipendente (docs/CODE-REVIEW-CLIENT.md). Ognuno di questi test FALLIVA prima delle correzioni.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncOp, SyncPushBody, SyncPushResponse } from '../../shared/api';
import type { QuoteDocument } from '../types';
import { defaultProfile } from '../storage';
import { ApiClientError } from './api';
import { __resetSyncDbForTests, enqueueUpsert, getMeta, listOutbox, setMeta, setSynced } from './outbox';
import { createSyncEngine, type SyncEngine } from './engine';
import { detectMassDelete, diffSnapshot, takeSnapshot } from './snapshot';
import { FakeServer, MemStore, mkDoc, mkItem } from './testing/fakes';

let token: string | null;
let account: { email: string; tenantId: string } | null;
let online: boolean;
let server: FakeServer;
let store: MemStore;
let engine: SyncEngine;

const make = () => createSyncEngine({
  api: server, store, isOnline: () => online, now: () => 1_000_000,
  tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
  accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
});

beforeEach(async () => {
  await __resetSyncDbForTests();
  token = 'tok'; account = { email: 'a@b.it', tenantId: 't' }; online = true;
  server = new FakeServer(); store = new MemStore(); engine = make();
});

const lockedInvoice = (id: string): QuoteDocument => mkDoc(id, {
  type: 'fattura', status: 'emessa', number: '1/2026',
  invoice: { tipoDocumento: 'TD01', year: 2026, sectional: 'FT', seq: 1, number: '1/2026', operationDate: '2026-01-01', lockedAt: 5, stampDuty: false, stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [] },
});

describe('SYNC-1 cambio account dopo uscita: la coda del vecchio account non va al nuovo', () => {
  it('uscita con coda piena + accesso con un altro account: outbox, cursor e hash azzerati', async () => {
    await engine.verifyCode('a@x.it', '123456');
    store.catalog.set('c1', mkItem('c1'));
    await engine.confirmMigration();
    expect(server.count('catalog')).toBe(1);
    store.catalog.set('c2', mkItem('c2', 'Segreto di A'));
    await engine.scan(); // accoda c2 (non ancora inviata)
    expect((await listOutbox()).length).toBe(1);
    engine.signOut();
    const before = server.receivedOps.length;
    await engine.verifyCode('b@x.it', '123456');
    expect(await listOutbox()).toHaveLength(0);
    expect(server.receivedOps.length).toBe(before); // nulla dell'account A è stato spedito al tenant di B
    expect(await getMeta('cursor')).toBeUndefined();
    expect(engine.getStatus().migration).not.toBeNull(); // i dati locali si caricano solo dopo conferma esplicita
  });
  it('stesso account: la coda resta e riparte', async () => {
    await engine.verifyCode('a@x.it', '123456');
    store.catalog.set('c2', mkItem('c2'));
    await engine.confirmMigration();
    online = false;
    store.catalog.set('c3', mkItem('c3'));
    await engine.scan();
    engine.signOut();
    online = true;
    await engine.verifyCode('a@x.it', '123456');
    expect(server.count('catalog')).toBe(2);
  });
});

describe('SYNC-2 circuit breaker: cancellazioni di massa', () => {
  const seed = async () => {
    await engine.syncNow(); // migrazione vuota
    for (let i = 0; i < 6; i++) store.docs.set(`d${i}`, mkDoc(`d${i}`));
    store.catalog.set('c1', mkItem('c1'));
    await engine.syncNow();
    expect(server.count('document')).toBe(6);
  };

  it('archivio locale svuotato: nessuna cancellazione sul server, richiesta di conferma', async () => {
    await seed();
    store.docs.clear(); store.catalog.clear(); store.profile = defaultProfile();
    await engine.syncNow();
    expect(server.count('document')).toBe(6);
    expect(server.count('catalog')).toBe(1);
    expect(engine.getStatus().massDelete).toEqual({ documents: 6, catalog: 1 });
    expect(await listOutbox()).toHaveLength(0);
  });

  it('"ripristina dal server" riscrive i dati in locale', async () => {
    await seed();
    store.docs.clear();
    await engine.syncNow();
    await engine.restoreFromServer();
    expect(store.docs.size).toBe(6);
    expect(engine.getStatus().massDelete).toBeNull();
    expect(server.count('document')).toBe(6);
  });

  it('"conferma" applica le cancellazioni al server', async () => {
    await seed();
    store.docs.clear();
    await engine.syncNow();
    await engine.confirmMassDelete();
    expect(server.count('document')).toBe(0);
    expect(engine.getStatus().massDelete).toBeNull();
  });

  it('cancellazioni normali (1-2 documenti) passano senza conferma', async () => {
    await seed();
    store.docs.delete('d0'); store.docs.delete('d1');
    await engine.syncNow();
    expect(server.count('document')).toBe(4);
    expect(engine.getStatus().massDelete).toBeNull();
  });

  it('funzione pura: soglie', async () => {
    const synced = new Map<string, { hash: string }>();
    for (let i = 0; i < 10; i++) synced.set(`document:d${i}`, { hash: 'x' });
    const snap = await takeSnapshot(store);
    const keep = (n: number) => { store.docs.clear(); for (let i = n; i < 10; i++) store.docs.set(`d${i}`, mkDoc(`d${i}`)); };
    keep(4); // 4 cancellati su 10: sotto la soglia
    let s = await takeSnapshot(store);
    expect(detectMassDelete(s, diffSnapshot(s, synced), synced)).toBeNull();
    keep(5); // 5 su 10
    s = await takeSnapshot(store);
    expect(detectMassDelete(s, diffSnapshot(s, synced), synced)?.documents).toBe(5);
    expect(snap).toBeTruthy();
  });
});

describe('SYNC-3 profilo vuoto non sovrascrive quello del server', () => {
  it('storage ripristinato ai default: nessun upsert del profilo vuoto', async () => {
    await engine.syncNow();
    store.profile = { ...defaultProfile(), businessName: 'Rossi Impianti', vatNumber: '01234567897' };
    await engine.syncNow();
    expect((server.get('profile', 'profile') as { businessName: string }).businessName).toBe('Rossi Impianti');
    store.profile = defaultProfile();
    await engine.syncNow();
    expect((server.get('profile', 'profile') as { businessName: string }).businessName).toBe('Rossi Impianti');
    // e il pull lo riporta in locale
    server.put('profile', 'profile', { ...defaultProfile(), businessName: 'Rossi Impianti', vatNumber: '01234567897' });
    await engine.syncNow();
    expect(store.profile.businessName).toBe('Rossi Impianti');
  });
});

describe('SYNC-4 fattura emessa su un altro dispositivo arriva con il percorso "sincronizzato" dello storage', () => {
  it('pull di un documento con lockedAt mai visto in locale', async () => {
    await engine.syncNow();
    server.put('document', 'f1', lockedInvoice('f1'));
    await engine.syncNow();
    expect(store.docs.get('f1')?.invoice?.lockedAt).toBe(5);
    expect(engine.getStatus().remoteIgnored).toBe(0);
  });
});

describe('SYNC-5 una richiesta rifiutata (413) non blocca la coda', () => {
  class Picky extends FakeServer {
    async syncPush(body: SyncPushBody): Promise<SyncPushResponse> {
      if (body.ops.some((o: SyncOp) => o.entityId === 'huge')) throw new ApiClientError(413, 'payload_too_large', 'troppo grande');
      return super.syncPush(body);
    }
  }
  it('dimezza il lotto e segna come non valida solo l\'operazione colpevole', async () => {
    server = new Picky(); engine = make();
    await engine.syncNow();
    store.docs.set('a', mkDoc('a')); store.docs.set('huge', mkDoc('huge')); store.docs.set('b', mkDoc('b'));
    await engine.syncNow();
    expect(server.count('document')).toBe(2);
    const st = engine.getStatus();
    expect(st.conflicts).toHaveLength(1);
    expect(st.conflicts[0]).toMatchObject({ entityId: 'huge', reason: 'invalid' });
    expect(st.phase).toBe('conflict');
  });
});

describe('SYNC-6 due schede: un solo ciclo alla volta (Web Locks)', () => {
  const nav = navigator as unknown as { locks?: unknown };
  afterEach(() => { delete nav.locks; });
  it('se un\'altra scheda tiene il lock il ciclo viene saltato', async () => {
    await engine.syncNow();
    store.catalog.set('c1', mkItem('c1'));
    nav.locks = { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(null) };
    const before = server.pushCalls;
    await engine.syncNow();
    expect(server.pushCalls).toBe(before);
    nav.locks = { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb({}) };
    await engine.syncNow();
    expect(server.count('catalog')).toBe(1);
  });
});

describe('SYNC-7 /me si rilegge dopo un sync riuscito (cache Pro)', () => {
  it('meAt valorizzato e aggiornato quando vecchio', async () => {
    let now = 1_000_000;
    engine = createSyncEngine({
      api: server, store, isOnline: () => true, now: () => now,
      tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
      accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
    });
    await engine.syncNow();
    expect(engine.getStatus().meAt).toBe(1_000_000);
    server.plan = 'pro';
    now += 2 * 3600_000;
    await engine.syncNow();
    expect(engine.getStatus().me?.plan).toBe('pro');
    expect(engine.getStatus().meAt).toBe(now);
  });
});

describe('uso diretto di outbox (sanità)', () => {
  it('setMeta/setSynced esistono', async () => {
    await setMeta('tenant', 'x');
    await setSynced([['catalog:a', { hash: 'h' }]]);
    await enqueueUpsert({ entity: 'catalog', entityId: 'a', payload: mkItem('a') });
    expect(await getMeta('tenant')).toBe('x');
  });
});
