import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, createCreditNote, getDocument, issueInvoice, listAudit, saveDocument, setInvoiceCounterStart, verifyStorageIntegrity,
} from './index';
import { getBackend } from './db';
import type { QuoteDocument } from '../types';
import { draftData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const Y = Number(today().slice(0, 4));

const issue = async (id: string) => { await saveDocument(draftData(id, today())); return issueInvoice(id); };
const rawPut = (d: QuoteDocument) => getBackend().transact('readwrite', (t) => t.put('documents', d));
const rawDel = (id: string) => getBackend().transact('readwrite', (t) => t.del('documents', id));
const codes = async () => (await verifyStorageIntegrity()).issues.map((i) => i.code).sort();

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
});

describe('verifyStorageIntegrity', () => {
  it('archivio vuoto o sano: nessun problema', async () => {
    let r = await verifyStorageIntegrity();
    expect(r).toMatchObject({ ok: true, clean: true, issues: [] });
    expect(r.summary).toMatch(/Tutto in ordine/);
    await issue('a'); await issue('b'); await issue('c');
    await createCreditNote('b', { reason: 'reso' });
    r = await verifyStorageIntegrity();
    expect(r.issues).toEqual([]);
    expect(r.counts).toMatchObject({ documents: 4, issuedInvoices: 3, creditNotes: 1 });
  });

  it('numerazione con buco: errore con i numeri mancanti', async () => {
    const a = await issue('a'); await issue('b'); await issue('c');
    expect(a.invoice!.seq).toBe(1);
    await rawDel('b');
    const r = await verifyStorageIntegrity();
    const gap = r.issues.find((i) => i.code === 'numbering_gap')!;
    expect(gap.severity).toBe('error');
    expect(gap.message).toContain(`2/${Y}`);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/1 problema da risolvere/);
  });

  it('i buchi tra sezionali e anni diversi sono indipendenti', async () => {
    await issue('a'); await issue('b');
    await createCreditNote('a', { reason: 'x' });
    expect(await codes()).toEqual([]);
  });

  it('numero di partenza impostato a mano: nessun errore per la partenza, avviso (non errore) per un salto', async () => {
    await setInvoiceCounterStart('FT', Y, 14);
    await issue('a'); // 15
    expect(await codes()).toEqual([]);
    await setInvoiceCounterStart('FT', Y, 20);
    await issue('b'); // 21: salto voluto
    const r = await verifyStorageIntegrity();
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([['numbering_gap_declared', 'warning']]);
    expect(r.ok).toBe(true);
  });

  it('serie che non parte da 1 senza numero di partenza: avviso', async () => {
    await issue('a'); const b = await issue('b');
    await rawDel('a');
    const r = await verifyStorageIntegrity();
    expect(r.issues.find((i) => i.code === 'numbering_gap')).toMatchObject({ severity: 'warning', docIds: [b.id] });
  });

  it('contatore indietro rispetto al massimo emesso: errore', async () => {
    await issue('a'); await issue('b');
    await getBackend().transact('readwrite', async (t) => {
      const p = (await t.getProfile())!;
      await t.putProfile({ ...p, invoiceYearCounters: { ...p.invoiceYearCounters, [`FT-${Y}`]: 1 } } as never);
    });
    expect(await codes()).toContain('counter_behind');
  });

  it('numero duplicato (stesso testo di numero su due documenti): errore', async () => {
    const a = await issue('a'); const b = await issue('b');
    await rawPut({ ...b, invoice: { ...b.invoice!, number: a.invoice!.number } });
    const r = await verifyStorageIntegrity();
    expect(r.issues.find((i) => i.code === 'duplicate_number')).toMatchObject({ severity: 'error' });
  });

  it('fattura emessa senza XML, senza hash, con XML alterato', async () => {
    const a = await issue('a'); const b = await issue('b'); const c = await issue('c');
    const { xml: _x, ...noXml } = a.invoice!;
    await rawPut({ ...a, invoice: noXml });
    const { xmlSha256: _h, ...noHash } = b.invoice!;
    await rawPut({ ...b, invoice: noHash });
    await rawPut({ ...c, invoice: { ...c.invoice!, xml: c.invoice!.xml + '<!-- manomesso -->' } });
    const r = await verifyStorageIntegrity();
    expect(r.issues.map((i) => i.code).sort()).toEqual(['hash_mismatch', 'missing_hash', 'missing_xml']);
    expect(r.issues.find((i) => i.code === 'hash_mismatch')!.docIds).toEqual([c.id]);
    expect(r.issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('nota di credito orfana (fattura originale sparita o collegamento rotto)', async () => {
    await issue('a');
    const nc = await createCreditNote('a', { reason: 'reso' });
    await rawPut({ ...nc, invoice: { ...nc.invoice!, originalDocumentId: 'inesistente' } });
    const r = await verifyStorageIntegrity();
    expect(r.issues.find((i) => i.code === 'credit_note_orphan')).toMatchObject({ severity: 'error', docIds: [nc.id] });
  });

  it('audit delle emissioni mancante: avviso (non errore)', async () => {
    await issue('a');
    await clearLocalDataKeepDocs();
    const r = await verifyStorageIntegrity();
    expect(r.issues.find((i) => i.code === 'missing_issue_audit')).toMatchObject({ severity: 'warning' });
    expect(r.ok).toBe(true);
    expect(r.clean).toBe(false);
  });

  it('impronta in audit diversa dall\'XML attuale: avviso', async () => {
    const a = await issue('a');
    await getBackend().transact('readwrite', async (t) => {
      for (const e of await t.all<{ id: string; docId: string; xmlSha256?: string }>('audit')) if (e.docId === a.id) await t.put('audit', { ...e, xmlSha256: 'f'.repeat(64) });
    });
    expect(await codes()).toEqual(['audit_hash_mismatch']);
  });

  it('non modifica nulla (sola lettura)', async () => {
    await issue('a');
    const before = JSON.stringify([await getDocument('a'), await listAudit()]);
    await verifyStorageIntegrity();
    expect(JSON.stringify([await getDocument('a'), await listAudit()])).toBe(before);
  });
});

/** Svuota solo il registro audit (simula un registro perso) lasciando i documenti. */
async function clearLocalDataKeepDocs(): Promise<void> {
  await getBackend().transact('readwrite', (t) => t.clear('audit'));
}
