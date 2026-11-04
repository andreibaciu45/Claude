import { describe, expect, it } from 'vitest';
import {
  codiceFiscaleCheckChar,
  isValidCapIt,
  isValidCodiceDestinatario,
  isValidCodiceFiscale,
  isValidIban,
  isValidPartitaIva,
  isValidPec,
  isValidProvinciaIt,
  vatCheckDigit,
} from './validators';

// Tutti i valori sono FITTIZI ma con checksum valido (docs/FISCAL-SPEC.md §2.5).
describe('isValidPartitaIva', () => {
  it.each(['01234567897', '09876543217', '12345678903'])('accetta %s', (v) => {
    expect(isValidPartitaIva(v)).toBe(true);
  });
  it('rifiuta cifra di controllo errata', () => {
    expect(isValidPartitaIva('01234567898')).toBe(false);
  });
  it.each(['', '1234567890', '012345678971', '0123456789A', 'IT01234567897', '00000000000'])('rifiuta %j', (v) => {
    expect(isValidPartitaIva(v)).toBe(false);
  });
  it('calcola la cifra di controllo', () => {
    expect(vatCheckDigit('0123456789')).toBe(7);
  });
  it('tollera spazi ai bordi', () => {
    expect(isValidPartitaIva(' 01234567897 ')).toBe(true);
  });
});

describe('isValidCodiceFiscale', () => {
  it.each(['RSSMRA80A01H501U', 'VRDLGI85M41F205H', 'MRTMTT91D08F205J'])('accetta persona fisica %s', (v) => {
    expect(isValidCodiceFiscale(v)).toBe(true);
  });
  it('è case-insensitive', () => {
    expect(isValidCodiceFiscale('rssmra80a01h501u')).toBe(true);
  });
  it('rifiuta carattere di controllo errato', () => {
    expect(isValidCodiceFiscale('RSSMRA80A01H501V')).toBe(false);
  });
  it('rifiuta forma errata (mese non ammesso, lunghezza)', () => {
    expect(isValidCodiceFiscale('RSSMRA80Z01H501U')).toBe(false);
    expect(isValidCodiceFiscale('RSSMRA80A01H501')).toBe(false);
    expect(isValidCodiceFiscale('')).toBe(false);
  });
  it('gestisce l\'omocodia (cifre sostituite da lettere)', () => {
    // RSSMRA80A01H501U con le ultime cifre della posizione 15 sostituite: '1'->'N' in "H501" => "H50N"
    const base = 'RSSMRA80A01H50N';
    const full = base + codiceFiscaleCheckChar(base);
    expect(isValidCodiceFiscale(full)).toBe(true);
  });
  it('accetta 11 cifre con checksum (persona giuridica)', () => {
    expect(isValidCodiceFiscale('01234567897')).toBe(true);
    expect(isValidCodiceFiscale('01234567890')).toBe(false);
  });
});

describe('isValidIban', () => {
  it.each(['IT60X0542811101000000123456', 'IT60 X054 2811 1010 0000 0123 456', 'GB82WEST12345698765432', 'DE89370400440532013000'])(
    'accetta %s',
    (v) => expect(isValidIban(v)).toBe(true),
  );
  it.each(['IT61X0542811101000000123456', 'IT60X054281110100000012345', 'XX', '', '1234567890123456'])('rifiuta %j', (v) => {
    expect(isValidIban(v)).toBe(false);
  });
});

describe('altri validatori', () => {
  it('codice destinatario: 7 caratteri alfanumerici maiuscoli', () => {
    for (const ok of ['0000000', 'XXXXXXX', 'ABC1234']) expect(isValidCodiceDestinatario(ok)).toBe(true);
    for (const ko of ['abc1234', 'ABC123', 'ABC12345', 'ABC-123', '']) expect(isValidCodiceDestinatario(ko)).toBe(false);
  });
  it('PEC: formato e lunghezza', () => {
    expect(isValidPec('mario.rossi@pec.it')).toBe(true);
    expect(isValidPec('a@b.it')).toBe(false); // < 7 caratteri
    expect(isValidPec('senza-chiocciola.it')).toBe(false);
    expect(isValidPec('x@y')).toBe(false);
  });
  it('CAP e provincia', () => {
    expect(isValidCapIt('00100')).toBe(true);
    expect(isValidCapIt('0010')).toBe(false);
    expect(isValidProvinciaIt('RM')).toBe(true);
    expect(isValidProvinciaIt('rm')).toBe(false);
  });
});
