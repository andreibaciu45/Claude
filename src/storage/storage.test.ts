import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import {
  __resetStorageForTests, deleteCatalogItem, deleteDocument, exportBackup, getDocument, getProfile,
  importBackup, listCatalog, listDocuments, nextDocumentNumber, saveCatalogItem, saveDocument, saveProfile,
} from './index';
import type { CatalogItem, QuoteDocument } from '../types';

const item = (id: string, name: string): CatalogItem => ({
  id, name, aliases: ['x'], unit: 'm', price: 5.5, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1,
});
const doc = (id: string, date: string, number = 'PRev-0001'): QuoteDocument => ({
  id, type: 'preventivo', number, date, customer: { id: 'c', name: 'Mario' }, lines: [], status: 'bozza', createdAt: 1, updatedAt: 1,
});

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
});

describe('profilo', () => {
  it('restituisce i default se vuoto', async () => {
    const p = await getProfile();
    expect(p.defaultVat).toBe(22);
    expect(p.quotePrefix).toBe('PRev-');
    expect(p.invoicePrefix).toBe('FT-');
    expect(p.nextQuoteNumber).toBe(1);
    expect(p.quoteValidityDays).toBe(30);
    expect(p.regimeForfettario).toBe(false);
    expect(p.paymentTerms).toContain('30 giorni');
  });
  it('salva e rilegge', async () => {
    const p = await getProfile();
    await saveProfile({ ...p, businessName: 'Rossi Impianti' });
    expect((await getProfile()).businessName).toBe('Rossi Impianti');
  });
});

describe('catalogo', () => {
  it('CRUD', async () => {
    await saveCatalogItem(item('1', 'Tubo'));
    await saveCatalogItem(item('2', 'Altro'));
    expect((await listCatalog()).map((i) => i.name)).toEqual(['Altro', 'Tubo']);
    await saveCatalogItem({ ...item('1', 'Tubo rame'), price: 9 });
    expect((await listCatalog()).find((i) => i.id === '1')?.price).toBe(9);
    await deleteCatalogItem('1');
    expect(await listCatalog()).toHaveLength(1);
  });
});

describe('documenti', () => {
  it('CRUD e ordinamento per data desc', async () => {
    await saveDocument(doc('a', '2025-01-01'));
    await saveDocument(doc('b', '2025-03-01'));
    await saveDocument(doc('c', '2025-02-01'));
    expect((await listDocuments()).map((d) => d.id)).toEqual(['b', 'c', 'a']);
    expect((await getDocument('c'))?.date).toBe('2025-02-01');
    await deleteDocument('c');
    expect(await getDocument('c')).toBeUndefined();
  });
});

describe('numerazione', () => {
  it('incrementa i contatori separatamente', async () => {
    expect(await nextDocumentNumber('preventivo')).toBe('PRev-0001');
    expect(await nextDocumentNumber('preventivo')).toBe('PRev-0002');
    expect(await nextDocumentNumber('fattura')).toBe('FT-0001');
    const p = await getProfile();
    expect(p.nextQuoteNumber).toBe(3);
    await saveProfile({ ...p, nextQuoteNumber: 12 });
    expect(await nextDocumentNumber('preventivo')).toBe('PRev-0012');
  });
  it('è atomico con chiamate concorrenti', async () => {
    const nums = await Promise.all([1, 2, 3, 4, 5].map(() => nextDocumentNumber('preventivo')));
    expect(new Set(nums).size).toBe(5);
  });
});

describe('backup', () => {
  it('round-trip con sostituzione', async () => {
    const p = await getProfile();
    await saveProfile({ ...p, businessName: 'Ditta A' });
    await saveCatalogItem(item('1', 'Tubo'));
    await saveDocument(doc('d1', '2025-01-01'));
    const json = await exportBackup();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.audit)).toBe(true);
    expect(parsed.exportedAt).toBeTruthy();

    await saveProfile({ ...p, businessName: 'Altra' });
    await saveCatalogItem(item('2', 'Extra'));
    await deleteDocument('d1');
    await importBackup(json);
    expect((await getProfile()).businessName).toBe('Ditta A');
    expect((await listCatalog()).map((i) => i.id)).toEqual(['1']);
    expect((await listDocuments()).map((d) => d.id)).toEqual(['d1']);
  });
  it('rifiuta JSON non validi senza toccare i dati', async () => {
    await saveCatalogItem(item('1', 'Tubo'));
    await expect(importBackup('non json')).rejects.toThrow(/Backup non valido/);
    await expect(importBackup('{"version":1}')).rejects.toThrow(/profilo/);
    await expect(importBackup(JSON.stringify({ version: 99, profile: {}, catalog: [], documents: [] }))).rejects.toThrow(/versione/);
    await expect(importBackup(JSON.stringify({ version: 1, profile: {}, catalog: [{ id: 'z', name: 'n', price: 'x' }], documents: [] }))).rejects.toThrow(/prezzo/);
    expect(await listCatalog()).toHaveLength(1);
  });
});
