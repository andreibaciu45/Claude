/**
 * Property test DETERMINISTICI (PRNG con seed) sull'idempotenza e la convergenza del sync server:
 * lo stesso insieme di operazioni, consegnato in ordini diversi e con duplicati (retry di rete), deve produrre
 * lo stesso stato finale e contare la quota una volta sola. Nessuna rete, DB in memoria, orologio finto.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncOp } from '../../../shared/api';
import { catalogItem, docOp, freshEnv, invoice, login, opId, push, quote, call } from './helpers';
import { canon, deliveryPlan, genOps, modelState, rng } from './convergence-model';
import { one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';

beforeEach(freshEnv);

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

  // Difetto storico (TEST-REPORT n.1): una `delete` su una voce mai vista era un no-op senza tombstone, quindi una upsert piu' vecchia in ritardo
  // la faceva risorgere (ordine-dipendente). Ora la delete crea sempre un tombstone.
  it('delete + upsert più vecchia in ordine invertito: lo stato finale è lo stesso (voce cancellata)', async () => {
    const up: SyncOp = { opId: opId(), entity: 'catalog', entityId: 'cx', op: 'upsert', payload: catalogItem('cx', { updatedAt: 100 }), clientTs: 100 };
    const del: SyncOp = { opId: opId(), entity: 'catalog', entityId: 'cx', op: 'delete', clientTs: 200 };
    const inOrder = await run('o1@x.it', [up, del], 1, false, false);
    freshEnv();
    const { token, tenantId } = await login('o2@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    await push(token, [del]);
    const late = await push(token, [up]);
    expect(late.json.conflicts[0].reason).toBe('stale'); // scartata, nessuna risposta serverVersion (voce cancellata)
    expect(late.json.conflicts[0].serverVersion).toBeUndefined();
    expect(await finalState(token)).toEqual(inOrder.state);
    expect(inOrder.state).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// CONVERGENZA: >= 300 sequenze casuali (seme fisso) su 3 dispositivi, ordine/duplicati/ritardi casuali, contro un modello di riferimento puro.
// ---------------------------------------------------------------------------------------------------------------------------------------
const norm = (v: unknown) => canon(JSON.parse(JSON.stringify(v)));
async function serverState(token: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(await finalState(token))) out[k] = norm(JSON.parse(v));
  return out;
}
const expected = (ops: SyncOp[]) => Object.fromEntries(Object.entries(modelState(ops)).map(([k, v]) => [k, norm(JSON.parse(v))]));

describe('sync server: convergenza LWW con tombstone (modello puro)', () => {
  const N = 320;
  it(`${N} sequenze casuali: catalogo, profilo e bozze convergono al modello per qualunque ordine/duplicato`, async () => {
    let nonEmpty = 0, withDeletes = 0;
    for (let seed = 1; seed <= N; seed++) {
      const devOps = genOps(seed);
      const ops = devOps.map((d) => d.op);
      const r = rng(seed * 977 + 13);
      freshEnv();
      const t = await login('conv@x.it');
      setEntitlement(t.tenantId, { plan: 'pro' });
      for (const batch of deliveryPlan(r, ops)) {
        const dev = devOps.find((d) => batch.some((b) => b.opId === d.op.opId))?.device ?? 0;
        const res = await push(t.token, batch, `dev-${dev}`);
        expect(res.status).toBe(200);
        for (const c of res.json.conflicts) expect(c.reason, `seed ${seed}`).toBe('stale'); // mai invalid/resync/500
      }
      const got = await serverState(t.token);
      expect(got, `seed ${seed}`).toEqual(expected(ops));
      if (Object.keys(got).length) nonEmpty++;
      if (ops.some((o) => o.op === 'delete')) withDeletes++;
    }
    expect(nonEmpty).toBeGreaterThan(N * 0.8); // lo scenario non e' degenere
    expect(withDeletes).toBeGreaterThan(N * 0.8);
  }, 240_000);

  it('tie-break a parità di timestamp: la delete batte l\'upsert, tra due upsert vince il contenuto canonico maggiore, in ogni ordine', async () => {
    const mk = (name: string): SyncOp => ({ opId: opId(), entity: 'catalog', entityId: 'k', op: 'upsert', payload: catalogItem('k', { name, updatedAt: 500 }), clientTs: 500 });
    const a = mk('Alfa'), b = mk('Beta');
    const del: SyncOp = { opId: opId(), entity: 'catalog', entityId: 'k', op: 'delete', clientTs: 500 };
    const runOrder = async (ops: SyncOp[]) => { freshEnv(); const { token } = await login('tb@x.it'); for (const o of ops) await push(token, [o]); return serverState(token); };
    for (const o of [[a, b], [b, a]]) expect(Object.values(await runOrder(o))[0]).toContain('Beta');
    for (const o of [[a, del], [del, a], [a, b, del], [del, b, a]]) expect(await runOrder(o)).toEqual({});
  });

  it('delete su bozza mai vista: tombstone propagato dal pull; upsert più vecchia scartata, più recente risuscita (anche con tipo diverso)', async () => {
    const { token, tenantId } = await login('tomb@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    expect((await push(token, [{ opId: opId(), entity: 'document', entityId: 'z1', op: 'delete', clientTs: 300 }])).json.accepted).toHaveLength(1);
    const p = await call('GET', '/v1/sync/pull?cursor=0', { token });
    expect(p.json.ops).toEqual([expect.objectContaining({ entity: 'document', entityId: 'z1', op: 'delete' })]);
    expect((await push(token, [docOp(quote('z1', { updatedAt: 300 }))])).json.conflicts[0].reason).toBe('stale'); // pari ts: vince la cancellazione
    expect((await push(token, [docOp(quote('z1', { updatedAt: 299 }))])).json.conflicts[0].reason).toBe('stale');
    expect((await call('GET', '/v1/documents/z1', { token })).status).toBe(404);
    expect((await push(token, [docOp(invoice('z1', 1, { updatedAt: 301 }, false))])).json.accepted).toHaveLength(1);
    expect(one<{ type: string }>("SELECT type FROM documents WHERE id='z1'")!.type).toBe('fattura');
    expect((await call('GET', '/v1/documents/z1', { token })).status).toBe(200);
  });

  it('più delete tengono il timestamp maggiore (in qualunque ordine) e non generano modifiche inutili', async () => {
    const { token } = await login('maxts@x.it');
    const d = (ts: number): SyncOp => ({ opId: opId(), entity: 'catalog', entityId: 'm', op: 'delete', clientTs: ts });
    await push(token, [d(400)]);
    const cur = (await push(token, [d(100)])).json.cursor;
    expect((await push(token, [d(900)])).json.cursor).toBe(cur); // nessun nuovo evento di pull
    expect(one<{ updated_at: number }>("SELECT updated_at FROM catalog_items WHERE id='m'")!.updated_at).toBe(900);
    expect((await push(token, [{ opId: opId(), entity: 'catalog', entityId: 'm', op: 'upsert', payload: catalogItem('m', { updatedAt: 800 }), clientTs: 800 }])).json.conflicts[0].reason).toBe('stale');
  });

  it('fattura EMESSA: un tombstone più recente non la scarta (le emesse non si cancellano), in entrambi gli ordini', async () => {
    const { token, tenantId } = await login('iss@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    await push(token, [{ opId: opId(), entity: 'document', entityId: 'fx', op: 'delete', clientTs: 9000 }]);
    const r = await push(token, [docOp(invoice('fx', 7, { updatedAt: 100 }))]);
    expect(r.json.accepted).toHaveLength(1);
    expect((await call('GET', '/v1/documents/fx', { token })).status).toBe(200);
    expect((await push(token, [{ opId: opId(), entity: 'document', entityId: 'fx', op: 'delete', clientTs: 9500 }])).json.conflicts[0].reason).toBe('locked_document');
  });

  it('audit: insieme append-only, convergente per qualunque ordine/duplicato', async () => {
    const mk = (i: number): SyncOp => ({ opId: opId(), entity: 'audit', entityId: `a${i}`, op: 'upsert', clientTs: 10 + i,
      payload: { id: `a${i}`, at: 10 + i, docId: 'd', action: 'viewed', actor: 'user' } });
    const ops = Array.from({ length: 8 }, (_, i) => mk(i));
    const r = rng(5);
    const states: Record<string, string>[] = [];
    for (let k = 0; k < 4; k++) {
      freshEnv(); const { token } = await login('au@x.it');
      for (const b of deliveryPlan(r, ops)) await push(token, b);
      states.push(await serverState(token));
    }
    for (const s of states) { expect(s).toEqual(states[0]); expect(Object.keys(s)).toHaveLength(8); }
  });

  it('tetto ai tombstone per tenant (anti-abuso di spazio): oltre MAX_TOMBSTONES la delete è `invalid`', async () => {
    process.env.MAX_TOMBSTONES = '3';
    try {
      const { token } = await login('cap@x.it');
      const res = await push(token, Array.from({ length: 5 }, (_, i) => ({ opId: opId(), entity: 'catalog', entityId: `t${i}`, op: 'delete', clientTs: 50 + i }) as SyncOp));
      expect(res.json.accepted).toHaveLength(3);
      expect(res.json.conflicts.map((c: any) => c.reason)).toEqual(['invalid', 'invalid']);
    } finally { delete process.env.MAX_TOMBSTONES; }
  });
});
