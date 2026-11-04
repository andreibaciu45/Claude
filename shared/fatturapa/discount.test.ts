/**
 * Sconti in euro (righe a PREZZO NEGATIVO) e sconti %: validazione, XML nelle due modalità, bollo dopo sconto.
 * Rappresentazione XML dello sconto in euro: vedi EURO_DISCOUNT_XML_MODE in ./common [DA VERIFICARE].
 */
import { describe, expect, it } from 'vitest';
import { EURO_DISCOUNT_XML_MODE, generateFatturaPA, validateInvoiceForIssue } from './index';
import type { EuroDiscountMode } from './index';
import { find, parseXml, textOf, validateStructure } from './__tests__/xmlTools';
import { NOW, line, makeDoc, makeProfile } from './__tests__/factories';
import { computeDocumentTotals, isDiscountLine, planEuroDiscounts, toCents } from '../fiscal/money';

const profile = makeProfile();
const gen = (doc: ReturnType<typeof makeDoc>, euroDiscountMode?: EuroDiscountMode) =>
  generateFatturaPA(doc, profile, '00001', { now: NOW, euroDiscountMode });
const val = (doc: ReturnType<typeof makeDoc>, euroDiscountMode?: EuroDiscountMode) =>
  validateInvoiceForIssue(doc, profile, { now: NOW, euroDiscountMode });
const has = (r: ReturnType<typeof val>, code: string, severity?: 'error' | 'warning') => r.some((i) => i.code === code && (!severity || i.severity === severity));
const discount = (euro: number, over = {}) => line({ id: 'sc', description: 'Sconto', unit: 'corpo', qty: 1, unitPrice: -euro, ...over });

describe('righe di sconto: riconoscimento', () => {
  it('quantità positiva e prezzo negativo', () => {
    expect(isDiscountLine({ qty: 1, unitPrice: -20 })).toBe(true);
    expect(isDiscountLine({ qty: 1, unitPrice: 20 })).toBe(false);
    expect(isDiscountLine({ qty: -1, unitPrice: -20 })).toBe(false);
    expect(isDiscountLine({ qty: 0, unitPrice: -20 })).toBe(false);
  });
});

