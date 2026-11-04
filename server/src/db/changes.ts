// Log delle modifiche per il sync: seq AUTOINCREMENT = cursore monotono crescente.
// - Il payload è cifrato (blob intero, IV casuale) se APP_ENCRYPTION_KEY è impostata; i chiamanti passano SEMPRE il payload in chiaro.
// - Compattazione: scrivendo una nuova modifica per un'entità si eliminano le precedenti. Il pull restituisce comunque solo l'ultima
//   modifica per entità, quindi nulla di osservabile cambia, ma il log non cresce a ogni salvataggio (abuso di spazio / copie vecchie dei dati).
import { all, one, run } from './index';
import { now } from './clock';
import { aadChange, open, sealJson } from './seal';

export function appendChange(tenantId: string, opId: string, entity: string, entityId: string, op: 'upsert' | 'delete', payload: unknown): number {
  const body = payload === undefined || payload === null ? null : sealJson(payload, aadChange(tenantId, entity, entityId));
  const r = run('INSERT INTO changes(tenant_id, op_id, entity, entity_id, op, payload, created_at) VALUES (?,?,?,?,?,?,?)',
    tenantId, opId, entity, entityId, op, body, now());
  const seq = Number(r.lastInsertRowid);
  run('DELETE FROM changes WHERE tenant_id=? AND entity=? AND entity_id=? AND seq < ?', tenantId, entity, entityId, seq);
  return seq;
}

export function currentCursor(tenantId: string): number {
  return one<{ m: number | null }>('SELECT MAX(seq) AS m FROM changes WHERE tenant_id=?', tenantId)?.m ?? 0;
}

export interface ChangeRow { seq: number; op_id: string; entity: string; entity_id: string; op: string; payload: string | null }

const LATEST = `c.seq = (SELECT MAX(c2.seq) FROM changes c2 WHERE c2.tenant_id = c.tenant_id AND c2.entity = c.entity AND c2.entity_id = c.entity_id)`;

/** Solo l'ultima modifica per entità, con seq > cursor, ordinata. Il payload è restituito in chiaro (già decifrato). */
export function pullChanges(tenantId: string, cursor: number, limit: number): ChangeRow[] {
  return all<ChangeRow>(
    `SELECT c.seq, c.op_id, c.entity, c.entity_id, c.op, c.payload FROM changes c
     WHERE c.tenant_id = ? AND c.seq > ? AND ${LATEST}
     ORDER BY c.seq LIMIT ?`, tenantId, cursor, limit).map((r) => openRow(tenantId, r));
}

/** Pagina con tetto di byte: evita risposte enormi (e picchi di memoria) quando le entità sono grosse. Almeno una riga per pagina. */
export function pullPage(tenantId: string, cursor: number, limit: number, maxBytes = Number(process.env.SYNC_PULL_MAX_BYTES) || 4_000_000): { rows: ChangeRow[]; hasMore: boolean } {
  const sizes = all<{ seq: number; n: number }>(
    `SELECT c.seq, COALESCE(length(c.payload), 0) AS n FROM changes c
     WHERE c.tenant_id = ? AND c.seq > ? AND ${LATEST} ORDER BY c.seq LIMIT ?`, tenantId, cursor, limit + 1);
  let total = 0;
  const take: number[] = [];
  for (const s of sizes.slice(0, limit)) {
    if (take.length > 0 && total + s.n > maxBytes) break;
    total += s.n;
    take.push(s.seq);
  }
  const hasMore = sizes.length > take.length;
  if (take.length === 0) return { rows: [], hasMore: false };
  const rows = all<ChangeRow>(
    `SELECT c.seq, c.op_id, c.entity, c.entity_id, c.op, c.payload FROM changes c
     WHERE c.tenant_id = ? AND c.seq >= ? AND c.seq <= ? AND ${LATEST} ORDER BY c.seq`, tenantId, take[0], take[take.length - 1])
    .map((r) => openRow(tenantId, r));
  return { rows, hasMore };
}

const openRow = (tenantId: string, r: ChangeRow): ChangeRow =>
  r.payload === null ? r : { ...r, payload: open(r.payload, aadChange(tenantId, r.entity, r.entity_id)) };
