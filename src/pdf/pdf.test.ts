import { describe, expect, it, vi } from 'vitest';
import type { DocLine, DocType, Totals } from '../types';
import { roundMoney } from '../types';

// Il motore potrebbe essere ancora uno stub: uso un calcolo di riferimento locale.
vi.mock('../engine', () => ({
  computeTotals: (lines: DocLine[], o: { forfettario: boolean; type: DocType }): Totals => {
    const map = new Map<number, number>();
    for (const l of lines) map.set(l.vat, (map.get(l.vat) ?? 0) + roundMoney(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)));
    const byRate = [...map].map(([rate, base]) => ({ rate, base: roundMoney(base), vat: o.forfettario ? 0 : roundMoney((base * rate) / 100) }));
    const net = roundMoney(byRate.reduce((s, r) => s + r.base, 0));
    const vat = roundMoney(byRate.reduce((s, r) => s + r.vat, 0));
    const stamp = o.forfettario && o.type === 'fattura' && net > 77.47 ? 2 : 0;
    return { net, vat, stamp, gross: roundMoney(net + vat + stamp), byRate };
  },
}));

import { generateDocumentPdf, fmtNum, fmtEuro } from './index';
import { fakeDoc, fakeProfile } from './fixtures';

const head = async (b: Blob) => new TextDecoder().decode(await b.slice(0, 5).arrayBuffer());

describe('generateDocumentPdf', () => {
  it('genera un PDF non vuoto per un preventivo', async () => {
    const blob = await generateDocumentPdf(fakeDoc(), fakeProfile());
    expect(blob.size).toBeGreaterThan(2000);
    expect(blob.type).toBe('application/pdf');
    expect(await head(blob)).toBe('%PDF-');
  });
  it('genera una fattura forfettaria con bollo', async () => {
    const blob = await generateDocumentPdf(fakeDoc({ type: 'fattura', number: 'FT-0001' }), fakeProfile({ regimeForfettario: true }));
    expect(blob.size).toBeGreaterThan(2000);
  });
  it('gestisce molte righe (multi-pagina) e profilo minimo', async () => {
    const many = await generateDocumentPdf(fakeDoc({}, 80), fakeProfile());
    const few = await generateDocumentPdf(fakeDoc({}, 3), fakeProfile());
    expect(many.size).toBeGreaterThan(few.size);
    const minimal = await generateDocumentPdf(fakeDoc({ notes: undefined, customer: { id: 'x', name: 'Cliente' } }), fakeProfile({ iban: undefined, footerNotes: undefined, pec: undefined }));
    expect(minimal.size).toBeGreaterThan(1000);
  });
  it('formatta gli importi in it-IT', () => {
    expect(fmtNum(1234.5)).toBe('1.234,50');
    expect(fmtNum(0.5)).toBe('0,50');
    expect(fmtEuro(1234567.891)).toBe('€ 1.234.567,89');
  });
});
