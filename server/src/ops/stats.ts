// Statistiche operative aggregate (nessun dato personale): usate da /metrics, da /health/deep e dal comando `stats` della CLI.
import { all, one, run } from '../db';
import { now } from '../db/clock';

const DAY = 86_400_000;
export const dayKey = (ts: number = now()): string => new Date(ts).toISOString().slice(0, 10);

/** Valore di un PRAGMA numerico (es. page_count). */
export const pragmaNum = (name: string): number => Number(Object.values(one<Record<string, number>>(`PRAGMA ${name}`) ?? { x: 0 })[0] ?? 0);

export function getState(key: string): string | undefined {
  return one<{ value: string }>('SELECT value FROM ops_state WHERE key=?', key)?.value;
}
export function setState(key: string, value: string): void {
  run('INSERT INTO ops_state(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, value, now());
}
export const lastHousekeepingAt = (): number | null => { const v = getState('last_housekeeping_at'); return v ? Number(v) : null; };

/** Contatore giornaliero persistente (conflitti per motivo, errori). `metric` e' sempre una costante del codice. */
export function bumpDaily(metric: string, by = 1): void {
  run('INSERT INTO ops_daily(day, metric, value) VALUES (?,?,?) ON CONFLICT(day, metric) DO UPDATE SET value = value + excluded.value', dayKey(), metric, by);
}

/** Errore interno: solo tipo, rotta (pattern) e nome dell'errore. Mai messaggio, body o utente. Non lancia mai. */
export function recordError(kind: string, route: string | null, name: string | null): void {
  try {
    run('INSERT INTO ops_errors(at, kind, route, name) VALUES (?,?,?,?)', now(), kind, route, name ? name.slice(0, 60) : null);
    bumpDaily(`error:${kind}`);
  } catch { /* se il DB e' proprio il problema, non peggioriamo le cose */ }
}

/** Utenti con attivita' negli ultimi `days` giorni (ultimo accesso o sessione vista di recente). */
export function activeUsers(days: number, ts: number = now()): number {
  const cut = ts - days * DAY;
  return one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users u WHERE u.last_login_at >= ? OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.last_seen_at >= ?)`, cut, cut)?.n ?? 0;
}

const sumDaily = (prefix: string, days: number): Record<string, number> => {
  const from = dayKey(now() - (days - 1) * DAY);
  const out: Record<string, number> = {};
  for (const r of all<{ metric: string; v: number }>('SELECT metric, SUM(value) AS v FROM ops_daily WHERE day >= ? AND metric LIKE ? GROUP BY metric', from, `${prefix}%`)) out[r.metric.slice(prefix.length)] = r.v;
  return out;
};

export interface StatsReport {
  generatedAt: string;
  tenants: { active: number; deleted: number };
  users: { total: number; active7d: number; active30d: number; newLast7d: number; newLast30d: number };
  plans: { proStripe: number; proManual: number; free: number };
  documents: { total: number; createdThisMonth: number; drafts: number; quotes: number };
  invoices: { issued: number; issuedLast30d: number; rejected: number };
  syncConflicts: { last7d: Record<string, number>; last30d: Record<string, number> };
  sdiJobs: Record<string, number>;
  errors: { last24h: number; last7d: number; recent: { at: string; kind: string; route: string | null; name: string | null }[] };
  db: { sizeBytes: number; freeBytes: number };
}

export function collectStats(): StatsReport {
  const t = now();
  const n = (sql: string, ...p: number[]) => one<{ n: number }>(sql, ...p)?.n ?? 0;
  const month = new Date(t).toISOString().slice(0, 7);
  const sdi: Record<string, number> = {};
  try { for (const r of all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM sdi_jobs GROUP BY status')) sdi[r.status] = r.n; } catch { /* modulo SDI non caricato */ }
  const proStripe = n("SELECT COUNT(*) AS n FROM entitlements e JOIN tenants t ON t.id=e.tenant_id WHERE t.status='active' AND e.plan='pro' AND e.status IN ('active','trialing') AND (e.current_period_end IS NULL OR e.current_period_end > ?)", t);
  const proManual = n(`SELECT COUNT(*) AS n FROM (SELECT MAX(id) AS id FROM admin_actions WHERE action IN ('grant_pro','revoke_pro') AND tenant_id IS NOT NULL GROUP BY tenant_id) l
    JOIN admin_actions a ON a.id=l.id WHERE a.action='grant_pro' AND a.until_at > ?`, t);
  const tenantsActive = n("SELECT COUNT(*) AS n FROM tenants WHERE status='active'");
  const pageSize = pragmaNum('page_size');
  return {
    generatedAt: new Date(t).toISOString(),
    tenants: { active: tenantsActive, deleted: n("SELECT COUNT(*) AS n FROM tenants WHERE status<>'active'") },
    users: { total: n('SELECT COUNT(*) AS n FROM users'), active7d: activeUsers(7), active30d: activeUsers(30),
      newLast7d: n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t - 7 * DAY), newLast30d: n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', t - 30 * DAY) },
    plans: { proStripe, proManual, free: Math.max(0, tenantsActive - proStripe - proManual) },
    documents: {
      total: n('SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL'),
      createdThisMonth: one<{ n: number | null }>('SELECT SUM(docs_created) AS n FROM usage WHERE month=?', month)?.n ?? 0,
      drafts: n("SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL AND type='fattura' AND locked_at IS NULL"),
      quotes: n("SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL AND type='preventivo'"),
    },
    invoices: {
      issued: n('SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL'),
      issuedLast30d: n('SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL AND locked_at >= ?', t - 30 * DAY),
      rejected: n("SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL AND status='scartata'"),
    },
    syncConflicts: { last7d: sumDaily('sync_conflict:', 7), last30d: sumDaily('sync_conflict:', 30) },
    sdiJobs: sdi,
    errors: {
      last24h: n('SELECT COUNT(*) AS n FROM ops_errors WHERE at >= ?', t - DAY),
      last7d: n('SELECT COUNT(*) AS n FROM ops_errors WHERE at >= ?', t - 7 * DAY),
      recent: all<{ at: number; kind: string; route: string | null; name: string | null }>('SELECT at, kind, route, name FROM ops_errors ORDER BY id DESC LIMIT 10')
        .map((r) => ({ at: new Date(r.at).toISOString(), kind: r.kind, route: r.route, name: r.name })),
    },
    db: { sizeBytes: pragmaNum('page_count') * pageSize, freeBytes: pragmaNum('freelist_count') * pageSize },
  };
}
