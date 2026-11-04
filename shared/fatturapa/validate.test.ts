import { describe, expect, it } from 'vitest';
import { validateInvoiceForIssue } from './validate';
import { NOW, company, consumer, docExampleA, docExampleB, line, makeDoc, makeProfile } from './__tests__/factories';

const run = (doc = docExampleA(), profile = makeProfile()) => validateInvoiceForIssue(doc, profile, { now: NOW });
const codes = (issues: ReturnType<typeof run>, severity?: 'error' | 'warning') =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const has = (issues: ReturnType<typeof run>, field: string, code: string) =>
  issues.some((i) => i.field === field && i.code === code);

describe('validateInvoiceForIssue — casi validi', () => {
  it('esempio A e B senza errori', () => {
    expect(codes(run(docExampleA()), 'error')).toEqual([]);
    expect(codes(run(docExampleB()), 'error')).toEqual([]);
  });
  it('non lancia mai, nemmeno con dati spazzatura', () => {
    const broken = { type: 'fattura', lines: null, customer: undefined } as unknown as ReturnType<typeof docExampleA>;
    expect(() => validateInvoiceForIssue(broken, makeProfile())).not.toThrow();
    expect(() => validateInvoiceForIssue({} as never, {} as never)).not.toThrow();
  });
});

describe('profilo (cedente)', () => {
  it('P.IVA mancante / errata', () => {
    expect(has(run(docExampleA(), makeProfile({ vatNumber: '' })), 'profile.vatNumber', 'required')).toBe(true);
    expect(has(run(docExampleA(), makeProfile({ vatNumber: '01234567898' })), 'profile.vatNumber', 'invalid_vat')).toBe(true);
  });
  it('accetta il prefisso IT nella P.IVA', () => {
    expect(codes(run(docExampleA(), makeProfile({ vatNumber: 'IT01234567897' })), 'error')).toEqual([]);
  });
  it('CF errato = errore; assente = avviso', () => {
    expect(has(run(docExampleA(), makeProfile({ fiscalCode: 'RSSMRA80A01H501X' })), 'profile.fiscalCode', 'invalid_fiscal_code')).toBe(true);
    const w = run(docExampleA(), makeProfile({ fiscalCode: undefined }));
    expect(codes(w, 'error')).toEqual([]);
    expect(codes(w, 'warning')).toContain('missing_fiscal_code');
  });
  it('regime forfettario obbligatorio (MVP)', () => {
    expect(has(run(docExampleA(), makeProfile({ regimeForfettario: false })), 'profile.regimeForfettario', 'regime_not_supported')).toBe(true);
  });
  it('sede e IBAN', () => {
    const issues = run(docExampleA(), makeProfile({ address: '', zip: '1', city: '', province: 'roma', iban: 'IT00X' }));
    for (const f of ['profile.address', 'profile.zip', 'profile.city', 'profile.province', 'profile.iban']) {
      expect(issues.some((i) => i.field === f && i.severity === 'error')).toBe(true);
    }
  });
  it('nome mancante', () => {
    expect(has(run(docExampleA(), makeProfile({ businessName: '', ownerName: '' })), 'profile.businessName', 'required')).toBe(true);
  });
  it('REA incompleto e contatti non validi = avvisi', () => {
    const w = run(docExampleA(), makeProfile({ reaOffice: 'RM', reaNumber: '', email: 'xx', phone: '12' }));
    expect(codes(w, 'error')).toEqual([]);
    expect(codes(w, 'warning')).toEqual(expect.arrayContaining(['rea_incomplete', 'invalid_email', 'invalid_phone']));
  });
});

