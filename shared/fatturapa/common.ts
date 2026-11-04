/**
 * Costanti e funzioni condivise tra validazione e generazione.
 * Lunghezze: [DA VERIFICARE] sull'XSD ufficiale (non scaricato in sessione) — vedi docs/FISCAL-SPEC.md §5.3.
 */
import type { Customer, DocLine, NaturaIva, Profile, QuoteDocument } from '../types';
import { computeDocumentTotals, type DocumentTotalsCents } from '../fiscal/money';
import { isValidCodiceDestinatario, isValidPartitaIva, isValidPec } from '../fiscal/validators';

export const LIMITS = {
  denominazione: 80,
  nome: 60,
  cognome: 60,
  indirizzo: 60,
  comune: 60,
  numero: 20,
  descrizione: 1000,
  causale: 200,
  riferimentoNormativo: 100,
  unitaMisura: 10,
  telefonoMin: 5,
  telefonoMax: 12,
  idDocumento: 20,
  reaNumero: 20,
  idCodiceEstero: 28,
} as const;

/** Dicitura per il regime forfettario in Causale [DA VERIFICARE: testo esatto]. */
export const CAUSALE_FORFETTARIO =
  "Operazione effettuata ai sensi dell'articolo 1, commi da 54 a 89, della Legge n. 190/2014 - Regime forfettario.";
/** Nessuna ritenuta per i forfettari (art. 1 c. 67 L. 190/2014) [DA VERIFICARE]. */
export const CAUSALE_NO_RITENUTA =
  "Compenso non assoggettato a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014.";
export const RIF_NORM_FORFETTARIO = 'Art. 1, c. 54-89, L. 190/2014 - Regime forfettario';
export const RIF_NORM_N1 = 'Escluso art. 15 DPR 633/72';
export const RIF_NORM_N1_BOLLO = 'Escluso art. 15 DPR 633/72 - Rimborso bollo';
export const DESC_RIMBORSO_BOLLO = 'Rimborso imposta di bollo';

export const DEFAULT_NATURA: NaturaIva = 'N2.2';
export const ALLOWED_NATURE: readonly NaturaIva[] = ['N2.2', 'N1'];

// ---- normalizzazioni -------------------------------------------------------------------------

export const normalizeVat = (s: string | undefined): string => {
  const v = (s ?? '').replace(/\s+/g, '').toUpperCase();
  return /^IT\d{11}$/.test(v) ? v.slice(2) : v;
};
export const normalizeFiscalCode = (s: string | undefined): string => (s ?? '').replace(/\s+/g, '').toUpperCase();
export const normalizeCountry = (s: string | undefined): string => (s ?? '').trim().toUpperCase() || 'IT';
export const trimmed = (s: string | undefined): string => (s ?? '').trim();

// ---- date ISO --------------------------------------------------------------------------------

export const isIsoDate = (s: string | undefined): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const dayNumber = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/** Giorni tra due date ISO (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round(dayNumber(b) - dayNumber(a));

export const addDays = (iso: string, days: number): string =>
  new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);

/** Data locale di `now` come YYYY-MM-DD. */
export const localIsoDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (per le causali). */
export const itDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// ---- cliente ---------------------------------------------------------------------------------

export interface CustomerIds {
  vat: string;
  fiscalCode: string;
  country: string;
}

/** Identificativi del cliente, con fallback sul campo legacy `vatOrFiscalCode`. */
export const resolveCustomerIds = (c: Customer): CustomerIds => {
  let vat = normalizeVat(c.vatNumber);
  let fiscalCode = normalizeFiscalCode(c.fiscalCode);
  const legacy = normalizeFiscalCode(c.vatOrFiscalCode);
  if (!vat && !fiscalCode && legacy) {
    if (isValidPartitaIva(normalizeVat(legacy))) vat = normalizeVat(legacy);
    else fiscalCode = legacy;
  }
  return { vat, fiscalCode, country: normalizeCountry(c.country) };
};

