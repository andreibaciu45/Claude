import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';

vi.mock('../../shared/fatturapa', () => ({
  validateInvoiceForIssue: vi.fn(() => []),
  generateFatturaPA: vi.fn((doc: { invoice: { number: string } }, profile: { vatNumber: string }, prog: string) => ({
    xml: `<xml n="${doc.invoice.number}" p="${prog}"/>`,
    fileName: `IT${profile.vatNumber}_${prog}.xml`,
    progressivoInvio: prog,
  })),
  formatProgressivoInvio: (n: number) => n.toString(36).toUpperCase().padStart(5, '0'),
}));

import { generateFatturaPA, validateInvoiceForIssue } from '../../shared/fatturapa';
import {
  ImmutableDocumentError, InvoiceValidationError, InvalidSdiTransitionError, __resetStorageForTests, createCreditNote,
  createInvoiceFromQuote, deleteDocument, exportBackup, getDocument, getProfile, importBackup, issueInvoice,
  issueInvoiceWithWarnings, listAudit, listDocuments, recordPayment, recordSdiEvent, saveDocument, saveProfile,
  nextDocumentNumber, sha256Hex, saveSyncedDocument as saveSyncedDocument2,
} from './index';
import type { DocLine, InvoiceFiscal, QuoteDocument } from '../types';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const line = (id: string, price = 100, qty = 1): DocLine => ({ id, description: 'Lavoro', qty, unit: 'pz', unitPrice: price, vat: 0, natura: 'N2.2' });
const fiscal = (over: Partial<InvoiceFiscal> = {}): InvoiceFiscal => ({
  tipoDocumento: 'TD01', year: 2026, sectional: 'FT', operationDate: '2026-03-10', stampDuty: true, stampDutyChargedToCustomer: false,
  stampAmount: 2, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [], ...over,
});
const draft = (id: string, over: Partial<QuoteDocument> = {}, inv: Partial<InvoiceFiscal> = {}): QuoteDocument => ({
  id, type: 'fattura', number: '', date: '2026-03-10', customer: { id: 'c', name: 'Mario Rossi', vatNumber: '12345678903' },
  lines: [line('l1', 100), line('l2', 50)], status: 'bozza', invoice: fiscal(inv), createdAt: 1, updatedAt: 1, ...over,
});
const quote = (id: string): QuoteDocument => ({
  id, type: 'preventivo', number: 'PRev-0001', date: '2026-03-01', customer: { id: 'c', name: 'Mario' }, lines: [line('q1', 80)],
  status: 'accettato', createdAt: 1, updatedAt: 1,
});
const sdi = (type: 'INVIO' | 'RC' | 'MC' | 'NS', at = Date.now()) => ({ at, type, channel: 'portale_ade' as const });

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  vi.mocked(generateFatturaPA).mockClear();
  vi.mocked(validateInvoiceForIssue).mockReset().mockReturnValue([]);
  const p = await getProfile();
  await saveProfile({ ...p, vatNumber: '01234567897', regimeForfettario: true });
});

