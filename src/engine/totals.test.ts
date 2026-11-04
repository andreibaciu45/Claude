import { describe, expect, it } from 'vitest';
import type { DocLine } from '../types';
import { computeTotals } from './index';

const L = (qty: number, unitPrice: number, vat = 22, extra: Partial<DocLine> = {}): DocLine => ({
  id: Math.random().toString(36), description: 'x', qty, unit: 'pz', unitPrice, vat, ...extra,
});
const P = { forfettario: false, type: 'preventivo' as const };

describe('computeTotals', () => {
  it('righe vuote -> tutto zero', () => {
    expect(computeTotals([], P)).toEqual({ net: 0, vat: 0, stamp: 0, gross: 0, byRate: [] });
  });
  it('una riga con IVA 22', () => {
    expect(computeTotals([L(2, 50)], P)).toEqual({ net: 100, vat: 22, stamp: 0, gross: 122, byRate: [{ rate: 22, base: 100, vat: 22 }] });
  });
  it('qty 0 e prezzo 0 non producono aliquote', () => {
    const t = computeTotals([L(0, 100), L(3, 0, 10)], P);
    expect(t).toEqual({ net: 0, vat: 0, stamp: 0, gross: 0, byRate: [] });
  });
  it('sconto di riga', () => {
    const t = computeTotals([L(1, 200, 22, { discountPct: 10 })], P);
    expect(t.net).toBe(180);
    expect(t.vat).toBe(39.6);
    expect(t.gross).toBe(219.6);
  });
  it('sconto 100% azzera, sconto fuori range viene limitato', () => {
    expect(computeTotals([L(1, 100, 22, { discountPct: 100 })], P).net).toBe(0);
    expect(computeTotals([L(1, 100, 22, { discountPct: 250 })], P).net).toBe(0);
    expect(computeTotals([L(1, 100, 22, { discountPct: -20 })], P).net).toBe(100);
  });
  it('più aliquote: byRate ordinato e IVA per aliquota', () => {
    const t = computeTotals([L(1, 100, 22), L(1, 100, 4), L(1, 100, 10), L(2, 50, 22)], P);
    expect(t.byRate).toEqual([
      { rate: 4, base: 100, vat: 4 },
      { rate: 10, base: 100, vat: 10 },
      { rate: 22, base: 200, vat: 44 },
    ]);
    expect(t.net).toBe(400);
    expect(t.vat).toBe(58);
    expect(t.gross).toBe(458);
  });
  it('IVA arrotondata per aliquota, non per riga (3 righe da 0,33)', () => {
    const t = computeTotals([L(1, 0.33), L(1, 0.33), L(1, 0.33)], P);
    expect(t.net).toBe(0.99);
    expect(t.vat).toBe(0.22); // 0,99*22% = 0,2178; per riga sarebbe 3*0,07 = 0,21
    expect(t.gross).toBe(1.21);
  });
  it('arrotondamento half-up del centesimo sulla riga', () => {
    expect(computeTotals([L(1, 0.005)], P).net).toBe(0.01);
    expect(computeTotals([L(3, 1.005)], P).net).toBe(3.02);
    expect(computeTotals([L(1.5, 19.99)], P).net).toBe(29.99);
  });
  it('quantità decimali', () => {
    const t = computeTotals([L(2.5, 8.5), L(0.5, 280)], P);
    expect(t.net).toBe(161.25);
    expect(t.vat).toBe(35.48);
    expect(t.gross).toBe(196.73);
  });
  it('forfettario: IVA 0 ovunque, una sola aliquota 0', () => {
    const t = computeTotals([L(1, 100, 22), L(1, 50, 10)], { forfettario: true, type: 'preventivo' });
    expect(t).toEqual({ net: 150, vat: 0, stamp: 0, gross: 150, byRate: [{ rate: 0, base: 150, vat: 0 }] });
  });
  it('bollo: fattura + forfettario + imponibile > 77,47', () => {
    const o = { forfettario: true, type: 'fattura' as const };
    expect(computeTotals([L(1, 77.48)], o).stamp).toBe(2);
    expect(computeTotals([L(1, 77.48)], o).gross).toBe(79.48);
    expect(computeTotals([L(1, 77.47)], o).stamp).toBe(0);
    expect(computeTotals([L(1, 50)], o).stamp).toBe(0);
    expect(computeTotals([L(1, 1000)], o)).toMatchObject({ net: 1000, vat: 0, stamp: 2, gross: 1002 });
  });
  it('bollo: mai su preventivo né se non forfettario', () => {
    expect(computeTotals([L(1, 1000)], { forfettario: true, type: 'preventivo' }).stamp).toBe(0);
    expect(computeTotals([L(1, 1000)], { forfettario: false, type: 'fattura' }).stamp).toBe(0);
  });
  it('bollo sul netto dopo sconti', () => {
    const o = { forfettario: true, type: 'fattura' as const };
    expect(computeTotals([L(1, 100, 22, { discountPct: 30 })], o).stamp).toBe(0); // 70 < 77,47
    expect(computeTotals([L(1, 100, 22, { discountPct: 20 })], o).stamp).toBe(2); // 80
  });
  it('valori non finiti / negativi non rompono i totali', () => {
    const t = computeTotals([L(NaN, 10), L(1, Infinity), L(1, 10, -5)], P);
    expect(Number.isFinite(t.gross)).toBe(true);
    expect(t.net).toBe(10);
    expect(t.vat).toBe(0);
  });
  it('righe negative (storno) sono ammesse', () => {
    const t = computeTotals([L(1, 100), L(-1, 30)], P);
    expect(t.net).toBe(70);
    expect(t.vat).toBe(15.4);
  });
  it('totale coerente: gross = net + vat + stamp', () => {
    const lines = [L(7, 13.37), L(3, 4.99, 10), L(1.25, 99.99, 4)];
    const t = computeTotals(lines, P);
    expect(t.gross).toBe(Math.round((t.net + t.vat + t.stamp) * 100) / 100);
    expect(t.net).toBe(Math.round(t.byRate.reduce((s, r) => s + r.base, 0) * 100) / 100);
    expect(t.vat).toBe(Math.round(t.byRate.reduce((s, r) => s + r.vat, 0) * 100) / 100);
  });
});
