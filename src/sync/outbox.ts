/**
 * Outbox persistente delle operazioni di sync + metadati, in un DB IndexedDB SEPARATO (`vp-sync`)
 * per non toccare lo schema di src/storage. Fallback in memoria se IndexedDB non c'è.
 *
 * Stores:
 *  - outbox  : operazioni in coda, keyPath `seq` (autoIncrement = ordine di inserimento), indice unico `opId`
 *  - synced  : ultimo stato noto al server per entità (`entity:id` -> {hash, updatedAt})
 *  - meta    : chiave/valore (cursor, lastSyncAt, migrated, ...)
 */
import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { SyncConflict, SyncEntity, SyncOp } from '../../shared/api';
import { uid } from '../types';

const DB_NAME = 'vp-sync';

export type OutboxStatus = 'pending' | 'conflict';
export interface OutboxRecord extends SyncOp {
  seq: number;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  conflict?: SyncConflict;
  /** hash del payload al momento dell'accodamento (diventa "stato sincronizzato" quando il server accetta) */
  hash?: string;
}
export interface SyncedEntry { hash: string; updatedAt?: number }
export type MetaKey = 'cursor' | 'lastSyncAt' | 'migrated' | 'email';

export const entityKey = (entity: SyncEntity, id: string): string => `${entity}:${id}`;

interface Store {
  outboxAll(): Promise<OutboxRecord[]>;
  outboxPut(r: Omit<OutboxRecord, 'seq'> & { seq?: number }): Promise<void>;
  outboxDelete(seqs: number[]): Promise<void>;
  syncedAll(): Promise<Map<string, SyncedEntry>>;
  syncedPut(entries: [string, SyncedEntry][]): Promise<void>;
  syncedDelete(keys: string[]): Promise<void>;
  metaGet(k: MetaKey): Promise<unknown>;
  metaSet(k: MetaKey, v: unknown): Promise<void>;
  clear(): Promise<void>;
}

function memoryStore(): Store {
  let seq = 0;
  const outbox = new Map<number, OutboxRecord>();
  const synced = new Map<string, SyncedEntry>();
  const meta = new Map<string, unknown>();
  return {
    async outboxAll() { return [...outbox.values()].sort((a, b) => a.seq - b.seq).map((r) => structuredClone(r)); },
    async outboxPut(r) {
      const s = r.seq ?? ++seq;
      if (s > seq) seq = s;
      outbox.set(s, structuredClone({ ...r, seq: s }) as OutboxRecord);
    },
    async outboxDelete(seqs) { for (const s of seqs) outbox.delete(s); },
    async syncedAll() { return new Map(synced); },
    async syncedPut(es) { for (const [k, v] of es) synced.set(k, { ...v }); },
    async syncedDelete(ks) { for (const k of ks) synced.delete(k); },
    async metaGet(k) { return meta.get(k); },
    async metaSet(k, v) { meta.set(k, v); },
    async clear() { outbox.clear(); synced.clear(); meta.clear(); },
  };
}

function idbStore(dbp: Promise<IDBPDatabase>): Store {
  return {
    async outboxAll() { return ((await (await dbp).getAll('outbox')) as OutboxRecord[]).sort((a, b) => a.seq - b.seq); },
    async outboxPut(r) { await (await dbp).put('outbox', r); },
    async outboxDelete(seqs) {
      const tx = (await dbp).transaction('outbox', 'readwrite');
      for (const s of seqs) await tx.store.delete(s);
      await tx.done;
    },
    async syncedAll() {
      const db = await dbp;
      const keys = (await db.getAllKeys('synced')) as string[];
      const vals = (await db.getAll('synced')) as SyncedEntry[];
      return new Map(keys.map((k, i) => [k, vals[i]]));
    },
    async syncedPut(es) {
      const tx = (await dbp).transaction('synced', 'readwrite');
      for (const [k, v] of es) await tx.store.put(v, k);
      await tx.done;
    },
    async syncedDelete(ks) {
      const tx = (await dbp).transaction('synced', 'readwrite');
      for (const k of ks) await tx.store.delete(k);
      await tx.done;
    },
    async metaGet(k) { return (await dbp).get('meta', k); },
    async metaSet(k, v) { await (await dbp).put('meta', v, k); },
    async clear() {
      const tx = (await dbp).transaction(['outbox', 'synced', 'meta'], 'readwrite');
      await Promise.all([tx.objectStore('outbox').clear(), tx.objectStore('synced').clear(), tx.objectStore('meta').clear(), tx.done]);
    },
  };
}

let store: Store | null = null;
let dbHandle: Promise<IDBPDatabase> | null = null;

function getStore(): Store {
  if (store) return store;
  if (typeof indexedDB === 'undefined') return (store = memoryStore());
  const dbp = openDB(DB_NAME, 1, {
    upgrade(db) {
      const ob = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      ob.createIndex('opId', 'opId', { unique: true });
      db.createObjectStore('synced');
      db.createObjectStore('meta');
    },
  });
  dbHandle = dbp;
  const fallback = memoryStore();
  let broken = false;
  dbp.catch(() => { broken = true; });
  const real = idbStore(dbp);
  const wrap = <K extends keyof Store>(k: K): Store[K] =>
    (async (...args: unknown[]) => {
      if (broken) return (fallback[k] as (...a: unknown[]) => unknown)(...args);
      try { return await (real[k] as (...a: unknown[]) => unknown)(...args); } catch {
        broken = true;
        return (fallback[k] as (...a: unknown[]) => unknown)(...args);
      }
    }) as Store[K];
  return (store = {
    outboxAll: wrap('outboxAll'), outboxPut: wrap('outboxPut'), outboxDelete: wrap('outboxDelete'),
    syncedAll: wrap('syncedAll'), syncedPut: wrap('syncedPut'), syncedDelete: wrap('syncedDelete'),
    metaGet: wrap('metaGet'), metaSet: wrap('metaSet'), clear: wrap('clear'),
  });
}

