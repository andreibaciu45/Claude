// GET /metrics (Prometheus, token) · GET /health/deep · middleware di strumentazione e di arresto ordinato.
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { safeEqual } from '../auth/crypto';
import type { AuthEnv } from '../auth/middleware';
import { deepHealth, redactHealth } from './health';
import { recordHttp, renderMetrics } from './metrics';
import { isDraining } from './state';
import { memoryRateLimitStore } from '../db/ratelimit';
import { ipHash, tooMany } from '../auth/limits';

const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

/** Token per /metrics e per i dettagli di /health/deep. Senza METRICS_TOKEN (o troppo corto) /metrics e' DISABILITATO (404). */
const metricsToken = (): string | null => { const t = process.env.METRICS_TOKEN; return t && t.length >= 16 ? t : null; };
const authorized = (header: string | undefined): boolean => {
  const tok = metricsToken();
  const m = /^Bearer (.{16,200})$/.exec(header ?? '');
  return !!tok && !!m && safeEqual(m[1]!, tok);
};

/** Rotta registrata (pattern, mai il path reale) per le etichette: l'ultimo handler non-middleware che ha risposto. */
export function routeLabel(c: Parameters<MiddlewareHandler>[0]): string {
  try {
    const hs = matchedRoutes(c).filter((r) => r.method !== 'ALL');
    return hs.length ? hs[hs.length - 1]!.path : 'unmatched';
  } catch { return 'unmatched'; }
}

/** Durante l'arresto: 503 + Connection: close (il load balancer / proxy smette di inviare traffico). */
export const drainGuard: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!isDraining()) return next();
  c.header('Connection', 'close');
  c.header('Retry-After', '5');
  return c.json({ error: { code: 'shutting_down', message: 'Server in arresto, riprova tra poco' } }, 503);
};

/** Conta richieste e latenza per rotta/stato. Va montato come primo middleware. */
export const instrument: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const t0 = performance.now();
  try {
    await next();
  } finally {
    recordHttp(routeLabel(c), c.req.method, c.res.status, (performance.now() - t0) / 1000);
  }
};

export const opsRoutes = new Hono<AuthEnv>();

opsRoutes.get('/metrics', (c) => {
  if (!metricsToken()) return c.json({ error: { code: 'not_found', message: 'Risorsa non trovata' } }, 404); // disabilitato
  if (!authorized(c.req.header('authorization'))) {
    c.header('WWW-Authenticate', 'Bearer');
    return c.json({ error: { code: 'unauthorized', message: 'Token mancante o errato' } }, 401);
  }
  return c.body(renderMetrics(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
});

// /health/deep: SENZA token e' di sola lettura (nessuna scrittura sul DB) e con rate-limit per IP in memoria (nessuna I/O);
// CON token valido esegue anche la sonda di scrittura, ma al massimo una ogni HEALTH_CACHE_MS (cache) e con un limite piu' ampio per IP.
opsRoutes.get('/health/deep', (c) => {
  const auth = authorized(c.req.header('authorization'));
  const lim = auth ? envNum('RL_HEALTH_DEEP_AUTH_PER_MIN', 120) : envNum('RL_HEALTH_DEEP_PER_MIN', 30);
  const r = memoryRateLimitStore.hit(`health:${auth ? 'a' : 'n'}:${ipHash(c)}`, lim, 60_000);
  if (!r.ok) return tooMany(c, r);
  const h = deepHealth({ write: auth });
  return c.json(auth ? h : redactHealth(h), h.status === 'fail' ? 503 : 200);
});
