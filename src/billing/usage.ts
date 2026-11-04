/**
 * Conteggio dei documenti creati nel mese di calendario.
 *
 * LIMITE MORBIDO (onestà): il conteggio vive sul dispositivo (storage locale + registro in localStorage),
 * quindi chi non ha un account può aggirarlo (cancellare i dati del browser, usare un altro browser).
 * Non è una protezione: serve a far rispettare il piano a chi lo vuole rispettare. L'unico limite
 * VINCOLANTE è quello del server sui documenti sincronizzati (SyncConflict 'quota_exceeded').
 *
 * Regole:
 *  - conta i documenti NUOVI (preventivi e fatture) in base a `createdAt`, nel mese di calendario del dispositivo
 *    (il server usa il mese UTC: a cavallo del mese le due viste possono differire di qualche ora);
 *  - le note di credito (TD04) NON contano e non sono mai bloccate: stornare è un obbligo, non una scelta;
 *  - le bozze eliminate NON rimborsano: ogni id creato si registra nel registro e resta contato nel mese;
 *  - modificare, scaricare e consultare non passano mai da qui.
 */
import type { QuoteDocument } from '../types';

const LEDGER_KEY = 'vp:billing:ledger';
const KEEP_MONTHS = 3;
export const BILLING_CHANGED_EVENT = 'vp:billing-changed';

/** Chiave 'YYYY-MM' del mese di calendario di `ts`. `timeZone` (IANA) opzionale: default = fuso del dispositivo. */
export function monthKey(ts: number, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(ts));
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const m = parts.find((p) => p.type === 'month')?.value ?? '00';
    return `${y}-${m}`;
  }
  const d = new Date(ts);
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Primo istante del mese successivo (per dire "il contatore riparte il 1 dicembre"). */
export function nextMonthStart(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

type CountableDoc = Pick<QuoteDocument, 'id' | 'createdAt'> & { invoice?: { tipoDocumento?: string } };

/** Le note di credito non si contano né si bloccano. */
export const isCountable = (d: CountableDoc): boolean => d.invoice?.tipoDocumento !== 'TD04';

/**
 * Documenti creati nel mese di `now`: unione degli id presenti (createdAt nel mese) e di quelli registrati
 * nel registro (così una bozza eliminata resta contata). Mai doppio conteggio dello stesso id.
 */
export function countDocsInMonth(docs: readonly CountableDoc[], ledgerIds: readonly string[], now: number, timeZone?: string): number {
  const key = monthKey(now, timeZone);
  const ids = new Set<string>(ledgerIds);
  for (const d of docs) {
    if (!isCountable(d)) { ids.delete(d.id); continue; }
    if (typeof d.createdAt === 'number' && monthKey(d.createdAt, timeZone) === key) ids.add(d.id);
  }
  return ids.size;
}

// ---- registro locale (mai fa lanciare l'app) ----
type Ledger = Record<string, string[]>; // 'YYYY-MM' -> id creati

function readLedger(): Ledger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out: Ledger = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}$/.test(k) && Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch { return {}; }
}

export function ledgerIdsForMonth(now: number, timeZone?: string): string[] {
  return readLedger()[monthKey(now, timeZone)] ?? [];
}

/** Registra un documento appena creato. Idempotente. Tiene solo gli ultimi mesi. */
export function recordDocumentCreated(id: string, createdAt: number, timeZone?: string): void {
  try {
    const ledger = readLedger();
    const k = monthKey(createdAt, timeZone);
    const ids = new Set(ledger[k] ?? []);
    ids.add(id);
    ledger[k] = [...ids];
    const keys = Object.keys(ledger).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_MONTHS))) delete ledger[old];
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch { /* storage non disponibile: resta il conteggio dai documenti presenti */ }
  notifyBillingChanged();
}

export function notifyBillingChanged(): void {
  try { window.dispatchEvent(new Event(BILLING_CHANGED_EVENT)); } catch { /* ignora */ }
}
