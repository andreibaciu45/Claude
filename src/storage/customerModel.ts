/**
 * Rubrica clienti: logica PURA (nessun accesso allo storage) — normalizzazione, dedup, ricerca, popolamento iniziale.
 *
 * NOTA: la rubrica è SOLO LOCALE (IndexedDB + backup JSON). Il contratto di sync (shared/api.ts) non ha l'entità
 * 'customer': i clienti NON vengono sincronizzati col server in questa versione. I documenti già emessi mantengono
 * comunque la propria copia dei dati cliente, quindi la rubrica non influisce mai su fatture/preventivi esistenti.
 */
import type { Customer, QuoteDocument } from '../types';
import { uid } from '../types';

export interface StoredCustomer extends Customer {
  createdAt: number;
  updatedAt: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Nome normalizzato per il confronto: senza accenti, punteggiatura e maiuscole ("S.r.l." = "Srl", "D'Angelo" = "Dangelo"). */
export const normName = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** P.IVA normalizzata: solo cifre, senza prefisso IT. Vuoto se non plausibile (non 11 cifre). */
export const normVat = (s: unknown): string => {
  const v = str(s).replace(/\s/g, '').toUpperCase().replace(/^IT/, '');
  return /^\d{11}$/.test(v) ? v : '';
};
export const normCf = (s: unknown): string => str(s).replace(/\s/g, '').toUpperCase();

const OPTIONAL = ['vatNumber', 'fiscalCode', 'country', 'zip', 'city', 'province', 'codiceDestinatario', 'pec', 'address', 'email', 'phone', 'vatOrFiscalCode'] as const;

/** Pulisce un cliente: trim, maiuscole dove serve, campo unico v1 smistato in P.IVA / CF, campi vuoti rimossi. */
export function normalizeCustomerRecord<T extends Customer>(c: T): T {
  const out = { ...c, name: str(c.name).replace(/\s+/g, ' ') } as unknown as Record<string, unknown>;
  for (const k of OPTIONAL) {
    const v = str(out[k]);
    if (v) out[k] = v; else delete out[k];
  }
  if (out.vatNumber) out.vatNumber = String(out.vatNumber).replace(/\s/g, '').toUpperCase().replace(/^IT(?=\d{11}$)/, '');
  if (out.fiscalCode) out.fiscalCode = String(out.fiscalCode).replace(/\s/g, '').toUpperCase();
  if (out.province) out.province = String(out.province).toUpperCase();
  if (out.country) out.country = String(out.country).toUpperCase();
  if (out.codiceDestinatario) out.codiceDestinatario = String(out.codiceDestinatario).toUpperCase();
  const raw = str(out.vatOrFiscalCode).replace(/\s/g, '').toUpperCase();
  if (raw && !out.vatNumber && !out.fiscalCode) {
    if (/^\d{11}$/.test(raw)) { out.vatNumber = raw; delete out.vatOrFiscalCode; }
    else if (/^[A-Z0-9]{16}$/.test(raw)) { out.fiscalCode = raw; delete out.vatOrFiscalCode; }
  } else if (raw && (out.vatNumber || out.fiscalCode)) delete out.vatOrFiscalCode;
  return out as unknown as T;
}

/**
 * Stesso cliente? Prima gli identificativi fiscali (P.IVA poi CF: se entrambi presenti decidono loro, anche
 * per escludere), poi, in assenza di conflitti, il nome normalizzato.
 */
export function sameCustomer(a: Partial<Customer>, b: Partial<Customer>): boolean {
  const va = normVat(a.vatNumber ?? (a.vatOrFiscalCode && /^\s*(IT)?\d{11}\s*$/i.test(a.vatOrFiscalCode) ? a.vatOrFiscalCode : ''));
  const vb = normVat(b.vatNumber ?? (b.vatOrFiscalCode && /^\s*(IT)?\d{11}\s*$/i.test(b.vatOrFiscalCode) ? b.vatOrFiscalCode : ''));
  if (va && vb) return va === vb;
  const ca = normCf(a.fiscalCode);
  const cb = normCf(b.fiscalCode);
  if (ca && cb) return ca === cb;
  const na = normName(a.name ?? '');
  return !!na && na === normName(b.name ?? '');
}

export const findDuplicate = <T extends Customer>(c: Customer, list: T[], exceptId?: string): T | undefined =>
  list.find((x) => x.id !== exceptId && sameCustomer(c, x));

/** Completa SOLO i campi vuoti di `base` con quelli di `extra` (non sovrascrive mai un dato esistente). */
export function fillMissing<T extends Customer>(base: T, extra: Partial<Customer>): { value: T; changed: boolean } {
  const out = { ...base } as Record<string, unknown>;
  let changed = false;
  for (const k of OPTIONAL) {
    if (k === 'vatOrFiscalCode') continue;
    const cur = str(out[k]);
    const add = str((extra as Record<string, unknown>)[k]);
    if (!cur && add) { out[k] = add; changed = true; }
  }
  return { value: normalizeCustomerRecord(out as unknown as T), changed };
}

/** Suggerimenti per l'autocompletamento: nome (inizio > parola che inizia > contiene) oppure P.IVA/CF parziale. */
export function searchCustomers<T extends Customer>(query: string, list: T[], limit = 6): T[] {
  const q = normName(query);
  const digits = query.replace(/[\s.]/g, '').toUpperCase();
  if (!q) return [];
  const qt = q.split(' ');
  const scored: { c: T; s: number }[] = [];
  for (const c of list) {
    const n = normName(c.name);
    let s = 0;
    if (n === q) s = 5;
    else if (n.startsWith(q)) s = 4;
    else if (qt.every((t) => n.split(' ').some((w) => w.startsWith(t)))) s = 3;
    else if (n.includes(q)) s = 2;
    if (!s && digits.length >= 3) {
      const ids = [normVat(c.vatNumber), normCf(c.fiscalCode)].filter(Boolean);
      if (ids.some((i) => i.startsWith(digits) || (digits.length >= 5 && i.includes(digits)))) s = 2;
    }
    if (s) scored.push({ c, s });
  }
  return scored.sort((x, y) => y.s - x.s || x.c.name.localeCompare(y.c.name, 'it', { sensitivity: 'base' })).slice(0, limit).map((x) => x.c);
}

/** Il documento è di questo cliente? (stesso id di rubrica, oppure stessi dati identificativi: copre i documenti precedenti alla rubrica) */
export const docBelongsTo = (doc: Pick<QuoteDocument, 'customer'>, c: Customer): boolean =>
  !!doc.customer && (doc.customer.id === c.id || sameCustomer(doc.customer, c));

/**
 * Popolamento iniziale dai clienti già presenti nei documenti. Idempotente: un cliente già in `existing`
 * (stessa P.IVA/CF/nome) non viene duplicato; dai documenti più recenti si prendono i dati più aggiornati.
 * Restituisce SOLO i record nuovi o modificati.
 */
export function seedCustomersFromDocuments(docs: QuoteDocument[], existing: StoredCustomer[], now = Date.now()): StoredCustomer[] {
  const book = existing.map((c) => ({ ...c }));
  const touched = new Map<string, StoredCustomer>();
  const usedIds = new Set(book.map((c) => c.id));
  const sorted = [...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const d of sorted) {
    if (!d.customer || !str(d.customer.name)) continue;
    const c = normalizeCustomerRecord(d.customer);
    const dup = findDuplicate(c, book);
    if (dup) {
      const idx = book.indexOf(dup);
      const { value, changed } = fillMissing(dup, c);
      const created = Math.min(dup.createdAt, d.createdAt || dup.createdAt);
      if (changed || created !== dup.createdAt) {
        book[idx] = { ...value, createdAt: created, updatedAt: changed ? now : dup.updatedAt };
        touched.set(dup.id, book[idx]);
      }
      continue;
    }
    const id = c.id && !usedIds.has(c.id) ? c.id : uid();
    usedIds.add(id);
    const rec: StoredCustomer = { ...c, id, createdAt: d.createdAt || now, updatedAt: now };
    book.push(rec);
    touched.set(id, rec);
  }
  return [...touched.values()];
}