describe('cliente', () => {
  it('serve P.IVA o CF', () => {
    const d = makeDoc({ customer: consumer({ fiscalCode: undefined }) });
    expect(has(run(d), 'customer.vatNumber', 'required')).toBe(true);
  });
  it('P.IVA e CF non validi', () => {
    expect(has(run(makeDoc({ customer: company({ vatNumber: '09876543210' }) })), 'customer.vatNumber', 'invalid_vat')).toBe(true);
    expect(has(run(makeDoc({ customer: consumer({ fiscalCode: 'VRDLGI85M41F205X' }) })), 'customer.fiscalCode', 'invalid_fiscal_code')).toBe(true);
  });
  it('legacy vatOrFiscalCode accettato', () => {
    const d = makeDoc({ customer: consumer({ fiscalCode: undefined, vatOrFiscalCode: 'VRDLGI85M41F205H' }) });
    expect(codes(run(d), 'error')).toEqual([]);
  });
  it('indirizzo incompleto', () => {
    const d = makeDoc({ customer: company({ address: '', city: '', zip: 'abc', province: '' }) });
    const e = run(d).filter((i) => i.severity === 'error').map((i) => i.field);
    expect(e).toEqual(expect.arrayContaining(['customer.address', 'customer.city', 'customer.zip', 'customer.province']));
  });
  it('codice destinatario non valido = errore; PEC non valida = avviso', () => {
    const d = makeDoc({ customer: company({ codiceDestinatario: 'ABC12', pec: 'no' }) });
    const r = run(d);
    expect(has(r, 'customer.codiceDestinatario', 'invalid_codice_destinatario')).toBe(true);
    expect(has(r, 'customer.pec', 'invalid_pec')).toBe(true);
  });
  it('azienda senza codice né PEC: avviso area riservata', () => {
    const r = run(makeDoc({ customer: company({ codiceDestinatario: undefined }) }));
    expect(codes(r, 'warning')).toContain('no_recipient_channel');
    expect(codes(r, 'error')).toEqual([]);
  });
  it('cliente estero: avviso, non errore', () => {
    const r = run(makeDoc({ customer: company({ country: 'DE', vatNumber: 'DE123456789', zip: '10115', province: '' }) }));
    expect(codes(r, 'error')).toEqual([]);
    expect(codes(r, 'warning')).toContain('foreign_customer');
  });
});

describe('righe', () => {
  it('righe vuote', () => {
    expect(has(run(makeDoc({ lines: [] })), 'lines', 'no_lines')).toBe(true);
  });
  it('qty, prezzo, sconto, descrizione, needsReview', () => {
    const d = makeDoc({
      lines: [
        line({ description: '', qty: 0 }),
        line({ unitPrice: NaN }),
        line({ unitPrice: -5 }),
        line({ discountPct: 120 }),
        line({ needsReview: true }),
      ],
    });
    const r = run(d);
    expect(has(r, 'lines[0].description', 'required')).toBe(true);
    expect(has(r, 'lines[0].qty', 'invalid_qty')).toBe(true);
    expect(has(r, 'lines[1].unitPrice', 'invalid_price')).toBe(true);
    expect(has(r, 'lines[2].unitPrice', 'negative_price')).toBe(true);
    expect(has(r, 'lines[3].discountPct', 'invalid_discount')).toBe(true);
    expect(has(r, 'lines[4].needsReview', 'needs_review')).toBe(true);
  });
  it('totale zero = errore', () => {
    expect(has(run(makeDoc({ lines: [line({ unitPrice: 0 })] })), 'lines', 'zero_total')).toBe(true);
  });
  it('multi-aliquota: IVA ignorata con avviso, non errore', () => {
    const r = run(makeDoc({ lines: [line({ vat: 22 }), line({ vat: 10 })] }));
    expect(codes(r, 'error')).toEqual([]);
    expect(codes(r, 'warning').filter((c) => c === 'vat_ignored')).toHaveLength(2);
  });
  it('testi lunghi o con caratteri non ammessi: avviso esplicito', () => {
    const r = run(makeDoc({ lines: [line({ description: 'x'.repeat(1001) }), line({ description: 'costo 5 € “ok”' })] }));
    expect(has(r, 'lines[0].description', 'too_long')).toBe(true);
    expect(has(r, 'lines[1].description', 'chars_replaced')).toBe(true);
    expect(codes(r, 'error')).toEqual([]);
  });
});

