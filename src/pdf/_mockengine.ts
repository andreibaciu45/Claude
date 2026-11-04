import type { DocLine, DocType, Totals } from '../types';
import { roundMoney } from '../types';
export const computeTotals = (lines: DocLine[], o: { forfettario: boolean; type: DocType }): Totals => {
  const map = new Map<number, number>();
  for (const l of lines) map.set(l.vat, (map.get(l.vat) ?? 0) + roundMoney(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)));
  const byRate = [...map].map(([rate, base]) => ({ rate, base: roundMoney(base), vat: o.forfettario ? 0 : roundMoney((base * rate) / 100) }));
  const net = roundMoney(byRate.reduce((s, r) => s + r.base, 0));
  const vat = roundMoney(byRate.reduce((s, r) => s + r.vat, 0));
  const stamp = o.forfettario && o.type === 'fattura' && net > 77.47 ? 2 : 0;
  return { net, vat, stamp, gross: roundMoney(net + vat + stamp), byRate };
};
