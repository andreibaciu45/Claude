// Accettazione di Termini di servizio e DPA (art. 28 GDPR) al primo accesso: versione + data/ora del SERVER (+ hash dell'IP se TERMS_STORE_IP_HASH=1).
// Variabili: REQUIRE_TERMS=1 (obbligatorio alla creazione dell'account), TERMS_CURRENT_VERSION / DPA_CURRENT_VERSION (se impostate, la versione
// inviata deve coincidere), TERMS_STORE_IP_HASH=1 (salva HMAC(AUTH_SECRET, IP): minimizzazione, di default NO).
// Proposta per shared/api.ts: `AuthVerifyBody.acceptedTerms?: { termsVersion: string; dpaVersion?: string; acceptedAt?: number }`.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { all, one, run } from '../db';
import { now } from '../db/clock';
import { audit } from '../db/audit';
import { getAuthSecret } from './crypto';

const version = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, 'versione non valida');
export const acceptedTermsSchema = z.object({
  termsVersion: version,
  dpaVersion: version.optional(),
  acceptedAt: z.number().int().nonnegative().optional(), // orologio del client: solo informativo, non fa fede
});
export type AcceptedTerms = z.infer<typeof acceptedTermsSchema>;

export const requireTerms = (): boolean => process.env.REQUIRE_TERMS === '1';

export const TERMS_REQUIRED_MESSAGE =
  "Per creare l'account occorre accettare i Termini di servizio e il DPA (art. 28 GDPR): invia il campo acceptedTerms { termsVersion, dpaVersion }.";

/** Messaggio d'errore se le versioni inviate non sono quelle correnti (quando configurate), altrimenti null. */
export function termsVersionError(t: AcceptedTerms): string | null {
  const ct = process.env.TERMS_CURRENT_VERSION, cd = process.env.DPA_CURRENT_VERSION;
  if (ct && t.termsVersion !== ct) return 'Versione dei Termini non aggiornata: ricarica l\'app e riaccetta.';
  if (cd && t.dpaVersion !== undefined && t.dpaVersion !== cd) return 'Versione del DPA non aggiornata: ricarica l\'app e riaccetta.';
  return null;
}
/** true se, per creare l'account con REQUIRE_TERMS=1, mancano Termini o DPA. */
export const termsIncomplete = (t: AcceptedTerms | undefined): boolean => !t || !t.dpaVersion;

const ipHashOf = (ipKey: string) => createHmac('sha256', getAuthSecret()).update(`terms-ip|${ipKey}`).digest('hex').slice(0, 32);

/** Registra (append-only) le versioni accettate se diverse dall'ultima registrata per quel tipo. Da chiamare dentro una transazione. */
export function recordAcceptance(tenantId: string, userId: string, t: AcceptedTerms, ipKey?: string): void {
  const at = now();
  const ip = process.env.TERMS_STORE_IP_HASH === '1' && ipKey ? ipHashOf(ipKey) : null;
  const done: Record<string, string> = {};
  for (const [kind, v] of [['terms', t.termsVersion], ['dpa', t.dpaVersion]] as const) {
    if (!v) continue;
    const last = one<{ version: string }>('SELECT version FROM legal_acceptances WHERE tenant_id=? AND kind=? ORDER BY id DESC LIMIT 1', tenantId, kind);
    if (last?.version === v) continue;
    run('INSERT INTO legal_acceptances(tenant_id, user_id, kind, version, accepted_at, client_accepted_at, ip_hash) VALUES (?,?,?,?,?,?,?)',
      tenantId, userId, kind, v, at, t.acceptedAt ?? null, ip);
    done[kind] = v;
  }
  if (Object.keys(done).length) audit(tenantId, userId, 'legal.accept', 'legal', undefined, done);
}

export interface AcceptanceRow { kind: string; version: string; acceptedAt: number; clientAcceptedAt: number | null; ipHash: string | null }
export function listAcceptances(tenantId: string): AcceptanceRow[] {
  return all<{ kind: string; version: string; accepted_at: number; client_accepted_at: number | null; ip_hash: string | null }>(
    'SELECT kind, version, accepted_at, client_accepted_at, ip_hash FROM legal_acceptances WHERE tenant_id=? ORDER BY id', tenantId)
    .map((r) => ({ kind: r.kind, version: r.version, acceptedAt: r.accepted_at, clientAcceptedAt: r.client_accepted_at, ipHash: r.ip_hash }));
}
