import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, createCreditNote, getDocument, getProfile, issueInvoice, issueInvoiceWithWarnings, listAudit, listDocuments, saveDocument,
} from './index';
import { previewNumber } from '../pages/invoice/model';
import { draftData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00`));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-03-20');
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
});
afterEach(() => vi.useRealTimers());

const nums = async () => (await listDocuments()).map((d) => d.invoice?.number).filter(Boolean).sort();

describe('numerazione e date', () => {
  it('date in ordine cronologico: numeri progressivi senza buchi e senza avvisi', async () => {
    for (const [i, d] of ['2026-03-01', '2026-03-05', '2026-03-05', '2026-03-19'].entries()) await saveDocument(draftData(`d${i}`, d));
    for (let i = 0; i < 4; i++) {
      const r = await issueInvoiceWithWarnings(`d${i}`);
      expect(r.doc.invoice!.number).toBe(`${i + 1}/2026`);
      expect(r.warnings.filter((w) => /anteriore/.test(w))).toEqual([]);
    }
  });

  it('data anteriore all\'ultima emessa nello stesso sezionale/anno: emessa con avviso (non bloccante) tracciato in audit', async () => {
    await saveDocument(draftData('a', '2026-03-10'));
    await saveDocument(draftData('b', '2026-03-02'));
    await issueInvoice('a');
    const r = await issueInvoiceWithWarnings('b');
    expect(r.doc.invoice!.number).toBe('2/2026');
    expect(r.warnings.join(' ')).toMatch(/anteriore all'ultima fattura emessa/);
    const audit = (await listAudit('b')).find((e) => e.action === 'issue')!;
    expect(audit.detail).toMatch(/Avvisi/);
  });

  it('anno nuovo: la numerazione riparte da 1, quella dell\'anno vecchio resta intatta', async () => {
    await saveDocument(draftData('a', '2026-03-10'));
    await saveDocument(draftData('b', '2026-03-11'));
    await issueInvoice('a'); await issueInvoice('b');
    at('2027-01-03');
    await saveDocument(draftData('c', '2027-01-03'));
    await saveDocument(draftData('d', '2027-01-03'));
    expect((await issueInvoice('c')).invoice!.number).toBe('1/2027');
    expect((await issueInvoice('d')).invoice!.number).toBe('2/2027');
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 2, 'FT-2027': 2 });
  });

  it('operazione dell\'anno precedente emessa a gennaio: numero dell\'anno corretto (2026) e nessun interferenza con il 2027', async () => {
    at('2026-12-21');
    await saveDocument(draftData('a', '2026-12-20'));
    await issueInvoice('a'); // 1/2026
    at('2027-01-05');
    await saveDocument(draftData('b', '2026-12-28')); // operazione del 2026, emessa a gennaio 2027
    await saveDocument(draftData('c', '2027-01-05'));
    const b = await issueInvoice('b');
    const c = await issueInvoice('c');
    expect(b.invoice).toMatchObject({ number: '2/2026', year: 2026, sectional: 'FT' });
    expect(b.date).toBe('2026-12-28');
    expect(c.invoice).toMatchObject({ number: '1/2027', year: 2027 });
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 2, 'FT-2027': 1 });
  });

  it('operazione dell\'anno precedente oltre 12 giorni: emessa con avviso di trasmissione tardiva', async () => {
    at('2027-01-20');
    await saveDocument(draftData('a', '2026-12-28'));
    const r = await issueInvoiceWithWarnings('a');
    expect(r.doc.invoice!.number).toBe('1/2026');
    expect(r.warnings.join(' ')).toMatch(/12 giorni/);
  });

  it('cambio anno durante l\'uso: bozza creata il 31/12, emessa dopo mezzanotte -> numero 2026 con data 31/12; nota di credito del 2 gennaio -> NC1/2027', async () => {
    at('2026-12-31');
    await saveDocument(draftData('a', '2026-12-31'));
    vi.setSystemTime(new Date('2027-01-01T00:05:00'));
    const a = await issueInvoice('a');
    expect(a.invoice!.number).toBe('1/2026');
    expect(a.date).toBe('2026-12-31');
    at('2027-01-02');
    const nc = await createCreditNote('a', { reason: 'errore' });
    expect(nc.invoice).toMatchObject({ number: 'NC1/2027', year: 2027, sectional: 'NC', originalNumber: '1/2026', originalDate: '2026-12-31' });
    // una nuova fattura del 2027 ha il proprio contatore
    await saveDocument(draftData('b', '2027-01-02'));
    expect((await issueInvoice('b')).invoice!.number).toBe('1/2027');
  });

  it('l\'anteprima del numero usa l\'anno della data operazione (non un anno memorizzato obsoleto)', async () => {
    const p = await getProfile();
    const stale = draftData('x', '2027-01-04', undefined, {}, { year: 2026 });
    expect(previewNumber(stale, { invoiceYearCounters: { 'FT-2026': 7, 'FT-2027': 0 } })).toBe('1/2027');
    expect(previewNumber(draftData('y', '2026-06-01'), { invoiceYearCounters: { 'FT-2026': 7 } })).toBe('8/2026');
    expect(p.invoiceYearCounters).toEqual({});
  });

  it('emissioni concorrenti a cavallo d\'anno: contatori separati, nessun buco', async () => {
    at('2027-01-03');
    for (let i = 0; i < 3; i++) await saveDocument(draftData(`o${i}`, '2026-12-30'));
    for (let i = 0; i < 3; i++) await saveDocument(draftData(`n${i}`, '2027-01-02'));
    await Promise.all([...Array(3).keys()].flatMap((i) => [issueInvoice(`o${i}`), issueInvoice(`n${i}`)]));
    expect(await nums()).toEqual(['1/2026', '1/2027', '2/2026', '2/2027', '3/2026', '3/2027']);
  });

  it('data nel futuro oltre la tolleranza: emissione rifiutata, nessun numero consumato', async () => {
    await saveDocument(draftData('a', '2026-04-30'));
    await expect(issueInvoice('a')).rejects.toMatchObject({ name: 'InvoiceValidationError' });
    expect((await getProfile()).invoiceYearCounters).toEqual({});
    expect((await getDocument('a'))!.invoice!.number).toBeUndefined();
  });
});
