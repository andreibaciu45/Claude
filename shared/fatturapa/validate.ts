/**
 * Validazione pre-emissione (FISCAL-SPEC §5.3). Non lancia mai. Messaggi in italiano.
 * error = blocca l'emissione; warning = informa (es. testo che verrà troncato/ripulito).
 */
import type { Customer, DocLine, Profile, QuoteDocument, ValidationIssue } from '../types';
import {
  isValidCapIt,
  isValidCodiceDestinatario,
  isValidCodiceFiscale,
  isValidCountryCode,
  isValidEmail,
  isValidIban,
  isValidPartitaIva,
  isValidPec,
  isValidProvinciaIt,
} from '../fiscal/validators';
import { STAMP_DUTY_THRESHOLD_CENTS, formatCents } from '../fiscal/money';
import {
  ALLOWED_NATURE,
  LIMITS,
  computeInvoiceTotals,
  daysBetween,
  isIsoDate,
  lineNatura,
  localIsoDate,
  normalizeCountry,
  normalizeFiscalCode,
  normalizeVat,
  resolveCustomerIds,
  resolveRecipient,
  trimmed,
} from './common';
import { fitText, sanitizeText } from './text';

export interface ValidateOptions {
  /** Orologio (per i test). Default: adesso. */
  now?: Date;
  /** Data (ISO) dell'ultima fattura emessa nello stesso sezionale, per il controllo cronologico. */
  lastIssuedDate?: string;
}

/** Oltre questo numero di giorni dalla data operazione scatta l'avviso (art. 21 c. 4 DPR 633/72) [DA VERIFICARE]. */
export const ISSUE_TERM_DAYS = 12;
/** Tolleranza (giorni) per date nel futuro: oltre -> errore (lo SDI scarta date posteriori all'invio) [DA VERIFICARE]. */
export const FUTURE_TOLERANCE_DAYS = 1;

class Collector {
  readonly issues: ValidationIssue[] = [];
  error(field: string, code: string, message: string): void {
    this.issues.push({ field, code, message, severity: 'error' });
  }
  warn(field: string, code: string, message: string): void {
    this.issues.push({ field, code, message, severity: 'warning' });
  }
  /** Segnala testo troncato / caratteri sostituiti (warning, mai silenzioso). */
  text(field: string, label: string, value: string | undefined, max: number): void {
    const f = fitText(value ?? '', max);
    if (f.truncated) {
      this.warn(field, 'too_long', `${label} supera ${max} caratteri: nel file XML verrà troncato.`);
    }
    if (f.replaced) {
      this.warn(field, 'chars_replaced', `${label} contiene caratteri non ammessi dallo schema: nel file XML saranno sostituiti.`);
    }
  }
}

