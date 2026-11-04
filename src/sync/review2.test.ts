/** Regressioni del secondo giro di revisione (docs/CODE-REVIEW-2.md): conflitti sulle bozze. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QuoteDocument } from '../types';
import { __resetSyncDbForTests } from './outbox';
import { createSyncEngine, type SyncEngine } from './engine';
import { unavailableStorageHooks } from './storageHooks';
import { FakeServer, MemStore, mkDoc } from './testing/fakes';

let token: string | null; let account: { email: string; tenantId: string } | null;
let server: FakeServer; let store: MemStore; let engine: SyncEngine;
beforeEach(async () => {
  await __resetSyncDbForTests();
  token = 'tok'; account = { email: 'a@b.it', tenantId: 't' };
  server = new FakeServer(); store = new MemStore();
  engine = createSyncEngine({
    api: server, store, isOnline: () => true, now: () => 1_000_000, hooks: unavailableStorageHooks,
    tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
    accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
  });
});

describe('REV2-S1 "Tieni entrambe" non duplica la copia a ogni tentativo', () => {
  it('se l\'adozione della versione del server fallisce (errore passeggero), ripetere la scelta non crea una seconda copia', async () => {
    store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.put('document', 'd', mkDoc('d', { notes: 'dal server', updatedAt: 100 }));
    store.docs.set('d', mkDoc('d', { notes: 'mia nota', updatedAt: 60 }));
    await engine.syncNow();
    const c = engine.getStatus().conflicts[0];
    expect(c.canKeepBoth).toBe(true);

    // l'applicazione della versione del server fallisce una volta (es. errore di IndexedDB)
    const original = store.saveRemoteDocument?.bind(store) ?? store.saveDocument.bind(store);
    let fail = true;
    (store as unknown as { saveRemoteDocument: (d: QuoteDocument) => Promise<void> }).saveRemoteDocument = async (d) => {
      if (fail) { fail = false; throw new Error('Errore passeggero dell\'archivio'); }
      return original(d);
    };
    await expect(engine.resolveConflict(c.opId, 'keep-both')).rejects.toThrow();
    await engine.resolveConflict(c.opId, 'keep-both'); // l'utente riprova

    const copies = [...store.docs.values()].filter((d) => d.notes?.includes('Copia in conflitto'));
    expect(copies).toHaveLength(1);
    expect(store.docs.get('d')?.notes).toBe('dal server');
    expect(engine.getStatus().conflicts).toHaveLength(0);
    await engine.syncNow();
    expect(server.count('document')).toBe(2);
  });
});

// ------------------------------------------------------------------ dopo la convergenza del server
import { mkItem } from './testing/fakes';
import { listOutbox } from './outbox';

const syncedDraft = async () => {
  store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
  await engine.syncNow(); await engine.confirmMigration();
};

describe('tombstone: stale senza serverVersion = cancellata altrove', () => {
  beforeEach(() => { server.strictTombstones = true; });

  it('catalogo: la cancellazione si applica in locale con voce nel registro', async () => {
    store.catalog.set('c1', mkItem('c1')); store.catalog.set('c2', mkItem('c2')); store.catalog.set('c3', mkItem('c3'));
    await engine.syncNow(); await engine.confirmMigration();
    server.remove('catalog', 'c1');
    store.catalog.set('c1', { ...store.catalog.get('c1')!, price: 99, updatedAt: 500 });
    await engine.syncNow();
    expect(store.catalog.has('c1')).toBe(false);
    expect(store.catalog.size).toBe(2);
    expect(engine.getStatus().log.some((l) => /cancellata su un altro dispositivo/.test(l.message))).toBe(true);
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });

  it('bozza: mai eliminata in silenzio; "Ripristina la mia" la ricrea come nuova, "Elimina anche qui" la cancella', async () => {
    await syncedDraft();
    server.remove('document', 'd');
    store.docs.set('d', mkDoc('d', { notes: 'mia modifica', updatedAt: 60 }));
    await engine.syncNow();
    expect(store.docs.get('d')?.notes).toBe('mia modifica');
    let c = engine.getStatus().conflicts[0];
    expect(c.draft?.serverDeleted).toBe(true);
    expect(c.canUseServer).toBe(true);
    expect(c.canKeepBoth).toBe(false);
    await engine.resolveConflict(c.opId, 'keep-local');
    await engine.syncNow();
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('mia modifica');
    expect(engine.getStatus().conflicts).toHaveLength(0);

    // secondo caso: l'utente sceglie di eliminare
    server.remove('document', 'd');
    store.docs.set('d', mkDoc('d', { notes: 'ancora', updatedAt: 90 }));
    await engine.syncNow();
    c = engine.getStatus().conflicts[0];
    await engine.resolveConflict(c.opId, 'use-server');
    expect(store.docs.has('d')).toBe(false);
    expect(await listOutbox()).toHaveLength(0);
    await engine.syncNow();
    expect(engine.getStatus().conflicts).toHaveLength(0);
  });

  it('pull: un tombstone di una voce senza modifiche locali la cancella', async () => {
    store.catalog.set('c1', mkItem('c1')); store.catalog.set('c2', mkItem('c2')); store.catalog.set('c3', mkItem('c3')); store.catalog.set('c4', mkItem('c4'));
    await engine.syncNow(); await engine.confirmMigration();
    server.remove('catalog', 'c1');
    await engine.syncNow();
    expect([...store.catalog.keys()].sort()).toEqual(['c2', 'c3', 'c4']);
  });

  it('pull: troppi tombstone insieme passano dal circuit breaker, le copie locali restano', async () => {
    for (let i = 0; i < 8; i++) store.catalog.set(`c${i}`, mkItem(`c${i}`));
    await engine.syncNow(); await engine.confirmMigration();
    for (let i = 0; i < 8; i++) server.remove('catalog', `c${i}`);
    await engine.syncNow();
    expect(store.catalog.size).toBe(8);
    expect(engine.getStatus().log.some((l) => /molte voci/.test(l.message))).toBe(true);
    expect(engine.getStatus().remoteIgnored).toBeGreaterThan(0);
  });

  it('push: molte voci di catalogo "cancellate altrove" non vengono rimosse in blocco', async () => {
    for (let i = 0; i < 8; i++) store.catalog.set(`c${i}`, mkItem(`c${i}`));
    await engine.syncNow(); await engine.confirmMigration();
    for (let i = 0; i < 8; i++) { server.remove('catalog', `c${i}`); store.catalog.set(`c${i}`, { ...store.catalog.get(`c${i}`)!, price: 50, updatedAt: 500 }); }
    await engine.syncNow();
    expect(store.catalog.size).toBe(8);
  });
});

describe('resync_required: riallineamento completo', () => {
  it('pull da cursore 0, le voci rifiutate si ricreano come nuove e nessun dato locale va perso', async () => {
    store.catalog.set('c1', mkItem('c1'));
    store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    // il server ha perso/potato le voci (dispositivo offline da oltre 180 giorni) e ha altri dati
    server.entities.clear(); server.log = [];
    server.put('catalog', 'altro', mkItem('altro'));
    server.resyncRequired = true;
    store.catalog.set('c1', { ...store.catalog.get('c1')!, price: 77, updatedAt: 900 });
    store.docs.set('d', mkDoc('d', { notes: 'modifica offline', updatedAt: 900 }));
    await engine.syncNow();
    expect(store.catalog.get('c1')?.price).toBe(77);
    expect(store.docs.get('d')?.notes).toBe('modifica offline');
    expect(store.catalog.has('altro')).toBe(true); // scaricato dal server
    expect(server.get('catalog', 'c1')).toBeDefined(); // ricreato come nuovo
    expect((server.get('document', 'd') as QuoteDocument).notes).toBe('modifica offline');
    expect(engine.getStatus().conflicts).toHaveLength(0);
    expect(engine.getStatus().log.some((l) => /non si sincronizzava da molto tempo/.test(l.message))).toBe(true);
  });

  it('non cicla all\'infinito se il server continua a rifiutare: resta un conflitto visibile', async () => {
    store.docs.set('d', mkDoc('d', { notes: 'base', updatedAt: 10 }));
    await engine.syncNow(); await engine.confirmMigration();
    server.entities.clear(); server.log = [];
    server.resyncRequired = true;
    store.docs.set('d', mkDoc('d', { notes: 'x', updatedAt: 900 }));
    await engine.syncNow();
    expect(server.pushCalls).toBeLessThan(10);
  });
});