describe('emissione', () => {
  it('assegna numero, XML, hash, lock e audit; aggiorna i contatori', async () => {
    await saveDocument(draft('a'));
    const d = await issueInvoice('a');
    expect(d.status).toBe('emessa');
    expect(d.number).toBe('1/2026');
    expect(d.invoice).toMatchObject({ seq: 1, number: '1/2026', sectional: 'FT', year: 2026, progressivoInvio: '00001', fileName: 'IT01234567897_00001.xml' });
    expect(d.invoice!.lockedAt).toBeTruthy();
    expect(d.invoice!.xml).toContain('1/2026');
    expect(d.invoice!.xmlSha256).toBe(await sha256Hex(d.invoice!.xml!));
    expect(d.invoice!.xmlSha256).toMatch(/^[0-9a-f]{64}$/);
    const p = await getProfile();
    expect(p.invoiceYearCounters).toEqual({ 'FT-2026': 1 });
    expect(p.nextProgressivoInvio).toBe(2);
    const audit = await listAudit('a');
    expect(audit.map((e) => e.action)).toEqual(['create', 'issue']);
    expect(audit[1].xmlSha256).toBe(d.invoice!.xmlSha256);
  });

  it('numerazione per anno dell operationDate', async () => {
    await saveDocument(draft('a', {}, { operationDate: '2026-12-31' }));
    await saveDocument(draft('b', { date: '2027-01-02' }, { operationDate: '2027-01-02', year: 2027 }));
    expect((await issueInvoice('a')).number).toBe('1/2026');
    expect((await issueInvoice('b')).number).toBe('1/2027');
  });

  it('gap-free con emissioni concorrenti', async () => {
    const N = 12;
    for (let i = 0; i < N; i++) await saveDocument(draft(`d${i}`));
    const res = await Promise.all(Array.from({ length: N }, (_, i) => issueInvoice(`d${i}`)));
    const seqs = res.map((d) => d.invoice!.seq!).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(res.map((d) => d.invoice!.progressivoInvio)).size).toBe(N);
    expect((await getProfile()).invoiceYearCounters?.['FT-2026']).toBe(N);
  });

  it('errori di validazione: nessuna scrittura', async () => {
    await saveDocument(draft('a'));
    vi.mocked(validateInvoiceForIssue).mockReturnValue([
      { field: 'customer.vatNumber', code: 'invalid_vat', message: 'P.IVA non valida', severity: 'error' },
    ]);
    const err = await issueInvoice('a').catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceValidationError);
    expect(err.issues[0].code).toBe('invalid_vat');
    expect((await getDocument('a'))!.status).toBe('bozza');
    expect((await getProfile()).invoiceYearCounters).toEqual({});
    expect(generateFatturaPA).not.toHaveBeenCalled();
  });

  it('rollback se la generazione XML fallisce: contatori invariati, poi nessun buco', async () => {
    await saveDocument(draft('a'));
    await saveDocument(draft('b'));
    vi.mocked(generateFatturaPA).mockImplementationOnce(() => { throw new Error('xml ko'); });
    await expect(issueInvoice('a')).rejects.toThrow('xml ko');
    const p = await getProfile();
    expect(p.invoiceYearCounters).toEqual({});
    expect(p.nextProgressivoInvio).toBe(1);
    expect((await getDocument('a'))!.invoice!.lockedAt).toBeUndefined();
    expect((await issueInvoice('b')).number).toBe('1/2026');
  });

  it('indice UNIQUE su sezionale/anno/seq; il contatore resta allineato ai numeri presenti', async () => {
    // documento "fantasma" con seq 1 ma contatore a 0 (es. arrivato dalla sync): il prossimo numero salta al successivo
    await saveDocument(draft('a'));
    const ghost = draft('g', { status: 'emessa', number: '1/2026' }, { seq: 1, number: '1/2026', lockedAt: 5 });
    await saveSyncedDocument2(ghost);
    expect((await issueInvoice('a')).number).toBe('2/2026');
    // duplicare (sezionale, anno, seq) viene respinto dal vincolo e non scrive nulla
    const dup = draft('dup', { status: 'emessa', number: '2/2026' }, { seq: 2, number: '2/2026', lockedAt: 6 });
    await expect(saveSyncedDocument2(dup)).rejects.toThrow();
    expect(await getDocument('dup')).toBeUndefined();
  });

  it('data anteriore all ultima emessa: warning non bloccante in audit', async () => {
    await saveDocument(draft('a', {}, { operationDate: '2026-03-20' }));
    await saveDocument(draft('b', {}, { operationDate: '2026-03-10' }));
    await issueInvoice('a');
    const r = await issueInvoiceWithWarnings('b');
    expect(r.doc.number).toBe('2/2026');
    expect(r.warnings.join(' ')).toMatch(/anteriore/);
    expect((await listAudit('b')).find((e) => e.action === 'issue')!.detail).toMatch(/Avvisi/);
  });

  it('non riemette una fattura già emessa', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await expect(issueInvoice('a')).rejects.toBeInstanceOf(ImmutableDocumentError);
  });
});

