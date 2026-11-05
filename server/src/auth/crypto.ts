import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url'); // 256 bit

/** Confronto in tempo costante tra due stringhe (anche di lunghezza diversa). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

let devSecret: string | null = null;
export function getAuthSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET obbligatorio (>=16 caratteri) in produzione');
  return (devSecret ??= randomBytes(32).toString('hex'));
}
export const otpHash = (email: string, code: string): string => createHmac('sha256', getAuthSecret()).update(`${email}:${code}`).digest('hex');

/** Chiave per le tabelle dei limiti (persistite 24 ore): HMAC, non SHA-256 semplice (email e IPv4 sarebbero invertibili con un dizionario). */
export const rlHash = (s: string): string => createHmac('sha256', getAuthSecret()).update(`rl|${s}`).digest('hex').slice(0, 32);

/** Pseudonimo per i log: HMAC con il segreto del server (non invertibile con un dizionario di email). 12 caratteri. */
export const logHash = (s: string): string => createHmac('sha256', getAuthSecret()).update(`log|${s}`).digest('hex').slice(0, 12);

/** HMAC con il segreto del server, per chiavi non invertibili (email/IP nelle tabelle di difesa OTP). */
export const hmacHex = (label: string, s: string): string => createHmac('sha256', getAuthSecret()).update(`${label}|${s}`).digest('hex');
