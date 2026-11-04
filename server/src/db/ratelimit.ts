// Rate-limit a finestra fissa con DUE implementazioni dietro la stessa interfaccia `RateLimitStore`:
//   - DbRateLimitStore     : persistita nella tabella `rate_limits` (sopravvive ai riavvii, condivisa tra processi sullo stesso DB).
//                            Usata per tutto ciò che è sicurezza/costo (OTP, voce, export).
//   - MemoryRateLimitStore : per processo, nessuna scrittura su disco. Usata di default per il limite generale delle API
//                            (percorso caldo). Si azzera al riavvio e NON è condivisa tra più processi.
// Scelta del limite generale: env RATE_LIMIT_STORE = memory (default) | db.
import { one, registerResetHook, run } from './index';
import { now } from './clock';

export interface RateLimitResult { ok: boolean; limit: number; remaining: number; retryAfterSec: number; resetAt: number }
export interface RateLimitStore {
  /** Conta una richiesta sulla chiave. `ok=false` se il limite della finestra è già stato raggiunto (la richiesta NON viene contata). */
  hit(key: string, limit: number, windowMs: number, cost?: number): RateLimitResult;
  /** Come hit ma senza contare (per controllare un budget prima di un'azione). */
  peek(key: string, limit: number, windowMs: number): RateLimitResult;
  reset?(key?: string): void;
}

const result = (ok: boolean, limit: number, count: number, windowStart: number, windowMs: number, t: number): RateLimitResult => ({
  ok, limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs,
  retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((windowStart + windowMs - t) / 1000)),
});

export class DbRateLimitStore implements RateLimitStore {
  peek(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = now();
    const row = one<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key=?', key);
    if (!row || t - row.window_start >= windowMs) return result(true, limit, 0, t, windowMs, t);
    return result(row.count < limit, limit, row.count, row.window_start, windowMs, t);
  }
  hit(key: string, limit: number, windowMs: number, cost = 1): RateLimitResult {
    const t = now();
    const row = one<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key=?', key);
    if (!row || t - row.window_start >= windowMs) {
      if (cost > limit) return result(false, limit, 0, t, windowMs, t);
      run('INSERT INTO rate_limits(key, window_start, count) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=excluded.count', key, t, cost);
      return result(true, limit, cost, t, windowMs, t);
    }
    if (row.count + cost > limit) return result(false, limit, row.count, row.window_start, windowMs, t);
    run('UPDATE rate_limits SET count = count + ? WHERE key=?', cost, key);
    return result(true, limit, row.count + cost, row.window_start, windowMs, t);
  }
  reset(key?: string): void {
    if (key) run('DELETE FROM rate_limits WHERE key=?', key); else run('DELETE FROM rate_limits');
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { windowStart: number; count: number; windowMs: number }>();
  constructor(private maxKeys = 50_000) {}
  private sweep(t: number) {
    if (this.buckets.size <= this.maxKeys) return;
    for (const [k, b] of this.buckets) if (t - b.windowStart >= b.windowMs) this.buckets.delete(k);
    // Ancora troppo pieno (attacco con chiavi sempre nuove): scarta le più vecchie, mai crescere senza limite.
    if (this.buckets.size > this.maxKeys) {
      let n = this.buckets.size - this.maxKeys;
      for (const k of this.buckets.keys()) { if (n-- <= 0) break; this.buckets.delete(k); }
    }
  }
  peek(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = now();
    const b = this.buckets.get(key);
    if (!b || t - b.windowStart >= windowMs) return result(true, limit, 0, t, windowMs, t);
    return result(b.count < limit, limit, b.count, b.windowStart, windowMs, t);
  }
  hit(key: string, limit: number, windowMs: number, cost = 1): RateLimitResult {
    const t = now();
    let b = this.buckets.get(key);
    if (!b || t - b.windowStart >= windowMs) {
      b = { windowStart: t, count: 0, windowMs };
      this.buckets.set(key, b);
      this.sweep(t);
    }
    if (b.count + cost > limit) return result(false, limit, b.count, b.windowStart, windowMs, t);
    b.count += cost;
    return result(true, limit, b.count, b.windowStart, windowMs, t);
  }
  reset(key?: string): void {
    if (key) this.buckets.delete(key); else this.buckets.clear();
  }
}

export const dbRateLimitStore = new DbRateLimitStore();
export const memoryRateLimitStore = new MemoryRateLimitStore();
registerResetHook(() => memoryRateLimitStore.reset());

/** Store per il limite generale delle API (percorso caldo). */
export const generalRateLimitStore = (): RateLimitStore => (process.env.RATE_LIMIT_STORE === 'db' ? dbRateLimitStore : memoryRateLimitStore);

/** Compatibilità: limite persistito su DB. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const r = dbRateLimitStore.hit(key, limit, windowMs);
  return { ok: r.ok, retryAfterSec: r.retryAfterSec };
}

export function purgeRateLimits(olderThanMs = 24 * 3600_000): void {
  run('DELETE FROM rate_limits WHERE window_start < ?', now() - olderThanMs);
}

// ---- Backoff esponenziale (per coppia email+IP) ----
export interface BackoffOpts { freeAttempts: number; baseMs: number; maxMs: number }
export const OTP_BACKOFF: BackoffOpts = { freeAttempts: 3, baseMs: 60_000, maxMs: 3600_000 };

export function backoffCheck(key: string): { ok: boolean; retryAfterSec: number } {
  const t = now();
  const r = one<{ blocked_until: number }>('SELECT blocked_until FROM auth_backoff WHERE key=?', key);
  if (r && r.blocked_until > t) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((r.blocked_until - t) / 1000)) };
  return { ok: true, retryAfterSec: 0 };
}
/** Registra un fallimento: all'`freeAttempts`-esimo errore scatta il blocco (base), poi raddoppia a ogni errore (base, 2*base, ...) fino a maxMs. */
export function backoffFail(key: string, o: BackoffOpts = OTP_BACKOFF): void {
  const t = now();
  const r = one<{ fails: number; updated_at: number }>('SELECT fails, updated_at FROM auth_backoff WHERE key=?', key);
  // Un lungo periodo senza errori azzera il contatore (un utente onesto non accumula debiti).
  const prev = r && t - r.updated_at < 6 * 3600_000 ? r.fails : 0;
  const fails = prev + 1;
  const over = fails - o.freeAttempts + 1; // dal `freeAttempts`-esimo errore in poi scatta il blocco
  const blockedUntil = over > 0 ? t + Math.min(o.maxMs, o.baseMs * 2 ** Math.min(over - 1, 20)) : 0;
  run(`INSERT INTO auth_backoff(key, fails, blocked_until, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at`, key, fails, blockedUntil, t);
}
export function backoffReset(key: string): void { run('DELETE FROM auth_backoff WHERE key=?', key); }
export function purgeBackoff(olderThanMs = 24 * 3600_000): void { run('DELETE FROM auth_backoff WHERE updated_at < ?', now() - olderThanMs); }