describe('immutabilità e cancellazione', () => {
  it('saveDocument rifiuta modifiche a una fattura emessa, ammette pagamenti/esiti', async () => {
    await saveDocument(draft('a'));
    const d = await issueInvoice('a');
    await expect(saveDocument({ ...d, notes: 'x' })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, lines: [line('z', 1)] })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, invoice: { ...d.invoice!, xml: '<altro/>' } })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, status: 'stornata' })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...d, status: 'consegnata' })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await saveDocument({ ...d, status: 'inviata', invoice: { ...d.invoice!, paymentStatus: 'pagata', payments: [{ date: '2026-04-01', amount: 10 }], sdiEvents: [sdi('INVIO')] } });
    expect((await getDocument('a'))!.status).toBe('inviata');
  });

  it('non si può bloccare una bozza via saveDocument', async () => {
    await expect(saveDocument(draft('a', {}, { lockedAt: 5 }))).rejects.toBeInstanceOf(ImmutableDocumentError);
  });

  it('deleteDocument: bozze e preventivi sì (audit), emesse no', async () => {
    await saveDocument(draft('a'));
    await saveDocument(draft('b'));
    await saveDocument(quote('q'));
    await issueInvoice('b');
    await deleteDocument('a');
    await deleteDocument('q');
    expect(await getDocument('a')).toBeUndefined();
    expect(await getDocument('q')).toBeUndefined();
    await expect(deleteDocument('b')).rejects.toBeInstanceOf(ImmutableDocumentError);
    expect(await getDocument('b')).toBeDefined();
    expect((await listAudit('a')).map((e) => e.action)).toEqual(['create', 'delete_draft']);
  });

  it('cancellare la bozza da preventivo riapre il preventivo', async () => {
    await saveDocument(quote('q'));
    const inv = await createInvoiceFromQuote('q');
    expect((await getDocument('q'))!.status).toBe('convertito');
    await deleteDocument(inv.id);
    const q = (await getDocument('q'))!;
    expect(q.status).toBe('accettato');
    expect(q.convertedToInvoiceId).toBeUndefined();
  });
});

describe('createInvoiceFromQuote', () => {
  it('crea bozza senza numero e converte il preventivo', async () => {
    await saveDocument(quote('q'));
    const inv = await createInvoiceFromQuote('q');
    expect(inv).toMatchObject({ type: 'fattura', status: 'bozza', number: '', convertedFromQuoteId: 'q' });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0].id).not.toBe('q1');
    expect(inv.lines[0]).toMatchObject({ vat: 0, natura: 'N2.2', unitPrice: 80 });
    expect(inv.invoice).toMatchObject({ tipoDocumento: 'TD01', sectional: 'FT', stampDuty: true, stampAmount: 2 });
    expect(inv.invoice!.seq).toBeUndefined();
    const q = (await getDocument('q'))!;
    expect(q).toMatchObject({ status: 'convertito', convertedToInvoiceId: inv.id });
    expect((await getProfile()).invoiceYearCounters).toEqual({});
    await expect(createInvoiceFromQuote('q')).rejects.toThrow(/già/);
  });
});

