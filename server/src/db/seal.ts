// Cifratura applicativa AES-256-GCM dei campi sensibili (ARCHITECTURE-V2 §1.7).
//
// Formato di un valore cifrato:  enc:v1:<kid>:<base64url( iv(12) | tag(16) | ciphertext )>
//   - kid = identificativo della chiave (rotazione): APP_ENCRYPTION_KEY_ID (default "k1").
//   - Senza APP_ENCRYPTION_KEY i dati restano in chiaro (retro-compatibile); in lettura si accetta SEMPRE un misto di chiaro e cifrato.
//   - Chiavi: 32 byte in esadecimale (64 caratteri) o base64. Generare con `openssl rand -base64 32`. Mai nel repository.
//   - Rotazione: APP_ENCRYPTION_KEY = nuova chiave (+ ID nuovo); le vecchie restano in APP_ENCRYPTION_OLD_KEYS="k1:<chiave>,k0:<chiave>"
//     per la sola decifratura. Le nuove scritture usano la chiave corrente; `scripts/rotate-encryption-key.ts` ricifra i dati non bloccati.
//
// Due modalità:
//   - random (IV casuale): profilo, payload del log di sync, audit. Nessuna perdita di informazione.
//   - deterministica (IV = HMAC(sottochiave, aad|chiaro), "SIV-like"): SOLO per i campi dei documenti, perché i trigger SQL delle fatture
//     emesse confrontano `data` prima/dopo l'UPDATE e una ricifratura casuale di campi invariati verrebbe scambiata per una modifica.
//     Costo: chi legge il DB vede se due valori cifrati dello STESSO documento e campo sono uguali (nessun altro leak).
//     Con lo stesso IV e testi diversi il GCM sarebbe insicuro: qui l'IV dipende dal testo, quindi IV uguale <=> testo uguale.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
export interface Key { id: string; key: Buffer }
export interface KeyRing { current: Key; all: Map<string, Buffer> }

function parseKey(raw: string, label: string): Buffer {
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (buf.length !== 32) throw new Error(`${label}: la chiave deve essere di 32 byte (64 caratteri esadecimali o base64)`);
  return buf;
}

let cache: { sig: string; ring: KeyRing | null } | null = null;
/** Anello di chiavi dall'ambiente (null = cifratura disattivata). Lancia se la configurazione è invalida. */
export function getKeyRing(): KeyRing | null {
  const sig = `${process.env.APP_ENCRYPTION_KEY ?? ''}|${process.env.APP_ENCRYPTION_KEY_ID ?? ''}|${process.env.APP_ENCRYPTION_OLD_KEYS ?? ''}`;
  if (cache && cache.sig === sig) return cache.ring;
  let ring: KeyRing | null = null;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) {
    const id = (process.env.APP_ENCRYPTION_KEY_ID || 'k1').trim();
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error('APP_ENCRYPTION_KEY_ID non valido (1-16 caratteri [A-Za-z0-9_-])');
    const current = { id, key: parseKey(raw, 'APP_ENCRYPTION_KEY') };
    const all = new Map<string, Buffer>([[id, current.key]]);
    for (const part of (process.env.APP_ENCRYPTION_OLD_KEYS ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
      const i = part.indexOf(':');
      if (i < 1) throw new Error('APP_ENCRYPTION_OLD_KEYS: formato "id:chiave,id:chiave"');
      const oid = part.slice(0, i);
      if (all.has(oid)) throw new Error(`APP_ENCRYPTION_OLD_KEYS: id duplicato ${oid}`);
      all.set(oid, parseKey(part.slice(i + 1), `APP_ENCRYPTION_OLD_KEYS[${oid}]`));
    }
    ring = { current, all };
  }
  cache = { sig, ring };
  return ring;
}

export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX);
export const encryptionEnabled = (): boolean => getKeyRing() !== null;
/** Identificativo della chiave con cui è cifrato un valore (null se in chiaro). */
export const sealedKeyId = (v: unknown): string | null => (isSealed(v) ? v.split(':')[2] ?? null : null);

function sub(key: Buffer, label: string): Buffer { return createHmac('sha256', key).update(label).digest(); }

