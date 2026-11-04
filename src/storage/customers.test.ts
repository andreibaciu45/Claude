import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import {
  BACKUP_VERSION, DuplicateCustomerError, __resetStorageForTests, deleteCustomer, deleteDocument, exportBackup, getDocument,
  importBackup, importCustomersFromDocuments, listCustomers, listDocuments, mergeCustomers, parseBackup, saveCustomer,
  saveDocument, searchCustomers, upsertCustomer, upsertCustomers, normName, sameCustomer, docBelongsTo,
} from './index';
import type { QuoteDocument } from '../types';

const doc = (id: string, customer: QuoteDocument['customer'], createdAt = 1): QuoteDocument => ({
  id, type: 'preventivo', number: `PRev-${id}`, date: '2025-05-05', customer, lines: [], status: 'bozza', createdAt, updatedAt: createdAt,
});

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
});

describe('normalizzazione e dedup', () => {
  it('nome normalizzato ignora accenti, punti e maiuscole', () => {
    expect(normName("Rossi Costruzioni S.r.l.")).toBe(normName('rossi  costruzioni SRL'));
    expect(normName("D'Angelo Società")).toBe('dangelo societa');
  });
  it('P.IVA decide: stessa P.IVA = stesso cliente, P.IVA diversa = clienti diversi anche con nome uguale', () => {
    expect(sameCustomer({ name: 'A', vatNumber: 'IT 02345678904' }, { name: 'B', vatNumber: '02345678904' })).toBe(true);
    expect(sameCustomer({ name: 'Rossi', vatNumber: '02345678904' }, { name: 'Rossi', vatNumber: '01234567897' })).toBe(false);
  });
  it('CF e nome (in assenza di conflitti)', () => {
    expect(sameCustomer({ name: 'X', fiscalCode: 'bncmra80a01h501a' }, { name: 'Y', fiscalCode: 'BNCMRA80A01H501A' })).toBe(true);
    expect(sameCustomer({ name: 'Mario Rossi' }, { name: 'mario rossi', vatNumber: '02345678904' })).toBe(true);
    expect(sameCustomer({ name: 'Mario Rossi' }, { name: 'Mario Rossi Jr' })).toBe(false);
  });
});

