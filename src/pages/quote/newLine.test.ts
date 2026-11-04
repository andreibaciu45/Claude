import { describe, expect, it } from 'vitest';
import { newLine } from './QuoteEditor';

describe('newLine (riga libera)', () => {
  it('in forfettario nasce con IVA 0 e natura N2.2', () => {
    const l = newLine(22, true);
    expect(l.vat).toBe(0);
    expect(l.natura).toBe('N2.2');
  });
  it('fuori dal forfettario usa l’aliquota di default, senza natura', () => {
    const l = newLine(22);
    expect(l.vat).toBe(22);
    expect(l.natura).toBeUndefined();
  });
});
