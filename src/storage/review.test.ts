import 'fake-indexeddb/auto';
/**
 * REVISIONE INDIPENDENTE (docs/CODE-REVIEW-FATTURE.md): test di regressione dello storage fiscale.
 * Ogni test FALLIVA prima della correzione indicata (REV-xx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  ImmutableDocumentError, InvalidSdiTransitionError, __resetStorageForTests, createCreditNote, getDocument, getProfile, issueInvoice,
  listAudit, recordPayment, recordSdiEvent, saveDocument, saveProfile,
} from './index';
import type { DocLine, InvoiceFiscal, QuoteDocument } from '../types';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const line = (id: string, price = 100, qty = 1, over: Partial<DocLine> = {}): DocLine => ({ id, description: 'Lavoro', qty, unit: 'pz', unitPrice: price, vat: 0, natura: 'N2.2', ...over });
const fiscal = (over: Partial<InvoiceFiscal> = {}): InvoiceFiscal => ({
  tipoDocumento: 'TD01', year: 2026, sectional: 'FT', operationDate: '2026-03-10', stampDuty: false, stampDutyChargedToCustomer: false,
  stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [], ...over,
});
const draft = (id: string, over: Partial<QuoteDocument> = {}, inv: Partial<InvoiceFiscal> = {}): QuoteDocument => ({
  id, type: 'fattura', number: '', date: '2026-03-10',
  customer: { id: 'c', name: 'Bianchi Srl', vatNumber: '09876543217', codiceDestinatario: 'ABC1234', address: 'Via Torino 3', zip: '10100', city: 'Torino', province: 'TO' },
  lines: [line('l1', 100)], status: 'bozza', invoice: fiscal(inv), createdAt: 1, updatedAt: 1, ...over,
});
const sdi = (type: 'INVIO' | 'RC' | 'MC' | 'NS', at = Date.now()) => ({ at, type, channel: 'portale_ade' as const });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  const p = await getProfile();
  await saveProfile({
    ...p, businessName: 'Rossi Idraulica', ownerName: 'Mario Rossi', vatNumber: '01234567897', fiscalCode: 'RSSMRA80A01H501U', address: 'Via Roma 10',
    zip: '00100', city: 'Roma', province: 'RM', regimeForfettario: true, paymentTerms: 'Bonifico a 30 giorni',
  });
});

describe('REV-S1: immutabilità aggirabile salvando una "fattura" non emessa con stato/numero finti', () => {
  it('bozza con status emessa/inviata/stornata senza lockedAt = rifiutata', async () => {
    for (const status of ['emessa', 'inviata', 'consegnata', 'stornata'] as const) {
      await expect(saveDocument(draft(`x-${status}`, { status }))).rejects.toBeInstanceOf(ImmutableDocumentError);
    }
  });
  it('bozza con seq/number/xml già assegnati (gonfiava i contatori) = rifiutata', async () => {
    await expect(saveDocument(draft('s1', {}, { seq: 99, number: '99/2026' }))).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument(draft('s2', {}, { xml: '<x/>' }))).rejects.toBeInstanceOf(ImmutableDocumentError);
  });
  it('una bozza normale e una fattura di cortesia legacy si salvano ancora', async () => {
    await saveDocument(draft('ok'));
    await saveDocument(draft('leg', { number: 'FT-0001', status: 'inviato' as never }, { legacy: true }));
  });
});

describe('REV-S2: esiti SDI e incassi append-only anche via saveDocument', () => {
  it('non si può cancellare l\'esito NS né sostituire gli incassi', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await recordSdiEvent('a', sdi('INVIO', Date.now() - 2000));
    await recordSdiEvent('a', { ...sdi('NS', Date.now() - 1000), errorCodes: ['00305'] });
    await recordPayment('a', { date: '2026-04-01', amount: 10 });
    const d = (await getDocument('a'))!;
    await expect(saveDocument({ ...d, status: 'inviata', invoice: { ...d.invoice!, sdiEvents: [d.invoice!.sdiEvents[0]] } })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, invoice: { ...d.invoice!, payments: [] } })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, invoice: { ...d.invoice!, payments: [{ date: '2026-04-01', amount: 99999 }] } })).rejects.toBeInstanceOf(ImmutableDocumentError);
  });
});

describe('REV-G1/G2/G3: incassi', () => {
  it('una nota di credito non si incassa', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const nc = await createCreditNote('a', { reason: 'reso', lines: [line('x', 40)] });
    await expect(recordPayment(nc.id, { date: today(), amount: 10 })).rejects.toThrow(/nota di credito/);
  });
  it('data inesistente o futura = rifiutata', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await expect(recordPayment('a', { date: '2026-13-45', amount: 10 })).rejects.toThrow(/Data/);
    await expect(recordPayment('a', { date: '2099-01-01', amount: 10 })).rejects.toThrow(/futuro/);
  });
  it('non si incassa più del dovuto (doppio click / importo errato)', async () => {
    await saveDocument(draft('a')); // 100 €
    await issueInvoice('a');
    await recordPayment('a', { date: '2026-04-01', amount: 100 });
    await expect(recordPayment('a', { date: '2026-04-01', amount: 100 })).rejects.toThrow(/supera il residuo/);
    expect((await getDocument('a'))!.invoice!.payments).toHaveLength(1);
  });
  it('importo con più di 2 decimali: salvato in centesimi interi (1,005 -> 1,01)', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const d = await recordPayment('a', { date: '2026-04-01', amount: 1.005 });
    expect(d.invoice!.payments[0].amount).toBe(1.01);
  });
});

describe('REV-G4: stato di pagamento dopo note di credito parziali', () => {
  it('fattura 100, nota 40, cliente paga 60 = pagata (prima: "pagata in parte" per sempre)', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await createCreditNote('a', { reason: 'sconto', lines: [line('x', 40)] });
    const d = await recordPayment('a', { date: '2026-04-01', amount: 60 });
    expect(d.invoice!.paymentStatus).toBe('pagata');
  });
  it('incasso parziale poi nota di credito che azzera il residuo: lo stato si riallinea', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await recordPayment('a', { date: '2026-04-01', amount: 60 });
    expect((await getDocument('a'))!.invoice!.paymentStatus).toBe('parziale');
    await createCreditNote('a', { reason: 'sconto', lines: [line('x', 40)] });
    expect((await getDocument('a'))!.invoice!.paymentStatus).toBe('pagata');
  });
});

describe('REV-E1: date degli esiti SDI', () => {
  it('evento nel futuro o precedente al precedente = rifiutato', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await expect(recordSdiEvent('a', sdi('INVIO', Date.now() + 30 * 86_400_000))).rejects.toBeInstanceOf(InvalidSdiTransitionError);
    await recordSdiEvent('a', sdi('INVIO', Date.now() - 5 * 86_400_000));
    await expect(recordSdiEvent('a', sdi('NS', Date.now() - 20 * 86_400_000))).rejects.toBeInstanceOf(InvalidSdiTransitionError);
  });
});

describe('REV-S3: contatori corrotti non producono numeri "NaN/2026"', () => {
  it('contatore non numerico o progressivo NaN: l\'emissione parte da 1 con progressivo valido', async () => {
    const p = await getProfile();
    await saveProfile({ ...p, invoiceYearCounters: { 'FT-2026': 'x' as never }, nextProgressivoInvio: Number.NaN });
    await saveDocument(draft('a'));
    const d = await issueInvoice('a');
    expect(d.invoice!.number).toBe('1/2026');
    expect(d.invoice!.progressivoInvio).toMatch(/^[A-Z0-9]{5}$/);
    expect(d.invoice!.progressivoInvio).not.toContain('NAN');
  });
});

describe('REV-S4/S5: dati congelati coerenti con l\'XML', () => {
  it('forfettario: IVA di riga congelata a 0 (niente avviso spurio "IVA 22% ignorata" in audit)', async () => {
    await saveDocument(draft('a', { lines: [line('l1', 100, 1, { vat: 22 })] }));
    const d = await issueInvoice('a');
    expect(d.lines[0].vat).toBe(0);
    const audit = (await listAudit('a')).map((e) => e.detail ?? '').join(' ');
    expect(audit).not.toMatch(/IVA/);
  });
  it('bollo memorizzato nella bozza sbagliato: il documento congelato riporta quello realmente nell\'XML', async () => {
    await saveDocument(draft('a', { lines: [line('l1', 200)] }, { stampDuty: false, stampAmount: 0 }));
    const d = await issueInvoice('a');
    expect(d.invoice!.xml).toContain('<DatiBollo>');
    expect(d.invoice!.stampDuty).toBe(true);
    expect(d.invoice!.stampAmount).toBe(2);
    await saveDocument(draft('b', { lines: [line('l1', 50)] }, { stampDuty: true, stampAmount: 2, stampDutyChargedToCustomer: true }));
    const b = await issueInvoice('b');
    expect(b.invoice!.xml).not.toContain('<DatiBollo>');
    expect(b.invoice!.stampDuty).toBe(false);
    expect(b.invoice!.stampDutyChargedToCustomer).toBe(false);
  });
});
