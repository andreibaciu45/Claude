import { describe, expect, it } from 'vitest';
import { fakeCreditNote, fakeDoc, fakeInvoice } from '../../pdf/fixtures';
import { availableActions, displayNumber, issueTarget, newInvoiceFiscal, normalizeCustomerForInvoice, previewNumber } from './model';

const on = (a: ReturnType<typeof availableActions>) => Object.entries(a).filter(([, v]) => v).map(([k]) => k).sort();
const withStatus = (s: Parameters<typeof fakeInvoice>[0] extends infer P ? NonNullable<P>['status'] : never) => fakeInvoice({ status: s });
const draft = () => fakeInvoice({ status: 'bozza', invoice: { ...fakeInvoice().invoice!, number: undefined, lockedAt: undefined } });

describe('azioni disponibili per stato', () => {
  it('preventivo: modifica, elimina, converti, stato', () => {
    expect(on(availableActions(fakeDoc()))).toEqual(['convertToInvoice', 'delete', 'duplicate', 'edit', 'quoteStatus', 'shareCourtesy']);
  });
  it('bozza di fattura: emetti, modifica, elimina; niente XML né nota di credito', () => {
    expect(on(availableActions(draft()))).toEqual(['delete', 'duplicate', 'edit', 'issue']);
  });
  it('fattura emessa: immutabile (no modifica/elimina), si può inviare, incassare, stornare', () => {
    const a = availableActions(withStatus('emessa'));
    expect(a.edit).toBe(false); expect(a.delete).toBe(false);
    expect(a).toMatchObject({ downloadXml: true, howToSend: true, markSent: true, recordOutcome: true, recordPayment: true, creditNote: true });
  });
  it('inviata: esito sì, "segna inviata" no', () => {
    expect(availableActions(withStatus('inviata'))).toMatchObject({ markSent: false, recordOutcome: true, creditNote: true });
  });
  it('consegnata: nota di credito sì, invio/esito no', () => {
    expect(availableActions(withStatus('consegnata'))).toMatchObject({ markSent: false, recordOutcome: false, howToSend: false, creditNote: true });
  });
  it('scartata: si può rinviare ma non stornare', () => {
    expect(availableActions(withStatus('scartata'))).toMatchObject({ markSent: true, creditNote: false, recordPayment: false });
  });
  it('stornata: solo download/condivisione', () => {
    expect(availableActions(withStatus('stornata'))).toMatchObject({ creditNote: false, recordPayment: false, markSent: false, downloadXml: true });
  });
  it('nota di credito: non si storna né si incassa', () => {
    expect(availableActions(fakeCreditNote())).toMatchObject({ creditNote: false, recordPayment: false, edit: false, delete: false, downloadXml: true });
  });
  it('fattura legacy: comportamento v1', () => {
    expect(availableActions(fakeDoc({ type: 'fattura' }))).toMatchObject({ edit: true, delete: true, issue: false, downloadXml: false });
  });
});

describe('numeri e collegamenti', () => {
  it('mostra il numero fiscale reale, mai quello provvisorio', () => {
    expect(displayNumber(fakeInvoice())).toBe('12/2026');
    expect(displayNumber(draft())).toBe('bozza, senza numero');
    expect(displayNumber(fakeDoc({ number: 'PRev-0012' }))).toBe('PRev-0012');
  });
  it('anteprima numero dal contatore annuale', () => {
    expect(previewNumber(draft(), { invoiceYearCounters: { 'FT-2026': 11 } })).toBe('12/2026');
    expect(previewNumber(draft(), {})).toBe('1/2026');
    expect(previewNumber({ invoice: { ...draft().invoice!, tipoDocumento: 'TD04', sectional: 'NC' } }, { invoiceYearCounters: { 'NC-2026': 2 } })).toBe('NC3/2026');
  });
  it('link ai campi da correggere', () => {
    expect(issueTarget('profile.vatNumber', 'x').to).toBe('/profilo');
    expect(issueTarget('customer.vatNumber', 'x').to).toBe('/?edit=x&focus=customer.vatNumber');
    expect(issueTarget('lines[2].unitPrice', 'x').to).toBe('/?edit=x&focus=lines%5B2%5D');
  });
  it('nuova bozza: nessun numero, bollo e canale coerenti', () => {
    const f = newInvoiceFiscal({ date: '2026-11-04', customer: { id: 'c', name: 'A', codiceDestinatario: 'ABC1234' }, stampDue: 2, stampChargedToCustomer: true });
    expect(f).toMatchObject({ tipoDocumento: 'TD01', sectional: 'FT', year: 2026, stampDuty: true, stampAmount: 2, customerChannel: 'codice', paymentStatus: 'non_pagata' });
    expect(f.number).toBeUndefined(); expect(f.seq).toBeUndefined();
  });
  it('smista il campo cliente v1 in P.IVA o codice fiscale', () => {
    expect(normalizeCustomerForInvoice({ id: 'c', name: 'A', vatOrFiscalCode: '01234567897' }).vatNumber).toBe('01234567897');
    expect(normalizeCustomerForInvoice({ id: 'c', name: 'A', vatOrFiscalCode: 'RSSMRA70A01F205Z' }).fiscalCode).toBe('RSSMRA70A01F205Z');
  });
});
