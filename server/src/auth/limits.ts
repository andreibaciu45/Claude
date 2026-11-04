// Rate-limit generale delle API (a). Due livelli, entrambi su `RateLimitStore` (vedi db/ratelimit.ts):
//   - per IP (prima dell'autenticazione, tutte le rotte tranne /health): RL_IP_PER_MIN (default 600);
//   - per tenant (dopo l'autenticazione, in requireAuth): RL_TENANT_PER_MIN (default 300) e, per i metodi che scrivono, RL_TENANT_WRITES_PER_MIN (default 120).
// Store: RATE_LIMIT_STORE=memory (default, per processo) | db (persistito, condiviso). Le rotte di login hanno limiti propri e più severi.
// Risposta al superamento: 429 + Retry-After + RateLimit-Limit/Remaining/Reset.
import type { Context, MiddlewareHandler } from 'hono';
import { generalRateLimitStore, type RateLimitResult } from '../db/ratelimit';
import { sha256Hex } from './crypto';
import { apiError } from './http';
import { clientIp, ipKey } from './ip';
import type { AuthEnv } from './middleware';

const MIN = 60_000;
const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

export function tooMany(c: Context, r: RateLimitResult, message = 'Troppe richieste, riprova tra poco') {
  return apiError(c, 429, 'rate_limited', message, {
    'Retry-After': String(r.retryAfterSec), 'RateLimit-Limit': String(r.limit), 'RateLimit-Remaining': '0', 'RateLimit-Reset': String(r.retryAfterSec),
  });
}

export const ipHash = (c: Context): string => sha256Hex(ipKey(clientIp(c))).slice(0, 24);

/** Limite per IP su tutte le rotte (tranne gli health check). */
export const ipRateLimit: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/healthz') return next();
  const r = generalRateLimitStore().hit(`ip:${ipHash(c)}`, envNum('RL_IP_PER_MIN', 600), MIN);
  if (!r.ok) return tooMany(c, r);
  return next();
};

/** Limite per tenant (chiamato da requireAuth dopo aver risolto la sessione). Ritorna una Response se superato. */
export function tenantRateLimit(c: Context, tenantId: string): Response | null {
  const store = generalRateLimitStore();
  const r = store.hit(`tn:${tenantId}`, envNum('RL_TENANT_PER_MIN', 300), MIN);
  if (!r.ok) return tooMany(c, r);
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const w = store.hit(`tnw:${tenantId}`, envNum('RL_TENANT_WRITES_PER_MIN', 120), MIN);
    if (!w.ok) return tooMany(c, w);
  }
  return null;
}
