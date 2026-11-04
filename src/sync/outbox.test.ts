import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __closeSyncDbForTests, __resetSyncDbForTests, enqueueDelete, enqueueUpsert, getMeta, getSynced, listOutbox, listPending, markAttempt, removeOps, setMeta, setSynced, updateOp,
} from './outbox';
import { mkDoc, mkItem } from './testing/fakes';

beforeEach(async () => { await __resetSyncDbForTests(); });

describe('outbox', () => {
  it('assegna opId uuid univoci e mantiene l\'ordine di inserimento', async () => {
    const a = await enqueueUpsert({ entity: 'catalog', entityId: 'a', payload: mkItem('a') });
    const b = await enqueueUpsert({ entity: 'document', entityId: 'b', payload: mkDoc('b') });
    const c = await enqueueDelete({ entity: 'catalog', entityId: 'z' });
    expect(new Set([a.opId, b.opId, c.opId]).size).toBe(3);
    expect(a.opId).toMatch(/^[0-9a-f-]{8,}/i);
    expect((await listOutbox()).map((r) => r.entityId)).toEqual(['a', 'b', 'z']);
    expect(a.seq).toBeLessThan(b.seq);
  });

  it('persiste fra una riapertura del DB', async () => {
    await enqueueUpsert({ entity: 'catalog', entityId: 'a', payload: mkItem('a') });
    await setMeta('cursor', '42');
    // simula la chiusura dell'app: modulo nuovo = nuovo handle sullo stesso DB IndexedDB
    await __closeSyncDbForTests();
    expect((await listPending()).map((r) => r.entityId)).toEqual(['a']);
    expect(await getMeta('cursor')).toBe('42');
  });

  it('fonde (coalescing) le operazioni in attesa sulla stessa entità tenendo la base più vecchia', async () => {
    await enqueueUpsert({ entity: 'document', entityId: 'd', payload: mkDoc('d'), baseUpdatedAt: 5 });
    const second = await enqueueUpsert({ entity: 'document', entityId: 'd', payload: mkDoc('d', { notes: 'x' }), baseUpdatedAt: 99 });
    const all = await listOutbox();
    expect(all).toHaveLength(1);
    expect(all[0].opId).toBe(second.opId);
    expect(all[0].baseUpdatedAt).toBe(5);
  });

  it('non fonde le voci di audit (append-only) né le operazioni in conflitto', async () => {
    await enqueueUpsert({ entity: 'audit', entityId: 'x', payload: { id: 'x', at: 1, docId: 'd', action: 'create', actor: 'user' } });
    await enqueueUpsert({ entity: 'audit', entityId: 'x', payload: { id: 'x', at: 1, docId: 'd', action: 'create', actor: 'user' } });
    expect(await listOutbox()).toHaveLength(2);
    const d1 = await enqueueUpsert({ entity: 'catalog', entityId: 'c', payload: mkItem('c') });
    await updateOp(d1.opId, { status: 'conflict' });
    await enqueueUpsert({ entity: 'catalog', entityId: 'c', payload: mkItem('c', 'altro') });
    expect((await listOutbox()).filter((r) => r.entityId === 'c')).toHaveLength(2);
    expect((await listPending()).filter((r) => r.entityId === 'c')).toHaveLength(1);
  });

  it('rimuove, conta i tentativi e salva lo stato sincronizzato', async () => {
    const a = await enqueueUpsert({ entity: 'catalog', entityId: 'a', payload: mkItem('a') });
    await markAttempt([a.opId], 'boom');
    expect((await listOutbox())[0]).toMatchObject({ attempts: 1, lastError: 'boom' });
    await removeOps([a.opId]);
    expect(await listOutbox()).toHaveLength(0);
    await setSynced([['catalog:a', { hash: 'h', updatedAt: 3 }]]);
    expect((await getSynced()).get('catalog:a')).toEqual({ hash: 'h', updatedAt: 3 });
  });
});