describe('note di credito', () => {
  it('storno totale: TD04 NC1/2026, originale stornata', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const nc = await createCreditNote('a', { reason: 'Errore importi' });
    expect(nc.number).toBe('NC1/2026');
    expect(nc.invoice).toMatchObject({
      tipoDocumento: 'TD04', sectional: 'NC', seq: 1, originalDocumentId: 'a', originalNumber: '1/2026', originalDate: '2026-03-10', creditNoteReason: 'Errore importi',
    });
    expect(nc.lines).toHaveLength(2);
    expect(nc.invoice!.lockedAt).toBeTruthy();
    expect((await getDocument('a'))!.status).toBe('stornata');
    const p = await getProfile();
    expect(p.invoiceYearCounters).toEqual({ 'FT-2026': 1, 'NC-2026': 1 });
    expect((await listAudit('a')).map((e) => e.action)).toContain('credit_note');
    await expect(createCreditNote('a', { reason: 'ancora' })).rejects.toThrow(/stornata/);
  });

  it('storno parziale: originale resta, secondo storno fino al totale', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const nc1 = await createCreditNote('a', { reason: 'sconto', lines: [line('x', 50)] });
    expect(nc1.number).toBe('NC1/2026');
    expect((await getDocument('a'))!.status).toBe('emessa');
    await expect(createCreditNote('a', { reason: 'troppo', lines: [line('y', 500)] })).rejects.toBeInstanceOf(InvoiceValidationError);
    // senza righe = storno del RESIDUO (non più un errore): copre solo ciò che manca
    const nc2 = await createCreditNote('a', { reason: 'resto' });
    expect(nc2.number).toBe('NC2/2026');
    expect(nc2.lines.map((l) => l.unitPrice)).toEqual([100]);
    expect((await getDocument('a'))!.status).toBe('stornata');
  });

  it('richiede causale e fattura emessa; fallita => nessuna scrittura', async () => {
    await saveDocument(draft('a'));
    await expect(createCreditNote('a', { reason: 'x' })).rejects.toThrow(/non si può stornare/);
    await issueInvoice('a');
    await expect(createCreditNote('a', { reason: '  ' })).rejects.toBeInstanceOf(InvoiceValidationError);
    vi.mocked(generateFatturaPA).mockImplementationOnce(() => { throw new Error('xml ko'); });
    await expect(createCreditNote('a', { reason: 'x' })).rejects.toThrow('xml ko');
    expect((await getDocument('a'))!.status).toBe('emessa');
    expect((await getProfile()).invoiceYearCounters?.['NC-2026']).toBeUndefined();
    expect((await listDocuments()).filter((d) => d.invoice?.tipoDocumento === 'TD04')).toHaveLength(0);
  });
});

describe('esiti SDI e pagamenti', () => {
  it('transizioni consentite', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    expect((await recordSdiEvent('a', sdi('INVIO'))).status).toBe('inviata');
    expect((await recordSdiEvent('a', sdi('MC'))).status).toBe('mancata_consegna');
    const d = await recordSdiEvent('a', sdi('RC'));
    expect(d.status).toBe('consegnata');
    expect(d.invoice!.sdiEvents.map((e) => e.type)).toEqual(['INVIO', 'MC', 'RC']);
    expect((await listAudit('a')).map((e) => e.action)).toEqual(['create', 'issue', 'mark_sent', 'sdi_event', 'sdi_event']);
  });

  it('rifiuta transizioni illegali con errore chiaro', async () => {
    await saveDocument(draft('a'));
    await expect(recordSdiEvent('a', sdi('INVIO'))).rejects.toBeInstanceOf(InvalidSdiTransitionError);
    await issueInvoice('a');
    await expect(recordSdiEvent('a', sdi('RC'))).rejects.toThrow(/registra prima l'invio/);
    await recordSdiEvent('a', sdi('INVIO'));
    await expect(recordSdiEvent('a', sdi('INVIO'))).rejects.toThrow(/non consentito/);
    await recordSdiEvent('a', sdi('RC'));
    await expect(recordSdiEvent('a', sdi('NS'))).rejects.toBeInstanceOf(InvalidSdiTransitionError);
  });

  it('scartata: reinvio entro 5 giorni sì, dopo no', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await recordSdiEvent('a', sdi('INVIO', 1000));
    const ns = await recordSdiEvent('a', { ...sdi('NS', 2000), errorCodes: ['00305'] });
    expect(ns.status).toBe('scartata');
    expect((await recordSdiEvent('a', sdi('INVIO', 2000 + 4 * 86400000))).status).toBe('inviata');
    await recordSdiEvent('a', sdi('NS', 2000 + 4 * 86400000 + 3_000_000));
    await expect(recordSdiEvent('a', sdi('INVIO', 2000 + 4 * 86400000 + 3_000_000 + 6 * 86400000))).rejects.toThrow(/più di 5 giorni/);
  });

  it('non si stornano le scartate; nota di credito su consegnata ok', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await recordSdiEvent('a', sdi('INVIO'));
    await recordSdiEvent('a', sdi('NS'));
    await expect(createCreditNote('a', { reason: 'x' })).rejects.toThrow(/scartata/);
  });

  it('pagamenti: parziale poi pagata', async () => {
    await saveDocument(draft('a')); // 150 + bollo 2 a carico dell'emittente (non addebitato) => totale 150
    await issueInvoice('a');
    let d = await recordPayment('a', { date: '2026-04-01', amount: 50, method: 'bonifico' });
    expect(d.invoice!.paymentStatus).toBe('parziale');
    d = await recordPayment('a', { date: '2026-04-02', amount: 100 });
    expect(d.invoice!.paymentStatus).toBe('pagata');
    expect(d.invoice!.payments).toHaveLength(2);
    expect(d.status).toBe('emessa');
    await expect(recordPayment('a', { date: '2026-04-02', amount: -1 })).rejects.toThrow();
    await saveDocument(draft('b'));
    await expect(recordPayment('b', { date: '2026-04-02', amount: 1 })).rejects.toThrow(/emesse/);
  });
});

