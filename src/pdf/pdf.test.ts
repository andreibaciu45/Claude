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

import { generateDocumentPdf, renderDocumentPdf, creditNoteLines, docTitle, fmtNum, fmtEuro } from './index';
import { fakeDoc, fakeProfile, fakeInvoice, fakeCreditNote } from './fixtures';
import { BOLLO_LEGAL_TEXT, FORFETTARIO_LEGAL_TEXT } from '../../shared/fatturapa';

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

  it('fattura emessa: numero e data fiscali, dicitura forfettario, bollo e footer di cortesia', () => {
    const pdf = renderDocumentPdf(fakeInvoice(), fakeProfile({ regimeForfettario: true }), { compress: false });
    const txt = pdf.output();
    expect(docTitle(fakeInvoice())).toBe('FATTURA n. 12/2026');
    expect(txt).toContain('FATTURA n. 12/2026');
    expect(txt).toContain('Data: 03/11/2026');
    expect(txt).toContain('Regime forfettario');
    expect(txt).toContain('Imposta di bollo assolta in modo virtuale');
    expect(txt).toContain('Copia di cortesia della fattura elettronica');
    expect(txt).not.toContain('BOZZA');
  });
  it('bozza di fattura: senza numero, con filigrana BOZZA', () => {
    const txt = renderDocumentPdf(fakeInvoice({ status: 'bozza', invoice: { ...fakeInvoice().invoice!, number: undefined, lockedAt: undefined } }), fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    expect(txt).toContain('FATTURA \\(bozza\\)');
    expect(txt).toContain('BOZZA');
    expect(txt).not.toContain('n. 12/2026');
  });
  it('nota di credito TD04: riferimento alla fattura rettificata e motivo', async () => {
    const nc = fakeCreditNote();
    expect(creditNoteLines(nc)).toEqual([
      'NOTA DI CREDITO n. NC1/2026 del 04/11/2026 rettifica la fattura n. 12/2026 del 03/11/2026',
      'Motivo: Importo errato',
    ]);
    const txt = renderDocumentPdf(nc, fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    expect(txt).toContain('NOTA DI CREDITO n. NC1/2026');
    expect(txt).toContain('rettifica la fattura n. 12/2026');
    expect(txt).toContain('Motivo: Importo errato');
    expect(txt).toContain('INTESTATA A');
    expect(txt).toContain('Copia di cortesia della fattura elettronica');
    const blob = await generateDocumentPdf(nc, fakeProfile({ regimeForfettario: true }));
    expect(blob.size).toBeGreaterThan(2000);
  });
  it('fattura legacy (v1): resta "copia di cortesia" non fiscale', () => {
    const d = fakeDoc({ type: 'fattura', number: 'FT-0001' });
    expect(docTitle(d)).toBe('FATTURA (copia di cortesia) n. FT-0001');
  });

  it('diciture di legge identiche a quelle dell\'XML (una sola fonte: shared/fatturapa/legalText)', () => {
    const txt = renderDocumentPdf(fakeInvoice(), fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    const esc = (t: string) => t.replace(/[()]/g, (c) => `\\${c}`);
    expect(txt).toContain(esc(FORFETTARIO_LEGAL_TEXT));
    expect(txt).toContain(esc(BOLLO_LEGAL_TEXT));
  });
  it('fattura emessa: riporta la scadenza calcolata dalle condizioni di pagamento (come DataScadenzaPagamento nell\'XML)', () => {
    const txt = renderDocumentPdf(fakeInvoice(), fakeProfile({ regimeForfettario: true, paymentTerms: 'Bonifico a 30 giorni', iban: undefined }), { compress: false }).output();
    expect(txt).toContain('Scadenza: 03/12/2026');
    const nc = renderDocumentPdf(fakeCreditNote(), fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    expect(nc).not.toContain('Scadenza:');
  });
});
