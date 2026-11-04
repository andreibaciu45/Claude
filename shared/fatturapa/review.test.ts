/**
 * REVISIONE INDIPENDENTE (docs/CODE-REVIEW-FATTURE.md) — test di regressione sui difetti confermati nel cuore fiscale
 * (validazione + generazione XML). Ognuno di questi test FALLIVA prima della correzione.
 */
import { describe, expect, it } from 'vitest';
import { generateFatturaPA, validateInvoiceForIssue } from './index';
import { parseXml, validateStructure } from './__tests__/xmlTools';
import { NOW, company, consumer, line, makeDoc, makeProfile } from './__tests__/factories';

const run = (doc: ReturnType<typeof makeDoc>, profile = makeProfile()) => validateInvoiceForIssue(doc, profile, { now: NOW });
const has = (issues: ReturnType<typeof run>, code: string, severity?: 'error' | 'warning') =>
  issues.some((i) => i.code === code && (!severity || i.severity === severity));

describe('REV-X1: importi oltre i limiti dello schema (11 cifre intere) o non rappresentabili', () => {
  it('quantità, prezzo o totale troppo grandi bloccano l\'emissione (niente "1e+21" né 13 cifre nell\'XML)', () => {
    expect(has(run(makeDoc({ lines: [line({ qty: 1, unitPrice: 1e12 })] })), 'amount_too_large', 'error')).toBe(true);
    expect(has(run(makeDoc({ lines: [line({ qty: 1e12, unitPrice: 0.01 })] })), 'amount_too_large', 'error')).toBe(true);
    expect(has(run(makeDoc({ lines: [line({ qty: 1e22, unitPrice: 1 })] })), 'amount_too_large', 'error')).toBe(true);
    // somma di più righe oltre il limite del totale
    expect(has(run(makeDoc({ lines: [line({ id: 'a', unitPrice: 9e10 }), line({ id: 'b', unitPrice: 9e10 })] })), 'amount_too_large', 'error')).toBe(true);
  });
  it('un importo grande ma valido (99.999.999.999,99) resta emettibile e l\'XML rispetta il formato', () => {
    const d = makeDoc({ lines: [line({ unitPrice: 99_999_999_999.99 })] });
    expect(has(run(d), 'amount_too_large')).toBe(false);
    const { xml } = generateFatturaPA(d, makeProfile(), 'ABC12', { now: NOW });
    expect(xml).toMatch(/<ImportoTotaleDocumento>99999999999\.99<\/ImportoTotaleDocumento>/);
  });
});

describe('REV-X2: identificativi fiscali esteri con caratteri non ammessi producevano XML non valido', () => {
  const foreign = (vat: string) => makeDoc({ customer: { id: 'f', name: 'Müller GmbH', country: 'DE', vatNumber: vat, address: 'Hauptstr. 1', city: 'Berlin', zip: '10115' } });
  it('caratteri di controllo / fuori Latin-1 nel numero estero = errore bloccante', () => {
    expect(has(run(foreign('DE12\u00013456')), 'invalid_chars', 'error')).toBe(true);
    expect(has(run(foreign('DE12€3456')), 'invalid_chars', 'error')).toBe(true);
  });
  it('un identificativo estero normale resta valido', () => {
    expect(has(run(foreign('DE123456789')), 'invalid_chars')).toBe(false);
  });
});

describe('REV-X3: descrizione che dopo la pulizia diventa vuota (Descrizione 1..1000 obbligatoria)', () => {
  it('solo caratteri di controllo = errore, non <Descrizione></Descrizione>', () => {
    const d = makeDoc({ lines: [line({ description: '\u0001\u0002\u0003' })] });
    expect(has(run(d), 'required', 'error')).toBe(true);
    expect(() => generateFatturaPA(d, makeProfile(), 'ABC12', { now: NOW })).toThrow();
  });
});

describe('REV-X4: arrotondamento silenzioso di quantità/prezzi oltre 8 decimali e di nome/cognome oltre 60 caratteri', () => {
  it('quantità o prezzo con più di 8 decimali = avviso (nell\'XML vengono arrotondati)', () => {
    expect(has(run(makeDoc({ lines: [line({ qty: 1.123456789, unitPrice: 10 })] })), 'precision_rounded', 'warning')).toBe(true);
    expect(has(run(makeDoc({ lines: [line({ qty: 1, unitPrice: 0.123456789 })] })), 'precision_rounded', 'warning')).toBe(true);
    expect(has(run(makeDoc({ lines: [line({ qty: 1.12345678, unitPrice: 10.5 })] })), 'precision_rounded')).toBe(false);
  });
  it('cognome del consumatore oltre 60 caratteri (Nome+Cognome <= 80 totali) = avviso di troncamento', () => {
    const cu = consumer({ name: `Mario ${'R'.repeat(70)}` });
    expect(run(makeDoc({ customer: cu })).some((i) => i.field === 'customer.name' && i.code === 'too_long')).toBe(true);
  });
});

describe('REV-X5: regressioni di controllo (nessuna falsa segnalazione sui casi buoni)', () => {
  it('esempio standard senza errori e struttura valida', () => {
    const d = makeDoc({ customer: company(), lines: [line({ unitPrice: 0.125, qty: 1000 })] });
    expect(run(d).filter((i) => i.severity === 'error')).toEqual([]);
    const { xml } = generateFatturaPA(d, makeProfile(), 'ABC12', { now: NOW });
    expect(validateStructure(parseXml(xml))).toEqual([]);
    expect(xml).toContain('<PrezzoUnitario>0.125</PrezzoUnitario>');
  });
});
