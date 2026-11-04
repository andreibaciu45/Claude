import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CASES, HOLDOUT, HOLDOUT2, DEFAULT_CATALOG, type Case } from './cases';
import { parseDictation } from './index';
import { lineOk } from './testutils';

interface Score { cases: number; casesOk: number; lines: number; linesOk: number; customer: number; customerOk: number }

function evaluate(set: Case[]): { s: Score; fails: string[] } {
  const s: Score = { cases: 0, casesOk: 0, lines: 0, linesOk: 0, customer: 0, customerOk: 0 };
  const fails: string[] = [];
  for (const c of set) {
    const r = parseDictation(c.text, c.catalog ?? DEFAULT_CATALOG);
    s.cases++;
    let ok = true;
    if (c.customer !== undefined) {
      s.customer++;
      if ((r.customerName ?? null) === c.customer) s.customerOk++;
      else { ok = false; fails.push(`${c.name}: cliente ${r.customerName} != ${c.customer}`); }
    }
    c.lines.forEach((e, i) => {
      s.lines++;
      const errs = lineOk(r.lines[i], e);
      if (!errs.length && r.lines.length === c.lines.length) s.linesOk++;
      else { ok = false; fails.push(`${c.name}: riga ${i + 1}: ${errs.join('; ') || 'numero righe diverso'} [${r.lines.map((l) => `${l.description}x${l.qty}${l.unit}`).join(' | ')}]`); }
    });
    if (r.lines.length !== c.lines.length && !c.lines.length) { ok = false; fails.push(`${c.name}: righe inattese ${r.lines.length}`); }
    if (ok) s.casesOk++;
  }
  return { s, fails };
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '-') + '%';

describe('accuratezza', () => {
  it('misura su set di sviluppo + holdout', () => {
    const dev = evaluate(CASES);
    const ho = evaluate(HOLDOUT);
    const h2 = evaluate(HOLDOUT2);
    const report =
      `SVILUPPO: casi ${dev.s.casesOk}/${dev.s.cases} (${pct(dev.s.casesOk, dev.s.cases)}), righe ${dev.s.linesOk}/${dev.s.lines} (${pct(dev.s.linesOk, dev.s.lines)}), cliente ${dev.s.customerOk}/${dev.s.customer}\n` +
      `HOLDOUT:  casi ${ho.s.casesOk}/${ho.s.cases} (${pct(ho.s.casesOk, ho.s.cases)}), righe ${ho.s.linesOk}/${ho.s.lines} (${pct(ho.s.linesOk, ho.s.lines)}), cliente ${ho.s.customerOk}/${ho.s.customer}\n` +
      `HOLDOUT2: casi ${h2.s.casesOk}/${h2.s.cases} (${pct(h2.s.casesOk, h2.s.cases)}), righe ${h2.s.linesOk}/${h2.s.lines} (${pct(h2.s.linesOk, h2.s.lines)}), cliente ${h2.s.customerOk}/${h2.s.customer}\n` +
      [...dev.fails, ...ho.fails, ...h2.fails].join('\n');
    try { writeFileSync(process.env.ENGINE_ACCURACY_OUT ?? '/dev/null', report); } catch { /* ignore */ }
    expect(dev.s.casesOk / dev.s.cases).toBeGreaterThanOrEqual(0.95);
    expect(ho.s.casesOk / ho.s.cases).toBeGreaterThanOrEqual(0.85);
    expect(ho.s.linesOk / ho.s.lines).toBeGreaterThanOrEqual(0.9);
    expect(h2.s.casesOk / h2.s.cases).toBeGreaterThanOrEqual(0.8);
  });
});
