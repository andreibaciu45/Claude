// Revisione di secondo giro (docs/CODE-REVIEW-2.md): test di regressione per db.ts / migrazione v3 / backup / rubrica.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { __resetStorageForTests, getStorageStatus, listCustomers, listDocuments } from './index';
import { DB_NAME } from './db';
import { draftData } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Crea un database alla versione 2 (schema v2 reale) con alcuni documenti e lascia aperta la connessione, come farebbe una scheda col codice vecchio. */
async function openV2WithData() {
  const db = await openDB(DB_NAME, 2, {
    upgrade(d) {
      d.createObjectStore('profile');
      d.createObjectStore('catalog', { keyPath: 'id' });
      const docs = d.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('byType', 'type'); docs.createIndex('byStatus', 'status'); docs.createIndex('byDate', 'date');
      docs.createIndex('byTypeStatusDate', ['type', 'status', 'date']);
      docs.createIndex('byInvoiceNumber', ['invoice.sectional', 'invoice.year', 'invoice.seq'], { unique: true });
      const a = d.createObjectStore('audit', { keyPath: 'id' });
      a.createIndex('byDoc', 'docId'); a.createIndex('byAt', 'at');
    },
  });
  await db.put('documents', draftData('q1', '2026-03-10'));
  await db.put('documents', draftData('q2', '2026-03-11', undefined, { customer: { id: 'x', name: 'Verdi Spa', vatNumber: '02345678904' } }));
  return db;
}

