import { one, run } from './index';
import { now } from './clock';

/** Rate-limit a finestra fissa persistito su DB. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const t = now();
  const row = one<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key=?', key);
  if (!row || t - row.window_start >= windowMs) {
    run('INSERT INTO rate_limits(key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1', key, t);
    return { ok: true, retryAfterSec: 0 };
  }
  if (row.count >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.window_start + windowMs - t) / 1000)) };
  run('UPDATE rate_limits SET count = count + 1 WHERE key=?', key);
  return { ok: true, retryAfterSec: 0 };
}

export function purgeRateLimits(olderThanMs = 24 * 3600_000): void {
  run('DELETE FROM rate_limits WHERE window_start < ?', now() - olderThanMs);
}
