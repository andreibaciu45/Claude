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
