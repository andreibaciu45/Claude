// @vitest-environment jsdom
/**
 * Coerenza dei totali tra scheda (UI), elenco, PDF, XML, CSV del registro e note di credito su 60 documenti casuali
 * (generatore deterministico): 30 "classici" + 30 con SCONTI in % di riga e in EURO (righe a prezzo negativo, anche due).
 * Stessi centesimi ovunque, perché tutti usano lo stesso calcolo (`invoiceTotalsCents`); l'XML ha lo stesso totale
 * in entrambe le rappresentazioni dello sconto in euro (riga negativa / ScontoMaggiorazione Importo).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DocLine, QuoteDocument } from '../../types';
import { generateFatturaPA } from '../../../shared/fatturapa';
import { find, parseXml, textOf } from '../../../shared/fatturapa/__tests__/xmlTools';
import { company, consumer, makeDoc, makeProfile } from '../../../shared/fatturapa/__tests__/factories';
import { documentTotals, fmtNum, lineAmount } from '../../pdf';
import { renderDocumentPdf } from '../../pdf/render';
import { toCents } from '../../../shared/fiscal/money';
import { creditResidual } from '../../storage/creditResidual';
import { invoiceTotalsCents } from '../../storage/invoiceTotals';
import { invoiceRegisterCsv } from './register';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => ({
  getDocument: vi.fn(), getProfile: vi.fn(), listDocuments: vi.fn(), listAudit: vi.fn(), saveDocument: vi.fn(), deleteDocument: vi.fn(),
  nextDocumentNumber: vi.fn(), issueInvoice: vi.fn(), createCreditNote: vi.fn(), createInvoiceFromQuote: vi.fn(), recordPayment: vi.fn(), recordSdiEvent: vi.fn(),
  appendAudit: vi.fn(), reopenRejectedInvoice: vi.fn(), createResubmissionDraft: vi.fn(),
}));
vi.mock('../../storage', () => store);
const allow = vi.hoisted(() => ({ canCreate: true }));
vi.mock('../../billing/useAllowance', () => ({
  checkAllowanceNow: async () => ({ plan: 'free', used: allow.canCreate ? 0 : 3, limit: 3, remaining: allow.canCreate ? 3 : 0, canCreate: allow.canCreate }),
}));
vi.mock('../../sync/engine', () => ({ syncEngine: { getStatus: () => ({ signedIn: false }) } }));


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

/** `withEuro`: aggiunge 1-2 righe "Sconto" a prezzo negativo (mai oltre il 90% delle righe positive). */
function randomDoc(i: number, withEuro = false): QuoteDocument {
  const r = rng(1000 + i * 7919);
  const n = 1 + Math.floor(r() * 5);
  const lines: DocLine[] = Array.from({ length: n }, (_, k) => {
    const price = r() < 0.3 ? Math.round(r() * 500000) / 1000 : Math.round(r() * 50000) / 100; // 3 o 2 decimali
    return {
      id: `l${k}`, description: `Voce ${i}-${k}`, qty: pickOne(r, QTYS), unit: 'pz', unitPrice: Math.max(0.01, price), vat: 0, natura: 'N2.2',
      ...(pickOne(r, DISCOUNTS) ? { discountPct: pickOne(r, DISCOUNTS) } : {}),
    } as DocLine;
  });
  if (withEuro) {
    const gross = lines.reduce((t, l) => t + toCents(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)), 0);
    const n2 = r() < 0.3 ? 2 : 1;
    for (let k = 0; k < n2; k++) {
      const cents = Math.max(1, Math.floor((gross * (0.05 + r() * 0.4)) / n2));
      lines.push({ id: `s${k}`, description: 'Sconto', qty: 1, unit: 'corpo', unitPrice: -cents / 100, vat: 0, natura: 'N2.2' } as DocLine);
    }
  }
  const nc = i % 4 === 3;
  const charged = !nc && r() < 0.5;
  return makeDoc({
    id: `doc${i}${withEuro ? 'e' : ''}`,
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
const docs = [...Array.from({ length: 30 }, (_, i) => randomDoc(i)), ...Array.from({ length: 30 }, (_, i) => randomDoc(100 + i, true))];

const moneyDigits = (s: string) => s.replace(/[^\d,-]/g, '');

describe('coerenza totali: UI = elenco = PDF = XML = CSV = note di credito (60 documenti casuali)', () => {
  it('i documenti casuali coprono bollo dovuto/non dovuto, sconti, quantità frazionarie e note di credito', () => {
    const t = docs.map((d) => documentTotals(d, true));
    expect(t.some((x) => x.stampDue > 0)).toBe(true);
    expect(t.some((x) => x.stampDue === 0)).toBe(true);
    expect(docs.some((d) => d.invoice!.tipoDocumento === 'TD04')).toBe(true);
    expect(docs.some((d) => d.lines.some((l) => l.discountPct))).toBe(true);
    expect(docs.some((d) => d.lines.some((l) => l.unitPrice < 0))).toBe(true);
    expect(docs.filter((d) => d.lines.filter((l) => l.unitPrice < 0).length === 2).length).toBeGreaterThan(0);
    // lo sconto in euro porta almeno un documento sotto la soglia del bollo che sarebbe dovuto senza sconto
    expect(docs.some((d) => d.lines.some((l) => l.unitPrice < 0) && documentTotals(d, true).stampDue === 0)).toBe(true);
  });

  for (let i = 0; i < docs.length; i++) {
    it(`documento ${i + 1}/${docs.length}`, () => {
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
      // la riga di sconto è "Sconto" con importo negativo, senza quantità/unità/prezzo (una sola cella che copre le colonne)
      for (const l of d.lines.filter((x) => x.unitPrice < 0)) expect(txt).toContain(fmtNum(-Math.abs(lineAmount(l))));

      // XML: stesso totale/imponibile/bollo anche con lo sconto in euro ripartito sulle righe (ScontoMaggiorazione Importo)
      const alt = parseXml(generateFatturaPA(d, profile, '00001', { now: NOW, euroDiscountMode: 'sconto_su_riga' }).xml);
      for (const tag of ['ImportoTotaleDocumento', 'ImportoBollo', 'ImportoPagamento']) expect(textOf(alt, tag)).toBe(textOf(xml, tag));
      expect(find(alt, 'DatiRiepilogo').map((n) => textOf(n, 'ImponibileImporto'))).toEqual(find(xml, 'DatiRiepilogo').map((n) => textOf(n, 'ImponibileImporto')));
      const altLines = find(alt, 'DettaglioLinee').filter((l) => textOf(l, 'Descrizione') !== 'Rimborso imposta di bollo').map((l) => toCents(Number(textOf(l, 'PrezzoTotale'))));
      expect(altLines.reduce((s, c) => s + c, 0)).toBe(toCents(ui.net));

      // CSV del registro: imponibile, bollo e totale (note di credito col segno meno) = stessi centesimi
      const csv = invoiceRegisterCsv([d], true).split('\n').filter(Boolean);
      const cols = csv[1].split(';');
      const sign = d.invoice!.tipoDocumento === 'TD04' ? -1 : 1;
      const asCents = (v: string) => toCents(Number(v.replace(',', '.')));
      expect(asCents(cols[6])).toBe(sign * toCents(ui.net));
      expect(asCents(cols[7])).toBe(toCents(ui.stampDue));
      expect(asCents(cols[8])).toBe(sign * toCents(ui.gross));

      // nota di credito di storno totale: stesso imponibile della fattura (righe di sconto incluse)
      const inv = invoiceTotalsCents(d.lines, { forfettario: true, stampChargedToCustomer: false });
      const res = creditResidual(d, []);
      expect(res.originalCents).toBe(inv.netCents);
      expect(invoiceTotalsCents(res.lines, { forfettario: true, stampChargedToCustomer: false }).netCents).toBe(inv.netCents);
    });
  }

  it('la scheda documento (DocumentView) mostra gli stessi importi su 60 documenti', async () => {
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
      // le righe di sconto sono righe "Sconto" con importo negativo, senza "qtà × prezzo"
      const disc = [...host.querySelectorAll('.dv-line-discount')];
      expect(disc).toHaveLength(d.lines.filter((l) => l.unitPrice < 0).length);
      for (const e of disc) expect(e.textContent).not.toContain('×');
      act(() => root.unmount());
      host.remove();
    }
  });
});
