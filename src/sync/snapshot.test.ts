import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile } from '../storage';
import { __resetSyncDbForTests, listOutbox, setSynced } from './outbox';
import { diffSnapshot, hashValue, previewMigration, scanLocalChanges, type Snapshot } from './snapshot';
import { MemStore, mkDoc, mkItem } from './testing/fakes';

beforeEach(async () => { await __resetSyncDbForTests(); });

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ profile: defaultProfile(), catalog: [], documents: [], audit: [], ...over });

describe('hashValue', () => {
  it('è stabile rispetto all\'ordine delle chiavi e ignora undefined', () => {
    expect(hashValue({ a: 1, b: { c: 2, d: undefined } })).toBe(hashValue({ b: { c: 2 }, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});

describe('diffSnapshot', () => {
  it('nuove entità => upsert; invariate => niente; modificate => upsert con base', () => {
    const d = mkDoc('d1');
    const synced = new Map([['document:d1', { hash: hashValue(d), updatedAt: 10 }]]);
    expect(diffSnapshot(snap({ documents: [d] }), synced)).toEqual([]);
    const changed = mkDoc('d1', { notes: 'nuovo', updatedAt: 20 });
    const out = diffSnapshot(snap({ documents: [changed], catalog: [mkItem('c1')] }), synced);
    expect(out.map((c) => [c.entity, c.entityId, c.op, c.baseUpdatedAt])).toEqual([['catalog', 'c1', 'upsert', undefined], ['document', 'd1', 'upsert', 10]]);
  });
  it('elementi spariti => delete (solo catalogo e documenti)', () => {
    const synced = new Map([
      ['catalog:c1', { hash: 'x', updatedAt: 1 }], ['document:d1', { hash: 'y', updatedAt: 2 }], ['profile:profile', { hash: 'z' }],
    ]);
    const out = diffSnapshot(snap({ profile: { ...defaultProfile(), businessName: 'Rossi' } }), synced);
    expect(out.filter((c) => c.op === 'delete').map((c) => `${c.entity}:${c.entityId}`).sort()).toEqual(['catalog:c1', 'document:d1']);
  });
  it('un profilo mai compilato non viene caricato', () => {
    expect(diffSnapshot(snap(), new Map())).toEqual([]);
    expect(diffSnapshot(snap({ profile: { ...defaultProfile(), vatNumber: '01234567897' } }), new Map()).map((c) => c.entity)).toEqual(['profile']);
  });
  it('preview migrazione', () => {
    expect(previewMigration(snap({ documents: [mkDoc('a'), mkDoc('b')], catalog: [mkItem('c')] }))).toEqual({ documents: 2, catalog: 1, profile: false });
  });
});

describe('scanLocalChanges', () => {
  it('è idempotente: la stessa versione non viene riaccodata', async () => {
    const st = new MemStore();
    st.docs.set('d1', mkDoc('d1'));
    expect(await scanLocalChanges(st, new Map())).toBe(1);
    expect(await scanLocalChanges(st, new Map())).toBe(0);
    st.docs.set('d1', mkDoc('d1', { notes: 'v2' }));
    expect(await scanLocalChanges(st, new Map())).toBe(1);
    expect(await listOutbox()).toHaveLength(1); // coalescing
  });
  it('scarta l\'upsert in attesa se la modifica viene annullata o l\'elemento eliminato prima del sync', async () => {
    const st = new MemStore();
    const d = mkDoc('d1');
    await setSynced([['document:d1', { hash: hashValue(d), updatedAt: 10 }]]);
    const synced = new Map([['document:d1', { hash: hashValue(d), updatedAt: 10 }]]);
    st.docs.set('d1', mkDoc('d1', { notes: 'x' }));
    await scanLocalChanges(st, synced);
    expect(await listOutbox()).toHaveLength(1);
    st.docs.set('d1', d); // ripristinata
    await scanLocalChanges(st, synced);
    expect(await listOutbox()).toHaveLength(0);
    st.docs.set('nuovo', mkDoc('nuovo'));
    await scanLocalChanges(st, synced);
    st.docs.delete('nuovo');
    await scanLocalChanges(st, synced);
    expect(await listOutbox()).toHaveLength(0);
  });
  it('rileva le cancellazioni', async () => {
    const st = new MemStore();
    await scanLocalChanges(st, new Map([['catalog:c1', { hash: 'h', updatedAt: 1 }]]));
    expect((await listOutbox())[0]).toMatchObject({ op: 'delete', entity: 'catalog', entityId: 'c1', baseUpdatedAt: 1 });
  });
});
