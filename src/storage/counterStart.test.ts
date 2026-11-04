import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  CounterStartError, __resetStorageForTests, createCreditNote, exportBackup, getInvoiceCounterInfo, getProfile, importBackup, issueInvoice, listAudit,
  listInvoiceCounters, saveDocument, saveProfile, setInvoiceCounterStart,
} from './index';
import { draftData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-20T12:00:00'));
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
});
afterEach(() => vi.useRealTimers());

describe('numero di partenza (setInvoiceCounterStart)', () => {
  it('ultimo numero usato 14 -> la prossima fattura è 15/2026 e il contatore lo ricorda', async () => {
    const r = await setInvoiceCounterStart('FT', 2026, 14);
    expect(r).toMatchObject({ changed: true, previous: 0, lastUsed: 14, next: 15, nextNumber: '15/2026' });
    await saveDocument(draftData('a', '2026-03-10'));
    const doc = await issueInvoice('a');
    expect(doc.invoice).toMatchObject({ number: '15/2026', seq: 15 });
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 15 });
  });

  it('sezionale NC e anni indipendenti', async () => {
    await setInvoiceCounterStart('NC', 2026, 2);
    await setInvoiceCounterStart('FT', 2027, 40);
    const c = await listInvoiceCounters();
    expect(c.map((x) => [x.sectional, x.year, x.lastUsed, x.nextNumber])).toEqual([['FT', 2027, 40, '41/2027'], ['NC', 2026, 2, 'NC3/2026']]);
    await saveDocument(draftData('a', '2026-03-10'));
    expect((await issueInvoice('a')).invoice!.number).toBe('1/2026'); // FT-2026 non toccato
  });

  it('non si scende sotto il massimo già emesso con questa app (nemmeno con conferma)', async () => {
    for (const id of ['a', 'b', 'c']) { await saveDocument(draftData(id, '2026-03-10')); await issueInvoice(id); }
    for (const confirmLowering of [false, true]) {
      const e = await setInvoiceCounterStart('FT', 2026, 2, { confirmLowering }).catch((x) => x);
      expect(e).toBeInstanceOf(CounterStartError);
      expect(e).toMatchObject({ code: 'below_issued', maxIssued: 3 });
      expect(e.message).toContain('3/2026');
    }
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 3 });
  });

  it('si può alzare il numero oltre l\'emesso (il salto è voluto)', async () => {
    await saveDocument(draftData('a', '2026-03-10')); await issueInvoice('a');
    const r = await setInvoiceCounterStart('FT', 2026, 20);
    expect(r.nextNumber).toBe('21/2026');
  });

  it('abbassare il valore (ma restando sopra l\'emesso) richiede conferma esplicita e lascia traccia', async () => {
    await setInvoiceCounterStart('FT', 2026, 14);
    const e = await setInvoiceCounterStart('FT', 2026, 9).catch((x) => x);
    expect(e).toMatchObject({ code: 'lowering_not_confirmed', current: 14 });
    expect((await getInvoiceCounterInfo('FT', 2026)).lastUsed).toBe(14);
    const ok = await setInvoiceCounterStart('FT', 2026, 9, { confirmLowering: true });
    expect(ok).toMatchObject({ lastUsed: 9, nextNumber: '10/2026' });
    const log = (await listAudit('counter:FT-2026')).map((a) => a.detail ?? '');
    expect(log).toHaveLength(2);
    expect(log[1]).toMatch(/ABBASSATO/);
  });

  it('un salvataggio successivo del profilo (anche con form vecchio) non sovrascrive il numero impostato', async () => {
    const stale = await getProfile();
    await setInvoiceCounterStart('FT', 2026, 14);
    await saveProfile({ ...stale, businessName: 'Altro nome' });
    expect((await getProfile()).invoiceYearCounters?.['FT-2026']).toBe(14);
  });

  it('audit: voce nel registro con valori prima/dopo, nessuna voce se non cambia nulla', async () => {
    await setInvoiceCounterStart('FT', 2026, 14);
    const again = await setInvoiceCounterStart('FT', 2026, 14);
    expect(again.changed).toBe(false);
    const log = await listAudit('counter:FT-2026');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'edit', actor: 'user' });
    expect(log[0].detail).toMatch(/ultimo numero usato 14 \(prima 0\).*15\/2026/);
  });

  it('valori non validi', async () => {
    for (const bad of [-1, 1.5, Number.NaN, 1e12]) expect(await setInvoiceCounterStart('FT', 2026, bad).catch((x) => x)).toMatchObject({ code: 'invalid' });
    expect(await setInvoiceCounterStart('FT', 1999, 1).catch((x) => x)).toMatchObject({ code: 'invalid' });
    expect(await setInvoiceCounterStart('XX' as 'FT', 2026, 1).catch((x) => x)).toMatchObject({ code: 'invalid' });
  });

  it('la nota di credito usa il proprio contatore impostato (NC3/2026)', async () => {
    await saveDocument(draftData('a', '2026-03-10')); const inv = await issueInvoice('a');
    await setInvoiceCounterStart('NC', 2026, 2);
    const nc = await createCreditNote(inv.id, { reason: 'reso merce' });
    expect(nc.invoice!.number).toBe('NC3/2026');
  });

  it('il ripristino di un backup non riabbassa il numero impostato', async () => {
    const backup = await exportBackup();
    await setInvoiceCounterStart('FT', 2026, 14);
    await importBackup(backup);
    expect((await getInvoiceCounterInfo('FT', 2026)).lastUsed).toBe(14);
  });
});
