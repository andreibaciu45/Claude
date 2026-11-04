/**
 * Generatore XML FatturaPA FPR12 (TD01 / TD04, forfettario RF19).
 * Struttura e ordine degli elementi: docs/FISCAL-SPEC.md §2.2 e §2.5 [DA VERIFICARE sull'XSD ufficiale,
 * non scaricato in sessione]. Importi sempre da centesimi interi.
 */
import type { Customer, DocLine, Profile, QuoteDocument, ValidationIssue } from '../types';
import { fitText, chunkText } from './text';
import { el, leaf, optLeaf, renderNode, type XNode } from './xmlWriter';
import { formatCents, formatDecimal, discountBasisPoints, type DocumentTotalsCents } from '../fiscal/money';
import { isValidEmail, isValidIban, isValidProvinciaIt } from '../fiscal/validators';
import {
  CAUSALE_BOLLO,
  CAUSALE_FORFETTARIO,
  CAUSALE_NO_RITENUTA,
  DESC_RIMBORSO_BOLLO,
  LIMITS,
  RIF_NORM_FORFETTARIO,
  RIF_NORM_N1,
  RIF_NORM_N1_BOLLO,
  computeInvoiceTotals,
  derivePayment,
  isNaturalPersonCf,
  itDate,
  lineNatura,
  normalizeCountry,
  normalizeFiscalCode,
  normalizeVat,
  resolveCustomerIds,
  resolveRecipient,
  splitPersonName,
  trimmed,
} from './common';
import { validateInvoiceForIssue, type ValidateOptions } from './validate';

export interface FatturaPAResult {
  xml: string;
  fileName: string; // 'IT<PIVA>_<progressivoInvio>.xml'
  progressivoInvio: string; // 5 char alfanumerici
}

export interface GenerateOptions extends ValidateOptions {
  /** Scadenza pagamento ISO; se assente si deduce da "N giorni" in profile.paymentTerms. */
  paymentDueDate?: string;
}

/** Errore lanciato da generateFatturaPA quando la validazione ha errori bloccanti. */
export class FatturaPAValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`Fattura non valida: ${issues.map((i) => i.message).join(' ')}`);
    this.name = 'FatturaPAValidationError';
    this.issues = issues;
  }
}

export const FATTURAPA_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
const PROGRESSIVO_RE = /^[A-Z0-9]{5}$/;

/** Progressivo di 5 caratteri base-36 maiuscolo: 1 -> '00001', 36 -> '00010'. */
export const formatProgressivoInvio = (n: number): string => {
  if (!Number.isInteger(n) || n < 0 || n >= 36 ** 5) {
    throw new RangeError('Il progressivo di invio deve essere un intero tra 0 e 60466175');
  }
  return n.toString(36).toUpperCase().padStart(5, '0');
};

/** Nome file: 'IT' + P.IVA trasmittente + '_' + progressivo [DA VERIFICARE: P.IVA o CF del trasmittente]. */
export const buildFileName = (vatNumber: string, progressivoInvio: string): string =>
  `IT${normalizeVat(vatNumber)}_${progressivoInvio}.xml`;

const fit = (s: string | undefined, max: number): string => fitText(s ?? '', max).value;

// ---- anagrafica ------------------------------------------------------------------------------

const anagrafica = (legalName: string, person: { nome: string; cognome: string } | null): XNode =>
  person
    ? el('Anagrafica', leaf('Nome', fit(person.nome, LIMITS.nome)), leaf('Cognome', fit(person.cognome, LIMITS.cognome)))
    : el('Anagrafica', leaf('Denominazione', fit(legalName, LIMITS.denominazione)));

const sede = (a: { address?: string; zip?: string; city?: string; province?: string }, country: string): XNode => {
  const foreign = country !== 'IT';
  const province = trimmed(a.province).toUpperCase();
  return el(
    'Sede',
    leaf('Indirizzo', fit(a.address, LIMITS.indirizzo)),
    leaf('CAP', foreign ? '00000' : trimmed(a.zip)),
    leaf('Comune', fit(a.city, LIMITS.comune)),
    !foreign && isValidProvinciaIt(province) && leaf('Provincia', province),
    leaf('Nazione', country),
  );
};

const idFiscaleIva = (country: string, code: string): XNode =>
  el('IdFiscaleIVA', leaf('IdPaese', country), leaf('IdCodice', code));

const cedenteContatti = (p: Profile): XNode | null => {
  const phone = trimmed(p.phone).replace(/[\s.-]/g, '');
  const phoneOk = phone.length >= LIMITS.telefonoMin && phone.length <= LIMITS.telefonoMax;
  const email = trimmed(p.email);
  const emailOk = !!email && isValidEmail(email);
  if (!phoneOk && !emailOk) return null;
  return el('Contatti', phoneOk && leaf('Telefono', phone), emailOk && leaf('Email', email));
};