describe('documento: numero e date', () => {
  it('numero: lunghezza, almeno una cifra', () => {
    expect(has(run(makeDoc({ invoice: { number: 'A'.repeat(21) + '1' } })), 'invoice.number', 'too_long')).toBe(true);
    expect(has(run(makeDoc({ invoice: { number: 'ABC' } })), 'invoice.number', 'no_digit')).toBe(true);
  });
  it('numero assente: avviso in bozza, errore se non bozza', () => {
    const draft = makeDoc({ status: 'bozza', invoice: { number: undefined } });
    expect(run(draft).find((i) => i.code === 'number_missing')?.severity).toBe('warning');
    const issued = makeDoc({ status: 'emessa', invoice: { number: undefined } });
    expect(run(issued).find((i) => i.code === 'number_missing')?.severity).toBe('error');
  });
  it('data non valida / futura', () => {
    expect(has(run(makeDoc({ invoice: { operationDate: '2026-13-40' } })), 'invoice.operationDate', 'invalid_date')).toBe(true);
    expect(has(run(makeDoc({ invoice: { operationDate: '2026-11-30' } })), 'invoice.operationDate', 'date_in_future')).toBe(true);
    // domani = entro tolleranza
    expect(has(run(makeDoc({ invoice: { operationDate: '2026-10-21' } })), 'invoice.operationDate', 'date_in_future')).toBe(false);
  });
  it('oltre 12 giorni: avviso', () => {
    expect(has(run(makeDoc({ invoice: { operationDate: '2026-10-07' } })), 'invoice.operationDate', 'issue_term_exceeded')).toBe(true);
    expect(has(run(makeDoc({ invoice: { operationDate: '2026-10-08' } })), 'invoice.operationDate', 'issue_term_exceeded')).toBe(false);
  });
  it('ordine cronologico rispetto all\'ultima fattura', () => {
    const r = validateInvoiceForIssue(makeDoc(), makeProfile(), { now: NOW, lastIssuedDate: '2026-10-16' });
    expect(codes(r, 'warning')).toContain('not_chronological');
  });
  it('anno incoerente', () => {
    expect(has(run(makeDoc({ invoice: { year: 2025 } })), 'invoice.year', 'year_mismatch')).toBe(true);
  });
  it('documento non fattura / senza dati fiscali', () => {
    expect(has(run({ ...makeDoc(), type: 'preventivo' }), 'type', 'not_invoice')).toBe(true);
    expect(has(run({ ...makeDoc(), invoice: undefined }), 'invoice', 'required')).toBe(true);
  });
});

describe('nota di credito', () => {
  it('riferimento al documento originale obbligatorio', () => {
    const d = docExampleB();
    d.invoice = { ...d.invoice!, originalNumber: undefined, originalDate: undefined };
    const r = run(d);
    expect(has(r, 'invoice.originalNumber', 'required')).toBe(true);
    expect(has(r, 'invoice.originalDate', 'required')).toBe(true);
  });
  it('motivo mancante = avviso', () => {
    const d = docExampleB();
    d.invoice = { ...d.invoice!, creditNoteReason: '' };
    expect(codes(run(d), 'warning')).toContain('missing_reason');
  });
});

describe('bollo', () => {
  it('segnala il bollo dovuto e il ricalcolo', () => {
    const r = run(makeDoc({ lines: [line({ unitPrice: 200 })], invoice: { stampDuty: false } }));
    expect(codes(r, 'warning')).toEqual(expect.arrayContaining(['stamp_recomputed', 'stamp_due']));
  });
  it('sotto soglia: nessun avviso se coerente', () => {
    const r = run(makeDoc({ lines: [line({ unitPrice: 77.47 })], invoice: { stampDuty: false } }));
    expect(codes(r)).not.toContain('stamp_recomputed');
    expect(codes(r)).not.toContain('stamp_due');
  });
});
