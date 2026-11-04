/** REVISIONE INDIPENDENTE: regressioni PDF (REV-F1/F2). */
import { describe, expect, it } from 'vitest';
import { fakeInvoice, fakeProfile } from './fixtures';
import { fmtDiscount, fmtPrice, fmtQty } from './index';
import { renderDocumentPdf } from './render';

describe('REV-F1: prezzo, quantità e sconto mostrati come nel calcolo e nell\'XML', () => {
  it('formattazione', () => {
    expect(fmtPrice(0.125)).toBe('0,125');
    expect(fmtPrice(1234.5)).toBe('1.234,50');
    expect(fmtPrice(3.3333)).toBe('3,3333');
    expect(fmtQty(0.0001)).toBe('0,0001');
    expect(fmtQty(1000)).toBe('1.000');
    expect(fmtQty(2.5)).toBe('2,5');
    expect(fmtDiscount(12.25)).toBe('12,25%');
    expect(fmtDiscount(10)).toBe('10%');
  });
  it('nel PDF: 1000 pz × 0,125 = 125,00 (non "0,13")', () => {
    const d = fakeInvoice({ lines: [{ id: 'a', description: 'Vite', qty: 1000, unit: 'pz', unitPrice: 0.125, vat: 0, natura: 'N2.2', discountPct: 12.25 }] });
    const txt = renderDocumentPdf(d, fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    expect(txt).toContain('(0,125)');
    expect(txt).toContain('(12,25%)');
    expect(txt).toContain('109,69'); // 125 × (1 − 12,25%) = 109,6875
  });
});

describe('REV-F2: nome del cliente lungo non troncato alla prima riga', () => {
  it('compare per intero (anche la parte sulla seconda riga)', () => {
    const name = 'Società Cooperativa Edilizia Artigiana Lombarda dei Lavoratori Associati di Milano e Provincia S.r.l.';
    const d = fakeInvoice({ customer: { id: 'c', name, vatNumber: '09876543217', address: 'Via Torino 3', city: 'Torino', zip: '10100', province: 'TO' } });
    const txt = renderDocumentPdf(d, fakeProfile({ regimeForfettario: true }), { compress: false }).output();
    expect(txt).toContain('Provincia S.r.l.');
  });
});
