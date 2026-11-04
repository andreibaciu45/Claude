import type { Customer, QuoteDocument } from '../../types';
import { documentTotals } from '../../pdf/totals';
import { docBelongsTo } from '../../storage/customerModel';
import { isCreditNote } from '../invoice/model';
import { isCounted } from '../invoice/register';

export interface CustomerStats {
  docs: QuoteDocument[];
  /** Fatturato = fatture emesse valide meno note di credito (importi lordi, come sul documento). Sola lettura. */
  invoiced: number;
  invoices: number;
  quotes: number;
  drafts: number;
}

export function customerStats(c: Customer, all: QuoteDocument[], forfettario: boolean): CustomerStats {
  const docs = all.filter((d) => docBelongsTo(d, c));
  let invoiced = 0; let invoices = 0; let quotes = 0; let drafts = 0;
  for (const d of docs) {
    if (d.type === 'preventivo') quotes++;
    else if (isCounted(d)) {
      invoices++;
      const g = documentTotals(d, forfettario).gross;
      invoiced += isCreditNote(d) ? -g : g;
    } else drafts++;
  }
  return { docs, invoiced: Math.round(invoiced * 100) / 100, invoices, quotes, drafts };
}
