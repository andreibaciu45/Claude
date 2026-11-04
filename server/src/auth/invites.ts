// Codici invito monouso per un lancio privato. Attivi solo con INVITE_ONLY=1, e solo per CREARE un account (chi ha gia' un account entra come sempre).
// Il codice (es. VP-7K2M-9QXD-4TBN, 60 bit) si genera con la CLI (`admin.ts create-invite-code`); nel DB resta solo l'hash.
// Un codice puo' essere vincolato a un'email (--email): in quel caso vale solo per quell'indirizzo. Scadenza opzionale.
import { randomBytes } from 'node:crypto';
import { all, one, run } from '../db';
import { now } from '../db/clock';
import { sha256Hex } from './crypto';

export const inviteOnly = (): boolean => process.env.INVITE_ONLY === '1';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: niente I, L, O, U
export const INVITE_LEN = 12;

/** Maiuscole, solo caratteri dell'alfabeto; O->0, I/L->1 (errori di battitura comuni). */
export function normalizeInvite(raw: string): string {
  const n = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return (n.length === INVITE_LEN + 2 && n.startsWith('VP') ? n.slice(2) : n).replace(/O/g, '0').replace(/[IL]/g, '1');
}
export const formatInvite = (n: string): string => `VP-${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8, 12)}`;
const codeHash = (normalized: string): string => sha256Hex(`invite|${normalized}`);
const emailHash = (email: string): string => sha256Hex(`invite-email|${email.trim().toLowerCase()}`);

export function newInviteCode(): string {
  const b = randomBytes(INVITE_LEN);
  let s = '';
  for (let i = 0; i < INVITE_LEN; i++) s += ALPHABET[b[i]! & 31];
  return s;
}

export function createInvite(opts: { email?: string; days?: number; note?: string } = {}): { code: string; expiresAt: number | null } {
  const raw = newInviteCode();
  const t = now();
  const expiresAt = opts.days ? t + opts.days * 86_400_000 : null;
  run('INSERT INTO invite_codes(code_hash, created_at, expires_at, email_hash, note) VALUES (?,?,?,?,?)',
    codeHash(raw), t, expiresAt, opts.email ? emailHash(opts.email) : null, opts.note ? opts.note.slice(0, 200) : null);
  return { code: formatInvite(raw), expiresAt };
}

export type InviteProblem = 'invalid' | 'used' | 'expired' | 'email_mismatch';
export const INVITE_MESSAGES: Record<InviteProblem | 'required', string> = {
  required: "Accesso su invito: inserisci il codice invito che hai ricevuto per creare l'account.",
  invalid: 'Codice invito non valido.',
  used: 'Codice invito già utilizzato.',
  expired: 'Codice invito scaduto.',
  email_mismatch: 'Questo codice invito è riservato a un altro indirizzo email.',
};

interface Row { code_hash: string; expires_at: number | null; email_hash: string | null; used_at: number | null }
export function checkInvite(raw: string | undefined, email: string): { ok: true } | { ok: false; reason: InviteProblem } {
  const n = normalizeInvite(raw ?? '');
  if (n.length !== INVITE_LEN) return { ok: false, reason: 'invalid' };
  const r = one<Row>('SELECT code_hash, expires_at, email_hash, used_at FROM invite_codes WHERE code_hash=?', codeHash(n));
  if (!r) return { ok: false, reason: 'invalid' };
  if (r.used_at !== null) return { ok: false, reason: 'used' };
  if (r.expires_at !== null && r.expires_at <= now()) return { ok: false, reason: 'expired' };
  if (r.email_hash !== null && r.email_hash !== emailHash(email)) return { ok: false, reason: 'email_mismatch' };
  return { ok: true };
}

/** Consuma il codice in modo atomico (monouso). false se nel frattempo e' stato usato/scaduto. */
export function redeemInvite(raw: string | undefined, email: string, tenantId: string): boolean {
  const n = normalizeInvite(raw ?? '');
  const t = now();
  const r = run(`UPDATE invite_codes SET used_at=?, used_by_tenant=? WHERE code_hash=? AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
                 AND (email_hash IS NULL OR email_hash = ?)`, t, tenantId, codeHash(n), t, emailHash(email));
  return Number(r.changes) === 1;
}

export interface InviteInfo { codeHashPrefix: string; createdAt: number; expiresAt: number | null; boundToEmail: boolean; note: string | null; status: 'disponibile' | 'usato' | 'scaduto'; usedAt: number | null }
export function listInvites(): InviteInfo[] {
  const t = now();
  return all<Row & { created_at: number; note: string | null }>('SELECT * FROM invite_codes ORDER BY created_at DESC').map((r) => ({
    codeHashPrefix: r.code_hash.slice(0, 8), createdAt: r.created_at, expiresAt: r.expires_at, boundToEmail: r.email_hash !== null, note: r.note, usedAt: r.used_at,
    status: r.used_at !== null ? 'usato' : r.expires_at !== null && r.expires_at <= t ? 'scaduto' : 'disponibile',
  }));
}
/** Elimina un codice NON ancora usato. */
export function revokeInvite(raw: string): boolean {
  return Number(run('DELETE FROM invite_codes WHERE code_hash=? AND used_at IS NULL', codeHash(normalizeInvite(raw))).changes) === 1;
}
