// STUB del contratto fatturazione client — implementato dall'agente STORAGE-FATTURE (stesse firme).
import type { AuditEntry, DocLine, QuoteDocument, SdiEvent } from '../types';
const ni = (): never => { throw new Error('non implementato'); };

export class ImmutableDocumentError extends Error {}
export class InvoiceValidationError extends Error { issues: import('../types').ValidationIssue[] = []; }

/** Preventivo -> nuova fattura in BOZZA (copia righe e cliente; segna il preventivo 'convertito'). */
export const createInvoiceFromQuote = async (_quoteId: string): Promise<QuoteDocument> => ni();
/** Bozza fattura -> EMESSA, in UNA transazione: assegna seq (anno+sezionale), genera XML, hash, lockedAt, audit. Lancia InvoiceValidationError. */
export const issueInvoice = async (_docId: string): Promise<QuoteDocument> => ni();
/** Crea ED EMETTE una nota di credito TD04 collegata alla fattura. Senza `lines` = storno totale. Segna la fattura 'stornata' se totale. */
export const createCreditNote = async (_invoiceId: string, _opts: { reason: string; lines?: DocLine[] }): Promise<QuoteDocument> => ni();
/** Registra un esito/invio SDI (v1 manuale): aggiorna status coerentemente. */
export const recordSdiEvent = async (_docId: string, _ev: SdiEvent): Promise<QuoteDocument> => ni();
export const recordPayment = async (_docId: string, _p: { date: string; amount: number; method?: string }): Promise<QuoteDocument> => ni();
export const listAudit = async (_docId?: string): Promise<AuditEntry[]> => ni();