/** Solo per i test: chiude e cancella il DB, riparte da zero. */
export async function __resetSyncDbForTests(): Promise<void> {
  if (dbHandle) { try { (await dbHandle).close(); } catch { /* ignora */ } }
  store = null; dbHandle = null;
  if (typeof indexedDB !== 'undefined') await deleteDB(DB_NAME);
}

/** Solo per i test: chiude la connessione SENZA cancellare i dati (simula la chiusura dell'app). */
export async function __closeSyncDbForTests(): Promise<void> {
  if (dbHandle) { try { (await dbHandle).close(); } catch { /* ignora */ } }
  store = null; dbHandle = null;
}

// ------------------------------------------------------------------ API pubblica

export interface EnqueueInput {
  entity: SyncEntity;
  entityId: string;
  payload?: SyncOp['payload'];
  baseUpdatedAt?: number;
  hash?: string;
  clientTs?: number;
}

/** Serializza le scritture sull'outbox (evita race fra coalescing e inserimento). */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
};

async function enqueue(op: 'upsert' | 'delete', i: EnqueueInput): Promise<OutboxRecord> {
  return serial(async () => {
    const s = getStore();
    const all = await s.outboxAll();
    let base = i.baseUpdatedAt;
    // Coalescing: per le entità modificabili, un'operazione in attesa (non in conflitto) sulla stessa
    // entità viene sostituita dalla nuova (conserva il baseUpdatedAt più vecchio). Il log di audit è
    // append-only: mai fuso.
    if (i.entity !== 'audit') {
      const same = all.filter((r) => r.status === 'pending' && r.entity === i.entity && r.entityId === i.entityId);
      if (same.length) {
        base = same[0].baseUpdatedAt ?? base;
        await s.outboxDelete(same.map((r) => r.seq));
      }
    }
    const rec: Omit<OutboxRecord, 'seq'> = {
      opId: uid(), entity: i.entity, entityId: i.entityId, op,
      baseUpdatedAt: base, payload: op === 'delete' ? undefined : i.payload,
      clientTs: i.clientTs ?? Date.now(), status: 'pending', attempts: 0, hash: i.hash,
    };
    await s.outboxPut(rec);
    const stored = (await s.outboxAll()).find((r) => r.opId === rec.opId);
    return stored as OutboxRecord;
  });
}

export const enqueueUpsert = (i: EnqueueInput): Promise<OutboxRecord> => enqueue('upsert', i);
export const enqueueDelete = (i: Omit<EnqueueInput, 'payload'>): Promise<OutboxRecord> => enqueue('delete', i);

/** Tutte le operazioni, in ordine di inserimento. */
export const listOutbox = (): Promise<OutboxRecord[]> => getStore().outboxAll();
export const listPending = async (): Promise<OutboxRecord[]> => (await listOutbox()).filter((r) => r.status === 'pending');
export const listConflicts = async (): Promise<OutboxRecord[]> => (await listOutbox()).filter((r) => r.status === 'conflict');
export const pendingCount = async (): Promise<number> => (await listPending()).length;

export const removeOps = (opIds: string[]): Promise<void> => serial(async () => {
  const set = new Set(opIds);
  const seqs = (await getStore().outboxAll()).filter((r) => set.has(r.opId)).map((r) => r.seq);
  await getStore().outboxDelete(seqs);
});

export const updateOp = (opId: string, patch: Partial<Omit<OutboxRecord, 'seq' | 'opId'>>): Promise<void> => serial(async () => {
  const rec = (await getStore().outboxAll()).find((r) => r.opId === opId);
  if (rec) await getStore().outboxPut({ ...rec, ...patch });
});

export const markAttempt = (opIds: string[], error?: string): Promise<void> => serial(async () => {
  const set = new Set(opIds);
  for (const r of await getStore().outboxAll()) {
    if (set.has(r.opId)) await getStore().outboxPut({ ...r, attempts: r.attempts + 1, lastError: error });
  }
});

export const getSynced = (): Promise<Map<string, SyncedEntry>> => getStore().syncedAll();
export const setSynced = (entries: [string, SyncedEntry][]): Promise<void> => getStore().syncedPut(entries);
export const deleteSynced = (keys: string[]): Promise<void> => getStore().syncedDelete(keys);

export async function getMeta<T>(k: MetaKey): Promise<T | undefined> { return (await getStore().metaGet(k)) as T | undefined; }
export const setMeta = (k: MetaKey, v: unknown): Promise<void> => getStore().metaSet(k, v);

/** Cancella outbox, stato sincronizzato e metadati (logout con "dimentica sync"). I dati locali non si toccano. */
export const clearSyncState = (): Promise<void> => serial(() => getStore().clear());
