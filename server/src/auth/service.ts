// Logica OTP/tenant/sessioni (le route restano sottili).
import { randomInt, randomUUID } from 'node:crypto';
import { one, run, transaction } from '../db';
import { now } from '../db/clock';
import { audit } from '../db/audit';
import { newToken, otpHash, safeEqual, sha256Hex } from './crypto';
import { SESSION_TTL_MS } from './middleware';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

export function createOtp(email: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const t = now();
  transaction(() => {
    run('UPDATE otp_codes SET consumed_at=? WHERE email=? AND consumed_at IS NULL', t, email); // un solo codice valido alla volta
    run('INSERT INTO otp_codes(email, code_hash, created_at, expires_at) VALUES (?,?,?,?)', email, otpHash(email, code), t, t + OTP_TTL_MS);
    run('DELETE FROM otp_codes WHERE created_at < ?', t - 24 * 3600_000);
  });
  return code;
}

/** true solo se il codice è corretto, non scaduto, non consumato e con tentativi residui. Monouso. */
export function checkOtp(email: string, code: string): boolean {
  return transaction(() => {
    const r = one<{ id: number; code_hash: string; expires_at: number; attempts: number }>(
      'SELECT id, code_hash, expires_at, attempts FROM otp_codes WHERE email=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', email);
    const t = now();
    if (!r) return false;
    if (r.expires_at <= t || r.attempts >= OTP_MAX_ATTEMPTS) {
      run('UPDATE otp_codes SET consumed_at=? WHERE id=?', t, r.id);
      return false;
    }
    run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=?', r.id);
    if (!safeEqual(r.code_hash, otpHash(email, code))) return false;
    run('UPDATE otp_codes SET consumed_at=? WHERE id=?', t, r.id);
    return true;
  });
}

export interface LoginResult { token: string; expiresAt: number; tenantId: string; userId: string }

/** Crea tenant+utente al primo accesso, registra il dispositivo, emette sessione (token solo come hash). */
export function startSession(email: string, deviceId: string, deviceName?: string): LoginResult {
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
    return { token, expiresAt, tenantId: u.tenant_id, userId: u.id };
  });
}

export function revokeSession(tenantId: string, sessionId: string, userId: string): void {
  run('UPDATE sessions SET revoked_at=? WHERE id=? AND tenant_id=? AND revoked_at IS NULL', now(), sessionId, tenantId);
  audit(tenantId, userId, 'auth.logout', 'session', sessionId);
}