describe('CRUD rubrica', () => {
  it('salva, rilegge, ordina, normalizza e elimina', async () => {
    const a = await saveCustomer({ id: 'b', name: ' Zeta  Srl ', vatNumber: 'IT02345678904', province: 'mi' });
    await saveCustomer({ id: 'a', name: 'Alfa', vatOrFiscalCode: '01234567897' });
    const list = await listCustomers();
    expect(list.map((c) => c.name)).toEqual(['Alfa', 'Zeta Srl']);
    expect(list[1]).toMatchObject({ vatNumber: '02345678904', province: 'MI' });
    expect(list[0]).toMatchObject({ vatNumber: '01234567897' });
    expect(list[0].vatOrFiscalCode).toBeUndefined();
    const again = await saveCustomer({ ...a, city: 'Milano' });
    expect(again.createdAt).toBe(a.createdAt);
    expect((await listCustomers()).find((c) => c.id === 'b')?.city).toBe('Milano');
    await deleteCustomer('a');
    expect(await listCustomers()).toHaveLength(1);
  });
  it('rifiuta il duplicato (altro id) con DuplicateCustomerError, non quando modifica sé stesso', async () => {
    await saveCustomer({ id: 'a', name: 'Rossi', vatNumber: '02345678904' });
    await expect(saveCustomer({ id: 'b', name: 'Altro nome', vatNumber: '02345678904' })).rejects.toBeInstanceOf(DuplicateCustomerError);
    await expect(saveCustomer({ id: 'c', name: 'rossi' })).rejects.toBeInstanceOf(DuplicateCustomerError);
    await expect(saveCustomer({ id: 'a', name: 'Rossi', vatNumber: '02345678904', city: 'Roma' })).resolves.toMatchObject({ city: 'Roma' });
    await expect(saveCustomer({ id: 'x', name: '  ' })).rejects.toThrow();
  });
  it('upsert: nuovo -> crea; esistente -> completa solo i campi vuoti', async () => {
    const r1 = await upsertCustomer({ id: 'n1', name: 'Verdi Spa', vatNumber: '01234567897', city: 'Roma' });
    expect(r1.created).toBe(true);
    const r2 = await upsertCustomer({ id: 'n2', name: 'Verdi S.p.a.', vatNumber: '01234567897', city: 'Milano', pec: 'verdi@pec.example.test' });
    expect(r2).toMatchObject({ created: false, updated: true });
    expect(r2.customer).toMatchObject({ id: 'n1', city: 'Roma', pec: 'verdi@pec.example.test' });
    const r3 = await upsertCustomer({ id: 'n3', name: 'Verdi Spa', vatNumber: '01234567897' });
    expect(r3).toMatchObject({ created: false, updated: false });
    expect(await listCustomers()).toHaveLength(1);
  });
  it('upsertCustomers (CSV) conta creati / uniti / saltati', async () => {
    await saveCustomer({ id: 'a', name: 'Rossi', vatNumber: '02345678904' });
    const r = await upsertCustomers([{ id: 'x', name: 'Rossi', vatNumber: '02345678904', city: 'Roma' }, { id: 'y', name: 'Nuovo' }, { id: 'z', name: '' }]);
    expect(r).toEqual({ created: 1, merged: 1, skipped: 1 });
  });
  it('unione di duplicati: il principale vince, i vuoti si completano, gli altri spariscono, i documenti restano', async () => {
    await saveCustomer({ id: 'a', name: 'Rossi Mario', city: 'Roma' });
    await saveCustomer({ id: 'b', name: 'Rossi M.', vatNumber: '02345678904', city: 'Milano', email: 'r@example.test' });
    await saveDocument(doc('d1', { id: 'b', name: 'Rossi M.' }));
    const m = await mergeCustomers('a', ['b']);
    expect(m).toMatchObject({ id: 'a', city: 'Roma', vatNumber: '02345678904', email: 'r@example.test' });
    expect((await listCustomers()).map((c) => c.id)).toEqual(['a']);
    expect((await getDocument('d1'))?.customer.name).toBe('Rossi M.');
  });
  it('eliminare un cliente non tocca i documenti', async () => {
    const c = await saveCustomer({ id: 'a', name: 'Rossi' });
    await saveDocument(doc('d1', { ...c }));
    await deleteCustomer('a');
    expect((await getDocument('d1'))?.customer.name).toBe('Rossi');
  });
  it('docBelongsTo: per id o per dati identificativi', () => {
    const c = { id: 'a', name: 'Rossi', vatNumber: '02345678904' };
    expect(docBelongsTo({ customer: { id: 'a', name: 'Altro' } }, c)).toBe(true);
    expect(docBelongsTo({ customer: { id: 'zz', name: 'Ditta Rossi', vatNumber: '02345678904' } }, c)).toBe(true);
    expect(docBelongsTo({ customer: { id: 'zz', name: 'Rossi', vatNumber: '01234567897' } }, c)).toBe(false);
  });
});

describe('autocompletamento (searchCustomers)', () => {
  const book = [
    { id: '1', name: 'Rossi Costruzioni Srl', vatNumber: '02345678904' },
    { id: '2', name: 'Mario Rossi' },
    { id: '3', name: 'Bianchi Elena', fiscalCode: 'BNCLNE80A41H501X' },
    { id: '4', name: 'Condominio Aurora' },
  ];
  it('per inizio nome, parola e P.IVA/CF parziale; ordina per pertinenza', () => {
    expect(searchCustomers('ros', book).map((c) => c.id).sort()).toEqual(['1', '2']);
    expect(searchCustomers('rossi', book).map((c) => c.id).sort()).toEqual(['1', '2']);
    expect(searchCustomers('mario ro', book).map((c) => c.id)).toEqual(['2']);
    expect(searchCustomers('0234567', book).map((c) => c.id)).toEqual(['1']);
    expect(searchCustomers('bnclne', book).map((c) => c.id)).toEqual(['3']);
    expect(searchCustomers('aurora', book).map((c) => c.id)).toEqual(['4']);
    expect(searchCustomers('', book)).toEqual([]);
    expect(searchCustomers('zzz', book)).toEqual([]);
  });
  it('la corrispondenza esatta viene per prima', () => {
    expect(searchCustomers('mario rossi', book)[0].id).toBe('2');
  });
});

