import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  ClearLocalDataError, __resetStorageForTests, appendAudit, clearLocalData, exportBackup, getProfile, getStorageSummary, importAuditEntries,
  issueInvoice, listAudit, listCatalog, listCustomers, listDocuments, parseBackup, saveCatalogItem, saveDocument, saveCustomer, storageHooks,
} from './index';
import type { StorageHooks } from './hooks';
import type { AuditEntry } from '../types';
import { draftData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const CONFIRM = 'CANCELLA-DATI-LOCALI' as const;
const entry = (id: string, over: Partial<AuditEntry> = {}): AuditEntry => ({ id, at: 1_700_000_000_000, docId: 'd1', action: 'edit', actor: 'user', detail: 'x', ...over });

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  try { localStorage.clear(); } catch { /* ambiente senza localStorage */ }
  await seedProfile();
  await saveCatalogItem({ id: 'k1', name: 'Tubo', aliases: [], unit: 'm', price: 5, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1 });
  await saveCustomer({ id: 'c1', name: 'Rossi Srl' });
  await saveDocument(draftData('f1', '2026-03-10'));
  await saveDocument(draftData('f2', '2026-03-11'));
  await issueInvoice('f1');
});

describe('clearLocalData', () => {
  it('senza la conferma esplicita non cancella nulla', async () => {
    const before = await exportBackup();
    for (const bad of [undefined, {}, { confirm: 'si' }, { confirm: 'cancella-dati-locali' }, { keepBackupCopy: true }]) {
      await expect(clearLocalData(bad as never)).rejects.toBeInstanceOf(ClearLocalDataError);
    }
    const after = JSON.parse(await exportBackup());
    const b = JSON.parse(before);
    expect(after.documents).toEqual(b.documents);
    expect(after.catalog).toEqual(b.catalog);
    expect(after.audit).toEqual(b.audit);
    expect(after.profile).toEqual(b.profile);
  });

  it('svuota profilo, catalogo, documenti, rubrica e audit; il backup di sicurezza contiene le fatture emesse con XML', async () => {
    const issued = (await listDocuments()).find((d) => d.id === 'f1')!;
    expect(issued.invoice!.lockedAt).toBeTruthy();
    const r = await clearLocalData({ confirm: CONFIRM, keepBackupCopy: true });
    expect(r.cleared).toMatchObject({ catalog: 1, documents: 2, invoicesIssued: 1, customers: 1 });
    expect(r.auditWritten).toBe(false);
    expect(await listDocuments()).toEqual([]);
    expect(await listCatalog()).toEqual([]);
    expect(await listCustomers()).toEqual([]);
    expect(await listAudit()).toEqual([]);
    const p = await getProfile();
    expect(p.businessName).toBe('');
    expect(p.invoiceYearCounters).toEqual({});
    // il backup include la fattura emessa, con XML e hash, e si può ripristinare
    const b = parseBackup(r.backupJson!);
    const inBackup = b.documents.find((d) => d.id === 'f1')!;
    expect(inBackup.invoice!.lockedAt).toBe(issued.invoice!.lockedAt);
    expect(inBackup.invoice!.xml).toBe(issued.invoice!.xml);
    expect(inBackup.invoice!.xmlSha256).toBe(issued.invoice!.xmlSha256);
    expect(b.documents).toHaveLength(2);
    expect(b.catalog).toHaveLength(1);
    expect(b.customers.map((c) => c.id)).toContain('c1');
    expect(b.audit.some((a) => a.action === 'issue' && a.docId === 'f1')).toBe(true);
    expect(b.profile.businessName).toBe('Bianchi Mario Impianti');
  });

  it('keepBackupCopy: false non restituisce alcun backup; il predefinito è la copia di sicurezza', async () => {
    const r = await clearLocalData({ confirm: CONFIRM, keepBackupCopy: false });
    expect(r.backupJson).toBeUndefined();
    await seedProfile();
    await saveDocument(draftData('z', '2026-04-01'));
    const r2 = await clearLocalData({ confirm: CONFIRM });
    expect(parseBackup(r2.backupJson!).documents.map((d) => d.id)).toEqual(['z']);
  });

  it('con keepAudit il registro resta e viene scritta UNA sola voce "edit"; senza, nessuna voce', async () => {
    const before = (await listAudit()).length;
    expect(before).toBeGreaterThan(0);
    const r = await clearLocalData({ confirm: CONFIRM, keepAudit: true });
    expect(r.auditWritten).toBe(true);
    const after = await listAudit();
    expect(after).toHaveLength(before + 1);
    const last = after[after.length - 1];
    expect(last).toMatchObject({ action: 'edit', docId: '-' });
    expect(last.detail).toMatch(/cancellati/);
    expect(after.filter((a) => a.action === 'edit' && /cancellati/.test(a.detail ?? ''))).toHaveLength(1);
  });

  it('cancella anche la bozza locale del preventivo (dati del cliente precedente)', async () => {
    localStorage.setItem('vocepreventivo:draft:v1', '{"x":1}');
    localStorage.setItem('altro', 'resta');
    await clearLocalData({ confirm: CONFIRM });
    expect(localStorage.getItem('vocepreventivo:draft:v1')).toBeNull();
    expect(localStorage.getItem('altro')).toBe('resta');
  });

  it('dopo la cancellazione si possono emettere fatture da zero (numerazione dell\'account nuovo)', async () => {
    await clearLocalData({ confirm: CONFIRM });
    await seedProfile({ businessName: 'Altro Account Srl' });
    await saveDocument(draftData('n1', '2026-05-01'));
    expect((await issueInvoice('n1')).invoice!.number).toBe('1/2026');
  });

  it('getStorageSummary riflette il contenuto', async () => {
    expect(await getStorageSummary()).toMatchObject({ catalog: 1, documents: 2, invoicesIssued: 1, customers: 1, hasProfile: true });
    await clearLocalData({ confirm: CONFIRM });
    expect(await getStorageSummary()).toMatchObject({ catalog: 0, documents: 0, invoicesIssued: 0, customers: 0, hasProfile: false });
  });
});

