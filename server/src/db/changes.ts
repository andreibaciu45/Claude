// Log delle modifiche per il sync: seq AUTOINCREMENT = cursore monotono crescente.
import { all, one, run } from './index';
import { now } from './clock';

export function appendChange(tenantId: string, opId: string, entity: string, entityId: string, op: 'upsert' | 'delete', payload: unknown): number {
  const r = run('INSERT INTO changes(tenant_id, op_id, entity, entity_id, op, payload, created_at) VALUES (?,?,?,?,?,?,?)',
    tenantId, opId, entity, entityId, op, payload === undefined || payload === null ? null : JSON.stringify(payload), now());
  return Number(r.lastInsertRowid);
}

export function currentCursor(tenantId: string): number {
  return one<{ m: number | null }>('SELECT MAX(seq) AS m FROM changes WHERE tenant_id=?', tenantId)?.m ?? 0;
}

export interface ChangeRow { seq: number; op_id: string; entity: string; entity_id: string; op: string; payload: string | null }

/** Solo l'ultima modifica per entità, con seq > cursor, ordinata. */
export function pullChanges(tenantId: string, cursor: number, limit: number): ChangeRow[] {
  return all<ChangeRow>(
    `SELECT c.seq, c.op_id, c.entity, c.entity_id, c.op, c.payload FROM changes c
     WHERE c.tenant_id = ? AND c.seq > ?
       AND c.seq = (SELECT MAX(c2.seq) FROM changes c2 WHERE c2.tenant_id = c.tenant_id AND c2.entity = c.entity AND c2.entity_id = c.entity_id)
     ORDER BY c.seq LIMIT ?`, tenantId, cursor, limit);
}
