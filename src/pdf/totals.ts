import type { Totals, QuoteDocument } from '../types';
import { roundMoney } from '../types';
import { computeTotals } from '../engine';

/** Totali di un documento: come computeTotals ma coerenti con i dati fiscali della fattura. */
export interface DocTotals extends Totals {
  /** Bollo DOVUTO (0 o 2 €), anche se non addebitato al cliente. */
  stampDue: number;
  /** `stamp` (ereditato) = bollo ADDEBITATO al cliente, incluso nel totale. */
}

/**
 * - preventivo / fattura legacy: computeTotals invariato (il bollo, se c'è, è nel totale).
 * - fattura fiscale: bollo dovuto da `invoice.stampAmount` se bloccata, altrimenti ricalcolato;
 *   nel totale entra solo se addebitato al cliente (`stampDutyChargedToCustomer`).
 */
export function documentTotals(doc: Pick<QuoteDocument, 'lines' | 'type' | 'invoice'>, forfettario: boolean): DocTotals {
  const t = computeTotals(doc.lines, { forfettario, type: doc.type });
  const inv = doc.invoice;
  if (doc.type !== 'fattura' || !inv || inv.legacy) return { ...t, stampDue: t.stamp };
  const due = inv.lockedAt ? (inv.stampDuty ? inv.stampAmount || 2 : 0) : t.stamp;
  const charged = inv.stampDutyChargedToCustomer ? due : 0;
  return { ...t, stampDue: due, stamp: charged, gross: roundMoney(t.net + t.vat + charged) };
}

/** Totali di una bozza in compilazione: per le fatture fiscali il bollo entra nel totale solo se addebitato al cliente. */
export function draftTotals(lines: QuoteDocument['lines'], type: QuoteDocument['type'], forfettario: boolean, stampCharged: boolean): DocTotals {
  const t = computeTotals(lines, { forfettario, type });
  if (type !== 'fattura') return { ...t, stampDue: t.stamp };
  const charged = stampCharged ? t.stamp : 0;
  return { ...t, stampDue: t.stamp, stamp: charged, gross: roundMoney(t.net + t.vat + charged) };
}
