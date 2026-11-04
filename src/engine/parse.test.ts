import { describe, expect, it } from 'vitest';
import { CASES, DEFAULT_CATALOG } from './cases';
import { caseErrors } from './testutils';
import { parseDictation } from './index';

describe('parseDictation — casi reali', () => {
  it('ha almeno 40 casi', () => expect(CASES.length).toBeGreaterThanOrEqual(40));
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(caseErrors(c)).toEqual([]);
  });
});

describe('parseDictation — proprietà generali', () => {
  it('ogni riga ha id univoco, vat numerica e importi non negativi', () => {
    const r = parseDictation('quattro prese tre interruttori due salvavita una lavatrice', DEFAULT_CATALOG);
    const ids = new Set(r.lines.map((l) => l.id));
    expect(ids.size).toBe(r.lines.length);
    for (const l of r.lines) {
      expect(Number.isFinite(l.vat)).toBe(true);
      expect(l.unitPrice).toBeGreaterThanOrEqual(0);
      expect(l.qty).toBeGreaterThan(0);
    }
  });
  it('righe da catalogo ereditano prezzo, IVA e unità dal catalogo', () => {
    const r = parseDictation('una caldaia vaillant', DEFAULT_CATALOG);
    expect(r.lines[0]).toMatchObject({ catalogItemId: 'caldaia-vaillant', unitPrice: 1450, vat: 10, unit: 'pz', description: 'Caldaia a condensazione Vaillant 24 kW' });
  });
  it('righe libere: prezzo 0, IVA 22, needsReview', () => {
    const r = parseDictation('tre metri di grondaia', DEFAULT_CATALOG);
    expect(r.lines[0]).toMatchObject({ unitPrice: 0, vat: 22, needsReview: true, unit: 'm', qty: 3 });
    expect(r.lines[0].catalogItemId).toBeUndefined();
  });
  it('non muta il catalogo e non lancia con input strani', () => {
    const before = JSON.stringify(DEFAULT_CATALOG);
    for (const t of ['', '   ', '...', ',,,', '123', 'e e e e', 'virgola', 'mezzo', '😀 tre metri', 'per per per', 'cliente', 'a corpo', '€ 100']) {
      expect(() => parseDictation(t, DEFAULT_CATALOG)).not.toThrow();
    }
    expect(JSON.stringify(DEFAULT_CATALOG)).toBe(before);
  });
  it('è deterministico (a parte gli id)', () => {
    const strip = (t: string) => JSON.stringify(parseDictation(t, DEFAULT_CATALOG).lines.map(({ id: _i, ...x }) => x));
    const t = 'per il signor Bianchi due punti luce otto metri di cavo 2,5';
    expect(strip(t)).toBe(strip(t));
  });
  it('gestisce un catalogo con 500 voci in tempi ragionevoli', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ ...DEFAULT_CATALOG[i % DEFAULT_CATALOG.length], id: `x${i}`, name: `${DEFAULT_CATALOG[i % DEFAULT_CATALOG.length].name} v${i}` }));
    const t0 = Date.now();
    parseDictation('tre metri di tubo rame sedici dodici raccordi a gomito quattro ore di manodopera una caldaia vaillant', big);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