const checkProfile = (c: Collector, p: Profile): void => {
  if (!p.regimeForfettario) {
    c.error('profile.regimeForfettario', 'regime_not_supported', 'Questa versione emette fatture elettroniche solo per il regime forfettario (RF19): attiva il regime forfettario nel profilo.');
  }
  if (p.regimeFiscale && p.regimeFiscale !== 'RF19') {
    c.error('profile.regimeFiscale', 'regime_not_supported', 'Regime fiscale non supportato: è ammesso solo RF19 (forfettario).');
  }
  const vat = normalizeVat(p.vatNumber);
  if (!vat) c.error('profile.vatNumber', 'required', 'La partita IVA del profilo è obbligatoria.');
  else if (!isValidPartitaIva(vat)) c.error('profile.vatNumber', 'invalid_vat', 'La partita IVA del profilo non è valida (11 cifre con cifra di controllo corretta).');
  const cf = normalizeFiscalCode(p.fiscalCode);
  if (!cf) c.warn('profile.fiscalCode', 'missing_fiscal_code', 'Codice fiscale del profilo mancante: consigliato per la fattura elettronica.');
  else if (!isValidCodiceFiscale(cf)) c.error('profile.fiscalCode', 'invalid_fiscal_code', 'Il codice fiscale del profilo non è valido.');
  if (!trimmed(p.businessName) && !trimmed(p.ownerName)) {
    c.error('profile.businessName', 'required', 'Serve la denominazione o il nome del titolare nel profilo.');
  }
  c.text('profile.businessName', 'La denominazione del profilo', p.businessName || p.ownerName, LIMITS.denominazione);
  if (!trimmed(p.address)) c.error('profile.address', 'required', 'L\'indirizzo del profilo è obbligatorio.');
  c.text('profile.address', 'L\'indirizzo del profilo', p.address, LIMITS.indirizzo);
  if (!isValidCapIt(trimmed(p.zip))) c.error('profile.zip', 'invalid_zip', 'Il CAP del profilo deve avere 5 cifre.');
  if (!trimmed(p.city)) c.error('profile.city', 'required', 'Il comune del profilo è obbligatorio.');
  c.text('profile.city', 'Il comune del profilo', p.city, LIMITS.comune);
  if (!isValidProvinciaIt(trimmed(p.province).toUpperCase())) {
    c.error('profile.province', 'invalid_province', 'La provincia del profilo deve essere una sigla di 2 lettere (es. RM).');
  }
  if (trimmed(p.iban) && !isValidIban(p.iban as string)) {
    c.error('profile.iban', 'invalid_iban', 'L\'IBAN del profilo non è valido.');
  }
  if (trimmed(p.email) && !isValidEmail(p.email)) {
    c.warn('profile.email', 'invalid_email', 'L\'email del profilo non è valida: non verrà inserita nel file XML.');
  }
  const phone = trimmed(p.phone).replace(/[\s.-]/g, '');
  if (phone && (phone.length < LIMITS.telefonoMin || phone.length > LIMITS.telefonoMax)) {
    c.warn('profile.phone', 'invalid_phone', 'Il telefono del profilo deve avere 5-12 caratteri: non verrà inserito nel file XML.');
  }
  const hasOffice = !!trimmed(p.reaOffice);
  const hasNumber = !!trimmed(p.reaNumber);
  if (hasOffice !== hasNumber) {
    c.warn('profile.reaNumber', 'rea_incomplete', 'Iscrizione REA incompleta (servono ufficio e numero): non verrà inserita nel file XML.');
  } else if (hasOffice && !isValidProvinciaIt(trimmed(p.reaOffice).toUpperCase())) {
    c.warn('profile.reaOffice', 'rea_invalid', 'L\'ufficio REA deve essere una sigla di provincia di 2 lettere: l\'iscrizione REA non verrà inserita.');
  }
};

const checkCustomerIds = (c: Collector, cu: Customer): void => {
  const ids = resolveCustomerIds(cu);
  const italian = ids.country === 'IT';
  if (!ids.vat && !ids.fiscalCode) {
    c.error('customer.vatNumber', 'required', 'Il cliente deve avere almeno la partita IVA o il codice fiscale.');
    return;
  }
  if (italian && ids.vat && !isValidPartitaIva(ids.vat)) {
    c.error('customer.vatNumber', 'invalid_vat', 'La partita IVA del cliente non è valida (11 cifre con cifra di controllo corretta).');
  }
  if (italian && ids.fiscalCode && !isValidCodiceFiscale(ids.fiscalCode)) {
    c.error('customer.fiscalCode', 'invalid_fiscal_code', 'Il codice fiscale del cliente non è valido.');
  }
  if (!italian) {
    const foreign = ids.vat || ids.fiscalCode;
    if (foreign.length > LIMITS.idCodiceEstero) {
      c.error('customer.vatNumber', 'too_long', `L'identificativo fiscale estero supera ${LIMITS.idCodiceEstero} caratteri.`);
    }
  }
};

