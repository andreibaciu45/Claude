/**
 * Property test DETERMINISTICI (PRNG con seed, orologio finto, IndexedDB finto) sulle aree critiche dello storage:
 *  - numerazione fatture/note di credito senza buchi né duplicati sotto emissioni, cancellazioni e fallimenti casuali;
 *  - round-trip backup -> ripristino su un archivio vuoto e su uno più recente (i contatori non scendono mai).
 * Ogni scenario dipende solo dal seed: un rosso si riproduce con lo stesso numero.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  __resetStorageForTests, createCreditNote, deleteDocument, exportBackup, getProfile, importBackup, issueInvoice, listAudit, listCatalog, listCustomers,
  listDocuments, parseBackup, saveCatalogItem, saveCustomer, saveDocument,
} from './index';
import { draftData, lineData, seedProfile } from './testkit';
import type { QuoteDocument } from '../types';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (r: () => number, n: number) => Math.floor(r() * n);

const setNow = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00`));
const reset = async () => { await __resetStorageForTests(); await deleteDB('vocepreventivo'); };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow('2026-12-20');
  await reset();
  await seedProfile(); // la versione emette solo per il regime forfettario (RF19)
});
afterEach(() => vi.useRealTimers());

const DATES = ['2026-12-18', '2026-12-19', '2026-12-20', '2026-12-20'];

/** Esegue `ops` operazioni casuali e restituisce i documenti per cui l'emissione è riuscita. */
async function randomSession(seed: number, ops: number) {
  const r = rng(seed);
  let n = 0;
  const drafts: string[] = [];
  const issued: string[] = [];
  for (let i = 0; i < ops; i++) {
    const roll = r();
    if (roll < 0.35 || drafts.length === 0) {
      const id = `d${seed}-${n++}`;
      // 1 bozza su 6 ha data nel futuro oltre la tolleranza: l'emissione deve fallire senza consumare numeri
      const date = r() < 0.17 ? '2027-03-01' : DATES[int(r, DATES.length)];
      await saveDocument(draftData(id, date, [lineData('a', 10 + int(r, 90), 1 + int(r, 3))]));
      drafts.push(id);
    } else if (roll < 0.7) {
      const batch = Array.from({ length: 1 + int(r, 4) }, () => drafts[int(r, drafts.length)]);
      const res = await Promise.allSettled(batch.map((id) => issueInvoice(id)));
      res.forEach((x, k) => { if (x.status === 'fulfilled' && !issued.includes(batch[k])) issued.push(batch[k]); });
    } else if (roll < 0.82) {
      const id = drafts[int(r, drafts.length)];
      await deleteDocument(id).catch(() => undefined); // le emesse sono immutabili: rifiuto atteso
    } else if (issued.length) {
      await createCreditNote(issued[int(r, issued.length)], { reason: 'storno casuale' }).catch(() => undefined);
    }
  }
  return { issued };
}

const seqs = (docs: QuoteDocument[]) => {
  const by: Record<string, number[]> = {};
  for (const d of docs) {
    const i = d.invoice;
    if (!i || typeof i.seq !== 'number') continue;
    (by[`${i.sectional}-${i.year}`] ??= []).push(i.seq);
  }
  for (const k of Object.keys(by)) by[k].sort((a, b) => a - b);
  return by;
};

