import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QuoteDocument } from '../types';
import { defaultProfile } from '../storage';
import { __resetSyncDbForTests, getMeta, listOutbox } from './outbox';
import { createSyncEngine, type SyncEngine } from './engine';
import { FakeServer, MemStore, mkDoc, mkItem } from './testing/fakes';

let token: string | null;
let account: { email: string; tenantId: string } | null;
let online: boolean;
let server: FakeServer;
let store: MemStore;
let engine: SyncEngine;
const t0 = 1_000_000;

const make = () => createSyncEngine({
  api: server, store, isOnline: () => online, now: () => t0,
  tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
  accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
});

beforeEach(async () => {
  await __resetSyncDbForTests();
  token = 'tok'; account = { email: 'a@b.it', tenantId: 't' }; online = true;
  server = new FakeServer(); store = new MemStore(); engine = make();
});

const lockedInvoice = (id: string, number = '1/2026'): QuoteDocument => mkDoc(id, {
  type: 'fattura', status: 'emessa', number,
  invoice: { tipoDocumento: 'TD01', year: 2026, sectional: 'FT', seq: 1, number, operationDate: '2026-01-01', lockedAt: 5, stampDuty: false, stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [] },
});

describe('prima sincronizzazione (migrazione)', () => {
  it('con dati locali chiede conferma con anteprima e non invia nulla prima', async () => {
    store.docs.set('d1', mkDoc('d1')); store.docs.set('d2', mkDoc('d2')); store.catalog.set('c1', mkItem('c1'));
    await engine.syncNow();
    expect(engine.getStatus().migration).toEqual({ documents: 2, catalog: 1, profile: false });
    expect(server.pushCalls).toBe(0);
    await engine.confirmMigration();
    expect(server.count('document')).toBe(2);
    expect(server.count('catalog')).toBe(1);
    expect(engine.getStatus()).toMatchObject({ migration: null, phase: 'idle', pendingOps: 0, lastSyncAt: t0 });
    expect(await getMeta('migrated')).toBe(true);
  });
  it('senza dati locali parte da sola e scarica quelli del server', async () => {
    server.put('catalog', 'c9', mkItem('c9', 'Dal server'));
    server.put('document', 'd9', mkDoc('d9'));
    await engine.syncNow();
    expect(store.catalog.get('c9')?.name).toBe('Dal server');
    expect(store.docs.has('d9')).toBe(true);
    expect(engine.getStatus().phase).toBe('idle');
    expect(await listOutbox()).toHaveLength(0); // niente eco
  });
});

