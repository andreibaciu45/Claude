/**
 * Validatori anagrafici e bancari — funzioni PURE (browser + Node), nessuna dipendenza.
 *
 * Fonti (secondarie, [DA VERIFICARE] da un commercialista / sulle specifiche ufficiali):
 *  - P.IVA: 11 cifre, ultima = cifra di controllo (algoritmo di Luhn, variante italiana).
 *  - Codice fiscale: DM 23/12/1976 (carattere di controllo con tabelle dispari/pari, resto mod 26),
 *    omocodia: cifre sostituite da lettere LMNPQRSTUV.
 *  - IBAN: ISO 13616, controllo mod 97; per IT lunghezza 27.
 *
 * Tutti i valori usati nei test (P.IVA, CF, IBAN) sono FITTIZI ma con checksum valido.
 */

const onlyDigits = (s: string): boolean => /^\d+$/.test(s);

/** Cifra di controllo italiana per le prime 10 cifre di una P.IVA / CF numerico. */
export const vatCheckDigit = (first10: string): number => {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = first10.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      sum += d; // posizioni dispari (1a, 3a, ...)
    } else {
      const dbl = d * 2;
      sum += dbl > 9 ? dbl - 9 : dbl;
    }
  }
  return (10 - (sum % 10)) % 10;
};

/** P.IVA italiana: 11 cifre + checksum. Il valore 00000000000 è rifiutato (non assegnabile). */
export const isValidPartitaIva = (value: string): boolean => {
  const v = (value ?? '').trim();
  if (v.length !== 11 || !onlyDigits(v)) return false;
  if (v === '00000000000') return false;
  return vatCheckDigit(v) === v.charCodeAt(10) - 48;
};

const CF_ODD: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

const cfEvenValue = (ch: string): number => {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57 ? c - 48 : c - 65;
};

/** Carattere di controllo atteso per i primi 15 caratteri di un CF persona fisica. */
export const codiceFiscaleCheckChar = (first15: string): string => {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = first15[i];
    sum += i % 2 === 0 ? CF_ODD[ch] : cfEvenValue(ch);
  }
  return String.fromCharCode(65 + (sum % 26));
};

// Cifre ammesse anche come lettere LMNPQRSTUV (omocodia). Mese: A B C D E H L M P R S T.
const CF_SHAPE =
  /^[A-Z]{6}[\dLMNPQRSTUV]{2}[ABCDEHLMPRST][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/;

/**
 * Codice fiscale: 16 caratteri (persona fisica, con controllo e omocodia) oppure 11 cifre
 * (persone giuridiche, stesso checksum della P.IVA). Case-insensitive.
 */
export const isValidCodiceFiscale = (value: string): boolean => {
  const v = (value ?? '').trim().toUpperCase();
  if (v.length === 11) return isValidPartitaIva(v);
  if (v.length !== 16 || !CF_SHAPE.test(v)) return false;
  return codiceFiscaleCheckChar(v.slice(0, 15)) === v[15];
};

/** Normalizza un IBAN: toglie spazi, maiuscolo. */
export const normalizeIban = (value: string): string => (value ?? '').replace(/\s+/g, '').toUpperCase();

/** IBAN base: forma, lunghezza 15-34 (27 per IT), controllo mod 97. */
export const isValidIban = (value: string): boolean => {
  const iban = normalizeIban(value);
  if (iban.length < 15 || iban.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  if (iban.startsWith('IT') && iban.length !== 27) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const piece = code >= 65 ? String(code - 55) : ch; // A=10 ... Z=35
    for (const d of piece) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
};

/** Codice destinatario SDI: 7 caratteri alfanumerici maiuscoli (inclusi '0000000' e 'XXXXXXX'). */
export const isValidCodiceDestinatario = (value: string): boolean => /^[A-Z0-9]{7}$/.test(value ?? '');

/** PEC: formato email semplice, 7-256 caratteri. Non verifica che sia una vera PEC. */
export const isValidPec = (value: string): boolean => {
  const v = (value ?? '').trim();
  if (v.length < 7 || v.length > 256) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v);
};

/** Email generica (formato), 7-256 caratteri come da schema FatturaPA. */
export const isValidEmail = isValidPec;

/** CAP italiano: 5 cifre. */
export const isValidCapIt = (value: string): boolean => /^\d{5}$/.test(value ?? '');

/** Sigla provincia italiana: 2 lettere maiuscole. */
export const isValidProvinciaIt = (value: string): boolean => /^[A-Z]{2}$/.test(value ?? '');

/** Codice paese ISO 3166 alfa-2 (solo forma). */
export const isValidCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value ?? '');