const cedenteRea = (p: Profile): XNode | null => {
  const office = trimmed(p.reaOffice).toUpperCase();
  const number = trimmed(p.reaNumber);
  if (!isValidProvinciaIt(office) || !number) return null;
  return el(
    'IscrizioneREA',
    leaf('Ufficio', office),
    leaf('NumeroREA', fit(number, LIMITS.reaNumero)),
    leaf('StatoLiquidazione', 'LN'), // LN = non in liquidazione
  );
};

const cedentePrestatore = (p: Profile): XNode => {
  const cf = normalizeFiscalCode(p.fiscalCode);
  const owner = trimmed(p.ownerName);
  const person = isNaturalPersonCf(cf) && owner ? splitPersonName(owner) : null;
  return el(
    'CedentePrestatore',
    el(
      'DatiAnagrafici',
      idFiscaleIva('IT', normalizeVat(p.vatNumber)),
      cf && leaf('CodiceFiscale', cf),
      anagrafica(trimmed(p.businessName) || owner, person),
      leaf('RegimeFiscale', 'RF19'),
    ),
    sede(p, 'IT'),
    cedenteRea(p),
    cedenteContatti(p),
  );
};

const cessionarioCommittente = (c: Customer): XNode => {
  const ids = resolveCustomerIds(c);
  const country = ids.country;
  const person = !ids.vat && isNaturalPersonCf(ids.fiscalCode) ? splitPersonName(c.name) : null;
  return el(
    'CessionarioCommittente',
    el(
      'DatiAnagrafici',
      ids.vat && idFiscaleIva(country, ids.vat),
      ids.fiscalCode && leaf('CodiceFiscale', ids.fiscalCode),
      anagrafica(c.name, person),
    ),
    sede(c, country),
  );
};

// ---- header ----------------------------------------------------------------------------------

const datiTrasmissione = (profile: Profile, customer: Customer, progressivo: string): XNode => {
  const r = resolveRecipient(customer);
  return el(
    'DatiTrasmissione',
    el('IdTrasmittente', leaf('IdPaese', 'IT'), leaf('IdCodice', normalizeVat(profile.vatNumber))),
    leaf('ProgressivoInvio', progressivo),
    leaf('FormatoTrasmissione', 'FPR12'),
    leaf('CodiceDestinatario', r.codiceDestinatario),
    optLeaf('PECDestinatario', r.pec),
  );
};

// ---- body ------------------------------------------------------------------------------------

/** Blocchi di Causale (ciascuno <= 200 caratteri). TD04: motivo dello storno prima, poi dicitura forfettario. */
export const buildCausali = (doc: QuoteDocument, stampDue?: boolean): string[] => {
  const inv = doc.invoice;
  // bollo dovuto: la dicitura compare anche nell'XML, identica a quella del PDF (./legalText). Default: invoice.stampDuty.
  const bollo = (stampDue ?? !!inv?.stampDuty) ? [CAUSALE_BOLLO] : [];
  if (inv?.tipoDocumento === 'TD04') {
    const reason = trimmed(inv.creditNoteReason);
    const ref = `Storno della fattura n. ${inv.originalNumber ?? ''} del ${inv.originalDate ? itDate(inv.originalDate) : ''}`;
    const first = !reason ? `${ref}.` : reason.includes(inv.originalNumber ?? '\u0000') ? reason : `${ref}: ${reason}`;
    return [...chunkText(first, LIMITS.causale), ...[CAUSALE_FORFETTARIO, ...bollo].flatMap((t) => chunkText(t, LIMITS.causale))];
  }
  return [CAUSALE_FORFETTARIO, ...bollo, CAUSALE_NO_RITENUTA].flatMap((t) => chunkText(t, LIMITS.causale));
};

const datiGenerali = (doc: QuoteDocument, totals: DocumentTotalsCents): XNode => {
  const inv = doc.invoice as NonNullable<QuoteDocument['invoice']>;
  const td04 = inv.tipoDocumento === 'TD04';
  return el(
    'DatiGenerali',
    el(
      'DatiGeneraliDocumento',
      leaf('TipoDocumento', inv.tipoDocumento),
      leaf('Divisa', 'EUR'),
      leaf('Data', inv.operationDate),
      leaf('Numero', inv.number as string),
      totals.stampDue && el('DatiBollo', leaf('BolloVirtuale', 'SI'), leaf('ImportoBollo', formatCents(totals.stampCents))),
      leaf('ImportoTotaleDocumento', formatCents(totals.totalCents)),
      ...buildCausali(doc, totals.stampDue).map((t) => leaf('Causale', t)),
    ),
    td04 &&
      el(
        'DatiFattureCollegate',
        leaf('IdDocumento', fit(inv.originalNumber, LIMITS.idDocumento)),
        leaf('Data', inv.originalDate as string),
      ),
  );
};