describe('migrazione v2 -> v3 e v1 -> v3', () => {
  const docs = [
    doc('d1', { id: 'c1', name: 'Rossi Costruzioni Srl', vatNumber: '02345678904', city: 'Milano' }, 10),
    doc('d2', { id: 'c2', name: 'Rossi Costruzioni S.r.l.', vatNumber: '02345678904', pec: 'rossi@pec.example.test' }, 20),
    doc('d3', { id: 'c3', name: 'Elena Bianchi', vatOrFiscalCode: 'BNCLNE80A41H501X' }, 30),
    doc('d4', { id: 'c4', name: '  ' }, 40),
  ];
  it('v2: crea lo store, popola dai documenti senza duplicati, non perde né modifica documenti', async () => {
    const v2 = await openDB('vocepreventivo', 2, {
      upgrade(db) {
        db.createObjectStore('profile');
        db.createObjectStore('catalog', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' });
        db.createObjectStore('audit', { keyPath: 'id' });
      },
    });
    for (const d of docs) await v2.put('documents', d);
    await v2.put('profile', { businessName: 'Vecchia', nextQuoteNumber: 5 } as never, 'main');
    v2.close();

    const customers = await listCustomers();
    expect(customers.map((c) => c.name).sort()).toEqual(['Elena Bianchi', 'Rossi Costruzioni S.r.l.']);
    const rossi = customers.find((c) => c.vatNumber === '02345678904')!;
    expect(rossi).toMatchObject({ city: 'Milano', pec: 'rossi@pec.example.test' });
    expect(customers.find((c) => c.name === 'Elena Bianchi')).toMatchObject({ fiscalCode: 'BNCLNE80A41H501X' });
    const all = await listDocuments();
    expect(all).toHaveLength(4);
    expect((await getDocument('d1'))!.customer).toEqual(docs[0].customer);
    // idempotente: riaprire e rieseguire non duplica
    expect(await importCustomersFromDocuments()).toBe(0);
    expect(await listCustomers()).toHaveLength(2);
    // eliminato a mano: la migrazione non si ripete da sola
    await deleteCustomer(rossi.id);
    await __resetStorageForTests();
    expect(await listCustomers()).toHaveLength(1);
  });
  it('v1: arriva a v3 con documenti migrati e rubrica popolata', async () => {
    const v1 = await openDB('vocepreventivo', 1, {
      upgrade(db) {
        db.createObjectStore('profile');
        db.createObjectStore('catalog', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' });
      },
    });
    await v1.put('documents', { ...docs[0], type: 'fattura', status: 'pagato' });
    v1.close();
    expect((await listCustomers()).map((c) => c.name)).toEqual(['Rossi Costruzioni Srl']);
    expect((await getDocument('d1'))!.invoice?.legacy).toBe(true);
  });
  it('installazione nuova: rubrica vuota', async () => {
    expect(await listCustomers()).toEqual([]);
  });
});

describe('backup v3', () => {
  it('round-trip con la rubrica', async () => {
    await saveCustomer({ id: 'a', name: 'Rossi', vatNumber: '02345678904', city: 'Roma' });
    const json = await exportBackup();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.customers).toHaveLength(1);
    await deleteCustomer('a');
    await saveCustomer({ id: 'zz', name: 'Da perdere' });
    const { warnings } = await importBackup(json);
    expect(warnings.join(' ')).not.toMatch(/rubrica/);
    expect((await listCustomers()).map((c) => c.id)).toEqual(['a']);
  });
  it('importa un backup v2 (senza rubrica) ricavandola dai documenti', async () => {
    const v2 = JSON.stringify({
      version: 2, exportedAt: '2025-01-01T00:00:00Z', profile: { businessName: 'X', nextQuoteNumber: 1 }, catalog: [], audit: [],
      documents: [doc('d1', { id: 'c1', name: 'Rossi', vatNumber: '02345678904' }), doc('d2', { id: 'c2', name: 'rossi', vatNumber: '02345678904' })],
    });
    const b = parseBackup(v2);
    expect(b.customersDerived).toBe(true);
    expect(b.customers).toHaveLength(1);
    const { warnings } = await importBackup(v2);
    expect(warnings.join(' ')).toMatch(/rubrica/);
    expect((await listCustomers())[0]).toMatchObject({ vatNumber: '02345678904' });
    expect(await listDocuments()).toHaveLength(2);
  });
  it('importa un backup v1 e rifiuta rubriche non valide o versioni future', () => {
    const base = { profile: {}, catalog: [], documents: [], audit: [] };
    expect(() => parseBackup(JSON.stringify({ version: 1, ...base }))).not.toThrow();
    expect(() => parseBackup(JSON.stringify({ version: 3, ...base, customers: 'no' }))).toThrow(/rubrica/);
    expect(() => parseBackup(JSON.stringify({ version: 3, ...base, customers: [{ id: 'a' }] }))).toThrow(/nome/);
    expect(() => parseBackup(JSON.stringify({ version: 3, ...base, customers: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }] }))).toThrow(/duplicato/);
    expect(() => parseBackup(JSON.stringify({ version: 4, ...base }))).toThrow(/più recente/);
  });
  it('eliminare un documento non altera la rubrica', async () => {
    await saveCustomer({ id: 'a', name: 'Rossi' });
    await saveDocument(doc('d1', { id: 'a', name: 'Rossi' }));
    await deleteDocument('d1');
    expect(await listCustomers()).toHaveLength(1);
  });
});