const checkCustomerAddress = (c: Collector, cu: Customer): void => {
  const italian = normalizeCountry(cu.country) === 'IT';
  if (!isValidCountryCode(normalizeCountry(cu.country))) {
    c.error('customer.country', 'invalid_country', 'La nazione del cliente deve essere un codice ISO di 2 lettere (es. IT).');
  }
  if (!trimmed(cu.address)) c.error('customer.address', 'required', 'L\'indirizzo del cliente è obbligatorio per la fattura elettronica.');
  c.text('customer.address', 'L\'indirizzo del cliente', cu.address, LIMITS.indirizzo);
  if (!trimmed(cu.city)) c.error('customer.city', 'required', 'Il comune del cliente è obbligatorio per la fattura elettronica.');
  c.text('customer.city', 'Il comune del cliente', cu.city, LIMITS.comune);
  if (italian) {
    if (!isValidCapIt(trimmed(cu.zip))) c.error('customer.zip', 'invalid_zip', 'Il CAP del cliente deve avere 5 cifre.');
    if (!isValidProvinciaIt(trimmed(cu.province).toUpperCase())) {
      c.error('customer.province', 'invalid_province', 'La provincia del cliente deve essere una sigla di 2 lettere (es. MI).');
    }
  }
};

const checkCustomer = (c: Collector, cu: Customer): void => {
  if (!trimmed(cu.name)) c.error('customer.name', 'required', 'Il nome o la denominazione del cliente è obbligatorio.');
  c.text('customer.name', 'Il nome del cliente', cu.name, LIMITS.denominazione);
  checkCustomerIds(c, cu);
  checkCustomerAddress(c, cu);
  const rawCode = trimmed(cu.codiceDestinatario).toUpperCase();
  if (rawCode && !isValidCodiceDestinatario(rawCode)) {
    c.error('customer.codiceDestinatario', 'invalid_codice_destinatario', 'Il codice destinatario deve avere 7 caratteri alfanumerici (es. ABC1234).');
  }
  if (trimmed(cu.pec) && !isValidPec(cu.pec as string)) {
    c.warn('customer.pec', 'invalid_pec', 'La PEC del cliente non è valida: non verrà inserita nel file XML.');
  }
  const r = resolveRecipient(cu);
  if (r.channel === 'estero') {
    c.warn('customer.country', 'foreign_customer', 'Cliente estero: la natura dell\'operazione (N2.2) potrebbe non essere corretta. Verifica con il commercialista.');
  } else if (r.channel === 'codice' && r.codiceDestinatario === '0000000' && resolveCustomerIds(cu).vat) {
    c.warn('customer.codiceDestinatario', 'no_recipient_channel', 'Cliente con partita IVA senza codice destinatario né PEC: la fattura sarà visibile solo nella sua area riservata dell\'Agenzia delle Entrate.');
  }
};

const checkLine = (c: Collector, l: DocLine, i: number, forfettario: boolean): void => {
  const f = `lines[${i}]`;
  const n = i + 1;
  if (!trimmed(l.description)) c.error(`${f}.description`, 'required', `Riga ${n}: la descrizione è obbligatoria.`);
  c.text(`${f}.description`, `La descrizione della riga ${n}`, l.description, LIMITS.descrizione);
  if (!Number.isFinite(l.qty) || l.qty <= 0) c.error(`${f}.qty`, 'invalid_qty', `Riga ${n}: la quantità deve essere maggiore di zero.`);
  if (!Number.isFinite(l.unitPrice)) c.error(`${f}.unitPrice`, 'invalid_price', `Riga ${n}: il prezzo non è un numero valido.`);
  else if (l.unitPrice < 0) c.error(`${f}.unitPrice`, 'negative_price', `Riga ${n}: il prezzo non può essere negativo (per stornare usa una nota di credito).`);
  else if (l.unitPrice === 0) c.warn(`${f}.unitPrice`, 'zero_price', `Riga ${n}: il prezzo è zero.`);
  if (l.discountPct !== undefined && (!Number.isFinite(l.discountPct) || l.discountPct < 0 || l.discountPct > 100)) {
    c.error(`${f}.discountPct`, 'invalid_discount', `Riga ${n}: lo sconto deve essere tra 0 e 100%.`);
  }
  if (l.needsReview) c.error(`${f}.needsReview`, 'needs_review', `Riga ${n}: voce da verificare (non trovata a catalogo): conferma descrizione e prezzo.`);
  if (!ALLOWED_NATURE.includes(lineNatura(l))) {
    c.error(`${f}.natura`, 'invalid_natura', `Riga ${n}: natura IVA non supportata (ammesse N2.2 e N1).`);
  }
  if (forfettario && Number.isFinite(l.vat) && l.vat !== 0) {
    c.warn(`${f}.vat`, 'vat_ignored', `Riga ${n}: nel regime forfettario l'IVA è sempre 0: l'aliquota ${l.vat}% verrà ignorata.`);
  }
};

