/**
 * Property test DETERMINISTICI (PRNG con seed) sull'idempotenza e la convergenza del sync server:
 * lo stesso insieme di operazioni, consegnato in ordini diversi e con duplicati (retry di rete), deve produrre
 * lo stesso stato finale e contare la quota una volta sola. Nessuna rete, DB in memoria, orologio finto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncOp } from '../../../shared/api';
import { catalogItem, docOp, freshEnv, login, opId, push, quote, call } from './helpers';
import { one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';

beforeEach(freshEnv);

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (r: () => number, n: number) => Math.floor(r() * n);
const shuffle = <T,>(r: () => number, a: T[]): T[] => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = int(r, i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** Operazioni con timestamp TUTTI DISTINTI (LWW deterministico): upsert di catalogo e documenti (preventivi). `withDeletes` aggiunge cancellazioni. */
function scenario(seed: number, withDeletes: boolean): SyncOp[] {
  const r = rng(seed);
  const ops: SyncOp[] = [];
  let ts = 10_000;
  const n = 12 + int(r, 14);
  for (let i = 0; i < n; i++) {
    ts += 1 + int(r, 5);
    const k = int(r, 4);
    if (r() < 0.5) {
      if (withDeletes && r() < 0.25) ops.push({ opId: opId(), entity: 'catalog', entityId: `c${k}`, op: 'delete', clientTs: ts });
      else ops.push({ opId: opId(), entity: 'catalog', entityId: `c${k}`, op: 'upsert', payload: catalogItem(`c${k}`, { name: `Voce ${i}`, price: i, updatedAt: ts }), clientTs: ts });
    } else {
      ops.push(docOp(quote(`q${k}`, { notes: `nota ${i}`, updatedAt: ts, createdAt: 1000 }), { clientTs: ts }));
    }
  }
  return ops;
}

/** Spezza in lotti di dimensione casuale, con duplicati casuali (anche dentro lo stesso lotto). */
function deliver(r: () => number, ops: SyncOp[], dupes: boolean): SyncOp[][] {
  const stream = dupes ? ops.flatMap((o) => Array.from({ length: 1 + int(r, 3) }, () => o)) : [...ops];
  const batches: SyncOp[][] = [];
  for (let i = 0; i < stream.length;) { const size = 1 + int(r, 6); batches.push(stream.slice(i, i + size)); i += size; }
  return batches;
}

async function finalState(token: string) {
  // si ricostruisce lo stato rigiocando il log delle modifiche (ultima scrittura per entità vince)
  const state = new Map<string, string>();
  let cursor = '0';
  for (;;) {
    const p = await call('GET', `/v1/sync/pull?cursor=${cursor}&limit=500`, { token });
    for (const o of p.json.ops) {
      const key = `${o.entity}:${o.entityId}`;
      if (o.op === 'delete') state.delete(key);
      else state.set(key, JSON.stringify(o.payload));
    }
    cursor = p.json.cursor;
    if (!p.json.hasMore) break;
  }
  return Object.fromEntries([...state.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function run(email: string, ops: SyncOp[], seed: number, dupes: boolean, reorder: boolean) {
  freshEnv();
  const { token, tenantId } = await login(email);
  setEntitlement(tenantId, { plan: 'pro' });
  const r = rng(seed * 31 + 7);
  const order = reorder ? shuffle(r, ops) : [...ops].sort((a, b) => a.clientTs - b.clientTs);
  const accepted = new Set<string>();
  for (const batch of deliver(r, order, dupes)) {
    const res = await push(token, batch);
    expect(res.status).toBe(200);
    for (const id of res.json.accepted) accepted.add(id);
    for (const c of res.json.conflicts) expect(['stale', 'quota_exceeded']).toContain(c.reason); // mai invalid/500
  }
  return { token, tenantId, accepted, state: await finalState(token) };
}

describe('sync server: idempotenza e convergenza (seed fissi)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: duplicati e ordine casuale delle sole upsert convergono allo stato dell'invio ordinato e singolo`, async () => {
      const ops = scenario(seed, false);
      const reference = await run('ref@x.it', ops, seed, false, false);
      const noisy = await run('noisy@x.it', ops, seed, true, true);
      expect(Object.keys(reference.state).length).toBeGreaterThan(0);
      expect(noisy.state).toEqual(reference.state);
    });

    it(`seed ${seed}: la quota documenti conta ogni documento una sola volta anche con retry duplicati`, async () => {
      const ops = scenario(seed, false);
      const docIds = new Set(ops.filter((o) => o.entity === 'document').map((o) => o.entityId));
      const { token } = await run('quota@x.it', ops, seed, true, true);
      const me = await call('GET', '/v1/me', { token });
      expect(me.json.quota.docsThisMonth).toBe(docIds.size);
    });
  }

  it('lo stesso lotto riconsegnato intero più volte non cambia né il cursore né lo stato', async () => {
    freshEnv();
    const { token, tenantId } = await login('rep@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    const ops = scenario(42, false);
    const first = await push(token, ops);
    const snapshot = await finalState(token);
    for (let i = 0; i < 3; i++) {
      const again = await push(token, ops);
      expect(again.json.accepted.sort()).toEqual(first.json.accepted.sort());
      expect(again.json.cursor).toBe(first.json.cursor);
    }
    expect(await finalState(token)).toEqual(snapshot);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM sync_ops')!.n).toBe(first.json.accepted.length);
  });

  // LIMITE NOTO (da segnalare, codice di produzione in server/src/sync/service.ts applyCatalog):
  // una `delete` che arriva PRIMA di un'`upsert` più vecchia, su una voce mai vista dal server, è un no-op senza tombstone;
  // l'upsert più vecchia (clientTs minore della delete) viene poi applicata e la voce "risorge". Con ordine inverso la voce resta cancellata:
  // lo stato finale dipende dall'ordine di arrivo. `it.fails` documenta il difetto e diventa rosso quando verrà corretto (allora togliere `.fails`).
  it.fails('delete + upsert più vecchia in ordine invertito: lo stato finale dovrebbe essere lo stesso (voce cancellata)', async () => {
    const up: SyncOp = { opId: opId(), entity: 'catalog', entityId: 'cx', op: 'upsert', payload: catalogItem('cx', { updatedAt: 100 }), clientTs: 100 };
    const del: SyncOp = { opId: opId(), entity: 'catalog', entityId: 'cx', op: 'delete', clientTs: 200 };
    const inOrder = await run('o1@x.it', [up, del], 1, false, false);
    freshEnv();
    const { token, tenantId } = await login('o2@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    await push(token, [del]);
    await push(token, [up]);
    expect(await finalState(token)).toEqual(inOrder.state);
  });
});
