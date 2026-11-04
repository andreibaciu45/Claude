import { roundMoney, type DocLine, type DocType, type Totals } from '../types';

export const STAMP_AMOUNT = 2;
/** Soglia (in centesimi) oltre la quale, per i forfettari, serve la marca da bollo. */
export const STAMP_THRESHOLD_CENTS = 7747;

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Totali documento.
 * - sconto di riga -> imponibile di riga (arrotondato al centesimo)
 * - imponibile per aliquota, IVA calcolata sull'imponibile di ciascuna aliquota e arrotondata per aliquota
 * - forfettario: IVA 0 ovunque (una sola aliquota 0 in byRate)
 * - bollo 2 € solo fattura + forfettario + imponibile > 77,47
 */
export function computeTotals(lines: DocLine[], opts: { forfettario: boolean; type: DocType }): Totals {
  const bases = new Map<number, number>();
  for (const l of lines ?? []) {
    const qty = num(l.qty);
    const price = num(l.unitPrice);
    const disc = Math.min(100, Math.max(0, num(l.discountPct)));
    const lineNet = roundMoney(qty * price * (1 - disc / 100));
    const rate = opts.forfettario ? 0 : Math.max(0, num(l.vat));
    bases.set(rate, (bases.get(rate) ?? 0) + lineNet);
  }
  const byRate = [...bases.entries()]
    .map(([rate, base]) => {
      const b = roundMoney(base);
      return { rate, base: b, vat: opts.forfettario ? 0 : roundMoney((b * rate) / 100) };
    })
    .filter((r) => r.base !== 0)
    .sort((a, b) => a.rate - b.rate);
  const net = roundMoney(byRate.reduce((s, r) => s + r.base, 0));
  const vat = roundMoney(byRate.reduce((s, r) => s + r.vat, 0));
  const stamp =
    opts.type === 'fattura' && opts.forfettario && Math.round(net * 100) > STAMP_THRESHOLD_CENTS ? STAMP_AMOUNT : 0;
  return { net, vat, stamp, gross: roundMoney(net + vat + stamp), byRate };
}
