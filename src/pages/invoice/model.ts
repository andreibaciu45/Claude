/** Logica pura (testabile) della fatturazione lato interfaccia. Nessun accesso allo storage. */
import type { Customer, DocStatus, InvoiceFiscal, Profile, QuoteDocument, QuoteStatus, SdiOutcome, ValidationIssue } from '../../types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Fattura/nota di credito con valore fiscale (esclude i preventivi e le fatture "di cortesia" v1). */
export const isFiscalInvoice = (d: Pick<QuoteDocument, 'type' | 'invoice'>): boolean => d.type === 'fattura' && !!d.invoice && !d.invoice.legacy;
/** Fattura v1 migrata o senza dati fiscali: NON fiscale. */
export const isLegacyInvoice = (d: Pick<QuoteDocument, 'type' | 'invoice'>): boolean => d.type === 'fattura' && (!d.invoice || !!d.invoice.legacy);
export const isCreditNote = (d: Pick<QuoteDocument, 'type' | 'invoice'>): boolean => isFiscalInvoice(d) && d.invoice!.tipoDocumento === 'TD04';
export const isLocked = (d: Pick<QuoteDocument, 'type' | 'invoice' | 'status'>): boolean =>
  isFiscalInvoice(d) && (!!d.invoice!.lockedAt || d.status !== 'bozza');
export const isDraftInvoice = (d: Pick<QuoteDocument, 'type' | 'invoice' | 'status'>): boolean => isFiscalInvoice(d) && !isLocked(d);

export const kindLabel = (d: Pick<QuoteDocument, 'type' | 'invoice'>): string =>
  d.type === 'preventivo' ? 'Preventivo' : isCreditNote(d) ? 'Nota di credito' : 'Fattura';

/** Numero da mostrare: quello fiscale reale ('12/2026'), "senza numero" per la bozza, quello v1 per i legacy/preventivi. */
export const displayNumber = (d: Pick<QuoteDocument, 'type' | 'invoice' | 'number' | 'status'>): string => {
  if (!isFiscalInvoice(d)) return d.number;
  return d.invoice!.number || (isLocked(d) ? d.number : 'bozza, senza numero');
};
export const hasRealNumber = (d: Pick<QuoteDocument, 'type' | 'invoice' | 'number'>): boolean => !isFiscalInvoice(d) || !!d.invoice!.number;

/** Anteprima NON vincolante del numero che verrà assegnato all'emissione. */
export const previewNumber = (d: Pick<QuoteDocument, 'invoice'>, p: Pick<Profile, 'invoiceYearCounters'>, today = new Date()): string => {
  const inv = d.invoice;
  // l'anno di numerazione è quello della DATA OPERAZIONE (come in emissione), non un anno memorizzato che può essere stale
  const year = Number(inv?.operationDate?.slice(0, 4)) || inv?.year || today.getFullYear();
  const sect = inv?.sectional || (inv?.tipoDocumento === 'TD04' ? 'NC' : 'FT');
  const next = (p.invoiceYearCounters?.[`${sect}-${year}`] ?? 0) + 1;
  return `${sect === 'NC' ? 'NC' : ''}${next}/${year}`;
};

export const inferChannel = (c: Customer): InvoiceFiscal['customerChannel'] => {
  if (c.country && c.country.toUpperCase() !== 'IT') return 'estero';
  const cd = (c.codiceDestinatario ?? '').trim();
  if (cd && cd !== '0000000') return 'codice';
  if ((c.pec ?? '').trim()) return 'pec';
  if (!(c.vatNumber ?? '').trim() && !!(c.fiscalCode ?? '').trim()) return 'consumatore';
  return cd === '0000000' ? 'codice' : 'consumatore';
};

/** Se il cliente ha solo il campo unico v1, lo smista in P.IVA (11 cifre) o codice fiscale (16 car.). */
export const normalizeCustomerForInvoice = (c: Customer): Customer => {
  const raw = (c.vatOrFiscalCode ?? '').replace(/\s/g, '').toUpperCase();
  if (!raw || c.vatNumber || c.fiscalCode) return c;
  if (/^\d{11}$/.test(raw)) return { ...c, vatNumber: raw };
  if (/^[A-Z0-9]{16}$/.test(raw)) return { ...c, fiscalCode: raw };
  return c;
};

