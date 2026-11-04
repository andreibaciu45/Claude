// Registro audit con politica di conservazione (docs/OPERAZIONI.md §Audit, server/README.md).
//
//  - Append-only per trigger: UPDATE sempre vietato; DELETE solo per la potatura autorizzata (vedi `pruneAudit`).
//  - Ogni voce ha una classe (`retain`): 1 = FISCALE (si conserva per obbligo, mai potata), 0 = NON fiscale (aggregabile e potabile).
//      fiscale   : voci legate a una fattura EMESSA (sync.document.* e client.* con docId di un documento bloccato, con un tetto per documento),
//                  sdi_event, legal.accept (prova del consenso), account.delete/export (accountability GDPR);
//      non fiscale: voice_command, bozze e preventivi, catalogo, profilo, accessi (auth.*), voci del client non collegate a una fattura emessa.
//  - Voci non fiscali: dopo AUDIT_RETENTION_DAYS (default 365) vengono AGGREGATE in `audit_daily` (tenant, giorno, azione, conteggio) e cancellate;
//    in piu' un tetto per tenant (AUDIT_MAX_ROWS_PER_TENANT, default 50.000) elimina le piu' vecchie in eccesso.
//  - Mai contenuto dei documenti: solo ID e codici.
import { all, one, run, transaction } from './index';
import { now } from './clock';

const DAY = 24 * 3600_000;
const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
export const auditRetentionDays = (): number => envNum('AUDIT_RETENTION_DAYS', 365);
export const auditMaxRowsPerTenant = (): number => envNum('AUDIT_MAX_ROWS_PER_TENANT', 50_000);
/** Voci fiscali per singolo documento: oltre, le nuove diventano non fiscali (altrimenti basterebbe spammare voci su una fattura per riempire il disco senza possibilita' di potatura). */
export const auditMaxFiscalPerDoc = (): number => envNum('AUDIT_MAX_FISCAL_PER_DOC', 200);

const ALWAYS_FISCAL = new Set(['sdi_event', 'legal.accept', 'account.delete', 'account.export']);

/** Classe della voce: 1 = fiscale (da conservare), 0 = non fiscale. `docId` = documento a cui la voce si riferisce, se c'e'. */
export function auditClass(tenantId: string, action: string, docId?: string | null): 0 | 1 {
  if (ALWAYS_FISCAL.has(action)) return 1;
  if (!docId || !(action.startsWith('sync.document.') || action.startsWith('client.'))) return 0;
  if (!one('SELECT 1 AS x FROM documents WHERE tenant_id=? AND id=? AND locked_at IS NOT NULL', tenantId, docId)) return 0;
  const n = one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id=? AND entity_id=? AND retain=1', tenantId, docId)?.n ?? 0;
  return n < auditMaxFiscalPerDoc() ? 1 : 0;
}

/** Appende al registro audit (append-only per trigger). Mai contenuto dei documenti: solo ID e codici. */
export function audit(
  tenantId: string, userId: string | null, action: string,
  entity?: string, entityId?: string, payload?: unknown, refId?: string,
): void {
  const t = now();
  run(
    'INSERT OR IGNORE INTO audit_log(tenant_id, user_id, at, action, entity, entity_id, ref_id, payload, retain, recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    tenantId, userId, t, action, entity ?? null, entityId ?? null, refId ?? null,
    payload === undefined ? null : JSON.stringify(payload),
    auditClass(tenantId, action, entity === 'document' ? entityId : null), t,
  );
}

export interface AuditPruneReport { byAge: number; byCap: number; aggregated: number }
const BATCH = 2000;
const MAX_BATCHES = 50;

/** Aggrega in audit_daily e cancella le voci NON fiscali scelte da `where` (sempre con retain=0). Una transazione per blocco; il permesso di cancellare vive solo li' dentro. */
function pruneWhere(where: string, ceiling: number, ...params: (string | number)[]): number {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = transaction(() => {
      const maxId = one<{ m: number | null }>(`SELECT MAX(id) AS m FROM (SELECT id FROM audit_log WHERE retain=0 AND ${where} ORDER BY id LIMIT ${BATCH})`, ...params)?.m;
      if (maxId === null || maxId === undefined) return 0;
      const sel = `retain=0 AND ${where} AND id<=${maxId}`;
      run(`INSERT INTO audit_daily(tenant_id, day, action, n)
           SELECT tenant_id, strftime('%Y-%m-%d', recorded_at/1000, 'unixepoch'), action, COUNT(*) FROM audit_log WHERE ${sel} GROUP BY 1,2,3
           ON CONFLICT(tenant_id, day, action) DO UPDATE SET n = n + excluded.n`, ...params);
      run('INSERT OR REPLACE INTO audit_prune_ctl(id, cutoff_at) VALUES (1, ?)', ceiling);
      const r = run(`DELETE FROM audit_log WHERE ${sel}`, ...params);
      run('DELETE FROM audit_prune_ctl WHERE id=1');
      return Number(r.changes);
    });
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

/**
 * Potatura delle voci NON fiscali: (1) piu' vecchie di AUDIT_RETENTION_DAYS (orologio del server), (2) oltre il tetto per tenant
 * (le piu' vecchie in eccesso). Idempotente. Le voci fiscali (retain=1) non sono mai selezionate e comunque il trigger SQL le protegge.
 */
export function pruneAudit(): AuditPruneReport {
  const t = now();
  const cutoff = t - auditRetentionDays() * DAY;
  const before = one<{ n: number }>('SELECT COALESCE(SUM(n),0) AS n FROM audit_daily')?.n ?? 0;
  const byAge = pruneWhere('recorded_at < ?', cutoff, cutoff);
  let byCap = 0;
  const max = auditMaxRowsPerTenant();
  for (const r of all<{ tenant_id: string; n: number }>('SELECT tenant_id, COUNT(*) AS n FROM audit_log WHERE retain=0 GROUP BY tenant_id HAVING n > ?', max)) {
    // Soglia = id della (max+1)-esima voce piu' recente non fiscale: tutto cio' che e' <= e' in eccesso.
    const edge = one<{ id: number }>('SELECT id FROM audit_log WHERE tenant_id=? AND retain=0 ORDER BY id DESC LIMIT 1 OFFSET ?', r.tenant_id, max)?.id;
    if (edge !== undefined) byCap += pruneWhere('tenant_id=? AND id<=?', t + 1, r.tenant_id, edge);
  }
  const after = one<{ n: number }>('SELECT COALESCE(SUM(n),0) AS n FROM audit_daily')?.n ?? 0;
  return { byAge, byCap, aggregated: after - before };
}