const checkDates = (c: Collector, doc: QuoteDocument, opts: ValidateOptions): void => {
  const inv = doc.invoice;
  if (!inv) return;
  if (!isIsoDate(inv.operationDate)) {
    c.error('invoice.operationDate', 'invalid_date', 'La data del documento non è valida (formato AAAA-MM-GG).');
    return;
  }
  const today = localIsoDate(opts.now ?? new Date());
  const delta = daysBetween(today, inv.operationDate);
  if (delta > FUTURE_TOLERANCE_DAYS) {
    c.error('invoice.operationDate', 'date_in_future', 'La data del documento è nel futuro: il Sistema di Interscambio scarta le fatture con data successiva all\'invio.');
  } else if (-delta > ISSUE_TERM_DAYS) {
    c.warn('invoice.operationDate', 'issue_term_exceeded', `La data del documento è di oltre ${ISSUE_TERM_DAYS} giorni fa: la trasmissione allo SDI potrebbe essere tardiva.`);
  }
  if (Number.isFinite(inv.year) && Number(inv.operationDate.slice(0, 4)) !== inv.year) {
    c.warn('invoice.year', 'year_mismatch', 'L\'anno della data non coincide con l\'anno di numerazione del documento.');
  }
  if (opts.lastIssuedDate && isIsoDate(opts.lastIssuedDate) && inv.operationDate < opts.lastIssuedDate) {
    c.warn('invoice.operationDate', 'not_chronological', 'La data è precedente a quella dell\'ultima fattura emessa nello stesso sezionale: la numerazione dovrebbe seguire l\'ordine cronologico.');
  }
};

const checkNumber = (c: Collector, doc: QuoteDocument): void => {
  const inv = doc.invoice;
  if (!inv) return;
  const num = inv.number;
  if (!num) {
    const draft = doc.status === 'bozza';
    const add = draft ? c.warn : c.error;
    add.call(c, 'invoice.number', 'number_missing', draft ? 'Il numero verrà assegnato al momento dell\'emissione.' : 'Il numero della fattura è obbligatorio.');
    return;
  }
  if (num.length > LIMITS.numero) c.error('invoice.number', 'too_long', `Il numero fattura supera ${LIMITS.numero} caratteri.`);
  if (!/\d/.test(num)) c.error('invoice.number', 'no_digit', 'Il numero fattura deve contenere almeno una cifra.');
  if (sanitizeText(num).text !== num) c.error('invoice.number', 'invalid_chars', 'Il numero fattura contiene caratteri non ammessi.');
};

