/** Regressioni del secondo giro di revisione (docs/CODE-REVIEW-2.md): billing. */
import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_MS, canReplacePlanCache, readPlanCache, resolvePlan, type PlanCache } from './entitlement';
import { computeAllowance } from './allowance';
import { countDocsInMonth, ledgerIdsForMonth } from './usage';

const NOW = Date.parse('2026-11-04T10:00:00Z');
const pro = (verifiedAt: number, email = 'a@b.it'): PlanCache => ({ plan: 'pro', verifiedAt, email });

describe('REV2-B1 cache del piano con verifica "nel futuro" (orologio sballato in passato)', () => {
  it('prima della correzione l\'abbonato restava Free e la nuova risposta di /me non poteva riscrivere la cache', () => {
    const stuck = pro(NOW + 400 * 24 * 3600_000); // scritta quando il telefono segnava il 2027
    expect(resolvePlan(stuck, true, NOW, 'a@b.it').plan).toBe('free'); // non attendibile
    expect(canReplacePlanCache(stuck, NOW, 'a@b.it')).toBe(true); // ora si rinnova da sola
  });
  it('resta valido: mai una verifica più vecchia sopra una più recente (altra scheda), tolleranza di qualche minuto', () => {
    expect(canReplacePlanCache(pro(NOW), NOW - 60_000, 'a@b.it')).toBe(false);
    expect(canReplacePlanCache(pro(NOW + CLOCK_SKEW_MS), NOW, 'a@b.it')).toBe(false);
    expect(canReplacePlanCache(pro(NOW - 5000), NOW, 'a@b.it')).toBe(true);
    expect(canReplacePlanCache(null, NOW, 'a@b.it')).toBe(true);
    expect(canReplacePlanCache(pro(NOW + 10 * 24 * 3600_000, 'altro@b.it'), NOW - 1, 'a@b.it')).toBe(true); // altro account
  });
});

describe('REV2-B2 valori corrotti nella cache locale non rompono l\'app né fanno crescere i limiti', () => {
  const put = (v: unknown) => localStorage.setItem('vp:billing:plan', typeof v === 'string' ? v : JSON.stringify(v));
  it.each([
    ['non JSON', '{rotto'], ['null', 'null'], ['array', '[]'], ['piano sconosciuto', { plan: 'gold', verifiedAt: 1 }],
    ['verifiedAt stringa', { plan: 'pro', verifiedAt: '1' }], ['verifiedAt enorme', '{"plan":"pro","verifiedAt":1e999}'],
  ])('%s: nessuna eccezione, mai Pro', (_n, v) => {
    localStorage.clear(); put(v);
    const c = readPlanCache();
    expect(resolvePlan(c, true, NOW, 'a@b.it').plan === 'pro' && c === null).toBe(false);
    expect(() => computeAllowance(resolvePlan(c, true, NOW, 'a@b.it').plan, 0, c?.docsThisMonth)).not.toThrow();
  });
  it('conteggi del server assurdi (Infinity, negativi, frazionari) restano numeri sensati', () => {
    for (const bad of [Infinity, -5, 2.5, Number.NaN]) {
      const a = computeAllowance('free', 0, bad);
      expect(Number.isFinite(a.used), String(bad)).toBe(true);
      expect(Number.isInteger(a.used), String(bad)).toBe(true);
      expect(a.used).toBeGreaterThanOrEqual(0);
      expect(a.remaining === null || (a.remaining >= 0 && Number.isInteger(a.remaining))).toBe(true);
    }
    expect(computeAllowance('free', 1, Infinity).used).toBe(1); // valore non finito = ignorato, mai un blocco o un errore
  });
  it('registro locale corrotto: nessuna eccezione e il conteggio non cresce per voci non valide', () => {
    localStorage.clear();
    localStorage.setItem('vp:billing:ledger', JSON.stringify({ '2026-11': [1, null, {}, 'a', 'a'], 'x': ['b'], '2026-10': 'no' }));
    const ids = ledgerIdsForMonth(NOW);
    expect(ids).toEqual(['a', 'a']);
    expect(countDocsInMonth([], ids, NOW)).toBe(1);
  });
});