describe('validateInvoiceForIssue: sconti e righe negative', () => {
  const base = [line({ id: 'a', unitPrice: 100 })];
  it('uno sconto in euro valido non dà errori', () => {
    const r = val(makeDoc({ lines: [...base, discount(20)] }));
    expect(r.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('sconto superiore al totale = errore sul campo lines', () => {
    const r = val(makeDoc({ lines: [...base, discount(150)] }));
    expect(r.some((i) => i.field === 'lines' && i.code === 'discount_exceeds_total' && i.severity === 'error')).toBe(true);
    expect(r.find((i) => i.code === 'discount_exceeds_total')?.message).toMatch(/supera/);
  });
  it('sconto pari al totale = totale zero (errore)', () => {
    expect(has(val(makeDoc({ lines: [...base, discount(100)] })), 'zero_total', 'error')).toBe(true);
  });
  it('solo una riga di sconto = totale negativo (errore), anche su nota di credito', () => {
    expect(has(val(makeDoc({ lines: [discount(10)] })), 'discount_exceeds_total', 'error')).toBe(true);
    const nc = makeDoc({ lines: [discount(10)], invoice: { tipoDocumento: 'TD04', originalNumber: '1/2026', originalDate: '2026-10-01', creditNoteReason: 'x' } });
    expect(has(val(nc), 'discount_exceeds_total', 'error')).toBe(true);
  });
  it('quantità e prezzo entrambi negativi = errore dedicato', () => {
    const r = val(makeDoc({ lines: [...base, line({ id: 'x', qty: -2, unitPrice: -5 })] }));
    expect(r.some((i) => i.field === 'lines[1].qty' && i.code === 'both_negative' && i.severity === 'error')).toBe(true);
  });
  it('prezzo negativo con quantità zero non è uno sconto: errore', () => {
    expect(has(val(makeDoc({ lines: [...base, line({ id: 'x', qty: 0, unitPrice: -5 })] })), 'negative_price', 'error')).toBe(true);
  });
  it('più righe di sconto = avviso (non blocca)', () => {
    const r = val(makeDoc({ lines: [...base, discount(5), discount(5, { id: 'sc2' })] }));
    expect(has(r, 'multiple_discount_lines', 'warning')).toBe(true);
    expect(r.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('sconto % su una riga di sconto = errore', () => {
    expect(has(val(makeDoc({ lines: [...base, discount(5, { discountPct: 10 })] })), 'discount_on_discount', 'error')).toBe(true);
  });
  it('sconto più grande del gruppo con la stessa natura = errore (N1 vs N2.2)', () => {
    const r = val(makeDoc({ lines: [line({ id: 'a', unitPrice: 100 }), line({ id: 'b', unitPrice: 10, natura: 'N1' }), discount(30, { natura: 'N1' })] }));
    expect(has(r, 'discount_exceeds_group', 'error')).toBe(true);
  });
  it('modalità sconto_su_riga: avviso se lo sconto non è assorbibile dalle righe (resta riga negativa)', () => {
    const tiny = [line({ id: 'a', unitPrice: 0.01 }), line({ id: 'b', unitPrice: 0.01 }), line({ id: 'c', unitPrice: 0.01 }), line({ id: 'd', unitPrice: 0.02 }), discount(0.04)];
    const doc = makeDoc({ lines: tiny });
    expect(has(val(doc, 'sconto_su_riga'), 'discount_not_associable', 'warning')).toBe(true);
    expect(has(val(doc, 'riga_negativa'), 'discount_not_associable')).toBe(false);
    // e nell'XML la riga negativa resta
    const t = parseXml(gen(doc, 'sconto_su_riga').xml);
    expect(find(t, 'DettaglioLinee')).toHaveLength(5);
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('0.01');
  });
});

describe('bollo: soglia 77,47 € sull\'importo DOPO lo sconto [DA VERIFICARE]', () => {
  const totals = (lines: ReturnType<typeof line>[]) => computeDocumentTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: 0, natura: 'N2.2' as const })), { regimeForfettario: true, stampDutyChargedToCustomer: false });
  it('100 € - 30 € = 70 € -> nessun bollo; 100 € - 20 € = 80 € -> bollo', () => {
    expect(totals([line({ unitPrice: 100 }), discount(30)]).stampDue).toBe(false);
    expect(totals([line({ unitPrice: 100 }), discount(20)]).stampDue).toBe(true);
  });
  it('esattamente 77,47 € dopo lo sconto = non dovuto; 77,48 € = dovuto', () => {
    expect(totals([line({ unitPrice: 100 }), discount(22.53)]).stampDue).toBe(false);
    expect(totals([line({ unitPrice: 100 }), discount(22.52)]).stampDue).toBe(true);
  });
  it('sconto % di riga: soglia sul netto', () => {
    expect(totals([line({ unitPrice: 100, discountPct: 30 })]).stampDue).toBe(false);
  });
  it('avviso esplicito quando lo sconto cambia l\'esito del bollo', () => {
    const r = val(makeDoc({ lines: [line({ unitPrice: 100 }), discount(30)], invoice: { stampDuty: false } }));
    expect(has(r, 'stamp_after_discount', 'warning')).toBe(true);
    const r2 = val(makeDoc({ lines: [line({ unitPrice: 200 }), discount(30)], invoice: { stampDuty: true } }));
    expect(has(r2, 'stamp_after_discount')).toBe(false);
  });
  it('XML: DatiBollo assente se dopo lo sconto si scende sotto soglia', () => {
    const t = parseXml(gen(makeDoc({ lines: [line({ unitPrice: 100 }), discount(30)] })).xml);
    expect(find(t, 'DatiBollo')).toHaveLength(0);
  });
});

describe('planEuroDiscounts: ripartizione deterministica in centesimi', () => {
  const li = (unitPrice: number, natura: 'N2.2' | 'N1' = 'N2.2') => ({ qty: 1, unitPrice, vatRate: 0, natura });
  it('resto sull\'ULTIMA riga positiva; la somma delle quote = sconto', () => {
    const lines = [li(10), li(10), li(10), li(-1)];
    const tot = lines.map((l) => toCents(l.unitPrice));
    const p = planEuroDiscounts(lines, tot);
    expect(p.shareCents).toEqual([33, 33, 34, 0]);
    expect([...p.absorbed]).toEqual([3]);
  });
  it('proporzionale agli importi', () => {
    const lines = [li(30), li(70), li(-10)];
    const p = planEuroDiscounts(lines, lines.map((l) => toCents(l.unitPrice)));
    expect(p.shareCents).toEqual([300, 700, 0]);
  });
  it('non assorbibile: nessuna riga positiva nel gruppo, o sconto oltre il gruppo', () => {
    const a = [li(100), li(-5, 'N1')];
    expect([...planEuroDiscounts(a, a.map((l) => toCents(l.unitPrice))).absorbed]).toEqual([]);
    const b = [li(10), li(-50)];
    expect([...planEuroDiscounts(b, b.map((l) => toCents(l.unitPrice))).absorbed]).toEqual([]);
  });
  it('quota che supererebbe la riga (resto su riga minuscola): resta riga negativa', () => {
    const lines = [li(0.01), li(0.01), li(0.01), li(0.02), li(-0.05)];
    const p = planEuroDiscounts(lines, lines.map((l) => toCents(l.unitPrice)));
    expect(p.shareCents.reduce((s, x) => s + x, 0)).toBe(p.absorbed.size ? 5 : 0);
  });
});

describe('XML: due rappresentazioni, stessi totali', () => {
  const doc = () => makeDoc({
    lines: [
      line({ id: 'a', description: 'Voce A', unitPrice: 50, qty: 2 }),
      line({ id: 'b', description: 'Voce B', unitPrice: 33.33, qty: 1, discountPct: 10 }),
      line({ id: 'c', description: 'Voce C', unitPrice: 7.77, qty: 3 }),
      discount(20),
    ],
  });
  it('il default è la riga negativa (scelta prudente documentata)', () => {
    expect(EURO_DISCOUNT_XML_MODE).toBe('riga_negativa');
  });
  it('riga_negativa: una DettaglioLinee con PrezzoUnitario e PrezzoTotale negativi, struttura valida', () => {
    const t = parseXml(gen(doc(), 'riga_negativa').xml);
    expect(validateStructure(t)).toEqual([]);
    const rows = find(t, 'DettaglioLinee');
    expect(rows).toHaveLength(4);
    expect(textOf(rows[3], 'Descrizione')).toBe('Sconto');
    expect(textOf(rows[3], 'PrezzoUnitario')).toBe('-20.00');
    expect(textOf(rows[3], 'PrezzoTotale')).toBe('-20.00');
    expect(textOf(rows[3], 'Natura')).toBe('N2.2');
    expect(find(rows[3], 'ScontoMaggiorazione')).toHaveLength(0);
  });
  it('sconto_su_riga: nessuna riga negativa, Importo sulle righe positive, struttura valida', () => {
    const t = parseXml(gen(doc(), 'sconto_su_riga').xml);
    expect(validateStructure(t)).toEqual([]);
    const rows = find(t, 'DettaglioLinee');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => textOf(r, 'NumeroLinea'))).toEqual(['1', '2', '3']);
    const shares = rows.map((r) => find(r, 'ScontoMaggiorazione').map((s) => textOf(s, 'Importo')).filter(Boolean)[0]);
    expect(shares.every(Boolean)).toBe(true);
    expect(shares.reduce((s, x) => s + toCents(Number(x)), 0)).toBe(2000);
    // la riga con sconto % ha prima la Percentuale e poi l'Importo
    expect(find(rows[1], 'ScontoMaggiorazione').map((s) => textOf(s, 'Percentuale') ?? 'I')).toEqual(['10.00', 'I']);
    expect(rows.reduce((s, r) => s + toCents(Number(textOf(r, 'PrezzoTotale'))), 0)).toBe(toCents(Number(textOf(t, 'ImportoTotaleDocumento'))));
  });
  it('totale, imponibile e bollo IDENTICI nelle due modalità', () => {
    const a = parseXml(gen(doc(), 'riga_negativa').xml);
    const b = parseXml(gen(doc(), 'sconto_su_riga').xml);
    for (const tag of ['ImportoTotaleDocumento', 'ImponibileImporto', 'ImportoBollo', 'ImportoPagamento']) {
      expect(textOf(b, tag)).toBe(textOf(a, tag));
    }
  });
  it('sconti oltre il totale o oltre il gruppo bloccano la generazione in entrambe le modalità', () => {
    for (const m of ['riga_negativa', 'sconto_su_riga'] as const) {
      expect(() => gen(makeDoc({ lines: [line({ id: 'a', unitPrice: 10 }), discount(50)] }), m)).toThrow();
      expect(() => gen(makeDoc({ lines: [line({ id: 'a', unitPrice: 100 }), discount(5, { natura: 'N1' })] }), m)).toThrow();
    }
  });
});
