import { run } from './index';
import { now } from './clock';

/** Appende al registro audit (append-only per trigger). Mai contenuto dei documenti: solo ID e codici. */
export function audit(
  tenantId: string, userId: string | null, action: string,
  entity?: string, entityId?: string, payload?: unknown, refId?: string,
): void {
  run(
    'INSERT OR IGNORE INTO audit_log(tenant_id, user_id, at, action, entity, entity_id, ref_id, payload) VALUES (?,?,?,?,?,?,?,?)',
    tenantId, userId, now(), action, entity ?? null, entityId ?? null, refId ?? null,
    payload === undefined ? null : JSON.stringify(payload),
  );
}
