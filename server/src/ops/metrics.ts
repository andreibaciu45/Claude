// Metriche in formato testo Prometheus. REGOLA: nessun dato personale. Le etichette sono SOLO costanti del codice
// (pattern di rotta come '/v1/documents/:id', metodo, classe/codice di stato, motivo di conflitto): mai email, token, OTP, IP, id di tenant/utente/documento.
// I contatori sono in memoria (si azzerano al riavvio: Prometheus gestisce i reset); i gauge di stato si leggono dal DB al momento dello scrape.
import { statSync } from 'node:fs';
import { all, one } from '../db';
import { now } from '../db/clock';
import { effectivePlan } from '../db/entitlements';
import { bumpDaily, activeUsers, lastHousekeepingAt, pragmaNum } from './stats';
import { backupAgeSeconds } from './health';

type Labels = Record<string, string>;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const key = (l: Labels): string => Object.keys(l).sort().map((k) => `${k}="${esc(l[k]!)}"`).join(',');

const counters = new Map<string, { help: string; values: Map<string, number> }>();
const histograms = new Map<string, { help: string; buckets: number[]; values: Map<string, { counts: number[]; sum: number; count: number }> }>();

export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function defineCounter(name: string, help: string): void {
  if (!counters.has(name)) counters.set(name, { help, values: new Map() });
}
export function inc(name: string, labels: Labels = {}, by = 1): void {
  const c = counters.get(name);
  if (!c) return;
  const k = key(labels);
  c.values.set(k, (c.values.get(k) ?? 0) + by);
}
function observe(name: string, labels: Labels, v: number): void {
  const h = histograms.get(name);
  if (!h) return;
  const k = key(labels);
  let e = h.values.get(k);
  if (!e) { e = { counts: new Array(h.buckets.length).fill(0), sum: 0, count: 0 }; h.values.set(k, e); }
  h.buckets.forEach((b, i) => { if (v <= b) e!.counts[i]++; });
  e.sum += v; e.count++;
}

defineCounter('vp_http_requests_total', 'Richieste HTTP per rotta, metodo e stato');
histograms.set('vp_http_request_duration_seconds', { help: 'Latenza delle richieste HTTP per rotta', buckets: LATENCY_BUCKETS, values: new Map() });
defineCounter('vp_errors_total', 'Errori interni (5xx non gestiti) per tipo');
defineCounter('vp_sync_push_requests_total', 'Richieste di push del sync');
defineCounter('vp_sync_push_ops_total', 'Operazioni di sync ricevute per esito (accepted|conflict)');
defineCounter('vp_sync_conflicts_total', 'Conflitti di sync per motivo');
defineCounter('vp_sync_pull_requests_total', 'Richieste di pull del sync');
defineCounter('vp_sync_pull_ops_total', 'Operazioni restituite dal pull');
defineCounter('vp_quota_exceeded_total', 'Rifiuti per quota Free esaurita');
defineCounter('vp_sdi_jobs_processed_total', 'Job SDI elaborati per esito (done|retried|dead)');
defineCounter('vp_signups_total', 'Nuovi account creati');
defineCounter('vp_logins_total', 'Accessi riusciti (OTP verificato)');
defineCounter('vp_otp_requests_total', 'Codici di accesso richiesti');
defineCounter('vp_otp_verify_failed_total', 'Verifiche OTP sbagliate');
defineCounter('vp_otp_locked_total', 'Verifiche OTP respinte dal cooldown globale per email');
defineCounter('vp_otp_cooldowns_total', 'Cooldown globali per email attivati');
defineCounter('vp_otp_alerts_total', 'Avvisi «tentativi di accesso» inviati ai proprietari');
defineCounter('vp_rate_limited_total', 'Richieste respinte con 429');

/** Registra una richiesta HTTP completata. `route` = pattern registrato (mai il path reale). */
export function recordHttp(route: string, method: string, status: number, seconds: number): void {
  inc('vp_http_requests_total', { route, method, status: String(status) });
  observe('vp_http_request_duration_seconds', { route }, seconds);
  if (status === 429) inc('vp_rate_limited_total', { route });
}

export function recordSyncPush(accepted: number, conflicts: { reason: string }[]): void {
  inc('vp_sync_push_requests_total');
  if (accepted) inc('vp_sync_push_ops_total', { result: 'accepted' }, accepted);
  if (conflicts.length) inc('vp_sync_push_ops_total', { result: 'conflict' }, conflicts.length);
  for (const c of conflicts) {
    inc('vp_sync_conflicts_total', { reason: c.reason });
    if (c.reason === 'quota_exceeded') inc('vp_quota_exceeded_total');
    safe(() => bumpDaily(`sync_conflict:${c.reason}`));
  }
}
export function recordSyncPull(ops: number): void { inc('vp_sync_pull_requests_total'); inc('vp_sync_pull_ops_total', {}, ops); }

const safe = (fn: () => void) => { try { fn(); } catch { /* le metriche non devono mai far fallire la richiesta */ } };

// ---- rendering ----
const line = (name: string, labels: Labels | string, v: number) => {
  const l = typeof labels === 'string' ? labels : key(labels);
  return `${name}${l ? `{${l}}` : ''} ${Number.isFinite(v) ? v : 0}`;
};

