// Utilità condivise dai moduli SERVER-EXTRA (billing, sdi, voice): auth iniettabile, clock, errori.
import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { requireAuth as coreRequireAuth } from '../auth/middleware';

export type AuthVars = { tenantId: string; userId: string };
export type AppEnv = { Variables: AuthVars };
export type Env = Record<string, string | undefined>;
export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };

/**
 * Auth: di default il `requireAuth` di CORE (imposta c.get('tenantId') e c.get('userId')).
 * Sostituibile nei test (`authHolder.requireAuth = fake`); se nullo il gate è FAIL-CLOSED (503).
 */
export const authHolder: { requireAuth: MiddlewareHandler | null } = { requireAuth: coreRequireAuth as unknown as MiddlewareHandler };

export const apiError = (code: string, message: string) => ({ error: { code, message } });

export const authGate: MiddlewareHandler = async (c, next) => {
  const mw = authHolder.requireAuth;
  if (!mw) return c.json(apiError('auth_unavailable', 'Autenticazione non configurata'), 503);
  return mw(c, next);
};

/** Confronto stringhe in tempo costante (lunghezze diverse => false senza leak significativo). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Rate-limit a finestra fissa, in memoria, per chiave (es. tenant). */
export interface RateLimiter { hit(key: string): { allowed: boolean; remaining: number; resetAt: number } }
export function createRateLimiter(opts: { limit: number; windowMs: number; clock?: Clock }): RateLimiter {
  const clock = opts.clock ?? systemClock;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key) {
      const now = clock.now();
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, b);
        if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      }
      if (b.count >= opts.limit) return { allowed: false, remaining: 0, resetAt: b.resetAt };
      b.count++;
      return { allowed: true, remaining: opts.limit - b.count, resetAt: b.resetAt };
    },
  };
}
