import { describe, expect, it } from 'vitest';
import { extractModifiers } from './modifiers';
import { lex } from './text';

const M = (t: string) => extractModifiers(lex(t));
const words = (t: string) => M(t).rest.map((x) => x.w).join(' ');

describe('extractModifiers', () => {
  it('sconto in percentuale, in tutte le forme', () => {
    expect(M('con sconto del dieci per cento').discount).toEqual({ pct: 10 });
    expect(M('sconto del 15 per cento').discount).toEqual({ pct: 15 });
    expect(M('sconto 5%').discount).toEqual({ pct: 5 });
    expect(M('applica uno sconto di cinque percento').discount).toEqual({ pct: 5 });
    expect(M('il dieci per cento di sconto').discount).toEqual({ pct: 10 });
  });
  it('sconto in euro', () => {
    expect(M('sconto venti euro').discount).toEqual({ amount: 20 });
    expect(M('con sconto di 50 euro').discount).toEqual({ amount: 50 });
    expect(M('trenta euro di sconto').discount).toEqual({ amount: 30 });
    expect(M('sconto cento euro').discount).toEqual({ amount: 100 });
  });
  it('sconto senza unità: euristica segnalata', () => {
    expect(M('sconto del cinque').discount).toEqual({ pct: 5 });
    expect(M('sconto cinque').discount).toEqual({ pct: 5, uncertain: true });
    expect(M('sconto 200').discount).toEqual({ amount: 200, uncertain: true });
  });
  it('toglie i token consumati dal testo', () => {
    expect(words('tre prese con sconto del dieci per cento e due faretti')).toBe('tre prese e due faretti');
    expect(words('tre prese sconto venti euro')).toBe('tre prese');
  });
  it('la parola sconto senza cifra viene tolta ma non inventa nulla', () => {
    const m = M('due prese con sconto');
    expect(m.discount).toBeUndefined();
    expect(m.rest.map((x) => x.w)).toEqual(['due', 'prese']);
  });
  it('IVA: aliquota e modalità', () => {
    expect(M('iva al dieci').vatRate).toBe(10);
    expect(M('iva al 22 per cento').vatRate).toBe(22);
    expect(M('con iva al quattro').vatRate).toBe(4);
    expect(M('iva ridotta al dieci').vatRate).toBe(10);
    expect(M('più iva').vatMode).toBe('plus');
    expect(M('piu iva').vatMode).toBe('plus');
    expect(M('iva esclusa').vatMode).toBe('plus');
    expect(M('iva non compresa').vatMode).toBe('plus');
    expect(M('iva compresa').vatMode).toBe('included');
    expect(M('comprensivo di iva').vatMode).toBe('included');
  });
  it('IVA fuori scala non viene presa', () => {
    expect(M('iva al 500').vatRate).toBeUndefined();
  });
  it('rimando al preventivo precedente', () => {
    for (const t of ['come da preventivo precedente', 'uguale al preventivo di prima', 'idem come da preventivo precedente', 'stessa offerta dell ultima volta preventivo ultimo']) {
      expect(M(t).referencesPrevious).toBe(true);
    }
    expect(words('come da preventivo precedente più due prese')).toBe('piu due prese');
    expect(M('preventivo per Rossi').referencesPrevious).toBe(false);
  });
  it('non tocca il testo senza modificatori', () => {
    const r = lex('tre metri di tubo rame sedici');
    expect(extractModifiers(r).rest).toEqual(r);
  });
});