describe('push / pull', () => {
  beforeEach(async () => { await engine.syncNow(); }); // migrazione vuota -> sbloccata

  it('modifiche locali: create, update, delete arrivano al server in ordine e senza duplicati', async () => {
    store.catalog.set('c1', mkItem('c1', 'Uno'));
    await engine.syncNow();
    store.catalog.set('c1', mkItem('c1', 'Uno bis', 20));
    store.docs.set('d1', mkDoc('d1'));
    await engine.syncNow();
    expect(server.get('catalog', 'c1')).toMatchObject({ name: 'Uno bis' });
    store.catalog.delete('c1');
    await engine.syncNow();
    expect(server.get('catalog', 'c1')).toBeUndefined();
    const before = server.receivedOps.length;
    await engine.syncNow(); // nulla da fare
    expect(server.receivedOps.length).toBe(before);
  });

  it('è idempotente per opId: un push ripetuto non duplica (server)', async () => {
    store.catalog.set('c1', mkItem('c1'));
    await engine.syncNow();
    const op = server.receivedOps[0];
    const logLen = server.log.length;
    const r = await server.syncPush({ deviceId: 'x', ops: [op] });
    expect(r.accepted).toEqual([op.opId]);
    expect(server.log.length).toBe(logLen);
  });

  it('pull paginato con cursor; il cursor persiste', async () => {
    server.pageSize = 2;
    for (let i = 0; i < 5; i++) server.put('catalog', `c${i}`, mkItem(`c${i}`));
    await engine.syncNow();
    expect(store.catalog.size).toBe(5);
    expect(await getMeta('cursor')).toBe(String(server.seq));
    const pulls = server.pullCalls;
    await engine.syncNow();
    expect(server.pullCalls).toBe(pulls + 1); // nessuna rilettura dall'inizio
  });

  it('applica cancellazioni remote', async () => {
    store.catalog.set('c1', mkItem('c1'));
    await engine.syncNow();
    server.remove('catalog', 'c1');
    await engine.syncNow();
    expect(store.catalog.has('c1')).toBe(false);
    expect(await listOutbox()).toHaveLength(0);
  });

  it('modifica remota su documento locale già bloccato: ignorata e conteggiata (ImmutableDocumentError)', async () => {
    store.docs.set('f1', lockedInvoice('f1'));
    await engine.syncNow(); // upload (server lo accetta: nuovo)
    server.put('document', 'f1', mkDoc('f1', { notes: 'altrove', type: 'fattura' }));
    await engine.syncNow();
    expect(store.docs.get('f1')?.notes).toBeUndefined();
    expect(engine.getStatus().remoteIgnored).toBe(1);
  });

  it('non sovrascrive modifiche locali non ancora inviate: last-write-wins al push', async () => {
    store.catalog.set('c1', mkItem('c1', 'base', 10));
    await engine.syncNow();
    server.put('catalog', 'c1', mkItem('c1', 'altro dispositivo', 30));
    store.catalog.set('c1', mkItem('c1', 'mio', 20)); // base 10 < 30 => stale al primo tentativo
    await engine.syncNow();
    expect(server.get('catalog', 'c1')).toMatchObject({ name: 'mio' });
    expect(store.catalog.get('c1')?.name).toBe('mio');
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });

  it('il profilo viaggia e mantiene il logo locale', async () => {
    store.profile = { ...defaultProfile(), businessName: 'Rossi Srl', vatNumber: '01234567897', logoDataUrl: 'data:image/png;base64,AAA' };
    await engine.syncNow();
    expect((server.get('profile', 'profile') as { businessName: string }).businessName).toBe('Rossi Srl');
    server.put('profile', 'profile', { ...defaultProfile(), businessName: 'Rossi 2', vatNumber: '01234567897' });
    await engine.syncNow();
    expect(store.profile.businessName).toBe('Rossi 2');
    expect(store.profile.logoDataUrl).toBe('data:image/png;base64,AAA');
  });
});

describe('conflitti', () => {
  beforeEach(async () => { await engine.syncNow(); });

  it('locked_document: stato conflitto, dato locale intatto, opzione "usa il server"', async () => {
    const srvDoc = lockedInvoice('f1');
    server.put('document', 'f1', srvDoc);
    store.docs.set('f1', mkDoc('f1', { type: 'fattura', notes: 'locale', updatedAt: 50 }));
    await engine.syncNow();
    const st = engine.getStatus();
    expect(st.phase).toBe('conflict');
    expect(st.conflicts).toHaveLength(1);
    expect(st.conflicts[0]).toMatchObject({ reason: 'locked_document', canUseServer: true, entityId: 'f1' });
    expect(store.docs.get('f1')?.notes).toBe('locale');
    // il conflitto non viene rimandato in loop
    const pushes = server.pushCalls;
    await engine.syncNow();
    expect(server.pushCalls).toBe(pushes);
    await engine.resolveConflict(st.conflicts[0].opId, 'use-server');
    expect(store.docs.get('f1')?.invoice?.lockedAt).toBe(5);
    expect(engine.getStatus()).toMatchObject({ phase: 'idle', conflicts: [] });
  });

  it('numero duplicato: conflitto; "tieni la mia" non la rimanda più', async () => {
    server.put('document', 'x', lockedInvoice('x', '7/2026'));
    store.docs.set('y', { ...lockedInvoice('y', '7/2026'), id: 'y' });
    await engine.syncNow();
    const c = engine.getStatus().conflicts;
    expect(c.map((i) => i.reason)).toEqual(['duplicate_invoice_number']);
    await engine.resolveConflict(c[0].opId, 'keep-local');
    const n = server.receivedOps.length;
    await engine.syncNow();
    expect(server.receivedOps.length).toBe(n);
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(store.docs.has('y')).toBe(true);
  });

  it('quota Free superata: conflitto quota_exceeded, poi retry dopo il passaggio a Pro', async () => {
    server.docLimit = 1;
    store.docs.set('a', mkDoc('a')); store.docs.set('b', mkDoc('b'));
    await engine.syncNow();
    const st = engine.getStatus();
    expect(st.conflicts.map((c) => c.reason)).toEqual(['quota_exceeded']);
    expect(server.count('document')).toBe(1);
    server.docLimit = null; server.plan = 'pro';
    await engine.resolveConflict(st.conflicts[0].opId, 'retry');
    await engine.syncNow();
    expect(server.count('document')).toBe(2);
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });

  it('keep-both su bozza: crea una copia locale e adotta la versione del server', async () => {
    server.put('document', 'd', mkDoc('d', { updatedAt: 100, notes: 'server' }));
    store.docs.set('d', mkDoc('d', { notes: 'mio', updatedAt: 60 }));
    // forza un conflitto non-stale: simula quota
    server.docLimit = 0;
    server.entities.delete('document:d'); // il server "non ce l'ha" => è nuova per lui => quota
    await engine.syncNow();
    const c = engine.getStatus().conflicts[0];
    expect(c.canKeepBoth).toBe(true);
    await engine.resolveConflict(c.opId, 'keep-both');
    const docs = [...store.docs.values()];
    expect(docs.some((d) => d.notes?.includes('Copia in conflitto') && d.notes.includes('mio'))).toBe(true);
    expect(docs.some((d) => d.number.endsWith('(copia in conflitto)'))).toBe(true);
  });
});

