/**
 * Banco di prova: tipi, scorciatoie per scrivere i casi e valutatore.
 * Il valutatore legge anche i campi "estesi" (sconto, IVA, note, mani) con accesso difensivo,
 * così lo stesso banco gira sia sul motore base sia su quello esteso.
 */
import type { CatalogItem, DocLine, Unit } from '../../types';
import { computeTotals } from '../totals';
import { TRADES, type Trade } from './catalogs';

export interface BLine {
  id?: string | string[];
  free?: string;
  qty: number;
  unit?: Unit;
  price?: number;
  review?: boolean;
  /** testo atteso nella descrizione della riga (nota: stanza, zona...) */
  note?: string;
  /** numero di mani atteso (annotato, non moltiplicato) */
  coats?: number;
}
export interface BCase {
  t: string;
  trade: Trade;
  cust?: string | null;
  lines: BLine[];
  disc?: { pct?: number; amount?: number };
  vat?: number;
  /** "come da preventivo precedente" */
  prev?: boolean;
  /** nessun frammento non capito */
  clean?: boolean;
  /** categoria, per le statistiche */
  tag?: string;
}

export const L = (id: string, qty: number, unit?: Unit, o: Omit<BLine, 'id' | 'qty' | 'unit'> = {}): BLine => ({ id, qty, unit, ...o });
export const F = (free: string, qty: number, unit?: Unit, o: Omit<BLine, 'free' | 'qty' | 'unit'> = {}): BLine => ({ free, qty, unit, ...o });

const PREFIX: Record<Trade, string> = { idraulico: 'i', elettricista: 'e', imbianchino: 'm', serramentista: 's', muratore: 'u', manutentore: 'c' };

/** Costruisce una scorciatoia per un mestiere: gli id si scrivono senza prefisso. */
export function forTrade(trade: Trade) {
  const p = PREFIX[trade];
  const l = (id: string, qty: number, unit?: Unit, o: Omit<BLine, 'id' | 'qty' | 'unit'> = {}): BLine => ({ id: `${p}-${id}`, qty, unit, ...o });
  const c = (t: string, lines: BLine[], x: Partial<Omit<BCase, 't' | 'trade' | 'lines'>> = {}): BCase => ({ t, trade, lines, ...x });
  return { l, c, f: F };
}

export function catalogOf(trade: Trade): CatalogItem[] {
  return TRADES[trade];
}

type Ext = {
  discount?: { pct?: number; amount?: number };
  vatRate?: number;
  referencesPrevious?: boolean;
  lineMeta?: Record<string, { note?: string; coats?: number }>;
};

export function lineErrors(l: DocLine | undefined, e: BLine, ext: Ext): string[] {
  if (!l) return ['riga mancante'];
  const errs: string[] = [];
  if (e.id !== undefined) {
    const ids = Array.isArray(e.id) ? e.id : [e.id];
    if (!l.catalogItemId || !ids.includes(l.catalogItemId)) errs.push(`id ${l.catalogItemId} != ${ids.join('|')}`);
  }
  if (e.free !== undefined) {
    if (l.catalogItemId) errs.push(`atteso libera, trovato ${l.catalogItemId}`);
    if (!l.description.toLowerCase().includes(e.free.toLowerCase())) errs.push(`descr "${l.description}" senza "${e.free}"`);
  }
  if (Math.abs(l.qty - e.qty) > 1e-6) errs.push(`qty ${l.qty} != ${e.qty}`);
  if (e.unit && l.unit !== e.unit) errs.push(`unit ${l.unit} != ${e.unit}`);
  if (e.review !== undefined && !!l.needsReview !== e.review) errs.push(`review ${!!l.needsReview} != ${e.review}`);
  if (e.price !== undefined && Math.abs(l.unitPrice - e.price) > 1e-6) errs.push(`prezzo ${l.unitPrice} != ${e.price}`);
  if (e.note !== undefined && !l.description.toLowerCase().includes(e.note.toLowerCase())) errs.push(`nota "${e.note}" assente in "${l.description}"`);
  if (e.coats !== undefined) {
    const meta = ext.lineMeta?.[l.id];
    if (meta?.coats !== e.coats) errs.push(`mani ${meta?.coats} != ${e.coats}`);
  }
  return errs;
}

export interface Outcome {
  ok: boolean;
  errs: string[];
  lineOk: number;
  lineTotal: number;
}

export function judge(c: BCase, r: import('../../types').ParseResult & Ext): Outcome {
  const errs: string[] = [];
  let lineOk = 0;
  if (c.cust !== undefined && (r.customerName ?? null) !== c.cust) errs.push(`cliente ${r.customerName ?? null} != ${c.cust}`);
  if (r.lines.length !== c.lines.length) errs.push(`numero righe ${r.lines.length} != ${c.lines.length}`);
  c.lines.forEach((e, i) => {
    const le = lineErrors(r.lines[i], e, r);
    if (!le.length && r.lines.length === c.lines.length) lineOk++;
    errs.push(...le.map((x) => `riga ${i + 1}: ${x}`));
  });
  if (c.clean && r.leftovers.length) errs.push(`frammenti non capiti: ${r.leftovers.join(' | ')}`);
  if (c.disc?.pct !== undefined) {
    if (!r.lines.length || !r.lines.every((l) => l.discountPct === c.disc!.pct)) errs.push(`sconto % atteso ${c.disc.pct}`);
  }
  if (c.disc?.amount !== undefined) {
    const pos = r.lines.filter((l) => l.unitPrice >= 0);
    const gross = computeTotals(pos, { forfettario: true, type: 'preventivo' }).net;
    const net = computeTotals(r.lines, { forfettario: true, type: 'preventivo' }).net;
    if (r.discount?.amount !== c.disc.amount || Math.abs(gross - net - c.disc.amount) > 0.011) errs.push(`sconto € atteso ${c.disc.amount}`);
  }
  if (c.vat !== undefined) {
    if (r.vatRate !== c.vat || !r.lines.length || !r.lines.every((l) => l.vat === c.vat)) errs.push(`IVA attesa ${c.vat}`);
  }
  if (c.prev && !r.referencesPrevious) errs.push('riferimento al preventivo precedente non rilevato');
  return { ok: errs.length === 0, errs, lineOk, lineTotal: c.lines.length };
}
