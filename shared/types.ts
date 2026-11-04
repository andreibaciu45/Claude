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

  // ---- v2 fatturazione elettronica (tutti opzionali: lo storage fornisce i default) ----
  regimeFiscale?: 'RF19'; // solo forfettario nell'MVP
  /** chiave `${sectional}-${year}` (es. 'FT-2026', 'NC-2026') -> ultimo seq usato. Gestito SOLO in transazione di emissione. */
  invoiceYearCounters?: Record<string, number>;
  nextProgressivoInvio?: number; // contatore per il nome file (5 char base-36)
  stampDutyDefaultChargedToCustomer?: boolean;
  reaOffice?: string;
  reaNumber?: string;
}

export interface Customer {
  id: string;
  name: string;
  /** LEGACY (v1): campo unico. Per le fatture usare vatNumber / fiscalCode. */
  vatOrFiscalCode?: string;
  vatNumber?: string; // P.IVA (11 cifre, checksum)
  fiscalCode?: string; // CF (16 alfanumerici persona fisica, o 11 cifre)
  country?: string; // ISO-2, default 'IT'
  zip?: string;
  city?: string;
  province?: string;
  codiceDestinatario?: string; // 7 caratteri; '0000000' se non noto; 'XXXXXXX' estero
  pec?: string;
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
  natura?: NaturaIva; // default 'N2.2' se forfettario
}

export type DocType = 'preventivo' | 'fattura';
// Preventivo: bozza -> inviato -> accettato | rifiutato | scaduto | convertito
export type QuoteStatus = 'bozza' | 'inviato' | 'accettato' | 'rifiutato' | 'scaduto' | 'convertito';
// Fattura: 'emessa' e successivi sono IMMUTABILI (invoice.lockedAt valorizzato)
export type InvoiceStatus =
  | 'bozza' // modificabile, eliminabile, SENZA numero definitivo
  | 'emessa' // numero assegnato, XML congelato (hash). Non modificabile/eliminabile
  | 'inviata' // l'utente dichiara l'invio allo SDI (o il provider l'ha accettata)
  | 'consegnata' // RC
  | 'mancata_consegna' // MC (considerata emessa)
  | 'scartata' // NS (si considera NON emessa: correggere e reinviare entro 5 gg)
  | 'stornata'; // coperta da nota di credito
/** LEGACY v1: 'pagato' compare nei documenti già salvati; la migrazione lo sposta in invoice.paymentStatus */
export type DocStatus = QuoteStatus | InvoiceStatus | 'pagato';
export type PaymentStatus = 'non_pagata' | 'parziale' | 'pagata';
export type TipoDocumento = 'TD01' | 'TD04';
export type NaturaIva = 'N2.2' | 'N1';
export type SdiOutcome = 'RC' | 'NS' | 'MC';

export interface SdiEvent {
  at: number; // epoch ms
  type: SdiOutcome | 'INVIO';
  channel: 'portale_ade' | 'pec' | 'provider' | 'sdicoop';
  sdiIdentifier?: string;
  errorCodes?: string[];
  note?: string;
}

/** Dati fiscali: presenti SOLO per type='fattura' (TD01 fattura, TD04 nota di credito). */
export interface InvoiceFiscal {
  tipoDocumento: TipoDocumento;
  year: number;
  sectional: string; // 'FT' fatture, 'NC' note di credito
  seq?: number; // assegnato SOLO all'emissione
  number?: string; // es. '12/2026', 'NC1/2026' (1-20 char, almeno una cifra)
  operationDate: string; // ISO = elemento XML Data
  issuedAt?: number;
  lockedAt?: number; // da qui il documento è immutabile
  progressivoInvio?: string; // 5 char alfanumerici
  xml?: string; // XML congelato all'emissione
  xmlSha256?: string;
  fileName?: string; // 'IT01234567897_00001.xml'
  stampDuty: boolean; // bollo dovuto
  stampDutyChargedToCustomer: boolean;
  stampAmount: number; // 0 o 2
  customerChannel: 'codice' | 'pec' | 'consumatore' | 'estero';
  // nota di credito
  originalDocumentId?: string;
  originalNumber?: string;
  originalDate?: string;
  creditNoteReason?: string;
  sdiEvents: SdiEvent[];
  resubmissionOf?: string;
  paymentStatus: PaymentStatus;
  payments: { date: string; amount: number; method?: string }[];
  /** true = fattura "di cortesia" v1 migrata: NON fiscale */
  legacy?: boolean;
  /** Storico degli XML sostituiti (es. dopo scarto SDI e rinvio con stesso numero/data). */
  xmlHistory?: {
    xml?: string; xmlSha256?: string; fileName?: string; progressivoInvio?: string;
    archivedAt: number; reason: 'scartata' | 'sostituita'; sdiEvent?: SdiEvent;
  }[];
}

/** Registro append-only. Mai modificato né cancellato. */
export interface AuditEntry {
  id: string;
  at: number;
  docId: string;
  action:
    | 'create' | 'edit' | 'issue' | 'download_xml' | 'mark_sent' | 'sdi_event' | 'credit_note'
    | 'convert_quote' | 'duplicate' | 'delete_draft' | 'payment' | 'voice_command';
  actor: 'user';
  detail?: string;
  xmlSha256?: string;
  voiceTranscript?: string;
}

/** Problema di validazione pre-emissione */
export interface ValidationIssue {
  field: string; // es. 'customer.vatNumber', 'profile.vatNumber', 'lines[2].unitPrice'
  code: string; // es. 'required', 'invalid_vat', 'too_long'
  message: string; // italiano, mostrabile all'utente
  severity: 'error' | 'warning';
}

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
  invoice?: InvoiceFiscal; // solo type==='fattura'
  convertedFromQuoteId?: string;
  convertedToInvoiceId?: string;
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
