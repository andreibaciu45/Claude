// POST /v1/auth/request · POST /v1/auth/verify · POST /v1/auth/logout · GET /v1/me
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthRequestBody, AuthVerifyBody, AuthVerifyResponse, MeResponse } from '../../../shared/api';
import { one, transaction } from '../db';
import { backoffCheck, backoffFail, backoffReset, dbRateLimitStore } from '../db/ratelimit';
import { logOnce } from '../log';
import { billingStatusOf, docsLimitFor, effectivePlan, getDocsThisMonth, getEntitlement } from '../db/entitlements';
import { monthKey, now } from '../db/clock';
import { logHash, rlHash } from './crypto';
import { apiError, parseJson } from './http';
import { getMailer } from './mailer';
import { requireAuth, type AuthEnv } from './middleware';
import { consumeOtp, createOtp, mailboxKey, normalizeEmail, revokeSession, startSession, userExists, verifyOtp } from './service';
import { guardCheck, guardFail, guardSuccess, isTrustedNet } from './guard';
import { clientIp, ipKey } from './ip';
import { checkInvite, INVITE_MESSAGES, inviteOnly, redeemInvite, type InviteProblem } from './invites';
import { inc } from '../ops/metrics';
import { isDevEnv } from '../net/safe-url';
import { acceptedTermsSchema, requireTerms, TERMS_REQUIRED_MESSAGE, termsIncomplete, termsVersionError } from './terms';

// Niente caratteri di controllo, spazi, virgolette né separatori di lista: l'indirizzo finisce in un comando SMTP (RCPT TO).
const emailSchema = z.string().trim().min(3).max(254).regex(/^[^\s@<>"',;\x00-\x1f\x7f]+@[^\s@<>"',;\x00-\x1f\x7f]+\.[^\s@<>"',;\x00-\x1f\x7f]+$/, 'email non valida');
const requestSchema = z.object({ email: emailSchema }) satisfies z.ZodType<AuthRequestBody>;
const verifySchema = z.object({
  email: emailSchema,
  // 6..10 cifre: la lunghezza emessa dipende da OTP_DIGITS (default 8). Un codice di lunghezza diversa da quello emesso non può coincidere: nessun controllo di lunghezza qui,
  // così un client che manda 6 cifre funziona con OTP_DIGITS=6 e i codici già emessi prima di un cambio di configurazione restano verificabili.
  code: z.string().regex(/^\d{6,10}$/, 'il codice è numerico (6-10 cifre)'),
  deviceId: z.string().min(1).max(100).regex(/^[\w.:-]+$/, 'deviceId non valido'),
  deviceName: z.string().max(100).optional(),
  acceptedTerms: acceptedTermsSchema.optional(),
  inviteCode: z.string().max(40).optional(), // solo con INVITE_ONLY=1, per creare un account (proposta per shared/api.ts: AuthVerifyBody.inviteCode?: string)
}) satisfies z.ZodType<AuthVerifyBody>;

const num = (name: string, def: number) => Number(process.env[name]) || def;
const HOUR = 3600_000;
const h = (x: string) => rlHash(x);

export const authRoutes = new Hono<AuthEnv>();

/*
 * Limiti OTP (progettati per NON permettere il DoS mirato su una vittima):
 *  - per IP (anti-scansione), per COPPIA email+IP e per email (tetto globale più alto);
 *  - la coppia è controllata PRIMA del tetto per email: chi è già bloccato non consuma il budget della vittima;
 *  - sulle verifiche sbagliate scatta un backoff esponenziale per coppia email+IP (non per email): l'attaccante si blocca da solo,
 *    la vittima, da un altro IP, può continuare ad accedere finché il tetto globale per email non viene esaurito da molti IP distinti.
 */