describe('rete, sessione, account', () => {
  it('offline: stato offline, coda conservata, riprende al ritorno', async () => {
    await engine.syncNow();
    online = false;
    store.catalog.set('c1', mkItem('c1'));
    await engine.scan();
    await engine.syncNow();
    expect(engine.getStatus().phase).toBe('offline');
    online = true;
    await engine.syncNow();
    expect(server.count('catalog')).toBe(1);
    expect(engine.getStatus().phase).toBe('idle');
  });
  it('errore di rete a metà: offline, op non perse', async () => {
    await engine.syncNow();
    store.catalog.set('c1', mkItem('c1'));
    server.down = true;
    await engine.syncNow();
    expect(engine.getStatus()).toMatchObject({ phase: 'offline', pendingOps: 1 });
    server.down = false;
    await engine.syncNow();
    expect(server.count('catalog')).toBe(1);
  });
  it('401: esce dall\'account senza toccare i dati locali', async () => {
    await engine.syncNow();
    store.catalog.set('c1', mkItem('c1'));
    server.unauthorized = true;
    await engine.syncNow();
    expect(engine.getStatus().signedIn).toBe(false);
    expect(store.catalog.has('c1')).toBe(true);
  });
  it('senza account non fa nulla', async () => {
    token = null; engine = make();
    store.catalog.set('c1', mkItem('c1'));
    await engine.syncNow();
    expect(server.pushCalls + server.pullCalls).toBe(0);
    expect(engine.getStatus()).toMatchObject({ signedIn: false, phase: 'idle' });
  });
  it('verifyCode salva il token, signOut lo rimuove, codice errato => errore', async () => {
    token = null; account = null; engine = make();
    await expect(engine.verifyCode('x@y.it', '000000')).rejects.toThrow('Codice non valido');
    await engine.verifyCode('X@y.it', '123456');
    expect(token).toBe('tok-x@y.it');
    expect(engine.getStatus()).toMatchObject({ signedIn: true, email: 'x@y.it' });
    expect(engine.getStatus().me?.plan).toBe('free');
    engine.signOut();
    expect(token).toBeNull();
    expect(engine.getStatus().signedIn).toBe(false);
  });
  it('stato osservabile: notifica i sottoscrittori durante il sync', async () => {
    const phases: string[] = [];
    engine.subscribe(() => phases.push(engine.getStatus().phase));
    await engine.syncNow();
    expect(phases).toContain('syncing');
    expect(phases[phases.length - 1]).toBe('idle');
  });
});
