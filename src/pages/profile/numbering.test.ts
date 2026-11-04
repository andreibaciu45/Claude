import { describe, expect, it } from 'vitest';
import { evaluateCounterInput, numberText } from './numbering';

const ev = (input: string, over = {}) => evaluateCounterInput({ input, sectional: 'FT', year: 2026, maxIssued: 0, current: 0, ...over });

describe('evaluateCounterInput', () => {
  it('14 -> la prossima è 15/2026', () => {
    expect(ev('14')).toMatchObject({ value: 14, nextNumber: '15/2026', lowering: false, unchanged: false });
    expect(ev(' 0 ')).toMatchObject({ value: 0, nextNumber: '1/2026', unchanged: true });
  });
  it('note di credito: prefisso NC', () => {
    expect(evaluateCounterInput({ input: '2', sectional: 'NC', year: 2026, maxIssued: 0, current: 0 }).nextNumber).toBe('NC3/2026');
    expect(numberText('NC', 1, 2027)).toBe('NC1/2027');
  });
  it('input non valido: vuoto, lettere, numero con anno, decimali, enorme', () => {
    for (const bad of ['', 'abc', '14/2026', '1,5', '-3', '99999999999999999999']) expect(ev(bad).error, bad).toBeTruthy();
    expect(ev('14/2026').error).toMatch(/solo cifre/);
  });
  it('sotto il massimo già emesso: errore bloccante con il numero emesso', () => {
    const r = ev('3', { maxIssued: 5, current: 5 });
    expect(r.error).toMatch(/5\/2026/);
    expect(r.nextNumber).toBeUndefined();
  });
  it('più basso dell\'attuale ma non dell\'emesso: abbassamento (doppia conferma)', () => {
    expect(ev('10', { maxIssued: 5, current: 14 })).toMatchObject({ lowering: true, nextNumber: '11/2026' });
    expect(ev('10', { maxIssued: 5, current: 14 }).error).toBeUndefined();
    expect(ev('14', { maxIssued: 5, current: 14 }).unchanged).toBe(true);
  });
});
