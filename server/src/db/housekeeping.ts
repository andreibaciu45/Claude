// Pulizia periodica: dati scaduti che altrimenti crescerebbero all'infinito. Idempotente, sicura da chiamare spesso.
import { run } from './index';
import { now } from './clock';
import { purgeBackoff, purgeRateLimits } from './ratelimit';

const DAY = 24 * 3600_000;

export function housekeeping(): Record<string, number> {
  const t = now();
  const out: Record<string, number> = {};
  const del = (name: string, sql: string, ...p: number[]) => {
    try { out[name] = Number(run(sql, ...p).changes); } catch { out[name] = -1; /* tabella non presente: modulo non caricato */ }
  };
  del('sessions', 'DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', t - 30 * DAY, t - 30 * DAY);
  del('otp_codes', 'DELETE FROM otp_codes WHERE created_at < ?', t - DAY);
  del('billing_events', 'DELETE FROM billing_events WHERE received_at < ?', t - 90 * DAY);
  del('sdi_jobs', "DELETE FROM sdi_jobs WHERE status = 'done' AND created_at < ?", t - 30 * DAY);
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