export function renderMetrics(): string {
  const out: string[] = [];
  const head = (name: string, help: string, type: string) => { out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); };
  for (const [name, c] of counters) {
    head(name, c.help, 'counter');
    if (c.values.size === 0) out.push(line(name, '', 0));
    for (const [k, v] of c.values) out.push(line(name, k, v));
  }
  for (const [name, h] of histograms) {
    head(name, h.help, 'histogram');
    for (const [k, e] of h.values) {
      const pre = k ? `${k},` : '';
      h.buckets.forEach((b, i) => out.push(line(`${name}_bucket`, `${pre}le="${b}"`, e.counts[i]!)));
      out.push(line(`${name}_bucket`, `${pre}le="+Inf"`, e.count), line(`${name}_sum`, k, e.sum), line(`${name}_count`, k, e.count));
    }
  }
  const gauge = (name: string, help: string, rows: [Labels | string, number][]) => { head(name, help, 'gauge'); for (const [l, v] of rows) out.push(line(name, l, v)); };

  // Stato dal DB (aggregati: nessun identificativo). Un errore di lettura non deve rompere lo scrape.
  let dbOk = 1;
  try {
    const t = now();
    const tenants = one<{ n: number }>("SELECT COUNT(*) AS n FROM tenants WHERE status='active'")?.n ?? 0;
    const users = one<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
    gauge('vp_tenants', 'Tenant attivi', [['', tenants]]);
    gauge('vp_users', 'Utenti registrati', [['', users]]);
    gauge('vp_active_users', 'Utenti con attivita\' negli ultimi N giorni', [[{ window: '1d' }, activeUsers(1)], [{ window: '7d' }, activeUsers(7)], [{ window: '30d' }, activeUsers(30)]]);
    const plans = { free: 0, pro: 0 };
    for (const r of all<{ plan: string; status: string; current_period_end: number | null; grace_until: number | null }>(
      "SELECT e.plan, e.status, e.current_period_end, e.grace_until FROM entitlements e JOIN tenants t ON t.id=e.tenant_id WHERE t.status='active'")) {
      plans[effectivePlan({ plan: r.plan === 'pro' ? 'pro' : 'free', status: r.status, currentPeriodEnd: r.current_period_end, graceUntil: r.grace_until }, t)]++;
    }
    const manual = one<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT tenant_id, MAX(id) AS id FROM admin_actions WHERE action IN ('grant_pro','revoke_pro') GROUP BY tenant_id) l
      JOIN admin_actions a ON a.id=l.id WHERE a.action='grant_pro' AND a.until_at > ?`, t)?.n ?? 0;
    gauge('vp_tenants_by_stripe_plan', 'Tenant per piano da stato Stripe (senza concessioni manuali)', [[{ plan: 'free' }, plans.free], [{ plan: 'pro' }, plans.pro]]);
    gauge('vp_manual_grants_active', 'Licenze Pro concesse a mano e non scadute', [['', manual]]);
    const month = new Date(t).toISOString().slice(0, 7);
    gauge('vp_documents_created_month', 'Documenti creati nel mese corrente (somma dei consumi)', [['', one<{ n: number | null }>('SELECT SUM(docs_created) AS n FROM usage WHERE month=?', month)?.n ?? 0]]);
    gauge('vp_invoices_issued', 'Fatture emesse totali (bloccate)', [['', one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL')?.n ?? 0]]);
    const sdi = { queued: 0, running: 0, done: 0, dead: 0 } as Record<string, number>;
    try { for (const r of all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM sdi_jobs GROUP BY status')) sdi[r.status] = r.n; } catch { /* modulo SDI non caricato */ }
    gauge('vp_sdi_jobs', 'Job SDI in coda per stato', Object.entries(sdi).map(([status, n]) => [{ status }, n] as [Labels, number]));
    const pages = pragmaNum('page_count'), psize = pragmaNum('page_size'), free = pragmaNum('freelist_count');
    gauge('vp_db_size_bytes', 'Dimensione del database', [['', pages * psize]]);
    gauge('vp_db_free_bytes', 'Spazio libero riutilizzabile nel database', [['', free * psize]]);
    const wal = (() => { try { return process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? statSync(`${process.env.DB_PATH}-wal`).size : 0; } catch { return 0; } })();
    gauge('vp_db_wal_bytes', 'Dimensione del file WAL', [['', wal]]);
    const hk = lastHousekeepingAt();
    gauge('vp_last_housekeeping_timestamp_seconds', 'Ultima pulizia periodica (0 = mai)', [['', hk ? Math.floor(hk / 1000) : 0]]);
    const bk = backupAgeSeconds();
    if (bk !== null) gauge('vp_last_backup_age_seconds', 'Eta\' dell\'ultimo backup noto (BACKUP_DIR)', [['', Math.floor(bk)]]);
  } catch {
    dbOk = 0;
  }
  gauge('vp_db_up', '1 se il database risponde', [['', dbOk]]);
  const mem = process.memoryUsage();
  gauge('vp_process_resident_memory_bytes', 'Memoria residente del processo', [['', mem.rss]]);
  gauge('vp_process_heap_used_bytes', 'Heap usato', [['', mem.heapUsed]]);
  gauge('vp_process_uptime_seconds', 'Secondi dall\'avvio del processo', [['', Math.floor(process.uptime())]]);
  gauge('vp_build_info', 'Versione di Node', [[{ node: process.version }, 1]]);
  return out.join('\n') + '\n';
}

/** Solo test. */
export function resetMetrics(): void {
  for (const c of counters.values()) c.values.clear();
  for (const h of histograms.values()) h.values.clear();
}