authRoutes.post('/request', async (c) => {
  const p = await parseJson(c, requestSchema);
  if (p.res) return p.res;
  const email = normalizeEmail(p.data.email);
  const ip = ipKey(clientIp(c));
  const store = dbRateLimitStore;
  // Il tetto per CASELLA (non per stringa) vale per chi arriva da una rete nuova; una rete già usata dal proprietario ne è esente, altrimenti un attacco
  // distribuito esaurirebbe il budget e il proprietario non riceverebbe più codici nemmeno da casa. Restano IP e coppia email+IP.
  const budgets: (readonly [string, number])[] = [
    [`otpreq:ip:${h(ip)}`, num('RL_OTP_REQUEST_IP_HOUR', 20)],
    [`otpreq:pair:${h(`${email}|${ip}`)}`, num('RL_OTP_REQUEST_PAIR_HOUR', 5)],
  ];
  if (!isTrustedNet(email, ip)) budgets.push([`otpreq:email:${h(mailboxKey(email))}`, num('RL_OTP_REQUEST_EMAIL_HOUR', 10)]);
  for (const [key, limit] of budgets) {
    const r = store.hit(key, limit, HOUR);
    if (!r.ok) return apiError(c, 429, 'rate_limited', 'Troppe richieste, riprova più tardi', { 'Retry-After': String(r.retryAfterSec) });
  }
  const code = createOtp(email);
  inc('vp_otp_requests_total');
  try {
    await getMailer().sendOtp(email, code);
  } catch {
    console.error(JSON.stringify({ request_id: c.get('requestId'), error: 'mail_failed' })); // niente indirizzo né codice
  }
  // Risposta identica per email nuove/esistenti (nessuna enumerazione utenti).
  if (process.env.AUTH_DEV_RETURN_CODE === '1' && isDevEnv()) return c.json({ devCode: code }, 200);
  return c.body(null, 204);
});

/** Avviso al proprietario («qualcuno sta tentando di accedere»): solo per account esistenti (nessuna email a indirizzi inventati), mai bloccante, mai col codice. */
async function sendAlert(email: string, requestId: string | undefined): Promise<void> {
  try {
    if (!userExists(email)) return;
    const m = getMailer();
    if (!m.sendSecurityAlert) return;
    await m.sendSecurityAlert(email);
    inc('vp_otp_alerts_total');
  } catch {
    console.error(JSON.stringify({ request_id: requestId, error: 'alert_mail_failed' }));
  }
}