export function seal(plain: string, aad: string, mode: 'random' | 'deterministic' = 'random'): string {
  const ring = getKeyRing();
  if (!ring) return plain;
  const { id, key } = ring.current;
  const iv = mode === 'deterministic'
    ? createHmac('sha256', sub(key, 'vp-siv-iv')).update(aad).update('\0').update(plain).digest().subarray(0, 12)
    : randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${PREFIX}${id}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
}

/** Decifra; un valore non cifrato è restituito com'è. Lancia se la chiave manca o il dato/aad è alterato. */
export function open(value: string, aad: string): string {
  if (!isSealed(value)) return value;
  const [, , kid, b64] = value.split(':');
  const ring = getKeyRing();
  const key = kid ? ring?.all.get(kid) : undefined;
  if (!key) throw new Error(`chiave di cifratura "${kid}" non disponibile`);
  const raw = Buffer.from(b64 ?? '', 'base64url');
  if (raw.length < 28) throw new Error('valore cifrato troncato');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

export const sealJson = (obj: unknown, aad: string, mode: 'random' | 'deterministic' = 'random'): string => seal(JSON.stringify(obj), aad, mode);
export const openJson = <T = unknown>(text: string, aad: string): T => JSON.parse(open(text, aad)) as T;

// ---- Campi sensibili dei documenti ----
// customer (anagrafica del cliente dell'artigiano: nome, P.IVA, CF, indirizzo, email), notes, transcript, invoice.xml (contiene tutto).
// Restano in chiaro (e quindi indicizzabili/visibili ai trigger): id, type, number, date, status, lines, invoice.{year,sectional,seq,number,lockedAt,sdiEvents,payments,...}.
type Doc = Record<string, any>;
const aadDoc = (tenantId: string, docId: string, field: string) => `doc|${tenantId}|${docId}|${field}`;

export function sealDocument(tenantId: string, doc: Doc): Doc {
  if (!encryptionEnabled()) return doc;
  const out: Doc = { ...doc };
  const id = String(doc.id);
  if (doc.customer !== undefined && !isSealed(doc.customer)) out.customer = sealJson(doc.customer, aadDoc(tenantId, id, 'customer'), 'deterministic');
  for (const f of ['notes', 'transcript'] as const) {
    if (typeof doc[f] === 'string' && !isSealed(doc[f])) out[f] = seal(doc[f], aadDoc(tenantId, id, f), 'deterministic');
  }
  if (doc.invoice && typeof doc.invoice.xml === 'string' && !isSealed(doc.invoice.xml)) {
    out.invoice = { ...doc.invoice, xml: seal(doc.invoice.xml, aadDoc(tenantId, id, 'invoice.xml'), 'deterministic') };
  }
  return out;
}

export function openDocument(tenantId: string, doc: Doc): Doc {
  const id = String(doc.id);
  const out: Doc = { ...doc };
  if (isSealed(doc.customer)) out.customer = openJson(doc.customer, aadDoc(tenantId, id, 'customer'));
  for (const f of ['notes', 'transcript'] as const) if (isSealed(doc[f])) out[f] = open(doc[f], aadDoc(tenantId, id, f));
  if (doc.invoice && isSealed(doc.invoice.xml)) out.invoice = { ...doc.invoice, xml: open(doc.invoice.xml, aadDoc(tenantId, id, 'invoice.xml')) };
  return out;
}

/** Vero se qualche campo del documento è cifrato con una chiave diversa da quella corrente (serve alla rotazione). */
export function documentKeyIds(doc: Doc): string[] {
  const ids = [doc.customer, doc.notes, doc.transcript, doc.invoice?.xml].map(sealedKeyId).filter((x): x is string => x !== null);
  return [...new Set(ids)];
}

// ---- Payload del log di sync / profilo / audit: intero blob, IV casuale ----
export const aadChange = (tenantId: string, entity: string, entityId: string) => `chg|${tenantId}|${entity}|${entityId}`;
export const aadProfile = (tenantId: string) => `profile|${tenantId}`;
export const aadAudit = (tenantId: string, entryId: string) => `audit|${tenantId}|${entryId}`;
