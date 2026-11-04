import { describe, expect, it } from 'vitest';
import {
  computeDocumentTotals,
  formatCents,
  formatDecimal,
  fromCents,
  isStampDutyDue,
  lineTotalCents,
  summarizeByRate,
  taxCents,
  toCents,
} from './money';

describe('toCents / fromCents / formatCents', () => {
  it('converte senza errori binari', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101); // half-up commerciale
    expect(toCents(77.47)).toBe(7747);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(0)).toBe(0);
  });
  it('rifiuta valori non finiti', () => {
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
  });
  it('fromCents richiede interi', () => {
    expect(fromCents(37200)).toBe(372);
    expect(() => fromCents(1.5)).toThrow();
  });
  it('formatCents usa solo aritmetica intera', () => {
    expect(formatCents(37200)).toBe('372.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(-250)).toBe('-2.50');
    expect(formatCents(0)).toBe('0.00');
  });
  it('formatDecimal: da 2 a 8 decimali', () => {
    expect(formatDecimal(8)).toBe('8.00');
    expect(formatDecimal(4.5)).toBe('4.50');
    expect(formatDecimal(0.125)).toBe('0.125');
    expect(formatDecimal(1 / 3)).toBe('0.33333333');
  });
});

describe('lineTotalCents', () => {
  it('quantità × prezzo', () => {
    expect(lineTotalCents({ qty: 8, unitPrice: 35 })).toBe(28000);
    expect(lineTotalCents({ qty: 12, unitPrice: 4.5 })).toBe(5400);
  });
  it('arrotondamento commerciale half-up', () => {
    expect(lineTotalCents({ qty: 3, unitPrice: 1.005 })).toBe(302); // 3.015 -> 3.02
    expect(lineTotalCents({ qty: 1.5, unitPrice: 0.01 })).toBe(2); // 0.015 -> 0.02
    expect(lineTotalCents({ qty: 1, unitPrice: 0.004 })).toBe(0);
    expect(lineTotalCents({ qty: 0.5, unitPrice: 0.05 })).toBe(3); // 0.025 -> 0.03
  });
  it('sconto percentuale con un solo arrotondamento', () => {
    expect(lineTotalCents({ qty: 3, unitPrice: 19.99, discountPct: 10 })).toBe(5397); // 53.973
    expect(lineTotalCents({ qty: 1, unitPrice: 100, discountPct: 100 })).toBe(0);
    expect(lineTotalCents({ qty: 1, unitPrice: 33.33, discountPct: 12.5 })).toBe(2916); // 29.16375
  });
  it('sconti fuori range vengono limitati; valori non finiti valgono zero', () => {
    expect(lineTotalCents({ qty: 1, unitPrice: 10, discountPct: 150 })).toBe(0);
    expect(lineTotalCents({ qty: 1, unitPrice: 10, discountPct: -5 })).toBe(1000);
    expect(lineTotalCents({ qty: NaN, unitPrice: 10 })).toBe(0);
  });
  it('importi grandi senza perdita di precisione', () => {
    expect(lineTotalCents({ qty: 1000000, unitPrice: 12345.67 })).toBe(1234567000000);
  });
});

describe('bollo', () => {
  it('dovuto solo se forfettario e SOPRA 77,47', () => {
    expect(isStampDutyDue({ regimeForfettario: true, amountCents: 7747 })).toBe(false);
    expect(isStampDutyDue({ regimeForfettario: true, amountCents: 7748 })).toBe(true);
    expect(isStampDutyDue({ regimeForfettario: false, amountCents: 100000 })).toBe(false);
  });
});

describe('riepilogo per aliquota/natura', () => {
  it('raggruppa per coppia aliquota/natura nell\'ordine di comparsa', () => {
    const s = summarizeByRate([
      { totalCents: 1000, vatRate: 0, natura: 'N2.2' },
      { totalCents: 200, vatRate: 0, natura: 'N1' },
      { totalCents: 500, vatRate: 0, natura: 'N2.2' },
    ]);
    expect(s).toEqual([
      { vatRate: 0, natura: 'N2.2', taxableCents: 1500, taxCents: 0 },
      { vatRate: 0, natura: 'N1', taxableCents: 200, taxCents: 0 },
    ]);
  });
  it('calcola l\'imposta per aliquota con half-up', () => {
    expect(taxCents(10000, 22)).toBe(2200);
    expect(taxCents(101, 22)).toBe(22); // 22.22
    expect(taxCents(1, 50)).toBe(1); // 0.5 -> 1
  });
});

describe('computeDocumentTotals', () => {
  const lines = [
    { qty: 8, unitPrice: 35, vatRate: 0, natura: 'N2.2' as const },
    { qty: 12, unitPrice: 4.5, vatRate: 0, natura: 'N2.2' as const },
    { qty: 1, unitPrice: 36, vatRate: 0, natura: 'N2.2' as const },
  ];
  it('esempio A: rimborso bollo N1 incluso nel totale (372,00)', () => {
    const t = computeDocumentTotals(lines, { regimeForfettario: true, stampDutyChargedToCustomer: true });
    expect(t.linesNetCents).toBe(37000);
    expect(t.stampDue).toBe(true);
    expect(t.stampReimbursementCents).toBe(200);
    expect(t.totalCents).toBe(37200);
    expect(t.summary.map((g) => [g.natura, g.taxableCents])).toEqual([['N2.2', 37000], ['N1', 200]]);
  });
  it('bollo a carico del cedente: dovuto ma non sommato al totale', () => {
    const t = computeDocumentTotals(lines, { regimeForfettario: true, stampDutyChargedToCustomer: false });
    expect(t.stampDue).toBe(true);
    expect(t.stampCents).toBe(200);
    expect(t.stampReimbursementCents).toBe(0);
    expect(t.totalCents).toBe(37000);
  });
  it('soglia 77,47 / 77,48', () => {
    const at = (price: number) =>
      computeDocumentTotals([{ qty: 1, unitPrice: price, vatRate: 0, natura: 'N2.2' }], {
        regimeForfettario: true,
        stampDutyChargedToCustomer: true,
      });
    expect(at(77.47).stampDue).toBe(false);
    expect(at(77.47).totalCents).toBe(7747);
    expect(at(77.48).stampDue).toBe(true);
    expect(at(77.48).totalCents).toBe(7948);
  });
  it('non forfettario: nessun bollo, IVA calcolata', () => {
    const t = computeDocumentTotals([{ qty: 1, unitPrice: 100, vatRate: 22 }], {
      regimeForfettario: false,
      stampDutyChargedToCustomer: true,
    });
    expect(t.stampDue).toBe(false);
    expect(t.taxCents).toBe(2200);
    expect(t.totalCents).toBe(12200);
  });
});