describe('numerazione senza buchi sotto operazioni casuali', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: per ogni (sezionale, anno) i numeri sono 1..n senza buchi né duplicati e coincidono con i contatori`, async () => {
      await randomSession(seed, 40);
      const docs = await listDocuments();
      const by = seqs(docs);
      expect(by['FT-2026']?.length ?? 0, 'lo scenario deve emettere almeno una fattura (test non vacuo)').toBeGreaterThan(0);
      for (const [key, list] of Object.entries(by)) expect(list, `${key}: ${list.join(',')}`).toEqual(list.map((_, i) => i + 1));
      const counters = (await getProfile()).invoiceYearCounters ?? {};
      for (const [key, list] of Object.entries(by)) expect(counters[key], key).toBe(list.length);
      // il testo del numero è coerente con seq/sezionale/anno
      for (const d of docs) {
        const i = d.invoice;
        if (!i || typeof i.seq !== 'number') continue;
        expect(i.number).toBe(`${i.sectional === 'NC' ? 'NC' : ''}${i.seq}/${i.year}`);
        expect(i.lockedAt).toBeTruthy();
      }
      // le bozze non hanno mai numero né sequenza
      for (const d of docs.filter((x) => !x.invoice?.lockedAt)) expect(d.invoice?.seq).toBeUndefined();
      // ogni emissione è tracciata in audit
      for (const d of docs.filter((x) => x.invoice?.lockedAt)) expect((await listAudit(d.id)).some((e) => e.action === 'issue'), d.id).toBe(true);
    });
  }

  it('emissioni tutte in parallelo sullo stesso sezionale: un solo vincitore per numero', async () => {
    for (let i = 0; i < 12; i++) await saveDocument(draftData(`p${i}`, '2026-12-20'));
    await Promise.all(Array.from({ length: 12 }, (_, i) => issueInvoice(`p${i}`)));
    expect(seqs(await listDocuments())['FT-2026']).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

describe('backup: round-trip', () => {
  async function populate(seed: number) {
    const r = rng(seed);
    await randomSession(seed, 25);
    const nCat = 1 + int(r, 5);
    const nCust = 1 + int(r, 4);
    for (let i = 0; i < nCat; i++) await saveCatalogItem({ id: `k${i}`, name: `Voce ${i} àè`, aliases: [`a${i}`], unit: 'pz', price: int(r, 5000) / 100, vat: 22, kind: 'materiale', createdAt: i, updatedAt: i });
    for (let i = 0; i < nCust; i++) await saveCustomer({ id: `cu${i}`, name: `Anagrafica ${seed}-${i} Srl`, vatNumber: '' });
  }
  const norm = async () => ({
    docs: (await listDocuments()).sort((a, b) => a.id.localeCompare(b.id)),
    catalog: (await listCatalog()).sort((a, b) => a.id.localeCompare(b.id)),
    customers: (await listCustomers()).sort((a, b) => a.id.localeCompare(b.id)),
    counters: (await getProfile()).invoiceYearCounters,
  });

  for (const seed of [11, 12, 13, 14, 15]) {
    it(`seed ${seed}: esporta -> archivio vuoto -> ripristina dà gli stessi documenti, catalogo, clienti e contatori; il file è stabile`, async () => {
      await populate(seed);
      const before = await norm();
      const json = await exportBackup();
      await reset();
      const res = await importBackup(json);
      expect(res.rejected).toEqual([]);
      const after = await norm();
      expect(after).toEqual(before);
      // la riesportazione contiene le stesse entità (cambiano solo exportedAt e le righe di audit del ripristino)
      const again = parseBackup(await exportBackup());
      expect(again.documents.map((d) => d.id).sort()).toEqual(before.docs.map((d) => d.id));
      // i registri di audit originali sono tutti presenti (append-only)
      const original = parseBackup(json).audit.map((a) => a.id);
      const ids = new Set(again.audit.map((a) => a.id));
      for (const id of original) expect(ids.has(id), id).toBe(true);
    });
  }

  it('ripristinare due volte lo stesso file è idempotente', async () => {
    await populate(21);
    const json = await exportBackup();
    await importBackup(json);
    const once = await norm();
    await importBackup(json);
    expect(await norm()).toEqual(once);
  });

  it('un backup più vecchio non fa scendere i contatori né riusa numeri già emessi', async () => {
    await populate(31);
    const oldJson = await exportBackup();
    const oldCounters = (await getProfile()).invoiceYearCounters ?? {};
    // dopo il backup si emettono altre fatture
    for (let i = 0; i < 3; i++) { await saveDocument(draftData(`dopo${i}`, '2026-12-20')); await issueInvoice(`dopo${i}`); }
    const newer = (await getProfile()).invoiceYearCounters ?? {};
    await importBackup(oldJson);
    const restored = (await getProfile()).invoiceYearCounters ?? {};
    for (const [k, v] of Object.entries(newer)) expect(restored[k] ?? 0, k).toBeGreaterThanOrEqual(v);
    for (const [k, v] of Object.entries(oldCounters)) expect(restored[k] ?? 0, k).toBeGreaterThanOrEqual(v);
    // la prossima emissione non riusa un numero già assegnato
    await saveDocument(draftData('dopo-ripristino', '2026-12-20'));
    const nxt = await issueInvoice('dopo-ripristino');
    expect(nxt.invoice!.seq).toBe((newer['FT-2026'] ?? 0) + 1);
  });
});
