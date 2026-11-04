import type { Customer, DocLine, DocType } from '../../types';
import { uid } from '../../types';

const KEY = 'vocepreventivo:draft:v1';

export interface Draft {
  stage: 'input' | 'edit';
  type: DocType;
  transcript: string;
  customer: Customer;
  lines: DocLine[];
  notes: string;
  savedAt: number;
}

/**
 * JSON non rappresenta -0, NaN e ±Infinity (diventano 0 / null): una riga di sconto con importo -0 perdeva il segno
 * (e quindi lo stato di "sconto") e un valore non finito spariva in silenzio. Questi numeri vengono scritti come
 * oggetto marcatore `{"$num":"-0"}` e ripristinati in lettura. I numeri normali restano numeri JSON: le bozze scritte
 * dalla versione precedente si leggono senza modifiche.
 */
const SPECIAL = '$num';
const encodeNum = (_k: string, v: unknown): unknown => {
  if (typeof v !== 'number') return v;
  if (Object.is(v, -0)) return { [SPECIAL]: '-0' };
  if (Number.isNaN(v)) return { [SPECIAL]: 'NaN' };
  if (v === Infinity) return { [SPECIAL]: 'Infinity' };
  if (v === -Infinity) return { [SPECIAL]: '-Infinity' };
  return v;
};
const decodeNum = (_k: string, v: unknown): unknown => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === SPECIAL) {
      switch ((v as Record<string, unknown>)[SPECIAL]) {
        case '-0': return -0;
        case 'NaN': return NaN;
        case 'Infinity': return Infinity;
        case '-Infinity': return -Infinity;
        default: return v;
      }
    }
  }
  return v;
};

/** Serializza una bozza senza perdere -0, NaN, ±Infinity. */
export const serializeDraft = (d: Draft): string => JSON.stringify(d, encodeNum);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback); // NaN/±Infinity/-0 si conservano di proposito

/**
 * REV2-D1: la bozza arriva da localStorage (modificabile, scritta da versioni precedenti, troncata): i campi che la pagina usa
 * con `.trim()`/`.map()` devono avere il tipo giusto, altrimenti `/nuovo` andava in errore a ogni visita finché non si svuotava il sito.
 * I valori numerici fuori dall'ordinario (NaN, ±Infinity, -0) restano com'erano: lo scopo di `$num`.
 */
function sanitizeDraft(d: Draft): Draft {
  const raw = d as unknown as Record<string, unknown>;
  const c = d.customer as unknown as Record<string, unknown>;
  const customer = { ...c, id: text(c.id) || uid(), name: text(c.name) } as unknown as Customer;
  const lines = d.lines.map((l): DocLine => {
    const r = l as unknown as Record<string, unknown>;
    const out = { ...r, id: text(r.id) || uid(), description: text(r.description), unit: text(r.unit) || 'pz', qty: num(r.qty, 1), unitPrice: num(r.unitPrice, 0), vat: num(r.vat, 0) } as Record<string, unknown>;
    if (out.discountPct !== undefined && typeof out.discountPct !== 'number') delete out.discountPct;
    return out as unknown as DocLine;
  });
  return {
    ...d, // ordine delle chiavi invariato: parse -> serialize resta idempotente
    stage: raw.stage === 'edit' ? 'edit' : 'input',
    type: raw.type === 'fattura' ? 'fattura' : 'preventivo',
    transcript: text(raw.transcript), notes: text(raw.notes),
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
    customer, lines,
  };
}

/** Legge una bozza serializzata (anche nel formato precedente); null se non valida. */
export const parseDraft = (raw: string): Draft | null => {
  try {
    const d = JSON.parse(raw, decodeNum) as Draft;
    if (!d || typeof d !== 'object' || !Array.isArray(d.lines) || !d.customer || typeof d.customer !== 'object' || Array.isArray(d.customer)) return null;
    if (d.lines.some((l) => !l || typeof l !== 'object' || Array.isArray(l))) return null;
    return sanitizeDraft(d);
  } catch { return null; }
};

export const loadDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseDraft(raw) : null;
  } catch { return null; }
};
export const saveDraft = (d: Draft): void => {
  try { localStorage.setItem(KEY, serializeDraft(d)); } catch { /* quota o storage disattivato */ }
};
export const clearDraft = (): void => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
