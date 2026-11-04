// Logica OTP/tenant/sessioni (le route restano sottili).
import { randomInt, randomUUID } from 'node:crypto';
import { all, one, run, transaction } from '../db';
import { now } from '../db/clock';
import { audit } from '../db/audit';
import { newToken, otpHash, safeEqual, sha256Hex } from './crypto';
import { SESSION_TTL_MS } from './middleware';
import { recordAcceptance, type AcceptedTerms } from './terms';

export const OTP_TTL_MS = 10 * 60_000;
/** Tentativi massimi per singolo codice (somma di tutti i dispositivi). Il vero freno è per coppia email+IP (backoff) e per email (finestra). */
export const OTP_MAX_ATTEMPTS = 10;
/** Codici validi contemporaneamente per email: una nuova richiesta NON invalida subito i precedenti (altrimenti chiunque potrebbe
 *  annullare il codice appena inviato alla vittima), ma i più vecchi oltre il terzo sì. */
export const OTP_MAX_ACTIVE = 3;

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

export function createOtp(email: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const t = now();
  transaction(() => {
    run(`UPDATE otp_codes SET consumed_at=? WHERE email=? AND consumed_at IS NULL AND id NOT IN
         (SELECT id FROM otp_codes WHERE email=? AND consumed_at IS NULL ORDER BY id DESC LIMIT ?)`, t, email, email, OTP_MAX_ACTIVE - 1);
    run('INSERT INTO otp_codes(email, code_hash, created_at, expires_at) VALUES (?,?,?,?)', email, otpHash(email, code), t, t + OTP_TTL_MS);
    run('DELETE FROM otp_codes WHERE created_at < ?', t - 24 * 3600_000);
  });
  return code;
}

/**
 * Verifica il codice SENZA consumarlo (per poter rifiutare la richiesta per altri motivi, es. Termini mancanti, senza bruciare il codice).
 * Ogni chiamata conta come tentativo su tutti i codici attivi. Il confronto è in tempo costante su tutti i codici (nessun early-exit).
 */
export function verifyOtp(email: string, code: string): { ok: true; id: number } | { ok: false } {
  return transaction(() => {
    const t = now();
    const rows = all<{ id: number; code_hash: string; expires_at: number; attempts: number }>(
      'SELECT id, code_hash, expires_at, attempts FROM otp_codes WHERE email=? AND consumed_at IS NULL ORDER BY id DESC', email);
    const expected = otpHash(email, code);
    let hit: number | null = null;
    for (const r of rows) {
      if (r.expires_at <= t || r.attempts >= OTP_MAX_ATTEMPTS) { run('UPDATE otp_codes SET consumed_at=? WHERE id=?', t, r.id); continue; }
      run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=?', r.id);
      if (safeEqual(r.code_hash, expected) && hit === null) hit = r.id;
    }
    return hit === null ? { ok: false as const } : { ok: true as const, id: hit };
  });
}
export function consumeOtp(id: number): void { run('UPDATE otp_codes SET consumed_at=? WHERE id=?', now(), id); }

/** true solo se il codice è corretto, non scaduto, non consumato e con tentativi residui. Monouso. */
export function checkOtp(email: string, code: string): boolean {
  return transaction(() => {
    const v = verifyOtp(email, code);
    if (v.ok) consumeOtp(v.id);
    return v.ok;
  });
}

export const userExists = (email: string): boolean => one('SELECT 1 AS x FROM users WHERE email=?', email) !== undefined;

export interface LoginResult { token: string; expiresAt: number; tenantId: string; userId: string }

/** Crea tenant+utente al primo accesso, registra il dispositivo, emette sessione (token solo come hash). */
export function startSession(email: string, deviceId: string, deviceName?: string, terms?: { accepted: AcceptedTerms; ipKey?: string }): LoginResult {
  return transaction(() => {
    const t = now();
    let u = one<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM users WHERE email=?', email);
    let created = false;
    if (!u) {
      const tenantId = randomUUID(), userId = randomUUID();
      run('INSERT INTO tenants(id, created_at) VALUES (?,?)', tenantId, t);
      run('INSERT INTO users(id, email, tenant_id, role, created_at) VALUES (?,?,?,?,?)', userId, email, tenantId, 'owner', t);
      run("INSERT INTO entitlements(tenant_id, plan, status, updated_at) VALUES (?, 'free', 'active', ?)", tenantId, t);
      u = { id: userId, tenant_id: tenantId };
      created = true;
    }
    run('UPDATE users SET last_login_at=? WHERE id=?', t, u.id);
    run(`INSERT INTO devices(tenant_id, id, user_id, name, created_at, last_seen_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(tenant_id, id) DO UPDATE SET last_seen_at=excluded.last_seen_at, name=COALESCE(excluded.name, devices.name), user_id=excluded.user_id`,
      u.tenant_id, deviceId, u.id, deviceName ?? null, t, t);
    run('UPDATE sessions SET revoked_at=? WHERE tenant_id=? AND device_id=? AND revoked_at IS NULL', t, u.tenant_id, deviceId);
    const token = newToken();
    const expiresAt = t + SESSION_TTL_MS;
    run('INSERT INTO sessions(id, tenant_id, user_id, device_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      randomUUID(), u.tenant_id, u.id, deviceId, sha256Hex(token), t, t, expiresAt);
    audit(u.tenant_id, u.id, created ? 'auth.signup' : 'auth.login', 'device', deviceId);
    if (terms) recordAcceptance(u.tenant_id, u.id, terms.accepted, terms.ipKey);
    return { token, expiresAt, tenantId: u.tenant_id, userId: u.id };
  });
}

export function revokeSession(tenantId: string, sessionId: string, userId: string): void {
  run('UPDATE sessions SET revoked_at=? WHERE id=? AND tenant_id=? AND revoked_at IS NULL', now(), sessionId, tenantId);
  audit(tenantId, userId, 'auth.logout', 'session', sessionId);
}
