/**
 * requireAuth — middleware di autenticazione per TUTTI i router protetti (anche SERVER-EXTRA).
 *
 *   import { requireAuth, type AuthEnv } from '../auth/middleware';
 *   export const billingRoutes = new Hono<AuthEnv>();
 *   billingRoutes.use('*', requireAuth);            // oppure su singole route
 *   billingRoutes.post('/checkout', (c) => { const tenantId = c.get('tenantId'); ... });
 *
 * Imposta (SOLO dalla sessione, mai da body/query/header del client):
 *   c.get('tenantId'), c.get('userId'), c.get('sessionId')
 * Risponde 401 {error:{code:'unauthorized'}} se manca/è invalido/scaduto/revocato il Bearer token.
 * Il token è salvato come SHA-256 (sessions.token_hash); sessione sliding 90 giorni.
 */
import type { MiddlewareHandler } from 'hono';
import { one, run } from '../db';
import { now } from '../db/clock';
import { safeEqual, sha256Hex } from './crypto';
import { apiError } from './http';

export type AuthEnv = { Variables: { tenantId: string; userId: string; sessionId: string; requestId: string } };

export const SESSION_TTL_MS = 90 * 24 * 3600_000;
const TOUCH_EVERY_MS = 3600_000;

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const h = c.req.header('authorization') ?? '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(h);
  if (!m) return apiError(c, 401, 'unauthorized', 'Autenticazione richiesta');
  const hash = sha256Hex(m[1]);
  const s = one<{ id: string; tenant_id: string; user_id: string; token_hash: string; expires_at: number; revoked_at: number | null; last_seen_at: number; tstatus: string }>(
    `SELECT s.id, s.tenant_id, s.user_id, s.token_hash, s.expires_at, s.revoked_at, s.last_seen_at, t.status AS tstatus
     FROM sessions s JOIN tenants t ON t.id = s.tenant_id WHERE s.token_hash = ?`, hash);
  const t = now();
  if (!s || !safeEqual(s.token_hash, hash) || s.revoked_at !== null || s.expires_at <= t || s.tstatus !== 'active') {
    return apiError(c, 401, 'unauthorized', 'Sessione non valida o scaduta');
  }
  if (t - s.last_seen_at > TOUCH_EVERY_MS) {
    run('UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?', t, t + SESSION_TTL_MS, s.id);
  }
  c.set('tenantId', s.tenant_id);
  c.set('userId', s.user_id);
  c.set('sessionId', s.id);
  await next();
};
