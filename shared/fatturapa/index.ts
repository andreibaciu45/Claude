// Generazione e validazione FatturaPA (FPR12) — implementato dall'agente FATTURAPA.
// Funzioni PURE, usabili in browser e Node. Firme storiche mantenute.
export type { FatturaPAResult, GenerateOptions } from './generate';
export {
  generateFatturaPA,
  formatProgressivoInvio,
  buildFileName,
  buildCausali,
  FatturaPAValidationError,
  FATTURAPA_NAMESPACE,
} from './generate';
export { validateInvoiceForIssue, ISSUE_TERM_DAYS, FUTURE_TOLERANCE_DAYS } from './validate';
export type { ValidateOptions } from './validate';
export { escapeXml, sanitizeText, fitText, chunkText } from './text';
export { FORFETTARIO_LEGAL_TEXT, BOLLO_LEGAL_TEXT, NO_RITENUTA_LEGAL_TEXT, legalNotesFor } from './legalText';
export { derivePayment, addDays, daysBetween, endOfMonth, EURO_DISCOUNT_XML_MODE } from './common';
export type { EuroDiscountMode } from './common';
