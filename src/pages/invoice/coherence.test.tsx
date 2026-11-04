// @vitest-environment jsdom
/**
 * Coerenza dei totali tra scheda (UI), elenco, PDF e XML su 30 documenti casuali (generatore deterministico):
 * stessi centesimi ovunque, perché tutti usano lo stesso calcolo (`invoiceTotalsCents`).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DocLine, QuoteDocument } from '../../types';
import { generateFatturaPA } from '../../../shared/fatturapa';
import { find, parseXml, textOf } from '../../../shared/fatturapa/__tests__/xmlTools';
import { company, consumer, makeDoc, makeProfile } from '../../../shared/fatturapa/__tests__/factories';
import { documentTotals, fmtNum, lineAmount, renderDocumentPdf } from '../../pdf';
import { toCents } from '../../../shared/fiscal/money';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => ({
  getDocument: vi.fn(), getProfile: vi.fn(), listDocuments: vi.fn(), listAudit: vi.fn(), saveDocument: vi.fn(), deleteDocument: vi.fn(),
  nextDocumentNumber: vi.fn(), issueInvoice: vi.fn(), createCreditNote: vi.fn(), createInvoiceFromQuote: vi.fn(), recordPayment: vi.fn(), recordSdiEvent: vi.fn(),
  appendAudit: vi.fn(), reopenRejectedInvoice: vi.fn(), createResubmissionDraft: vi.fn(),
}));
vi.mock('../../storage', () => store);

import DocumentView from '../DocumentView';

/** mulberry32: generatore deterministico. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pickOne = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];

const QTYS = [1, 2, 3, 0.5, 1.25, 2.333, 7, 10, 0.125, 12.5];
const DISCOUNTS = [0, 0, 0, 5, 10, 12.5, 33.33, 7, 25];

function randomDoc(i: number): QuoteDocument {
  const r = rng(1000 + i * 7919);
  const n = 1 + Math.floor(r() * 5);
  const lines: DocLine[] = Array.from({ length: n }, (_, k) => {
    const price = r() < 0.3 ? Math.round(r() * 500000) / 1000 : Math.round(r() * 50000) / 100; // 3 o 2 decimali
    return {
      id: `l${k}`, description: `Voce ${i}-${k}`, qty: pickOne(r, QTYS), unit: 'pz', unitPrice: Math.max(0.01, price), vat: 0, natura: 'N2.2',
      ...(pickOne(r, DISCOUNTS) ? { discountPct: pickOne(r, DISCOUNTS) } : {}),
    } as DocLine;
  });
  const nc = i % 4 === 3;
  const charged = !nc && r() < 0.5;
  return makeDoc({
    id: `doc${i}`,
    customer: r() < 0.5 ? company() : consumer(),
    lines,
    invoice: {
      tipoDocumento: nc ? 'TD04' : 'TD01', sectional: nc ? 'NC' : 'FT', seq: i + 1, number: nc ? `NC${i + 1}/2026` : `${i + 1}/2026`, lockedAt: 1, issuedAt: 1,
      stampDutyChargedToCustomer: charged,
      ...(nc ? { originalNumber: '1/2026', originalDate: '2026-10-01', creditNoteReason: 'Reso merce', customerChannel: 'codice' as const } : {}),
    },
  });
}

const profile = makeProfile({ regimeForfettario: true });
const NOW = new Date(2026, 9, 20, 12);
const docs = Array.from({ length: 30 }, (_, i) => randomDoc(i));

const moneyDigits = (s: string) => s.replace(/[^\d,-]/g, '');

describe('coerenza totali: UI = elenco = PDF = XML (30 documenti casuali)', () => {
  it('i documenti casuali coprono bollo dovuto/non dovuto, sconti, quantità frazionarie e note di credito', () => {
    const t = docs.map((d) => documentTotals(d, true));
    expect(t.some((x) => x.stampDue > 0)).toBe(true);
    expect(t.some((x) => x.stampDue === 0)).toBe(true);
    expect(docs.some((d) => d.invoice!.tipoDocumento === 'TD04')).toBe(true);
    expect(docs.some((d) => d.lines.some((l) => l.discountPct))).toBe(true);
  });

  for (let i = 0; i < docs.length; i++) {
    it(`documento ${i + 1}/30`, () => {
      const d = docs[i];
      const ui = documentTotals(d, true);
      const xml = parseXml(generateFatturaPA(d, profile, '00001', { now: NOW }).xml);

      // XML: totale documento, imponibile (somma riepiloghi), bollo, importi di riga
      const xmlTotal = toCents(Number(textOf(xml, 'ImportoTotaleDocumento')));
      const xmlTaxable = find(xml, 'DatiRiepilogo').reduce((s, n) => s + toCents(Number(textOf(n, 'ImponibileImporto'))), 0);
      const xmlLines = find(xml, 'DettaglioLinee').filter((l) => textOf(l, 'Descrizione') !== 'Rimborso imposta di bollo').map((l) => toCents(Number(textOf(l, 'PrezzoTotale'))));
      const xmlStamp = textOf(xml, 'ImportoBollo');
      expect(toCents(ui.gross)).toBe(xmlTotal);
      expect(toCents(ui.net + ui.stamp)).toBe(xmlTaxable); // il rimborso bollo N1 è nei riepiloghi
      expect(d.lines.map((l) => toCents(lineAmount(l)))).toEqual(xmlLines);
      expect(xmlStamp === undefined ? 0 : toCents(Number(xmlStamp))).toBe(toCents(ui.stampDue));
      expect(toCents(ui.net)).toBe(xmlLines.reduce((s, c) => s + c, 0));
      expect(toCents(ui.gross)).toBe(toCents(ui.net) + toCents(ui.stamp)); // nessun bollo non addebitato nel totale

      // PDF: stesso totale, imponibile, righe
      const txt = renderDocumentPdf(d, profile, { compress: false }).output();
      const tail = txt.slice(txt.lastIndexOf('TOTALE'));
      expect(tail).toContain(fmtNum(ui.gross));
      const impIdx = txt.indexOf('(Imponibile)');
      expect(txt.slice(impIdx, impIdx + 200)).toContain(fmtNum(ui.net));
      for (const l of d.lines) expect(txt).toContain(fmtNum(lineAmount(l)));
    });
  }

  it('la scheda documento (DocumentView) mostra gli stessi importi su 30 documenti', async () => {
    store.getProfile.mockResolvedValue(profile);
    store.listAudit.mockResolvedValue([]);
    store.listDocuments.mockResolvedValue([]);
    Element.prototype.scrollIntoView = vi.fn();
    for (const d of docs) {
      store.getDocument.mockResolvedValue(d);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(<MemoryRouter initialEntries={[`/documenti/${d.id}`]}><Routes><Route path="/documenti/:id" element={<DocumentView />} /></Routes></MemoryRouter>);
      });
      for (let k = 0; k < 6; k++) await act(async () => { await Promise.resolve(); });
      const ui = documentTotals(d, true);
      const shown = (sel: string) => host.querySelector(sel)?.textContent ?? '';
      expect(moneyDigits(shown('.dv-total .num'))).toBe(moneyDigits(fmtNum(ui.gross)));
      const rowAmounts = [...host.querySelectorAll('.dv-line-calc strong.num')].map((e) => moneyDigits(e.textContent ?? ''));
      expect(rowAmounts).toEqual(d.lines.map((l) => moneyDigits(fmtNum(lineAmount(l)))));
      act(() => root.unmount());
      host.remove();
    }
  });
});
