// Difesa GLOBALE per email contro l'indovinare il codice OTP da molti indirizzi (attacco distribuito).
//
// Principio: il numero di tentativi che un attaccante puo' fare per email al giorno deve essere piccolo e NON dipendere dal numero di IP che controlla,
// senza che l'attaccante possa impedire alla vittima di ricevere i codici (l'invio non e' mai bloccato da qui).
//   1. Le prime OTP_GUARD_FREE_FAILS verifiche sbagliate (default 10) nella finestra (24 ore senza errori la azzerano) non hanno conseguenze.
//   2. Dalla successiva scatta un COOLDOWN CRESCENTE sulle sole verifiche, per email e per TUTTI gli IP: OTP_GUARD_BASE_MIN (2) minuti, poi raddoppia
//      a ogni errore, fino a OTP_GUARD_MAX_MIN (120). Durante il cooldown la verifica risponde 429 SENZA valutare il codice (nessun tentativo regalato).
//   3. Al raggiungimento di OTP_ALERT_FAILS errori (default 8) il proprietario riceve UNA email di avviso (al massimo ogni 24 ore) senza alcun codice.
//   4. Corsia dei dispositivi noti: chi ha gia' completato un accesso da questa rete (max 5 reti per email, 30 giorni) NON subisce il cooldown globale:
//      un attacco distribuito non puo' chiudere fuori il proprietario legittimo. Resta soggetto a backoff per coppia email+IP e al tetto per codice.
// Vedi docs/OPERAZIONI.md («Difesa OTP») per il calcolo della probabilita' residua.
import { one, run, transaction } from '../db';
import { now } from '../db/clock';
import { hmacHex } from './crypto';

const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;
const num = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : def; };
export const guardFreeFails = () => num('OTP_GUARD_FREE_FAILS', 10);
export const guardBaseMs = () => num('OTP_GUARD_BASE_MIN', 2) * MIN;
export const guardMaxMs = () => num('OTP_GUARD_MAX_MIN', 120) * MIN;
export const alertFails = () => num('OTP_ALERT_FAILS', 8);
const TRUSTED_MAX = 5;
const TRUSTED_TTL = 30 * DAY;

export const emailKey = (email: string): string => hmacHex('otpguard', email);
export const netKey = (ipKeyValue: string): string => hmacHex('otpnet', ipKeyValue);

interface GuardRow { fails: number; level: number; locked_until: number; alerted_at: number | null; updated_at: number }
const row = (ek: string) => one<GuardRow>('SELECT fails, level, locked_until, alerted_at, updated_at FROM otp_guard WHERE email_hash=?', ek);

export function isTrustedNet(email: string, ipKeyValue: string): boolean {
  const r = one<{ last_ok_at: number }>('SELECT last_ok_at FROM otp_trusted_ips WHERE email_hash=? AND ip_hash=?', emailKey(email), netKey(ipKeyValue));
  return !!r && now() - r.last_ok_at < TRUSTED_TTL;
}

/** Verifica consentita? (false = cooldown globale in corso; il codice NON deve essere valutato). */
export function guardCheck(email: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const r = row(emailKey(email));
  const t = now();
  if (r && r.locked_until > t) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((r.locked_until - t) / 1000)) };
  return { ok: true };
}

/** Registra una verifica sbagliata (da qualunque IP non fidato). Ritorna true se bisogna mandare l'avviso al proprietario. */
export function guardFail(email: string): { alert: boolean; lockedMs: number } {
  const ek = emailKey(email);
  return transaction(() => {
    const t = now();
    const r = row(ek);
    const fresh = !r || t - r.updated_at > DAY; // 24 ore senza errori: si riparte da zero
    const fails = (fresh ? 0 : r!.fails) + 1;
    const over = fails - guardFreeFails();
    const level = over > 0 ? over : 0;
    const lockedMs = over > 0 ? Math.min(guardMaxMs(), guardBaseMs() * 2 ** Math.min(over - 1, 20)) : 0;
    const alerted = fresh ? null : r!.alerted_at;
    const alert = fails >= alertFails() && (alerted === null || t - alerted > DAY);
    run(`INSERT INTO otp_guard(email_hash, fails, level, locked_until, alerted_at, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(email_hash) DO UPDATE SET fails=excluded.fails, level=excluded.level, locked_until=excluded.locked_until, alerted_at=excluded.alerted_at, updated_at=excluded.updated_at`,
      ek, fails, level, lockedMs > 0 ? t + lockedMs : 0, alert ? t : alerted, t);
    return { alert, lockedMs };
  });
}

/** Accesso riuscito: ricorda la rete (corsia dei dispositivi noti). Il contatore NON si azzera: altrimenti ogni login legittimo regalerebbe all'attaccante una finestra nuova. */
export function guardSuccess(email: string, ipKeyValue: string): void {
  const ek = emailKey(email), nk = netKey(ipKeyValue), t = now();
  transaction(() => {
    run('INSERT INTO otp_trusted_ips(email_hash, ip_hash, last_ok_at) VALUES (?,?,?) ON CONFLICT(email_hash, ip_hash) DO UPDATE SET last_ok_at=excluded.last_ok_at', ek, nk, t);
    run(`DELETE FROM otp_trusted_ips WHERE email_hash=? AND (last_ok_at < ? OR ip_hash NOT IN
         (SELECT ip_hash FROM otp_trusted_ips WHERE email_hash=? ORDER BY last_ok_at DESC LIMIT ?))`, ek, t - TRUSTED_TTL, ek, TRUSTED_MAX);
  });
}

export function guardForget(email: string): void {
  const ek = emailKey(email);
  run('DELETE FROM otp_guard WHERE email_hash=?', ek);
  run('DELETE FROM otp_trusted_ips WHERE email_hash=?', ek);
}

export function purgeGuard(): void {
  const t = now();
  run('DELETE FROM otp_guard WHERE updated_at < ? AND locked_until < ?', t - 2 * DAY, t);
  run('DELETE FROM otp_trusted_ips WHERE last_ok_at < ?', t - TRUSTED_TTL);
}