describe('importAuditEntries', () => {
  it('aggiunge le voci nuove, è idempotente per id e non sovrascrive mai', async () => {
    const base = (await listAudit()).length;
    const r1 = await importAuditEntries([entry('remote-1'), entry('remote-2', { at: 1_700_000_000_500, action: 'issue', xmlSha256: 'a'.repeat(64) })]);
    expect(r1).toEqual({ added: 2, skipped: 0 });
    expect((await listAudit()).length).toBe(base + 2);
    const r2 = await importAuditEntries([entry('remote-1'), entry('remote-2')]);
    expect(r2).toEqual({ added: 0, skipped: 2 });
    // stesso id con contenuto diverso: la voce locale resta com'è
    const r3 = await importAuditEntries([entry('remote-1', { detail: 'MANOMESSA', action: 'delete_draft' })]);
    expect(r3).toEqual({ added: 0, skipped: 1 });
    const kept = (await listAudit()).find((a) => a.id === 'remote-1')!;
    expect(kept).toMatchObject({ detail: 'x', action: 'edit' });
    expect((await listAudit()).length).toBe(base + 2);
  });

  it('non tocca le voci locali esistenti (un id uguale a una voce locale è ignorato)', async () => {
    const local = await appendAudit({ docId: 'dX', action: 'edit', detail: 'locale' });
    const r = await importAuditEntries([{ ...local, detail: 'remota diversa' }]);
    expect(r).toEqual({ added: 0, skipped: 1 });
    expect((await listAudit('dX'))[0].detail).toBe('locale');
  });

  it('valida i campi: voci non valide ignorate, duplicati nel lotto contati una volta', async () => {
    const bad = [
      null, 'x', 42, {}, entry(''), entry('a', { docId: '' }), entry('b', { at: NaN }), entry('c', { at: -5 }), entry('d', { at: Infinity }),
      entry('e', { action: 'hack' as never }), entry('f', { actor: 'admin' as never }), entry('g', { detail: 5 as never }),
      entry('h', { xmlSha256: {} as never }), entry('i', { detail: 'x'.repeat(20_001) }), entry('x'.repeat(201)),
    ];
    const r = await importAuditEntries([...bad as AuditEntry[], entry('ok'), entry('ok')]);
    expect(r).toEqual({ added: 1, skipped: bad.length + 1 });
    expect((await listAudit()).filter((a) => a.id === 'ok')).toHaveLength(1);
  });

  it('scarta i campi sconosciuti e non altera il contenuto', async () => {
    await importAuditEntries([{ ...entry('r1', { detail: '  spazi  e àccènti ', voiceTranscript: 'taglia' }), extra: 'no', __proto__x: 1 } as never]);
    const e = (await listAudit()).find((a) => a.id === 'r1')!;
    expect(e).toEqual({ id: 'r1', at: 1_700_000_000_000, docId: 'd1', action: 'edit', actor: 'user', detail: '  spazi  e àccènti ', voiceTranscript: 'taglia' });
  });

  it('input non array: errore; lista vuota: niente', async () => {
    await expect(importAuditEntries(null as never)).rejects.toBeInstanceOf(TypeError);
    expect(await importAuditEntries([])).toEqual({ added: 0, skipped: 0 });
  });

  it('un lotto grande entra in una transazione e il registro resta ordinato per tempo', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => entry(`bulk-${String(i).padStart(5, '0')}`, { at: 1_600_000_000_000 + i }));
    expect(await importAuditEntries(many)).toEqual({ added: 1500, skipped: 0 });
    const all = await listAudit();
    for (let i = 1; i < all.length; i++) expect(all[i].at).toBeGreaterThanOrEqual(all[i - 1].at);
  });
});

describe('StorageHooks', () => {
  it('storageHooks soddisfa l\'interfaccia per il sync', async () => {
    const h: StorageHooks = storageHooks;
    expect(await h.importAuditEntries([entry('hook-1')])).toEqual({ added: 1, skipped: 0 });
    const r = await h.clearLocalData({ confirm: CONFIRM, keepBackupCopy: false });
    expect(r.cleared.documents).toBe(2);
  });
});
