import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BLIND_SET } from './blind';
import { TRADES } from './catalogs';
import { FINAL_SET } from './final';
import { format, runSet } from './runner';

/**
 * Banco di prova (vedi anche baseline-blind.txt e first-pass-final.txt):
 * - BLIND_SET: 293 frasi scritte PRIMA di toccare il motore. Primo passaggio (cieco): 72,7% frasi / 81,0% righe.
 *   Dopo le correzioni è usato come test di regressione (non è più indipendente).
 * - FINAL_SET: 80 frasi scritte DOPO le correzioni e mai usate per tararle. Primo passaggio: 92,5% frasi / 95,2% righe.
 *   Le 6 frasi sbagliate sono poi state corrette con interventi generici (vedi first-pass-final.txt).
 */
describe('banco di prova', () => {
  it('cataloghi di 40-60 voci per 6 mestieri, con alias', () => {
    expect(Object.keys(TRADES)).toHaveLength(6);
    for (const [trade, cat] of Object.entries(TRADES)) {
      expect(cat.length, trade).toBeGreaterThanOrEqual(40);
      expect(cat.length, trade).toBeLessThanOrEqual(60);
      expect(new Set(cat.map((c) => c.id)).size, trade).toBe(cat.length);
      expect(cat.filter((c) => c.aliases.length > 0).length / cat.length, trade).toBeGreaterThan(0.9);
    }
  });

  it('set cieco: >= 250 frasi su 6 mestieri; set finale: 80 frasi nuove', () => {
    expect(BLIND_SET.length).toBeGreaterThanOrEqual(250);
    expect(new Set(BLIND_SET.map((c) => c.trade)).size).toBe(6);
    expect(FINAL_SET).toHaveLength(80);
    const blind = new Set(BLIND_SET.map((c) => c.t.toLowerCase()));
    expect(FINAL_SET.filter((c) => blind.has(c.t.toLowerCase()))).toEqual([]); // nessuna frase in comune
  });

  it('le frasi attese citano solo id esistenti nel catalogo del mestiere', () => {
    for (const c of [...BLIND_SET, ...FINAL_SET]) {
      const ids = new Set(TRADES[c.trade].map((x) => x.id));
      for (const l of c.lines) for (const id of l.id === undefined ? [] : Array.isArray(l.id) ? l.id : [l.id]) expect(ids.has(id), `${c.t}: ${id}`).toBe(true);
    }
  });

  it('primo passaggio cieco documentato (prima delle correzioni)', () => {
    const first = readFileSync(resolve(process.cwd(), 'src/engine/bench/baseline-blind.txt'), 'utf8').split('\n')[0];
    expect(first).toMatch(/frasi 213\/293 \(72\.7%\)/);
    const fin = readFileSync(resolve(process.cwd(), 'src/engine/bench/first-pass-final.txt'), 'utf8');
    expect(fin).toMatch(/FINALE: frasi 74\/80 \(92\.5%\)/);
  });

  it('regressione: set cieco >= 98% dopo le correzioni', () => {
    const r = runSet(BLIND_SET);
    if (process.env.ENGINE_BENCH_OUT) writeFileSync(process.env.ENGINE_BENCH_OUT, format('CIECO (dopo correzioni)', r));
    expect(r.casesOk / r.cases).toBeGreaterThanOrEqual(0.98);
    expect(r.linesOk / r.lines).toBeGreaterThanOrEqual(0.98);
  });

  it('verifica finale: >= 95% sul set mai usato per la taratura', () => {
    const f = runSet(FINAL_SET);
    if (process.env.ENGINE_BENCH_OUT) writeFileSync(`${process.env.ENGINE_BENCH_OUT}.final`, format('FINALE (dopo correzioni)', f));
    expect(f.casesOk / f.cases).toBeGreaterThanOrEqual(0.95);
    expect(f.linesOk / f.lines).toBeGreaterThanOrEqual(0.95);
  });
});
