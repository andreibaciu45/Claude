import { describe, expect, it } from 'vitest';
import { isValidFiscalCode, isValidIban, isValidVat } from './validators';

describe('validatori', () => {
  it('P.IVA', () => {
    expect(isValidVat('00743110157')).toBe(true);
    expect(isValidVat('IT 00743110157')).toBe(true);
    expect(isValidVat('00743110158')).toBe(false);
    expect(isValidVat('123')).toBe(false);
  });
  it('IBAN', () => {
    expect(isValidIban('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(isValidIban('IT60X0542811101000000123457')).toBe(false);
  });
  it('codice fiscale', () => {
    expect(isValidFiscalCode('RSSMRA85T10A562S')).toBe(true);
    expect(isValidFiscalCode('RSSMRA85T10A562X')).toBe(false);
    expect(isValidFiscalCode('00743110157')).toBe(true);
  });
});
