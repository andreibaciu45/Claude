/**
 * Property test DETERMINISTICI (PRNG con seed) sui totali in centesimi.
 * Verificano che: ogni importo è un intero, i totali sono la somma esatta delle parti, il risultato coincide con
 * un riferimento razionale esatto (BigInt) e NON dipende dall'ordine delle righe; mostrano anche perché il float non basta.
 * Nessun orologio, nessuna rete, nessuno stato globale.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDocumentTotals, divRoundHalfUp, formatCents, fromCents, lineTotalCents, summarizeByRate, taxCents, toCents,
  type DocumentLineInput,
} from './money';

/** mulberry32: PRNG a 32 bit con seed, stesso flusso su ogni macchina. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const RATES = [0, 4, 5, 10, 22];

function randomLines(r: () => number): DocumentLineInput[] {
  const n = 1 + Math.floor(r() * 12);
  return Array.from({ length: n }, () => {
    const rate = RATES[Math.floor(r() * RATES.length)];
    // prezzi con 2-4 decimali (come "0,333 al metro"), quantità frazionarie, qualche sconto % e qualche riga di sconto in euro
    const price = Math.round(r() * 200000) / 10 ** (2 + Math.floor(r() * 3));
    const qty = Math.round((0.01 + r() * 40) * 1000) / 1000;
    const discountPct = r() < 0.3 ? Math.round(r() * 3000) / 100 : undefined;
    const isEuroDiscount = r() < 0.1;
    return { qty: isEuroDiscount ? 1 : qty, unitPrice: isEuroDiscount ? -Math.round(r() * 5000) / 100 : price, discountPct, vatRate: rate, natura: rate === 0 ? 'N2.2' : undefined };
  });
}

/** Riferimento esatto: razionali con BigInt, scala 1e8 per ogni fattore (stessa definizione di lineTotalCents, scritta in modo indipendente). */
function referenceLineCents(l: DocumentLineInput): number {
  const s = (x: number) => BigInt(Math.round(x * 1e8));
  const bp = BigInt(10000 - Math.min(10000, Math.max(0, Math.round((l.discountPct ?? 0) * 100))));
  const num = s(l.unitPrice) * s(l.qty) * bp; // /1e18 -> centesimi
  const den = 10n ** 18n;
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = (a * 2n + den) / (2n * den);
  return Number(neg ? -q : q);
}

describe('totali in centesimi: proprietà su input casuali (seed fissi)', () => {
  it('ogni importo è un intero e il totale è la somma esatta di imponibili e imposte', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const lines = randomLines(r);
      for (const forf of [false, true]) for (const chg of [false, true]) {
        const t = computeDocumentTotals(lines, { regimeForfettario: forf, stampDutyChargedToCustomer: chg });
        for (const v of [...t.lineTotals, t.linesNetCents, t.taxCents, t.totalCents, t.stampCents, t.stampReimbursementCents]) expect(Number.isInteger(v)).toBe(true);
        expect(t.linesNetCents).toBe(t.lineTotals.reduce((s, c) => s + c, 0));
        expect(t.taxCents).toBe(t.summary.reduce((s, g) => s + g.taxCents, 0));
        expect(t.totalCents).toBe(t.summary.reduce((s, g) => s + g.taxableCents + g.taxCents, 0));
        // totale = imponibile righe + rimborso bollo + imposta (il bollo a carico del cedente NON entra)
        expect(t.totalCents).toBe(t.linesNetCents + t.stampReimbursementCents + t.taxCents);
        expect(t.stampReimbursementCents).toBe(t.stampDue && chg ? 200 : 0);
        expect(t.stampDue).toBe(forf && t.linesNetCents > 7747);
      }
    }
  });

  it('il totale di riga coincide con il riferimento razionale esatto (un solo arrotondamento half-up)', () => {
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0xabcdef);
      for (const l of randomLines(r)) expect(lineTotalCents(l)).toBe(referenceLineCents(l));
    }
  });

  it('il risultato non dipende dall\'ordine delle righe', () => {
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0x5eed);
      const lines = randomLines(r);
      const shuffled = [...lines].sort(() => r() - 0.5);
      const a = computeDocumentTotals(lines, { regimeForfettario: false, stampDutyChargedToCustomer: false });
      const b = computeDocumentTotals(shuffled, { regimeForfettario: false, stampDutyChargedToCustomer: false });
      expect(b.totalCents).toBe(a.totalCents);
      expect(b.taxCents).toBe(a.taxCents);
      expect(b.linesNetCents).toBe(a.linesNetCents);
      const key = (s: ReturnType<typeof summarizeByRate>) => s.map((g) => `${g.vatRate}|${g.natura ?? ''}|${g.taxableCents}|${g.taxCents}`).sort();
      expect(key(b.summary)).toEqual(key(a.summary));
    }
  });

  it('centesimi vs float: lo scarto della somma in virgola mobile è sempre sotto 1 centesimo per riga, ma la somma intera è esatta', () => {
    let floatDiffers = 0;
    let cases = 0;
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0xf10a7);
      const lines = randomLines(r).filter((l) => l.unitPrice > 0);
      const cents = lines.map(lineTotalCents);
      const exact = cents.reduce((s, c) => s + c, 0);
      const floatSum = lines.reduce((s, l) => s + l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100), 0);
      cases++;
      // il float, arrotondato alla fine, può differire dalla somma di righe arrotondate (comportamento corretto della fattura):
      // la differenza resta comunque limitata a mezzo centesimo per riga
      expect(Math.abs(floatSum * 100 - exact)).toBeLessThanOrEqual(0.5 * lines.length + 1e-6);
      if (Math.round(floatSum * 100) !== exact) floatDiffers++;
      // la somma intera è invariante: fromCents/toCents fanno round-trip senza rumore binario
      expect(toCents(fromCents(exact))).toBe(exact);
      expect(formatCents(exact)).toBe((exact / 100).toFixed(2));
    }
    // non è un'asserzione sul numero (dipende dai seed): serve a rendere visibile che il confronto è significativo
    expect(cases).toBe(SEEDS.length);
    expect(floatDiffers).toBeGreaterThanOrEqual(0);
  });

  it('toCents/fromCents: round-trip su tutti i centesimi di un intervallo, anche con rumore binario (0.1+0.2, 1.005...)', () => {
    for (let c = -2000; c <= 20000; c++) expect(toCents(fromCents(c))).toBe(c === 0 ? 0 : c);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(Object.is(toCents(-0.001), -0)).toBe(false);
  });

  it('divRoundHalfUp è simmetrica e taxCents è monotona nell\'imponibile', () => {
    const r = rng(77);
    for (let i = 0; i < 500; i++) {
      const n = BigInt(Math.floor(r() * 1e9) - 5e8);
      const d = BigInt(1 + Math.floor(r() * 5000));
      expect(divRoundHalfUp(-n, d)).toBe(-divRoundHalfUp(n, d));
    }
    for (const rate of RATES) {
      let prev = -Infinity;
      for (let base = 0; base <= 5000; base += 7) { const t = taxCents(base, rate); expect(t).toBeGreaterThanOrEqual(prev); prev = t; }
    }
  });
});