authRoutes.post('/verify', async (c) => {
  const p = await parseJson(c, verifySchema);
  if (p.res) return p.res;
  const email = normalizeEmail(p.data.email);
  const ip = ipKey(clientIp(c));
  const tooMany = (retryAfterSec: number) => apiError(c, 429, 'rate_limited', 'Troppi tentativi, riprova più tardi', { 'Retry-After': String(retryAfterSec) });

  const ipRes = dbRateLimitStore.hit(`otpver:ip:${h(ip)}`, num('RL_OTP_VERIFY_IP_10MIN', 30), 10 * 60_000);
  if (!ipRes.ok) return tooMany(ipRes.retryAfterSec);
  const pairKey = `otpver:pair:${h(`${email}|${ip}`)}`;
  const bo = backoffCheck(pairKey);
  if (!bo.ok) return tooMany(bo.retryAfterSec);
  // Corsia dei dispositivi noti: una rete da cui questo indirizzo ha già completato un accesso non subisce i freni GLOBALI per email
  // (cooldown e tetto dei 10 minuti), che un attacco distribuito potrebbe esaurire per chiudere fuori il proprietario. Restano IP, coppia e tetto per codice.
  const trusted = isTrustedNet(email, ip);
  if (!trusted) {
    const g = guardCheck(email);
    if (!g.ok) {
      inc('vp_otp_locked_total');
      return tooMany(g.retryAfterSec);
    }
    const emailRes = dbRateLimitStore.hit(`otpver:email:${h(email)}`, num('RL_OTP_VERIFY_EMAIL_10MIN', 15), 10 * 60_000);
    if (!emailRes.ok) {
      logOnce('warn', 'otp_verify_email_budget_exhausted', { email_hash: logHash(email) });
      return tooMany(emailRes.retryAfterSec);
    }
  }

  const terms = p.data.acceptedTerms;
  if (terms) {
    const verr = termsVersionError(terms);
    if (verr) return apiError(c, 400, 'terms_version_mismatch', verr);
  }

  const out = transaction(() => {
    const v = verifyOtp(email, p.data.code);
    if (!v.ok) return { kind: 'invalid' as const, hadActive: v.hadActive };
    const isNew = !userExists(email);
    // Primo accesso con REQUIRE_TERMS=1: senza Termini+DPA non si crea l'account e il codice NON viene consumato.
    // (Il controllo avviene solo dopo un codice valido: non permette di scoprire se un'email è registrata.)
    if (isNew && requireTerms() && termsIncomplete(terms)) return { kind: 'terms_required' as const };
    // Lancio privato (INVITE_ONLY=1): per creare un account serve un codice invito valido; l'OTP non viene consumato (si può riprovare col codice giusto).
    if (isNew && inviteOnly()) {
      const inv = checkInvite(p.data.inviteCode, email);
      if (!inv.ok) return { kind: 'invite' as const, reason: inv.reason };
    }
    consumeOtp(v.id);
    const s = startSession(email, p.data.deviceId, p.data.deviceName, terms ? { accepted: terms, ipKey: ip } : undefined);
    if (isNew && inviteOnly() && !redeemInvite(p.data.inviteCode, email, s.tenantId)) throw new Error('invite_race'); // annulla la transazione
    return { kind: 'ok' as const, s, isNew };
  });
  if (out.kind === 'invalid') {
    backoffFail(pairKey);
    inc('vp_otp_verify_failed_total');
    // Fallimento globale per email (solo se esisteva un codice da indovinare, così non si creano righe per email inventate).
    if (out.hadActive && !trusted) {
      const f = guardFail(email);
      if (f.lockedMs > 0) inc('vp_otp_cooldowns_total');
      if (f.alert) void sendAlert(email, c.get('requestId'));
    }
    return apiError(c, 401, 'invalid_code', 'Codice non valido o scaduto');
  }
  if (out.kind === 'invite') {
    // Tentativi di indovinare codici invito: tetto per IP (un codice ha 60 bit, ma meglio non offrire un oracolo illimitato).
    const r = dbRateLimitStore.hit(`invite:fail:${h(ip)}`, num('RL_INVITE_FAIL_HOUR', 10), HOUR);
    if (!r.ok) return tooMany(r.retryAfterSec);
    return apiError(c, 403, p.data.inviteCode ? 'invite_invalid' : 'invite_required', INVITE_MESSAGES[p.data.inviteCode ? (out.reason as InviteProblem) : 'required']);
  }
  if (out.kind === 'terms_required') return apiError(c, 400, 'terms_required', TERMS_REQUIRED_MESSAGE);
  backoffReset(pairKey);
  guardSuccess(email, ip);
  inc(out.isNew ? 'vp_signups_total' : 'vp_logins_total');
  return c.json({ token: out.s.token, expiresAt: out.s.expiresAt, tenantId: out.s.tenantId } satisfies AuthVerifyResponse);
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
  const e = getEntitlement(tenantId);
  const plan = effectivePlan(e, now());
  return c.json({
    email: u.email, tenantId, plan,
    quota: { docsThisMonth: getDocsThisMonth(tenantId), docsLimit: docsLimitFor(plan), periodKey: monthKey() },
    billingStatus: billingStatusOf(e, plan),
    currentPeriodEnd: e.plan === 'pro' ? e.currentPeriodEnd : null,
    cancelAtPeriodEnd: plan === 'pro' && e.cancelAtPeriodEnd,
    graceUntil: e.status === 'past_due' && plan === 'pro' ? e.graceUntil : null,
  } satisfies MeResponse);
});
