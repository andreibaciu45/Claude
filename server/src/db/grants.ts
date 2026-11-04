// Licenze Pro concesse a mano dall'operatore (CLI `scripts/admin.ts`), tracciate nel registro append-only `admin_actions`.
//
// PRECEDENZA (documentata anche in docs/OPERAZIONI.md): le due fonti sono INDIPENDENTI e il piano effettivo e' il MASSIMO delle due.
//   - Pro se lo stato Stripe (tabella `entitlements`, vedi effectivePlan) e' Pro, OPPURE se esiste una concessione manuale non scaduta.
//   - Gli eventi Stripe scrivono solo `entitlements`/`billing_subscriptions`: non toccano mai `admin_actions` (una concessione manuale non viene sovrascritta).
//   - Concedere/revocare a mano scrive solo `admin_actions`: non tocca mai `entitlements` (lo stato Stripe non viene sovrascritto).
//   - `revoke-pro` toglie SOLO la concessione manuale: un abbonamento Stripe attivo resta Pro.
//   - La concessione scade da sola alla data indicata (nessun job): `until_at` e' il primo istante NON piu' coperto.
import { one, run } from './index';
import { now } from './clock';

export const MAX_GRANT_DAYS = 3650;

/** Fine (ms, esclusa) della concessione manuale attiva a `ts`, oppure null. Vale l'ULTIMA riga grant/revoke del tenant. */
export function manualGrantUntil(tenantId: string, ts: number = now()): number | null {
  const r = one<{ action: string; until_at: number | null }>(
    "SELECT action, until_at FROM admin_actions WHERE tenant_id=? AND action IN ('grant_pro','revoke_pro') ORDER BY id DESC LIMIT 1", tenantId);
  if (!r || r.action !== 'grant_pro' || r.until_at === null || r.until_at <= ts) return null;
  return r.until_at;
}

export function logAdminAction(action: string, opts: { tenantId?: string | null; untilAt?: number | null; note?: string | null; actor?: string } = {}): number {
  const r = run('INSERT INTO admin_actions(at, actor, action, tenant_id, until_at, note) VALUES (?,?,?,?,?,?)',
    now(), opts.actor ?? 'cli', action, opts.tenantId ?? null, opts.untilAt ?? null, opts.note ? opts.note.slice(0, 500) : null);
  return Number(r.lastInsertRowid);
}

export const grantPro = (tenantId: string, untilAt: number, note?: string, actor?: string): number =>
  logAdminAction('grant_pro', { tenantId, untilAt, note, actor });
export const revokePro = (tenantId: string, note?: string, actor?: string): number =>
  logAdminAction('revoke_pro', { tenantId, note, actor });

export interface AdminActionRow { id: number; at: number; actor: string; action: string; tenant_id: string | null; until_at: number | null; note: string | null }
