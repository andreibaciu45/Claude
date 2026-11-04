import { describe, expect, it } from 'vitest';
import { BOLLO_LEGAL_TEXT, FORFETTARIO_LEGAL_TEXT, NO_RITENUTA_LEGAL_TEXT, buildCausali, generateFatturaPA, legalNotesFor, derivePayment, endOfMonth } from './index';
import { sanitizeText } from './text';
import { find, parseXml } from './__tests__/xmlTools';
import { NOW, docExampleA, docExampleB, line, makeDoc, makeProfile } from './__tests__/factories';

const causali = (xml: string): string[] => find(parseXml(xml), 'Causale').map((c) => c.text);

describe('diciture di legge: una sola fonte', () => {
  it('sono ASCII: la pulizia dei caratteri dell\'XML non le altera mai', () => {
    for (const t of [FORFETTARIO_LEGAL_TEXT, BOLLO_LEGAL_TEXT, NO_RITENUTA_LEGAL_TEXT]) {
      expect(sanitizeText(t)).toEqual({ text: t, replaced: false });
      expect(t.length).toBeLessThanOrEqual(200);
    }
  });

  it('XML TD01 con bollo: Causale = forfettario, bollo, nessuna ritenuta (testo identico a quello del PDF)', () => {
    const r = generateFatturaPA(docExampleA(), makeProfile(), '00001', { now: NOW });
    expect(causali(r.xml)).toEqual([FORFETTARIO_LEGAL_TEXT, BOLLO_LEGAL_TEXT, NO_RITENUTA_LEGAL_TEXT]);
  });

  it('XML senza bollo dovuto: nessuna dicitura bollo', () => {
    const doc = makeDoc({ lines: [line({ unitPrice: 50 })], invoice: { stampDuty: false } });
    const r = generateFatturaPA(doc, makeProfile(), '00001', { now: NOW });
    expect(causali(r.xml)).toEqual([FORFETTARIO_LEGAL_TEXT, NO_RITENUTA_LEGAL_TEXT]);
  });

  it('il bollo è deciso dai totali (non da invoice.stampDuty)', () => {
    const doc = makeDoc({ lines: [line({ unitPrice: 300 })], invoice: { stampDuty: false } });
    expect(causali(generateFatturaPA(doc, makeProfile(), '00001', { now: NOW }).xml)).toContain(BOLLO_LEGAL_TEXT);
  });

  it('nota di credito: motivo, forfettario e (se dovuto) bollo', () => {
    const doc = docExampleB();
    doc.lines = [line({ description: 'Storno totale', unitPrice: 300 })];
    const c = causali(generateFatturaPA(doc, makeProfile(), '00002', { now: NOW }).xml);
    expect(c.slice(-2)).toEqual([FORFETTARIO_LEGAL_TEXT, BOLLO_LEGAL_TEXT]);
    expect(buildCausali(docExampleB(), false).at(-1)).toBe(FORFETTARIO_LEGAL_TEXT);
  });

  it('legalNotesFor: ordine e condizioni', () => {
    expect(legalNotesFor({ forfettario: true, stampDue: true })).toEqual([FORFETTARIO_LEGAL_TEXT, BOLLO_LEGAL_TEXT]);
    expect(legalNotesFor({ forfettario: true, stampDue: false })).toEqual([FORFETTARIO_LEGAL_TEXT]);
    expect(legalNotesFor({ forfettario: false, stampDue: true })).toEqual([]);
  });
});

describe('date: Data e scadenza di pagamento', () => {
  const due = (terms: string, op = '2026-10-15') => derivePayment(makeProfile({ paymentTerms: terms }), op, true)?.dueDate;

  it('"Data" dell\'XML = data operazione del documento; scadenza calcolata da quella data', () => {
    const doc = makeDoc({ date: '2026-10-01', invoice: { operationDate: '2026-10-15' } });
    const t = parseXml(generateFatturaPA(doc, makeProfile(), '00001', { now: NOW }).xml);
    const dg = find(t, 'DatiGeneraliDocumento')[0];
    expect(find(dg, 'Data')[0].text).toBe('2026-10-15');
    expect(find(t, 'DataScadenzaPagamento')[0].text).toBe('2026-11-14');
  });

  it('condizioni: giorni, gg, data fattura', () => {
    expect(due('Bonifico a 30 giorni')).toBe('2026-11-14');
    expect(due('Bonifico 60 gg data fattura')).toBe('2026-12-14');
    expect(due('Bonifico a 15 giorni data fattura')).toBe('2026-10-30');
  });
  it('fine mese: dopo i giorni indicati si va a fine mese', () => {
    expect(due('Bonifico 30 giorni fine mese')).toBe('2026-11-30');
    expect(due('Bonifico 60 gg d.f. f.m.')).toBe('2026-12-31');
    expect(due('Bonifico fine mese')).toBe('2026-10-31');
  });
  it('a vista / alla consegna: stessa data del documento', () => {
    expect(due('Bonifico a vista')).toBe('2026-10-15');
    expect(due('Bonifico alla consegna')).toBe('2026-10-15');
  });
  it('rate multiple (30/60/90 giorni): nessuna scadenza unica inventata', () => {
    expect(due('Bonifico 30/60/90 giorni')).toBeUndefined();
  });
  it('senza indicazioni: nessuna scadenza; la scadenza esplicita prevale', () => {
    expect(due('Bonifico')).toBeUndefined();
    expect(derivePayment(makeProfile({ paymentTerms: 'Bonifico 30 giorni' }), '2026-10-15', true, '2026-12-31')?.dueDate).toBe('2026-12-31');
  });
  it('fine anno e anni bisestili', () => {
    expect(due('Bonifico 30 giorni', '2026-12-20')).toBe('2027-01-19');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });
  it('la nota di credito non ha DatiPagamento', () => {
    const t = parseXml(generateFatturaPA(docExampleB(), makeProfile(), '00002', { now: NOW }).xml);
    expect(find(t, 'DatiPagamento')).toHaveLength(0);
  });
});