/** Dati fiscali iniziali di una bozza di fattura (nessun numero: lo assegna l'emissione). */
export const newInvoiceFiscal = (o: { date: string; customer: Customer; stampDue: number; stampChargedToCustomer: boolean }): InvoiceFiscal => ({
  tipoDocumento: 'TD01',
  year: Number(o.date.slice(0, 4)) || new Date().getFullYear(),
  sectional: 'FT',
  operationDate: o.date,
  stampDuty: o.stampDue > 0,
  stampDutyChargedToCustomer: o.stampChargedToCustomer,
  stampAmount: o.stampDue,
  customerChannel: inferChannel(o.customer),
  sdiEvents: [],
  paymentStatus: 'non_pagata',
  payments: [],
});

/* ---------- stati ---------- */
export const QUOTE_STATUSES: QuoteStatus[] = ['bozza', 'inviato', 'accettato', 'rifiutato', 'scaduto', 'convertito'];
export const INVOICE_STATUSES: DocStatus[] = ['bozza', 'emessa', 'inviata', 'consegnata', 'mancata_consegna', 'scartata', 'stornata'];

export const SDI_INFO: Record<string, { label: string; tone: Tone; meaning: string }> = {
  bozza: { label: 'Bozza', tone: 'neutral', meaning: 'Non ha ancora un numero e non è stata emessa. Puoi modificarla o eliminarla.' },
  emessa: { label: 'Emessa', tone: 'info', meaning: 'Ha il suo numero ed è bloccata, ma non risulta ancora inviata allo SDI: il file XML va caricato da te.' },
  inviata: { label: 'Inviata allo SDI', tone: 'info', meaning: 'Hai dichiarato di averla inviata. Ora aspetta l’esito dello SDI e registralo qui.' },
  consegnata: { label: 'Consegnata', tone: 'success', meaning: 'Lo SDI l’ha consegnata al cliente: è tutto a posto.' },
  mancata_consegna: { label: 'Mancata consegna', tone: 'warning', meaning: 'Lo SDI non è riuscito a consegnarla al cliente (es. casella PEC piena), ma la fattura si considera emessa. Avvisa il cliente e mandagli la copia.' },
  scartata: { label: 'Scartata dallo SDI', tone: 'danger', meaning: 'Lo SDI l’ha rifiutata: si considera non emessa. Va corretta e rinviata con lo stesso numero e la stessa data, entro 5 giorni dalla notifica di scarto.' },
  stornata: { label: 'Stornata', tone: 'neutral', meaning: 'È stata annullata da una nota di credito collegata.' },
};
export const PAYMENT_LABEL = { non_pagata: 'Non pagata', parziale: 'Pagata in parte', pagata: 'Pagata' } as const;
export const PAYMENT_TONE: Record<keyof typeof PAYMENT_LABEL, Tone> = { non_pagata: 'warning', parziale: 'info', pagata: 'success' };
export const OUTCOME_LABEL: Record<SdiOutcome | 'INVIO', string> = {
  INVIO: 'Invio allo SDI', RC: 'Consegnata (RC)', MC: 'Mancata consegna (MC)', NS: 'Scartata (NS)',
};
export const CHANNEL_LABEL = { portale_ade: 'Portale Fatture e Corrispettivi', pec: 'PEC', provider: 'Provider', sdicoop: 'SDICoop' } as const;
export const AUDIT_LABEL: Record<string, string> = {
  create: 'Creata', edit: 'Modificata', issue: 'Emessa', download_xml: 'XML scaricato', mark_sent: 'Segnata come inviata', sdi_event: 'Esito SDI registrato',
  credit_note: 'Nota di credito', convert_quote: 'Convertita da preventivo', duplicate: 'Duplicata', delete_draft: 'Bozza eliminata', payment: 'Incasso registrato', voice_command: 'Comando vocale',
};

/** Giorni interi tra la data operazione (ISO) e oggi. */
export const daysSince = (iso: string, now = new Date()): number => {
  const t = new Date(`${iso}T12:00:00`).getTime();
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : 0;
};

export interface Actions {
  edit: boolean; delete: boolean; duplicate: boolean;
  issue: boolean; downloadXml: boolean; howToSend: boolean; markSent: boolean; recordOutcome: boolean;
  recordPayment: boolean; creditNote: boolean; convertToInvoice: boolean; quoteStatus: boolean; shareCourtesy: boolean;
  /** Fattura scartata entro 5 giorni: corregge e rigenera l'XML con stesso numero e stessa data. */
  correctAndResend: boolean;
  /** Fattura scartata (anche oltre i 5 giorni): nuova fattura collegata con numero nuovo. */
  resubmitNew: boolean;
}
const NONE: Actions = {
  edit: false, delete: false, duplicate: false, issue: false, downloadXml: false, howToSend: false, markSent: false, recordOutcome: false,
  recordPayment: false, creditNote: false, convertToInvoice: false, quoteStatus: false, shareCourtesy: false,
  correctAndResend: false, resubmitNew: false,
};

