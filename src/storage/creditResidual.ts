/**
 * Residuo stornabile di una fattura (modulo PURO, usato da storage e interfaccia).
 * Storni parziali multipli: ogni nota di credito EFFICACE (emessa e non scartata dallo SDI) consuma una parte
 * dell'imponibile della fattura. Le righe delle note si associano alle righe originali per
 * descrizione + unità + prezzo + sconto (le note nascono dalle righe della fattura).
 */
import type { DocLine, QuoteDocument } from '../types';
import { lineTotalCents } from '../../shared/fiscal/money';

export const lineKey = (l: Pick<DocLine, 'description' | 'unit' | 'unitPrice' | 'discountPct'>): string =>
  `${l.description.trim()}|${l.unit}|${l.unitPrice}|${l.discountPct ?? 0}`;

/** Note di credito che contano per il residuo: emesse (bloccate) e non scartate. */
export const effectiveCreditNotes = (all: QuoteDocument[], originalId: string): QuoteDocument[] =>
  all.filter((d) => d.invoice?.tipoDocumento === 'TD04' && d.invoice.originalDocumentId === originalId && !!d.invoice.lockedAt && d.status !== 'scartata');

const net = (lines: DocLine[]): number => lines.reduce((s, l) => s + lineTotalCents(l), 0);

export interface CreditResidual {
  /** Imponibile della fattura originale (centesimi). */
  originalCents: number;
  /** Già stornato da note efficaci. */
  creditedCents: number;
  /** Ancora stornabile (>= 0). */
  residualCents: number;
  /** Righe con la quantità ancora stornabile (qty > 0), id = id della riga originale. */
  lines: DocLine[];
}

export function creditResidual(original: Pick<QuoteDocument, 'lines'>, notes: Pick<QuoteDocument, 'lines'>[]): CreditResidual {
  const used = new Map<string, number>();
  for (const n of notes) for (const l of n.lines) used.set(lineKey(l), (used.get(lineKey(l)) ?? 0) + l.qty);
  const lines: DocLine[] = [];
  const left = new Map(used);
  for (const l of original.lines) {
    const k = lineKey(l);
    const u = left.get(k) ?? 0;
    const take = Math.min(u, l.qty);
    left.set(k, u - take);
    const rem = Math.round((l.qty - take) * 1e6) / 1e6;
    if (rem > 0) lines.push({ ...l, qty: rem });
  }
  const originalCents = net(original.lines);
  const creditedCents = net(notes.flatMap((n) => n.lines));
  return { originalCents, creditedCents, residualCents: Math.max(0, originalCents - creditedCents), lines };
}