const checkCreditNote = (c: Collector, doc: QuoteDocument): void => {
  const inv = doc.invoice;
  if (!inv || inv.tipoDocumento !== 'TD04') return;
  if (!trimmed(inv.originalNumber)) {
    c.error('invoice.originalNumber', 'required', 'La nota di credito deve riportare il numero della fattura originale.');
  } else if ((inv.originalNumber as string).length > LIMITS.idDocumento) {
    c.error('invoice.originalNumber', 'too_long', `Il numero della fattura originale supera ${LIMITS.idDocumento} caratteri.`);
  }
  if (!isIsoDate(inv.originalDate)) {
    c.error('invoice.originalDate', 'required', 'La nota di credito deve riportare la data della fattura originale.');
  } else if (isIsoDate(inv.operationDate) && inv.originalDate > inv.operationDate) {
    c.warn('invoice.originalDate', 'original_after_credit_note', 'La fattura originale ha data successiva alla nota di credito.');
  }
  if (!trimmed(inv.creditNoteReason)) {
    c.warn('invoice.creditNoteReason', 'missing_reason', 'Indica il motivo dello storno (verrà riportato in causale).');
  } else {
    c.text('invoice.creditNoteReason', 'Il motivo dello storno', inv.creditNoteReason, LIMITS.causale * 4);
  }
};

const checkTotalsAndStamp = (c: Collector, doc: QuoteDocument, profile: Profile): void => {
  const inv = doc.invoice;
  if (!inv || !Array.isArray(doc.lines) || doc.lines.length === 0) return;
  const t = computeInvoiceTotals(doc, profile);
  if (t.totalCents <= 0) c.error('lines', 'zero_total', 'Il totale del documento deve essere maggiore di zero.');
  if (profile.regimeForfettario) {
    if (inv.stampDuty !== t.stampDue) {
      c.warn('invoice.stampDuty', 'stamp_recomputed', t.stampDue
        ? `Il bollo da 2,00 € è dovuto (importo ${formatCents(t.linesNetCents)} € oltre 77,47 €): verrà inserito.`
        : `Il bollo non è dovuto (importo ${formatCents(t.linesNetCents)} € non oltre ${formatCents(STAMP_DUTY_THRESHOLD_CENTS)} €): non verrà inserito.`);
    }
    if (t.stampDue) {
      c.warn('invoice.stampDuty', 'stamp_due', inv.stampDutyChargedToCustomer
        ? 'Bollo da 2,00 € addebitato al cliente con riga di rimborso (natura N1) [DA VERIFICARE col commercialista].'
        : 'Bollo da 2,00 € a tuo carico: ricordati di versarlo (non viene addebitato al cliente).');
    }
  }
};

/** Validazioni pre-emissione. Non lancia mai. */
export const validateInvoiceForIssue = (
  doc: QuoteDocument,
  profile: Profile,
  opts: ValidateOptions = {},
): ValidationIssue[] => {
  const c = new Collector();
  try {
    if (doc.type !== 'fattura') c.error('type', 'not_invoice', 'Solo le fatture possono essere emesse in formato elettronico.');
    if (!doc.invoice) {
      c.error('invoice', 'required', 'Mancano i dati fiscali della fattura.');
    } else if (doc.invoice.tipoDocumento !== 'TD01' && doc.invoice.tipoDocumento !== 'TD04') {
      c.error('invoice.tipoDocumento', 'invalid_type', 'Tipo documento non supportato (ammessi TD01 e TD04).');
    }
    checkProfile(c, profile);
    checkCustomer(c, doc.customer ?? ({} as Customer));
    if (!Array.isArray(doc.lines) || doc.lines.length === 0) {
      c.error('lines', 'no_lines', 'La fattura deve avere almeno una riga.');
    } else {
      doc.lines.forEach((l, i) => checkLine(c, l, i, profile.regimeForfettario));
    }
    checkDates(c, doc, opts);
    checkNumber(c, doc);
    checkCreditNote(c, doc);
    checkTotalsAndStamp(c, doc, profile);
  } catch (e) {
    c.error('document', 'validation_failed', `Controllo non riuscito: ${e instanceof Error ? e.message : String(e)}`);
  }
  return c.issues;
};
