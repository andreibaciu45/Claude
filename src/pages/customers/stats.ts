import type { Customer, QuoteDocument } from '../../types';
import { documentTotals } from '../../pdf/totals';
import { docBelongsTo } from '../../storage/customerModel';
import { isCreditNote } from '../invoice/model';
import { docDateIso, isCounted } from '../invoice/register';

export interface CustomerStats {
  /** Documenti del cliente (nel periodo richiesto, se indicato). */
  docs: QuoteDocument[];
  /** Fatturato = fatture emesse valide meno note di credito (importi lordi, come sul documento). Sola lettura. */
  invoiced: number;
  invoices: number;
  quotes: number;
  /** Bozze e fatture di cortesia (non fiscali). */
  drafts: number;
  /** Fatture/note scartate dallo SDI: considerate non emesse, né bozze né fatturato. */
  rejected: number;
  /** Documenti emessi con importi non validi (NaN/Infinity): contati ma esclusi dal fatturato. Normalmente 0. */
  anomalies: number;
}

export interface CustomerStatsOptions {
  /** Solo documenti con data nell'anno (data operazione per le fatture, data del documento per gli altri). */
  year?: number;
  /** Periodo inclusivo, formato AAAA-MM-GG. Si combina con `year`. */
  from?: string;
  to?: string;
  /**
   * Rubrica completa. Con essa, un documento che porta l'id di UN ALTRO cliente della rubrica non viene attribuito a
   * questo solo perché ha lo stesso nome (clienti omonimi senza P.IVA/CF distinti).
   */
  book?: Pick<Customer, 'id'>[];
}

const inPeriod = (d: QuoteDocument, o: CustomerStatsOptions): boolean => {
  if (o.year === undefined && !o.from && !o.to) return true;
  const iso = docDateIso(d) || '';
  if (o.year !== undefined && Number(iso.slice(0, 4)) !== o.year) return false;
  if (o.from && iso.slice(0, 10) < o.from) return false;
  if (o.to && iso.slice(0, 10) > o.to) return false;
  return true;
};

/**
 * Statistiche di un cliente. Il fatturato si somma in CENTESIMI interi (niente deriva dei decimali), conta le fatture
 * emesse non scartate (anche se poi stornate: la nota di credito le compensa) e sottrae le note di credito emesse.
 * Il bollo entra solo se addebitato al cliente; la nota di credito non lo restituisce (regola di storage/invoiceTotals).
 */
export function customerStats(c: Customer, all: QuoteDocument[], forfettario: boolean, opts: CustomerStatsOptions = {}): CustomerStats {
  const otherIds = opts.book ? new Set(opts.book.map((b) => b.id).filter((id) => id !== c.id)) : null;
  const belongs = (d: QuoteDocument): boolean => {
    if (!docBelongsTo(d, c)) return false;
    // stesso nome ma id di rubrica di un altro cliente: è un omonimo, non questo cliente
    if (otherIds && d.customer?.id && d.customer.id !== c.id && otherIds.has(d.customer.id)) return false;
    return true;
  };
  const docs = all.filter((d) => belongs(d) && inPeriod(d, opts));
  let cents = 0; let invoices = 0; let quotes = 0; let drafts = 0; let rejected = 0; let anomalies = 0;
  for (const d of docs) {
    if (d.type === 'preventivo') quotes++;
    else if (isCounted(d)) {
      invoices++;
      const g = documentTotals(d, forfettario).gross;
      if (!Number.isFinite(g)) { anomalies++; continue; }
      const gc = Math.round(g * 100);
      cents += isCreditNote(d) ? -gc : gc;
    } else if (d.status === 'scartata') rejected++;
    else drafts++;
  }
  return { docs, invoiced: cents / 100, invoices, quotes, drafts, rejected, anomalies };
}
