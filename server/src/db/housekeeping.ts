// Pulizia periodica: dati scaduti che altrimenti crescerebbero all'infinito. Idempotente, sicura da chiamare spesso.
import { run } from './index';
import { now } from './clock';
import { purgeBackoff, purgeRateLimits } from './ratelimit';
import { pruneAudit } from './audit';
import { backfillChain } from './chain';

const DAY = 24 * 3600_000;
const BATCH = 2000;      // righe per istruzione: ogni DELETE resta breve (il DB e' condiviso con le richieste)
const MAX_BATCHES = 50;  // tetto per ciclo (100.000 righe); il resto al ciclo successivo
const envDays = (name: string, def: number) => { const n = Number(process.env[name]); return (Number.isFinite(n) && n > 0 ? n : def) * DAY; };

export function housekeeping(): Record<string, number> {
  const t = now();
  const out: Record<string, number> = {};
  // `sql` e' "DELETE FROM <tabella> WHERE <cond>": viene eseguito a blocchi di BATCH righe (via rowid) per non tenere il DB occupato a lungo.
  const del = (name: string, sql: string, ...p: number[]) => {
    try {
      const m = /^DELETE FROM (\w+) WHERE ([\s\S]+)$/.exec(sql);
      if (!m) { out[name] = Number(run(sql, ...p).changes); return; }
      const batched = `DELETE FROM ${m[1]} WHERE rowid IN (SELECT rowid FROM ${m[1]} WHERE ${m[2]} LIMIT ${BATCH})`;
      let total = 0;
      for (let i = 0; i < MAX_BATCHES; i++) {
        const n = Number(run(batched, ...p).changes);
        total += n;
        if (n < BATCH) break;
      }
      out[name] = total;
    } catch { out[name] = -1; /* tabella non presente: modulo non caricato */ }
  };
  del('sessions', 'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', t - 30 * DAY, t - 30 * DAY);
  del('otp_codes', 'DELETE FROM otp_codes WHERE created_at < ?', t - DAY);
  del('billing_events', 'DELETE FROM billing_events WHERE received_at < ?', t - 90 * DAY);
  del('sdi_jobs', "DELETE FROM sdi_jobs WHERE status = 'done' AND created_at < ?", t - 30 * DAY);
  del('sync_ops', 'DELETE FROM sync_ops WHERE applied_at < ?', t - 400 * DAY); // idempotenza: nessun client riprova dopo oltre un anno
  // Bozze/preventivi eliminati (tombstone senza contenuto) e voci di catalogo eliminate: servono solo a propagare la cancellazione agli altri
  // dispositivi; dopo il periodo di conservazione si eliminano (le fatture emesse non sono mai toccate: locked_at IS NULL + trigger).
  const tomb = t - envDays('TOMBSTONE_RETENTION_DAYS', 180);
  del('documents_tombstones', 'DELETE FROM documents WHERE deleted_at IS NOT NULL AND locked_at IS NULL AND deleted_at < ?', tomb);
  del('catalog_tombstones', 'DELETE FROM catalog_items WHERE deleted_at IS NOT NULL AND deleted_at < ?', tomb);
  del('sdi_jobs_dead', "DELETE FROM sdi_jobs WHERE status = 'dead' AND created_at < ?", t - 180 * DAY);
  del('ops_errors', 'DELETE FROM ops_errors WHERE at < ?', t - 90 * DAY);
  del('invite_codes', 'DELETE FROM invite_codes WHERE (used_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?) OR (used_at IS NOT NULL AND used_at < ?)', t - 90 * DAY, t - 400 * DAY);
  try { out.ops_daily = Number(run('DELETE FROM ops_daily WHERE day < ?', new Date(t - 400 * DAY).toISOString().slice(0, 10)).changes); } catch { out.ops_daily = -1; }
  del('otp_guard', 'DELETE FROM otp_guard WHERE updated_at < ? AND locked_until < ?', t - 2 * DAY, t);
  del('otp_trusted_ips', 'DELETE FROM otp_trusted_ips WHERE last_ok_at < ?', t - 30 * DAY);
  // Audit: le voci NON fiscali oltre AUDIT_RETENTION_DAYS (o oltre il tetto per tenant) vengono aggregate in audit_daily e potate; le fiscali mai.
  try { const a = pruneAudit(); out.audit_pruned_age = a.byAge; out.audit_pruned_cap = a.byCap; } catch { out.audit_pruned_age = -1; }
  // Catena fiscale: aggancia le fatture emesse non ancora presenti (emesse prima dell'introduzione della catena).
  try { out.fiscal_chain_backfilled = backfillChain(); } catch { out.fiscal_chain_backfilled = -1; }
  purgeRateLimits();
  purgeBackoff();
  return out;
}

/** Avvia la pulizia ogni ora (timer non bloccante). Ritorna la funzione di stop. */
export function startHousekeeping(everyMs = 3600_000): () => void {
  const tick = () => { try { housekeeping(); } catch { /* mai far cadere il processo */ } };
  tick();
  const h = setInterval(tick, everyMs);
  h.unref?.();
  return () => clearInterval(h);
}
