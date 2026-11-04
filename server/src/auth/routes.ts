// POST /v1/auth/request · POST /v1/auth/verify · POST /v1/auth/logout · GET /v1/me
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { z } from 'zod';
import type { AuthRequestBody, AuthVerifyBody, AuthVerifyResponse, MeResponse } from '../../../shared/api';
import { one } from '../db';
import { rateLimit } from '../db/ratelimit';
import { docsLimitFor, getDocsThisMonth, getPlan } from '../db/entitlements';
import { sha256Hex } from './crypto';
import { apiError, parseJson } from './http';
import { getMailer } from './mailer';
import { requireAuth, type AuthEnv } from './middleware';
import { checkOtp, createOtp, normalizeEmail, revokeSession, startSession } from './service';

const emailSchema = z.string().trim().min(3).max(254).regex(/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/, 'email non valida');
const requestSchema = z.object({ email: emailSchema }) satisfies z.ZodType<AuthRequestBody>;
const verifySchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'il codice ha 6 cifre'),
  deviceId: z.string().min(1).max(100).regex(/^[\w.:-]+$/, 'deviceId non valido'),
  deviceName: z.string().max(100).optional(),
}) satisfies z.ZodType<AuthVerifyBody>;

const num = (name: string, def: number) => Number(process.env[name]) || def;
const HOUR = 3600_000;

function clientIp(c: Parameters<typeof getConnInfo>[0]): string {
  if (process.env.TRUST_PROXY === '1') {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',').pop()!.trim(); // l'ultimo valore è quello aggiunto dal nostro proxy
  }
  try { return getConnInfo(c).remote.address ?? 'unknown'; } catch { return 'unknown'; }
}

export const authRoutes = new Hono<AuthEnv>();

authRoutes.post('/request', async (c) => {
  const p = await parseJson(c, requestSchema);
  if (p.res) return p.res;
  const email = normalizeEmail(p.data.email);
  const ip = clientIp(c);
  for (const [key, limit] of [
    [`otpreq:ip:${sha256Hex(ip)}`, num('RL_OTP_REQUEST_IP_HOUR', 20)],
    [`otpreq:email:${sha256Hex(email)}`, num('RL_OTP_REQUEST_EMAIL_HOUR', 5)],
  ] as const) {
    const r = rateLimit(key, limit, HOUR);
    if (!r.ok) return apiError(c, 429, 'rate_limited', 'Troppe richieste, riprova più tardi', { 'Retry-After': String(r.retryAfterSec) });
  }
  const code = createOtp(email);
  try {
    await getMailer().sendOtp(email, code);
  } catch {
    console.error(JSON.stringify({ request_id: c.get('requestId'), error: 'mail_failed' })); // niente indirizzo né codice
  }
  // Risposta identica per email nuove/esistenti (nessuna enumerazione utenti).
  if (process.env.AUTH_DEV_RETURN_CODE === '1' && process.env.NODE_ENV !== 'production') return c.json({ devCode: code }, 200);
  return c.body(null, 204);
});

authRoutes.post('/verify', async (c) => {
  const p = await parseJson(c, verifySchema);
  if (p.res) return p.res;
  const email = normalizeEmail(p.data.email);
  const ip = clientIp(c);
  for (const [key, limit] of [
    [`otpver:ip:${sha256Hex(ip)}`, num('RL_OTP_VERIFY_IP_10MIN', 30)],
    [`otpver:email:${sha256Hex(email)}`, num('RL_OTP_VERIFY_EMAIL_10MIN', 10)],
  ] as const) {
    const r = rateLimit(key, limit, 10 * 60_000);
    if (!r.ok) return apiError(c, 429, 'rate_limited', 'Troppi tentativi, riprova più tardi', { 'Retry-After': String(r.retryAfterSec) });
  }
  if (!checkOtp(email, p.data.code)) return apiError(c, 401, 'invalid_code', 'Codice non valido o scaduto');
  const s = startSession(email, p.data.deviceId, p.data.deviceName);
  return c.json({ token: s.token, expiresAt: s.expiresAt, tenantId: s.tenantId } satisfies AuthVerifyResponse);
});

authRoutes.post('/logout', requireAuth, (c) => {
  revokeSession(c.get('tenantId'), c.get('sessionId'), c.get('userId'));
  return c.body(null, 204);
});

export const meRoutes = new Hono<AuthEnv>();
meRoutes.get('/', requireAuth, (c) => {
  const tenantId = c.get('tenantId');
  const u = one<{ email: string }>('SELECT email FROM users WHERE id=? AND tenant_id=?', c.get('userId'), tenantId);
  if (!u) return apiError(c, 401, 'unauthorized', 'Sessione non valida');
  const plan = getPlan(tenantId);
  return c.json({ email: u.email, tenantId, plan, quota: { docsThisMonth: getDocsThisMonth(tenantId), docsLimit: docsLimitFor(plan) } } satisfies MeResponse);
});