export type Channel = 'codice' | 'pec' | 'consumatore' | 'estero';

export interface Recipient {
  channel: Channel;
  codiceDestinatario: string;
  pec?: string;
}

/** Regole di destinazione: estero 'XXXXXXX'; codice SDI valido; altrimenti '0000000' (+ PEC se presente). */
export const resolveRecipient = (c: Customer): Recipient => {
  const { vat, country } = resolveCustomerIds(c);
  if (country !== 'IT') return { channel: 'estero', codiceDestinatario: 'XXXXXXX' };
  const codice = trimmed(c.codiceDestinatario).toUpperCase();
  if (isValidCodiceDestinatario(codice) && codice !== '0000000' && codice !== 'XXXXXXX') {
    return { channel: 'codice', codiceDestinatario: codice };
  }
  const pec = trimmed(c.pec);
  if (pec && isValidPec(pec)) return { channel: 'pec', codiceDestinatario: '0000000', pec };
  return { channel: vat ? 'codice' : 'consumatore', codiceDestinatario: '0000000' };
};

/** Divide "Mario De Luca" in Nome="Mario", Cognome="De Luca" [DA VERIFICARE: ordine nome/cognome]. */
export const splitPersonName = (full: string): { nome: string; cognome: string } | null => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { nome: parts[0], cognome: parts.slice(1).join(' ') };
};

export const isNaturalPersonCf = (cf: string): boolean => cf.length === 16;

// ---- righe e totali --------------------------------------------------------------------------

export const lineNatura = (l: DocLine): NaturaIva => l.natura ?? DEFAULT_NATURA;

/** Totali del documento: nel forfettario l'aliquota è SEMPRE 0 (qualunque `vat` di riga viene ignorato). */
export const computeInvoiceTotals = (doc: QuoteDocument, profile: Profile): DocumentTotalsCents =>
  computeDocumentTotals(
    doc.lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatRate: profile.regimeForfettario ? 0 : l.vat,
      natura: lineNatura(l),
    })),
    {
      regimeForfettario: profile.regimeForfettario,
      stampDutyChargedToCustomer: !!doc.invoice?.stampDutyChargedToCustomer,
    },
  );

// ---- pagamento -------------------------------------------------------------------------------

export interface PaymentInfo {
  modalita: 'MP01' | 'MP02' | 'MP05' | 'MP08';
  dueDate?: string;
  iban?: string;
}

/**
 * Deriva modalità e scadenza dal testo libero `paymentTerms` [DA VERIFICARE: euristica].
 * bonifico -> MP05, contanti -> MP01, carta/POS -> MP08, assegno -> MP02; se non riconosciuto
 * ma c'è un IBAN -> MP05; altrimenti nessun blocco DatiPagamento.
 */
export const derivePayment = (
  profile: Profile,
  operationDate: string,
  ibanValid: boolean,
  dueDateOverride?: string,
): PaymentInfo | null => {
  const terms = (profile.paymentTerms ?? '').toLowerCase();
  let modalita: PaymentInfo['modalita'] | null = null;
  if (/bonifico/.test(terms)) modalita = 'MP05';
  else if (/contant/.test(terms)) modalita = 'MP01';
  else if (/carta|carte|\bpos\b|bancomat/.test(terms)) modalita = 'MP08';
  else if (/assegn/.test(terms)) modalita = 'MP02';
  else if (ibanValid) modalita = 'MP05';
  if (!modalita) return null;
  const days = /(\d{1,3})\s*(?:giorni|gg)\b/.exec(terms);
  const dueDate = dueDateOverride && isIsoDate(dueDateOverride)
    ? dueDateOverride
    : days
      ? addDays(operationDate, Number(days[1]))
      : undefined;
  return {
    modalita,
    dueDate,
    iban: modalita === 'MP05' && ibanValid ? (profile.iban ?? '').replace(/\s+/g, '').toUpperCase() : undefined,
  };
};
