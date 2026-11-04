// REV-IMP1: un backup manomesso non può riscrivere fatture emesse.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  BackupValidationError, __resetStorageForTests, createCreditNote, exportBackup, getDocument, getProfile, importBackup, issueInvoice,
  listDocuments, parseBackup, saveDocument, validateBackupDocuments,
} from './index';
import { sha256Hex } from './invoices';
import { draftData, lineData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

afterEach(() => vi.useRealTimers());

type Json = { documents: { id: string; status: string; invoice: Record<string, unknown> }[]; audit: Record<string, unknown>[]; profile: { invoiceYearCounters: Record<string, number> } };
let good: string;

// Orologio fisso: i fixture usano date 2026 e numeri '1/2026'; senza il blocco il test diventerebbe rosso dal 1/1/2027.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-15T12:00:00'));
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
  await saveDocument(draftData('f1', '2026-03-10'));
  await issueInvoice('f1');
  await saveDocument(draftData('f2', '2026-03-11', [lineData('l1', 200)]));
  await issueInvoice('f2');
  await createCreditNote('f2', { reason: 'reso' });
  await saveDocument(draftData('f3', '2026-03-12'));
  good = await exportBackup();
});

const tamper = (fn: (j: Json) => void): string => { const j = JSON.parse(good) as Json; fn(j); return JSON.stringify(j); };
const doc = (j: Json, id: string) => j.documents.find((d) => d.id === id)!;
const issuesOf = async (json: string) => (await validateBackupDocuments(parseBackup(json).documents, parseBackup(json).audit)).issues;

describe('backup valido', () => {
  it('nessun problema e import riuscito', async () => {
    expect(await issuesOf(good)).toEqual([]);
    const res = await importBackup(good);
    expect(res.rejected).toEqual([]);
    expect((await listDocuments()).length).toBe(4);
  });
});

describe('backup manomesso: default = rifiuto dell\'intero import', () => {
  const cases: [string, (j: Json) => void, string][] = [
    ['XML modificato con hash invariato', (j) => { const i = doc(j, 'f1').invoice; i.xml = String(i.xml).replace('<ImportoTotaleDocumento>150.00', '<ImportoTotaleDocumento>1.00'); }, 'hash_mismatch'],
    ['XML e hash rigenerati insieme (non compare nell\'audit)', (j) => { const i = doc(j, 'f1').invoice; i.xml = `${String(i.xml)}<!-- x -->`; i.xmlSha256 = 'x'; }, 'hash_mismatch'],
    ['fattura emessa senza lockedAt', (j) => { delete doc(j, 'f1').invoice.lockedAt; }, 'missing_locked_at'],
    ['numero incoerente con il progressivo', (j) => { doc(j, 'f1').invoice.number = '7/2026'; }, 'number_mismatch'],
    ['bozza con numero e XML', (j) => { Object.assign(doc(j, 'f3').invoice, { seq: 9, number: '9/2026' }); }, 'draft_has_issue_data'],
    ['XML mancante', (j) => { delete doc(j, 'f1').invoice.xml; }, 'missing_xml'],
    ['sezionale incoerente col tipo', (j) => { Object.assign(doc(j, 'f1').invoice, { sectional: 'NC', seq: 5, number: 'NC5/2026' }); }, 'sectional_mismatch'],
    ['nota di credito orfana', (j) => { const nc = j.documents.find((d) => d.invoice.tipoDocumento === 'TD04')!; nc.invoice.originalDocumentId = 'nope'; }, 'credit_note_original_missing'],
    ['hash dello storico XML falso', (j) => { doc(j, 'f1').invoice.xmlHistory = [{ xml: '<a/>', xmlSha256: 'ff', archivedAt: 1, reason: 'scartata' }]; }, 'history_hash_mismatch'],
  ];
  for (const [name, fn, code] of cases) {
    it(`${name} -> ${code}`, async () => {
      const bad = tamper(fn);
      expect((await issuesOf(bad)).map((i) => i.code)).toContain(code);
      // stato attuale diverso dal backup: deve restare INTATTO
      await saveDocument(draftData('extra', '2026-04-01'));
      const err = await importBackup(bad).catch((e) => e);
      expect(err).toBeInstanceOf(BackupValidationError);
      expect((err as BackupValidationError).issues.length).toBeGreaterThan(0);
      expect(err.message).toContain('Nessun dato è stato modificato');
      expect(await getDocument('extra')).toBeDefined();
      expect((await getDocument('f1'))?.invoice?.number).toBe('1/2026');
    });
  }

  it('hash dell\'XML ricalcolato davvero (SHA-256)', async () => {
    const j = JSON.parse(good) as Json;
    const i = doc(j, 'f1').invoice;
    expect(await sha256Hex(String(i.xml))).toBe(i.xmlSha256);
  });
});

describe('opzione esplicita skipInvalidDocuments', () => {
  it('rifiuta solo i documenti manomessi (e le note collegate), tiene la versione attuale e segnala tutto', async () => {
    const original = (await getDocument('f2'))!;
    const bad = tamper((j) => { const i = doc(j, 'f2').invoice; i.xml = `${String(i.xml)} `; });
    const res = await importBackup(bad, { skipInvalidDocuments: true });
    expect(res.rejected.map((r) => r.docId).sort()).toEqual([...new Set(res.rejected.map((r) => r.docId))].sort());
    expect(res.rejected.length).toBeGreaterThanOrEqual(2); // f2 + la sua nota di credito
    expect(res.warnings.join(' ')).toContain('NON ripristinat');
    // f2 resta quello attuale (non quello manomesso); f1 ripristinato
    expect((await getDocument('f2'))?.invoice?.xml).toBe(original.invoice?.xml);
    expect((await getDocument('f1'))?.invoice?.number).toBe('1/2026');
  });
});

describe('contatori', () => {
  it('non scendono mai sotto il massimo seq del file, nemmeno con contatori manomessi', async () => {
    const bad = tamper((j) => { j.profile.invoiceYearCounters = { 'FT-2026': 0, 'NC-2026': 0 }; });
    await importBackup(bad);
    const c = (await getProfile()).invoiceYearCounters;
    expect(c?.['FT-2026']).toBeGreaterThanOrEqual(2);
    expect(c?.['NC-2026']).toBeGreaterThanOrEqual(1);
  });
  it('anche con documenti rifiutati i loro numeri non vengono riutilizzati', async () => {
    const bad = tamper((j) => { const i = doc(j, 'f2').invoice; i.xml = `${String(i.xml)} `; j.profile.invoiceYearCounters = {}; });
    await importBackup(bad, { skipInvalidDocuments: true });
    expect((await getProfile()).invoiceYearCounters?.['FT-2026']).toBeGreaterThanOrEqual(2);
  });
});
