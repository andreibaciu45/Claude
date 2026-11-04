/**
 * CONTRATTO DEI DATI — condiviso da tutti i moduli.
 * Non modificare le firme senza aggiornare docs/ARCHITECTURE.md.
 * Importi in EURO come number (2 decimali, arrotondare con roundMoney).
 */

export type Unit = 'pz' | 'm' | 'mq' | 'mc' | 'kg' | 'l' | 'h' | 'gg' | 'corpo';
export const UNITS: Unit[] = ['pz', 'm', 'mq', 'mc', 'kg', 'l', 'h', 'gg', 'corpo'];

export type ItemKind = 'materiale' | 'manodopera' | 'servizio';

export interface CatalogItem {
  id: string;
  name: string; // "Tubo rame 16 mm"
  aliases: string[]; // sinonimi per la ricerca vocale: ["rame sedici", "tubo di rame"]
  unit: Unit;
  price: number; // prezzo unitario NETTO IVA, in euro
  vat: number; // aliquota % (22, 10, 4, 0)
  kind: ItemKind;
  category?: string;
  stock?: number; // giacenza opzionale (magazzino)
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  businessName: string;
  ownerName?: string;
  vatNumber: string; // P.IVA
  fiscalCode?: string;
  address: string;
  zip: string;
  city: string;
  province: string;
  phone: string;
  email: string;
  pec?: string;
  iban?: string;
  artigianiNumber?: string; // n. iscrizione Albo Imprese Artigiane
  logoDataUrl?: string;
  regimeForfettario: boolean; // senza IVA in fattura + bollo > 77,47 €
  defaultVat: number; // aliquota di default, es. 22
  quotePrefix: string; // "PRev-"
  invoicePrefix: string; // "FT-"
  nextQuoteNumber: number;
  nextInvoiceNumber: number;
  quoteValidityDays: number; // validità preventivo, default 30
  paymentTerms: string; // "Bonifico a 30 giorni"
  footerNotes?: string;
}

export interface Customer {
  id: string;
  name: string;
  vatOrFiscalCode?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface DocLine {
  id: string;
  catalogItemId?: string; // assente se riga libera / non trovata
  description: string;
  qty: number;
  unit: Unit;
  unitPrice: number; // NETTO IVA
  vat: number; // %
  discountPct?: number; // 0-100
  /** true = la voce parlata non è stata trovata a catalogo: l'utente deve confermare/prezzare */
  needsReview?: boolean;
}

export type DocType = 'preventivo' | 'fattura';
export type DocStatus = 'bozza' | 'inviato' | 'accettato' | 'pagato';

export interface QuoteDocument {
  id: string;
  type: DocType;
  number: string; // "PRev-0012"
  date: string; // ISO yyyy-mm-dd
  customer: Customer;
  lines: DocLine[];
  notes?: string;
  status: DocStatus;
  transcript?: string; // testo dettato originale
  createdAt: number;
  updatedAt: number;
}

export interface Totals {
  net: number; // imponibile (dopo sconti)
  vat: number; // IVA totale (0 se forfettario)
  stamp: number; // marca da bollo (2 € se forfettario e totale > 77,47, solo fattura)
  gross: number; // totale documento
  byRate: { rate: number; base: number; vat: number }[];
}

/** Risultato del motore di dettatura (src/engine) */
export interface ParseResult {
  customerName?: string;
  lines: DocLine[]; // già pronte; le non trovate hanno needsReview=true
  /** frammenti di frase non riconducibili ad alcuna riga */
  leftovers: string[];
}

export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
