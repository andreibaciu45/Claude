// STUB del contratto — implementato dall'agente FATTURAPA. Funzioni PURE, usabili in browser e Node.
import type { Profile, QuoteDocument, ValidationIssue } from '../types';

export interface FatturaPAResult {
  xml: string;
  fileName: string; // 'IT<PIVA>_<progressivoInvio>.xml'
  progressivoInvio: string; // 5 char alfanumerici
}

/** Validazioni pre-emissione (profilo, cliente, righe, regole forfettario, bollo). Non lancia mai. */
export const validateInvoiceForIssue = (_doc: QuoteDocument, _profile: Profile): ValidationIssue[] => [];

/** Genera l'XML FatturaPA (TD01 o TD04 secondo doc.invoice.tipoDocumento). Lancia Error se validateInvoiceForIssue ha errori. */
export const generateFatturaPA = (_doc: QuoteDocument, _profile: Profile, _progressivoInvio: string): FatturaPAResult => {
  throw new Error('fatturapa non implementato');
};