/** true se è passata la finestra di 5 giorni dalla notifica di scarto (NS) più recente. */
export const windowExpired = (d: Pick<QuoteDocument, 'invoice'>, now: number = Date.now()): boolean => {
  const ns = [...(d.invoice?.sdiEvents ?? [])].reverse().find((e) => e.type === 'NS');
  return !!ns && now > ns.at + RESUBMIT_DAYS_MS;
};
export const RESUBMIT_DAYS_MS = 5 * 86_400_000;
/** Scadenza (epoch ms) per rinviare con lo stesso numero, o null. */
export const resubmitUntil = (d: Pick<QuoteDocument, 'invoice' | 'status'>): number | null => {
  const ns = d.status === 'scartata' ? [...(d.invoice?.sdiEvents ?? [])].reverse().find((e) => e.type === 'NS') : undefined;
  return ns ? ns.at + RESUBMIT_DAYS_MS : null;
};

/** Quali azioni sono disponibili per un documento, in base a tipo e stato. */
export function availableActions(d: Pick<QuoteDocument, 'type' | 'invoice' | 'status'>, now: number = Date.now()): Actions {
  if (d.type === 'preventivo') {
    return { ...NONE, edit: true, delete: true, duplicate: true, convertToInvoice: true, quoteStatus: true, shareCourtesy: true };
  }
  if (!isFiscalInvoice(d)) return { ...NONE, edit: true, delete: true, duplicate: true, shareCourtesy: true }; // fattura v1 "di cortesia"
  if (!isLocked(d)) return { ...NONE, edit: true, delete: true, duplicate: true, issue: true };
  const nc = isCreditNote(d);
  const st = d.status;
  const transmitted = st === 'emessa' || st === 'inviata' || st === 'scartata' || st === 'mancata_consegna';
  return {
    ...NONE,
    duplicate: !nc,
    shareCourtesy: true,
    downloadXml: true,
    howToSend: transmitted,
    markSent: st === 'emessa' || (st === 'scartata' && !windowExpired(d, now)),
    correctAndResend: st === 'scartata' && !windowExpired(d, now),
    resubmitNew: st === 'scartata',
    recordOutcome: st === 'emessa' || st === 'inviata' || st === 'mancata_consegna',
    recordPayment: !nc && st !== 'stornata' && st !== 'scartata' && d.invoice!.paymentStatus !== 'pagata',
    creditNote: !nc && (st === 'emessa' || st === 'inviata' || st === 'consegnata' || st === 'mancata_consegna'),
  };
}

/** Collegamento da un problema di validazione al punto dove correggerlo. */
export function issueTarget(field: string, docId: string): { to: string; label: string } {
  if (field.startsWith('profile.')) return { to: '/profilo', label: 'Correggi nel profilo' };
  const m = /^lines\[\d+\]/.exec(field);
  const focus = m ? m[0] : field;
  return { to: `/?edit=${encodeURIComponent(docId)}&focus=${encodeURIComponent(focus)}`, label: field.startsWith('lines[') ? 'Vai alla riga' : 'Correggi nella bozza' };
}

export const splitIssues = (list: ValidationIssue[]) => ({
  errors: list.filter((i) => i.severity === 'error'),
  warnings: list.filter((i) => i.severity !== 'error'),
});

export const paidAmount = (d: Pick<QuoteDocument, 'invoice'>): number =>
  Math.round((d.invoice?.payments ?? []).reduce((s, p) => s + p.amount, 0) * 100) / 100;

/** Data operazione più recente tra le fatture EMESSE dello stesso sezionale/anno (esclude il documento stesso). '' se nessuna. */
export const lastIssuedIso = (all: Pick<QuoteDocument, 'id' | 'type' | 'invoice'>[], d: Pick<QuoteDocument, 'id' | 'invoice'>): string => {
  const inv = d.invoice;
  if (!inv) return '';
  const sect = inv.tipoDocumento === 'TD04' ? 'NC' : 'FT';
  const year = Number(inv.operationDate?.slice(0, 4)) || inv.year;
  return all
    .filter((x) => x.id !== d.id && isFiscalInvoice(x) && !!x.invoice!.lockedAt && x.invoice!.sectional === sect && x.invoice!.year === year)
    .reduce((m, x) => (x.invoice!.operationDate > m ? x.invoice!.operationDate : m), '');
};