beforeEach(async () => { await __resetStorageForTests(); await deleteDB(DB_NAME); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('migrazione v3 con una seconda scheda ancora alla v2', () => {
  it('l\'apertura resta in attesa (stato "blocked"), nulla si perde e la migrazione parte appena l\'altra scheda chiude', async () => {
    const old = await openV2WithData();
    const p = listDocuments();
    await sleep(60);
    expect(getStorageStatus().reason).toBe('blocked');
    old.close();
    const docs = await p;
    expect(docs.map((d) => d.id).sort()).toEqual(['q1', 'q2']);
    expect((await listCustomers()).length).toBeGreaterThan(0);
    expect(getStorageStatus().health).toBe('ok');
  });

  it('REV2-DB1: tornando sulla scheda (visibilitychange) durante l\'attesa NON si apre una seconda connessione che resta orfana', async () => {
    const old = await openV2WithData();
    const p = listDocuments();
    await sleep(40);
    // l'utente passa all'altra scheda e torna: il gestore di visibilità tenta una riapertura
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    if (!process.env.NO_VIS) { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); }
    await sleep(20);
    old.close();
    await p;
    await sleep(40);
    // una scheda con codice più nuovo vuole eliminare/aggiornare il database: TUTTE le nostre connessioni devono chiudersi
    let blockedForever = false;
    const done = new Promise<boolean>((res) => {
      const rq = indexedDB.deleteDatabase(DB_NAME);
      rq.onsuccess = () => res(true);
      rq.onerror = () => res(false);
      rq.onblocked = () => { blockedForever = true; };
    });
    const ok = await Promise.race([done, sleep(800).then(() => false)]);
    expect(ok, blockedForever ? 'deleteDatabase bloccato da una connessione orfana' : 'timeout').toBe(true);
  });
});

// ------------------------------------------------------------------ rubrica: proprietà con seme fisso
import { docBelongsTo, normalizeCustomerRecord, sameCustomer, seedCustomersFromDocuments, type StoredCustomer } from './customerModel';
import type { Customer, QuoteDocument } from '../types';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
/** Identità coerenti (come nella realtà: una P.IVA va sempre con lo stesso CF); gli ultimi due sono omonimi senza identificativi. */
const IDENTITIES = [
  { names: ['Rossi Srl', 'ROSSI S.r.l.', 'rossi  srl'], vat: ['02345678904', 'IT02345678904', ' 0234 5678 904 '], cf: ['02345678904'], city: 'Milano' },
  { names: ["D'Angelo Mario", 'Dangelo Mario'], vat: ['01234567897'], cf: ['DNGMRA80A01H501Q'], city: 'Roma' },
  { names: ['Èlite Café Snc'], vat: ['03456789014'], cf: [], city: 'Torino' },
  { names: ['Mario Verdi'], vat: [], cf: ['VRDMRA70A01F205X'], city: 'Napoli' },
  { names: ['Mario Bianchi'], vat: [], cf: [], city: 'Genova' },
  { names: ['Mario Bianchi'], vat: [], cf: [], city: 'Bari' },
];
function randomDocs(r: () => number, n: number): { docs: QuoteDocument[]; who: number[] } {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const who: number[] = [];
  const docs = Array.from({ length: n }, (_, i): QuoteDocument => {
    const w = Math.floor(r() * IDENTITIES.length); who.push(w);
    const id = IDENTITIES[w];
    const c: Customer = { id: `c${Math.floor(r() * 4)}`, name: pick(id.names) };
    if (id.vat.length && r() < 0.6) c.vatNumber = pick(id.vat);
    if (id.cf.length && r() < 0.5) c.fiscalCode = pick(id.cf);
    if (r() < 0.7) c.city = id.city;
    return { id: `d${i}`, type: 'preventivo', number: `P${i}`, date: '2026-01-01', lines: [], status: 'bozza', createdAt: i + 1, updatedAt: i + 1, customer: c };
  });
  return { docs, who };
}
const applyTouched = (book: StoredCustomer[], touched: StoredCustomer[]) => {
  const m = new Map(book.map((c) => [c.id, c]));
  for (const t of touched) m.set(t.id, t);
  return [...m.values()];
};

describe('rubrica: proprietà (seme fisso)', () => {
  it('il popolamento è idempotente, ogni documento ha una scheda e nessuna scheda mescola persone diverse', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(seed);
      const { docs, who } = randomDocs(r, 3 + Math.floor(r() * 14));
      const first = seedCustomersFromDocuments(docs, [], 1000);
      const book = applyTouched([], first);
      expect(seedCustomersFromDocuments(docs, book, 2000), `seed ${seed}: seconda esecuzione senza modifiche`).toEqual([]);
      for (const d of docs) expect(book.some((c) => docBelongsTo(d, c)), `seed ${seed}: documento ${d.id} senza scheda`).toBe(true);
      // nessuna contaminazione: P.IVA e CF di una scheda appartengono a una sola identità
      for (const c of book) {
        const owners = new Set<number>();
        docs.forEach((d, i) => {
          const dc = normalizeCustomerRecord(d.customer);
          if ((c.vatNumber && dc.vatNumber === c.vatNumber) || (c.fiscalCode && dc.fiscalCode === c.fiscalCode)) owners.add(who[i]);
        });
        expect(owners.size, `seed ${seed}: scheda ${c.name} mescola identità ${[...owners]}`).toBeLessThanOrEqual(1);
      }
      // i due omonimi (Mario Bianchi, Genova / Bari) non devono finire nella stessa scheda quando la città li distingue
      const genova = docs.filter((d, i) => who[i] === 4 && d.customer.city);
      const bari = docs.filter((d, i) => who[i] === 5 && d.customer.city);
      if (genova.length && bari.length) {
        const cg = book.find((c) => genova.some((d) => d.customer.city === c.city && docBelongsTo(d, c)));
        expect(book.filter((c) => c.name === 'Mario Bianchi' && c.city === 'Genova').length, `seed ${seed}`).toBeGreaterThan(0);
        expect(cg?.city, `seed ${seed}`).toBe('Genova');
        expect(book.filter((c) => c.name === 'Mario Bianchi' && c.city === 'Bari').length, `seed ${seed}: omonimo di Bari fuso`).toBeGreaterThan(0);
      }
    }
  });

  it('REV2-C1: due omonimi di città diverse non vengono fusi (e i dati dell\'uno non finiscono nell\'altro)', () => {
    const a = { name: 'Mario Rossi', city: 'Milano', phone: '' } as Customer;
    const b = { name: 'Mario Rossi', city: 'Roma', phone: '3331112222' } as Customer;
    expect(sameCustomer(a, b)).toBe(false);
    // stessa città (o città mancante) = stesso cliente come prima
    expect(sameCustomer({ name: 'Mario Rossi', city: 'milano' }, { name: 'mario rossi', city: 'MILANO' })).toBe(true);
    expect(sameCustomer({ name: 'Mario Rossi' }, { name: 'Mario Rossi', city: 'Roma' })).toBe(true);
    // gli identificativi fiscali restano decisivi anche con città diverse (trasloco)
    expect(sameCustomer({ name: 'Mario Rossi', vatNumber: '02345678904', city: 'Milano' }, { name: 'Mario Rossi', vatNumber: '02345678904', city: 'Roma' })).toBe(true);
  });
});