const dettaglioLinea = (n: number, l: DocLine, totalCents: number): XNode => {
  const disc = discountBasisPoints(l.discountPct);
  return el(
    'DettaglioLinee',
    leaf('NumeroLinea', String(n)),
    leaf('Descrizione', fit(l.description, LIMITS.descrizione)),
    leaf('Quantita', formatDecimal(l.qty)),
    optLeaf('UnitaMisura', fit(l.unit, LIMITS.unitaMisura)),
    leaf('PrezzoUnitario', formatDecimal(l.unitPrice)),
    disc > 0 && el('ScontoMaggiorazione', leaf('Tipo', 'SC'), leaf('Percentuale', formatDecimal(disc / 100, 2, 2))),
    leaf('PrezzoTotale', formatCents(totalCents)),
    leaf('AliquotaIVA', '0.00'),
    leaf('Natura', lineNatura(l)),
  );
};

const rimborsoBollo = (n: number, cents: number): XNode =>
  el(
    'DettaglioLinee',
    leaf('NumeroLinea', String(n)),
    leaf('Descrizione', DESC_RIMBORSO_BOLLO),
    leaf('Quantita', '1.00'),
    leaf('PrezzoUnitario', formatCents(cents)),
    leaf('PrezzoTotale', formatCents(cents)),
    leaf('AliquotaIVA', '0.00'),
    leaf('Natura', 'N1'),
  );

const datiRiepilogo = (totals: DocumentTotalsCents): XNode[] =>
  totals.summary.map((g) => {
    const onlyBollo = g.natura === 'N1' && g.taxableCents === totals.stampReimbursementCents;
    const rif = g.natura === 'N1' ? (onlyBollo ? RIF_NORM_N1_BOLLO : RIF_NORM_N1) : RIF_NORM_FORFETTARIO;
    return el(
      'DatiRiepilogo',
      leaf('AliquotaIVA', '0.00'),
      leaf('Natura', g.natura ?? 'N2.2'),
      leaf('ImponibileImporto', formatCents(g.taxableCents)),
      leaf('Imposta', '0.00'),
      leaf('RiferimentoNormativo', fit(rif, LIMITS.riferimentoNormativo)),
    );
  });

const datiBeniServizi = (doc: QuoteDocument, totals: DocumentTotalsCents): XNode =>
  el(
    'DatiBeniServizi',
    ...doc.lines.map((l, i) => dettaglioLinea(i + 1, l, totals.lineTotals[i])),
    totals.stampReimbursementCents > 0 && rimborsoBollo(doc.lines.length + 1, totals.stampReimbursementCents),
    ...datiRiepilogo(totals),
  );

const datiPagamento = (doc: QuoteDocument, profile: Profile, totals: DocumentTotalsCents, due?: string): XNode | null => {
  const inv = doc.invoice as NonNullable<QuoteDocument['invoice']>;
  if (inv.tipoDocumento !== 'TD01') return null; // nota di credito: nessun pagamento
  const ibanOk = !!trimmed(profile.iban) && isValidIban(profile.iban as string);
  const pay = derivePayment(profile, inv.operationDate, ibanOk, due);
  if (!pay) return null;
  return el(
    'DatiPagamento',
    leaf('CondizioniPagamento', 'TP02'),
    el(
      'DettaglioPagamento',
      leaf('ModalitaPagamento', pay.modalita),
      optLeaf('DataScadenzaPagamento', pay.dueDate),
      leaf('ImportoPagamento', formatCents(totals.totalCents)),
      optLeaf('IBAN', pay.iban),
    ),
  );
};

// ---- API pubblica ----------------------------------------------------------------------------

/**
 * Genera l'XML FatturaPA (TD01 o TD04 secondo doc.invoice.tipoDocumento).
 * Lancia FatturaPAValidationError se validateInvoiceForIssue ha errori, o Error se mancano numero o progressivo.
 * Il bollo è ricalcolato dai totali (non si fida di invoice.stampDuty).
 */
export const generateFatturaPA = (
  doc: QuoteDocument,
  profile: Profile,
  progressivoInvio: string,
  options: GenerateOptions = {},
): FatturaPAResult => {
  if (!PROGRESSIVO_RE.test(progressivoInvio)) {
    throw new Error('Il progressivo di invio deve essere di 5 caratteri alfanumerici maiuscoli (es. 00001)');
  }
  const errors = validateInvoiceForIssue(doc, profile, options).filter((i) => i.severity === 'error');
  if (!doc.invoice?.number) {
    errors.push({ field: 'invoice.number', code: 'number_missing', message: 'Il numero della fattura non è stato assegnato.', severity: 'error' });
  }
  if (errors.length > 0) throw new FatturaPAValidationError(errors);

  const totals = computeInvoiceTotals(doc, profile);
  const header = el(
    'FatturaElettronicaHeader',
    datiTrasmissione(profile, doc.customer, progressivoInvio),
    cedentePrestatore(profile),
    cessionarioCommittente(doc.customer),
  );
  const body = el(
    'FatturaElettronicaBody',
    datiGenerali(doc, totals),
    datiBeniServizi(doc, totals),
    datiPagamento(doc, profile, totals, options.paymentDueDate),
  );
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ` +
    `xmlns:p="${FATTURAPA_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `${renderNode(header)}\n${renderNode(body)}\n</p:FatturaElettronica>\n`;
  return { xml, fileName: buildFileName(profile.vatNumber, progressivoInvio), progressivoInvio };
};