describe('profilo e contatori', () => {
  it('default v2', async () => {
    await __resetStorageForTests();
    await deleteDB('vocepreventivo');
    const p = await getProfile();
    expect(p).toMatchObject({ regimeFiscale: 'RF19', invoiceYearCounters: {}, nextProgressivoInvio: 1, stampDutyDefaultChargedToCustomer: false });
  });

  it('saveProfile con form vecchio NON riporta indietro i contatori', async () => {
    const stale = await getProfile(); // form aperto prima dell'emissione
    await saveDocument(draft('a'));
    await issueInvoice('a');
    await nextDocumentNumber('preventivo');
    await saveProfile({ ...stale, businessName: 'Rossi' });
    const p = await getProfile();
    expect(p.businessName).toBe('Rossi');
    expect(p.invoiceYearCounters).toEqual({ 'FT-2026': 1 });
    expect(p.nextProgressivoInvio).toBe(2);
    expect(p.nextQuoteNumber).toBe(2);
    await saveDocument(draft('b'));
    expect((await issueInvoice('b')).number).toBe('2/2026');
  });
});

describe('migrazione v1 -> v2', () => {
  it('marca le fatture come legacy, mappa pagato, non perde dati', async () => {
    await __resetStorageForTests();
    await deleteDB('vocepreventivo');
    const v1 = await openDB('vocepreventivo', 1, {
      upgrade(db) {
        db.createObjectStore('profile');
        db.createObjectStore('catalog', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' });
      },
    });
    const base = { customer: { id: 'c', name: 'Mario' }, lines: [line('l', 10)], createdAt: 1, updatedAt: 1, date: '2025-05-05' };
    await v1.put('documents', { ...base, id: 'f1', type: 'fattura', number: 'FT-0001', status: 'pagato' });
    await v1.put('documents', { ...base, id: 'f2', type: 'fattura', number: 'FT-0002', status: 'inviato', notes: 'nota' });
    await v1.put('documents', { ...base, id: 'p1', type: 'preventivo', number: 'PRev-0001', status: 'accettato' });
    await v1.put('profile', { businessName: 'Vecchia', nextInvoiceNumber: 7, nextQuoteNumber: 3 } as never, 'main');
    v1.close();

    const docs = await listDocuments();
    expect(docs).toHaveLength(3);
    const f1 = (await getDocument('f1'))!;
    expect(f1).toMatchObject({ number: 'FT-0001', status: 'bozza' });
    expect(f1.invoice).toMatchObject({ legacy: true, paymentStatus: 'pagata', sectional: 'FT', year: 2025, operationDate: '2025-05-05' });
    expect(f1.invoice!.seq).toBeUndefined();
    expect(f1.invoice!.lockedAt).toBeUndefined();
    expect(f1.lines).toHaveLength(1);
    const f2 = (await getDocument('f2'))!;
    expect(f2.notes).toBe('nota');
    expect(f2.invoice!.paymentStatus).toBe('non_pagata');
    expect((await getDocument('p1'))!.invoice).toBeUndefined();
    const p = await getProfile();
    expect(p).toMatchObject({ businessName: 'Vecchia', nextInvoiceNumber: 7, nextQuoteNumber: 3, regimeFiscale: 'RF19', nextProgressivoInvio: 1 });
    // stato originale conservato in audit
    expect((await listAudit('f1'))[0].detail).toMatch(/pagato/);
    // le legacy sono modificabili ed eliminabili
    await saveDocument({ ...f2, notes: 'nuova' });
    await deleteDocument('f1');
    expect(await getDocument('f1')).toBeUndefined();
    // e le nuove emissioni partono da 1/anno, indipendenti da FT-0001
    await saveDocument(draft('n'));
    expect((await issueInvoice('n')).number).toBe('1/2026');
  });
});

describe('backup v2', () => {
  it('round-trip con audit e documenti fiscali', async () => {
    await saveDocument(draft('a'));
    const d = await issueInvoice('a');
    await createCreditNote('a', { reason: 'x', lines: [line('p', 10)] });
    const json = await exportBackup();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(3);
    expect(parsed.audit.length).toBeGreaterThan(2);
    await __resetStorageForTests();
    await deleteDB('vocepreventivo');
    const { warnings } = await importBackup(json);
    expect(warnings).toEqual([]);
    expect((await getDocument('a'))!.invoice!.xmlSha256).toBe(d.invoice!.xmlSha256);
    expect((await listAudit('a')).length).toBe(parsed.audit.filter((e: { docId: string }) => e.docId === 'a').length);
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 1, 'NC-2026': 1 });
  });

  it('backup vecchio: i contatori non scendono e c è un avviso', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const old = await exportBackup(); // contiene solo la 1
    await saveDocument(draft('b'));
    await issueInvoice('b'); // 2/2026 dopo il backup
    const { warnings } = await importBackup(old);
    expect(warnings.join(' ')).toMatch(/più vecchio/);
    expect(warnings.join(' ')).toMatch(/2\/2026/);
    expect((await getProfile()).invoiceYearCounters?.['FT-2026']).toBe(2);
    expect((await getProfile()).nextProgressivoInvio).toBe(3);
    await saveDocument(draft('c'));
    expect((await issueInvoice('c')).number).toBe('3/2026'); // nessun duplicato di 2/2026
    // l'audit non si perde
    expect((await listAudit('b')).some((e) => e.action === 'issue')).toBe(true);
  });

  it('contatori del backup inferiori al max seq dei documenti: usa il massimo', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const json = JSON.parse(await exportBackup());
    json.profile.invoiceYearCounters = {};
    await __resetStorageForTests();
    await deleteDB('vocepreventivo');
    const { warnings } = await importBackup(JSON.stringify(json));
    expect(warnings.join(' ')).toMatch(/FT-2026/);
    expect((await getProfile()).invoiceYearCounters?.['FT-2026']).toBe(1);
  });

  it('importa un backup v1: fatture -> legacy', async () => {
    const v1 = {
      version: 1, profile: { businessName: 'Old' }, catalog: [],
      documents: [{ id: 'f', type: 'fattura', number: 'FT-0004', date: '2024-01-01', customer: { id: 'c', name: 'M' }, lines: [], status: 'pagato', createdAt: 1, updatedAt: 1 }],
    };
    const { warnings } = await importBackup(JSON.stringify(v1));
    expect(warnings.join(' ')).toMatch(/v1/);
    const f = (await getDocument('f'))!;
    expect(f.invoice).toMatchObject({ legacy: true, paymentStatus: 'pagata' });
    expect(f.status).toBe('bozza');
  });

  it('rifiuta numeri fattura duplicati nel backup', async () => {
    await saveDocument(draft('a'));
    await issueInvoice('a');
    const j = JSON.parse(await exportBackup());
    j.documents.push({ ...j.documents[0], id: 'dup' });
    await expect(importBackup(JSON.stringify(j))).rejects.toThrow(/duplicato/);
  });
});
