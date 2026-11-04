// Generatore di scenari e MODELLO DI RIFERIMENTO PURO per la convergenza del sync (LWW con tombstone). Nessun accesso al DB.
// Ordine totale delle versioni di una voce: (ts, delete > upsert, contenuto canonico maggiore). Lo stato atteso = massimo di tutte le op dell'insieme.
import type { SyncOp } from '../../../shared/api';
import { catalogItem, docOp, opId, quote, invoice } from './helpers';

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const int = (r: () => number, n: number) => Math.floor(r() * n);
export const shuffle = <T,>(r: () => number, a: T[]): T[] => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = int(r, i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** JSON canonico (chiavi ordinate a ogni livello). */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x);

export interface DevOp { op: SyncOp; device: number }

/** Operazioni upsert/delete su 3 dispositivi per catalogo, profilo e bozze. I timestamp collidono apposta (tie-break) e anche i contenuti. */
export function genOps(seed: number, opts: { n?: number; kinds?: ('catalog' | 'profile' | 'document')[] } = {}): DevOp[] {
  const r = rng(seed);
  const kinds = opts.kinds ?? ['catalog', 'profile', 'document'];
  const n = (opts.n ?? 14) + int(r, 12);
  const out: DevOp[] = [];
  for (let i = 0; i < n; i++) {
    const ts = 1000 + int(r, 22);
    const device = int(r, 3);
    const kind = kinds[int(r, kinds.length)]!;
    const del = r() < 0.35;
    const v = int(r, 3); // contenuti spesso uguali a parità di ts
    if (kind === 'catalog') {
      const id = `c${int(r, 3)}`;
      out.push({ device, op: del ? { opId: opId(), entity: 'catalog', entityId: id, op: 'delete', clientTs: ts }
        : { opId: opId(), entity: 'catalog', entityId: id, op: 'upsert', payload: catalogItem(id, { name: `Voce ${v}`, price: v, updatedAt: ts }), clientTs: ts } });
    } else if (kind === 'profile') {
      out.push({ device, op: { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: { businessName: `Ditta ${v}`, vatNumber: `${v}` } as never, clientTs: ts } });
    } else {
      const k = int(r, 3);
      const id = k === 2 ? 'f0' : `q${k}`; // q0,q1 preventivi; f0 fattura in bozza (tipo costante per id)
      out.push({ device, op: del ? { opId: opId(), entity: 'document', entityId: id, op: 'delete', clientTs: ts }
        : docOp(k === 2 ? invoice(id, 1, { notes: `nota ${v}`, updatedAt: ts }, false) : quote(id, { notes: `nota ${v}`, updatedAt: ts }), { clientTs: ts }) });
    }
  }
  // Re-invii come operazione NUOVA (altro opId, altro dispositivo) con lo stesso contenuto: la versione e' la stessa, deve essere un no-op.
  for (const d of [...out]) if (r() < 0.2) out.push({ device: int(r, 3), op: { ...d.op, opId: opId() } });
  return out;
}

/** Stato atteso per chiave `entity:id` = payload canonico (voci vive); le cancellate sono assenti. */
export function modelState(ops: SyncOp[]): Record<string, string> {
  type V = { ts: number; del: boolean; key: string };
  const cmp = (a: V, b: V) => a.ts !== b.ts ? a.ts - b.ts : a.del !== b.del ? (a.del ? 1 : -1) : a.key === b.key ? 0 : a.key < b.key ? -1 : 1;
  const best = new Map<string, V>();
  for (const o of ops) {
    const v: V = o.op === 'delete' ? { ts: o.clientTs, del: true, key: '' }
      : { ts: o.clientTs, del: false, key: canon(o.payload) };
    const k = `${o.entity}:${o.entityId}`;
    const cur = best.get(k);
    if (!cur || cmp(v, cur) > 0) best.set(k, v);
  }
  const res: Record<string, string> = {};
  for (const [k, v] of [...best.entries()].sort(([a], [b]) => a.localeCompare(b))) if (!v.del) res[k] = v.key;
  return res;
}

/** Consegna: ordine casuale, duplicati (retry, anche in ritardo) e lotti di dimensione casuale. */
export function deliveryPlan(r: () => number, ops: SyncOp[]): SyncOp[][] {
  const order = shuffle(r, ops);
  const stream: SyncOp[] = [];
  for (const o of order) { stream.push(o); }
  for (const o of ops) for (let c = int(r, 3); c > 0; c--) stream.splice(int(r, stream.length + 1), 0, o); // duplicati ovunque
  const batches: SyncOp[][] = [];
  for (let i = 0; i < stream.length;) { const size = 1 + int(r, 5); batches.push(stream.slice(i, i + size)); i += size; }
  return batches;
}
