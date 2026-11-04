import type { Totals, QuoteDocument } from '../types';
import { computeTotals } from '../engine';
import { invoiceTotalsCents } from '../storage/invoiceTotals';

/** Totali di un documento: come computeTotals ma coerenti con i dati fiscali della fattura. */
export interface DocTotals extends Totals {
  /** Bollo DOVUTO (0 o 2 €), anche se non addebitato al cliente. */
  stampDue: number;
  /** `stamp` (ereditato) = bollo ADDEBITATO al cliente, incluso nel totale. */
}

const eur = (c: number): number => c / 100;

function fromCents(lines: QuoteDocument['lines'], forfettario: boolean, charged: boolean): DocTotals {
  const c = invoiceTotalsCents(lines, { forfettario, stampChargedToCustomer: charged });
  return {
    net: eur(c.netCents),
    vat: eur(c.vatCents),
    stamp: eur(c.stampChargedCents),
    gross: eur(c.grossCents),
    byRate: c.byRate.map((r) => ({ rate: r.rate, base: eur(r.baseCents), vat: eur(r.vatCents) })),
    stampDue: eur(c.stampDueCents),
  };
}

/**
 * - preventivo / fattura legacy: computeTotals invariato (il bollo, se c'è, è nel totale).
 * - fattura fiscale (anche bloccata): UNICO calcolo in centesimi (`invoiceTotalsCents`), lo stesso del generatore XML:
 *   scheda, elenco, PDF e XML mostrano gli stessi importi. Il bollo entra nel totale solo se addebitato al cliente.
 */
export function documentTotals(doc: Pick<QuoteDocument, 'lines' | 'type' | 'invoice'>, forfettario: boolean): DocTotals {
  const inv = doc.invoice;
  if (doc.type !== 'fattura' || !inv || inv.legacy) {
    const t = computeTotals(doc.lines, { forfettario, type: doc.type });
    return { ...t, stampDue: t.stamp };
  }
  return fromCents(doc.lines, forfettario, !!inv.stampDutyChargedToCustomer && inv.tipoDocumento !== 'TD04');
}

/** Totali di una bozza in compilazione: per le fatture fiscali il bollo entra nel totale solo se addebitato al cliente. */
export function draftTotals(lines: QuoteDocument['lines'], type: QuoteDocument['type'], forfettario: boolean, stampCharged: boolean): DocTotals {
  if (type !== 'fattura') {
    const t = computeTotals(lines, { forfettario, type });
    return { ...t, stampDue: t.stamp };
  }
  return fromCents(lines, forfettario, stampCharged);
}
