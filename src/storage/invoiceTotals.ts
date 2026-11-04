/**
 * UNICO calcolo dei totali di una fattura/nota di credito fiscale, in CENTESIMI INTERI.
 * Usato da scheda documento, elenco, PDF, pagamenti, note di credito: stessa aritmetica del generatore XML
 * (shared/fiscal/money: un solo arrotondamento half-up per riga, imposta per aliquota).
 * Modulo PURO: nessun accesso allo storage.
 *
 * Bollo [DA VERIFICARE]: dovuto se forfettario e imponibile > 77,47 €; entra nel totale (riga di rimborso N1)
 * solo se addebitato al cliente. Sulle note di credito vale la stessa soglia valutata sull'importo della nota
 * (regola prudente di FISCAL-SPEC §1.4: il bollo della fattura originale non viene stornato).
 */
import type { DocLine } from '../types';
import { computeDocumentTotals, lineTotalCents } from '../../shared/fiscal/money';

export interface InvoiceTotalsCents {
  lineCents: number[];
  netCents: number;
  byRate: { rate: number; baseCents: number; vatCents: number }[];
  vatCents: number;
  /** Bollo dovuto (0 o 200), anche se a carico dell'emittente. */
  stampDueCents: number;
  /** Bollo addebitato al cliente (incluso nel totale). */
  stampChargedCents: number;
  grossCents: number;
}

export function invoiceTotalsCents(
  lines: DocLine[],
  opts: { forfettario: boolean; stampChargedToCustomer: boolean },
): InvoiceTotalsCents {
  const inputs = (lines ?? []).map((l) => ({
    qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: opts.forfettario ? 0 : (Number.isFinite(l.vat) ? l.vat : 0), natura: l.natura,
  }));
  const t = computeDocumentTotals(inputs, { regimeForfettario: opts.forfettario, stampDutyChargedToCustomer: false });
  const byRateMap = new Map<number, { baseCents: number; vatCents: number }>();
  for (const g of t.summary) {
    const cur = byRateMap.get(g.vatRate) ?? { baseCents: 0, vatCents: 0 };
    cur.baseCents += g.taxableCents;
    cur.vatCents += g.taxCents;
    byRateMap.set(g.vatRate, cur);
  }
  const byRate = [...byRateMap.entries()].map(([rate, v]) => ({ rate, ...v })).filter((r) => r.baseCents !== 0).sort((a, b) => a.rate - b.rate);
  const stampChargedCents = opts.stampChargedToCustomer && t.stampDue ? t.stampCents : 0;
  return {
    lineCents: t.lineTotals,
    netCents: t.linesNetCents,
    byRate,
    vatCents: t.taxCents,
    stampDueCents: t.stampCents,
    stampChargedCents,
    grossCents: t.totalCents + stampChargedCents,
  };
}

/** Importo di riga in euro (centesimi → euro). */
export const lineEuro = (l: Pick<DocLine, 'qty' | 'unitPrice' | 'discountPct'>): number => lineTotalCents(l) / 100;

/**
 * Bollo sulle note di credito [DA VERIFICARE col commercialista]: le fonti sono discordanti (FISCAL-SPEC §1.4).
 * Scelta prudente: il bollo già versato sulla fattura originale NON viene stornato e il rimborso addebitato al cliente
 * non viene restituito dalla nota; la nota ha un proprio bollo (2 €, a carico dell'emittente) solo se il suo
 * imponibile supera 77,47 €, con la stessa regola di una fattura.
 */
export const CREDIT_NOTE_STAMP_NOTE =
  'Bollo sulla nota di credito [DA VERIFICARE col commercialista]: il bollo della fattura originale non viene stornato; la nota ha un proprio bollo di 2 € a tuo carico solo se il suo importo supera 77,47 €.';
