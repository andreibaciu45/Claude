/**
 * Livello di persistenza: IndexedDB (idb) con fallback in memoria.
 * Tutta la logica "di dominio" passa da `transact`: UNA transazione su profile+catalog+documents+audit.
 * Schema v2: nuovo store `audit` (append-only) + indici su `documents`; migrazione dei documenti v1.
 * Schema v3: nuovo store `customers` (rubrica clienti, solo locale), popolato UNA volta dai clienti dei documenti.
 */
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { AuditEntry, CatalogItem, InvoiceFiscal, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { seedCustomersFromDocuments } from './customerModel';

export const DB_NAME = 'vocepreventivo';
export const DB_VERSION = 3;
export const PROFILE_KEY = 'main';

export type StoreName = 'catalog' | 'documents' | 'audit' | 'customers';

export const defaultProfile = (): Profile => ({
  businessName: '',
  ownerName: '',
  vatNumber: '',
  fiscalCode: '',
  address: '',
  zip: '',
  city: '',
  province: '',
  phone: '',
  email: '',
  pec: '',
  iban: '',
  artigianiNumber: '',
  logoDataUrl: undefined,
  regimeForfettario: false,
  defaultVat: 22,
  quotePrefix: 'PRev-',
  invoicePrefix: 'FT-',
  nextQuoteNumber: 1,
  // LEGACY: usato solo per le bozze "di cortesia" v1; le fatture fiscali usano invoiceYearCounters.
  nextInvoiceNumber: 1,
  quoteValidityDays: 30,
  paymentTerms: 'Bonifico bancario a 30 giorni data fattura',
  footerNotes: '',
  // v2
  regimeFiscale: 'RF19',
  invoiceYearCounters: {},
  nextProgressivoInvio: 1,
  stampDutyDefaultChargedToCustomer: false,
});

/** Profilo completo: default per ogni campo mancante (anche quelli v2) o `undefined`. */
export const withDefaults = (p: Partial<Profile> | undefined): Profile => {
  const clean: Partial<Profile> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
  const out = { ...defaultProfile(), ...clean };
  out.invoiceYearCounters = { ...(out.invoiceYearCounters ?? {}) };
  return out;
};

// ---------------------------------------------------------------- transazione

/** Operazioni disponibili dentro una transazione. Tutte le promise sono promise IndexedDB (la tx resta viva). */
export interface Tx {
  getProfile(): Promise<Partial<Profile> | undefined>;
  putProfile(p: Profile): Promise<void>;
  get<T>(s: StoreName, id: string): Promise<T | undefined>;
  all<T>(s: StoreName): Promise<T[]>;
  put<T extends { id: string }>(s: StoreName, v: T): Promise<void>;
  /** Solo inserimento: fallisce se la chiave esiste (usato per l'audit append-only). */
  add<T extends { id: string }>(s: StoreName, v: T): Promise<void>;
  del(s: StoreName, id: string): Promise<void>;
  clear(s: StoreName): Promise<void>;
}

export interface Backend {
  transact<R>(mode: 'readonly' | 'readwrite', fn: (t: Tx) => Promise<R>): Promise<R>;
}

/** Errore lanciato dalla funzione passata a `transact`: va rilanciato così com'è, senza ripiegare sulla memoria. */
class TxFnError extends Error {
  constructor(readonly original: unknown) { super('tx-fn-error'); }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const numberKey = (d: { invoice?: Partial<InvoiceFiscal> }): string | null => {
  const i = d.invoice;
  return i && i.seq !== undefined && i.sectional && i.year !== undefined ? `${i.sectional}|${i.year}|${i.seq}` : null;
};

function memoryBackend(): Backend {
  let profile: Partial<Profile> | undefined;
  let stores: Record<StoreName, Map<string, unknown>> = { catalog: new Map(), documents: new Map(), audit: new Map(), customers: new Map() };
  let chain: Promise<unknown> = Promise.resolve();
  return {
    transact<R>(mode: 'readonly' | 'readwrite', fn: (t: Tx) => Promise<R>): Promise<R> {
      const run = chain.then(async () => {
        // copia di lavoro: si committa solo se `fn` termina senza errori (rollback = scartare la copia)
        let wp = profile && clone(profile);
        const ws: Record<StoreName, Map<string, unknown>> = {
          catalog: new Map(stores.catalog), documents: new Map(stores.documents), audit: new Map(stores.audit), customers: new Map(stores.customers),
        };
        const t: Tx = {
          async getProfile() { return wp && clone(wp); },
          async putProfile(p) { wp = clone(p); },
          async get<T>(s: StoreName, id: string) { const v = ws[s].get(id); return v === undefined ? undefined : (clone(v) as T); },
          async all<T>(s: StoreName) { return [...ws[s].values()].map((v) => clone(v) as T); },
          async put<T extends { id: string }>(s: StoreName, v: T) {
            if (s === 'documents') checkUnique(ws.documents, v as unknown as QuoteDocument);
            ws[s].set(v.id, clone(v));
          },
          async add<T extends { id: string }>(s: StoreName, v: T) {
            if (ws[s].has(v.id)) throw new Error(`ConstraintError: chiave duplicata in ${s}`);
            ws[s].set(v.id, clone(v));
          },
          async del(s, id) { ws[s].delete(id); },
          async clear(s) { ws[s].clear(); },
        };
        const r = await fn(t);
        if (mode === 'readwrite') { profile = wp; stores = ws; }
        return r;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

function checkUnique(m: Map<string, unknown>, d: QuoteDocument): void {
  const k = numberKey(d);
  if (!k) return;
  for (const o of m.values()) {
    const x = o as QuoteDocument;
    if (x.id !== d.id && numberKey(x) === k) throw new Error('ConstraintError: numero fattura duplicato per sezionale/anno');
  }
}

// ---------------------------------------------------------------- migrazione v1 -> v2

/** Mappa uno stato v1 di un preventivo ('pagato' non ha senso: era "accettato e chiuso"). */
const v1QuoteStatus = (s: string): QuoteDocument['status'] =>
  s === 'pagato' ? 'accettato' : (s as QuoteDocument['status']);

let auditSeq = 0;
/** Id ordinabile cronologicamente (timestamp + contatore + casuale). */
export const newAuditId = (at: number = Date.now()): string =>
  `${at.toString(36).padStart(9, '0')}-${(auditSeq++ % 1679616).toString(36).padStart(4, '0')}-${uid().slice(0, 8)}`;

/**
 * Migra UN documento v1. Le 'fattura' v1 erano PDF di cortesia: diventano `invoice.legacy = true`
 * (nessun numero fiscale, bozza modificabile/eliminabile). Lo stato 'pagato' passa in `invoice.paymentStatus='pagata'`;
 * lo stato originale è conservato nel testo dell'audit (nessuna perdita di informazione).
 * Ritorna null se il documento è già v2 (non serve modifica).
 */
export function migrateDocumentV1(d: QuoteDocument): { doc: QuoteDocument; audit?: AuditEntry } | null {
  if (d.type === 'preventivo') {
    if ((d.status as string) !== 'pagato') return null;
    return { doc: { ...d, status: v1QuoteStatus(d.status) } };
  }
  if (d.invoice) return null;
  const orig = String(d.status);
  const year = Number(String(d.date).slice(0, 4)) || new Date().getFullYear();
  const invoice: InvoiceFiscal = {
    tipoDocumento: 'TD01',
    year,
    sectional: 'FT',
    operationDate: d.date,
    stampDuty: false,
    stampDutyChargedToCustomer: false,
    stampAmount: 0,
    customerChannel: 'consumatore',
    sdiEvents: [],
    paymentStatus: orig === 'pagato' ? 'pagata' : 'non_pagata',
    payments: [],
    legacy: true,
  };
  const at = Date.now();
  return {
    doc: { ...d, status: 'bozza', invoice },
    audit: {
      id: newAuditId(at), at, docId: d.id, action: 'edit', actor: 'user',
      detail: `Migrazione v1->v2: fattura di cortesia ${d.number} marcata come NON fiscale (legacy). Stato originale: "${orig}".`,
    },
  };
}

type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>;

async function upgrade(db: IDBPDatabase, oldVersion: number, tx: UpgradeTx): Promise<void> {
  if (oldVersion < 1) {
    db.createObjectStore('profile');
    db.createObjectStore('catalog', { keyPath: 'id' });
    db.createObjectStore('documents', { keyPath: 'id' });
  }
  if (oldVersion < 2) {
    const audit = db.createObjectStore('audit', { keyPath: 'id' });
    audit.createIndex('byDoc', 'docId');
    audit.createIndex('byAt', 'at');
    const docs = tx.objectStore('documents');
    docs.createIndex('byType', 'type');
    docs.createIndex('byStatus', 'status');
    docs.createIndex('byDate', 'date');
    docs.createIndex('byTypeStatusDate', ['type', 'status', 'date']);
    // UNIQUE: stesso sezionale+anno+seq non può comparire due volte (i documenti senza seq non vengono indicizzati)
    docs.createIndex('byInvoiceNumber', ['invoice.sectional', 'invoice.year', 'invoice.seq'], { unique: true });
    if (oldVersion >= 1) {
      let cur = await docs.openCursor();
      while (cur) {
        const m = migrateDocumentV1(cur.value as QuoteDocument);
        if (m) {
          await cur.update(m.doc);
          if (m.audit) await audit.add(m.audit);
        }
        cur = await cur.continue();
      }
    }
  }
  if (oldVersion < 3) {
    db.createObjectStore('customers', { keyPath: 'id' });
    // Popolamento iniziale (una tantum, per costruzione: l'upgrade a v3 avviene una sola volta) dai clienti dei documenti.
    // Nessun documento viene toccato. Una nuova installazione (oldVersion 0) parte con la rubrica vuota.
    if (oldVersion >= 1) {
      const docs = (await tx.objectStore('documents').getAll()) as QuoteDocument[];
      const customers = tx.objectStore('customers');
      for (const c of seedCustomersFromDocuments(docs, [])) await customers.put(c);
    }
  }
}

// ---------------------------------------------------------------- idb

const ALL_STORES = ['profile', 'catalog', 'documents', 'audit', 'customers'] as const;

function idbBackend(dbp: Promise<IDBPDatabase>): Backend {
  return {
    async transact<R>(mode: 'readonly' | 'readwrite', fn: (t: Tx) => Promise<R>): Promise<R> {
      const db = await dbp;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx: any = db.transaction([...ALL_STORES], mode);
      const t: Tx = {
        async getProfile() { return (await tx.objectStore('profile').get(PROFILE_KEY)) as Partial<Profile> | undefined; },
        async putProfile(p: Profile) { await tx.objectStore('profile').put(p, PROFILE_KEY); },
        async get<T>(s: StoreName, id: string) { return (await tx.objectStore(s).get(id)) as T | undefined; },
        async all<T>(s: StoreName) { return (await tx.objectStore(s).getAll()) as T[]; },
        async put<T extends { id: string }>(s: StoreName, v: T) { await tx.objectStore(s).put(v); },
        async add<T extends { id: string }>(s: StoreName, v: T) { await tx.objectStore(s).add(v); },
        async del(s, id) { await tx.objectStore(s).delete(id); },
        async clear(s) { await tx.objectStore(s).clear(); },
      };
      let r: R;
      try {
        r = await fn(t);
      } catch (e) {
        try { tx.abort(); } catch { /* già conclusa */ }
        await tx.done.catch(() => undefined);
        throw new TxFnError(e);
      }
      await tx.done;
      // Avvisa chi osserva (es. src/sync) che i dati locali sono cambiati: sync con debounce senza polling.
      if (mode === 'readwrite' && typeof window !== 'undefined') {
        try { window.dispatchEvent(new Event('vp:storage-changed')); } catch { /* ambiente senza eventi */ }
      }
      return r;
    },
  };
}

let backend: Backend | null = null;
let openDbp: Promise<IDBPDatabase> | null = null;

export function getBackend(): Backend {
  if (backend) return backend;
  if (typeof indexedDB === 'undefined') {
    console.warn('[storage] IndexedDB non disponibile: uso la memoria, i dati andranno persi alla chiusura.');
    return (backend = memoryBackend());
  }
  const dbp = openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) { await upgrade(db, oldVersion, tx as unknown as UpgradeTx); },
  });
  openDbp = dbp;
  // se l'apertura fallisce (es. navigazione privata di alcuni browser) ripiega su memoria
  const fallback = memoryBackend();
  let broken = false;
  dbp.catch((e) => { broken = true; console.warn('[storage] apertura IndexedDB fallita, uso la memoria:', e); });
  const real = idbBackend(dbp);
  return (backend = {
    async transact<R>(mode: 'readonly' | 'readwrite', fn: (t: Tx) => Promise<R>): Promise<R> {
      if (broken) return fallback.transact(mode, fn);
      try {
        return await real.transact(mode, fn);
      } catch (e) {
        if (e instanceof TxFnError) throw e.original; // errore di dominio: nessun fallback
        if (!broken) { broken = true; console.warn('[storage] errore IndexedDB, uso la memoria:', e); }
        return fallback.transact(mode, fn);
      }
    },
  });
}

/** Solo per i test: azzera la connessione memorizzata. */
export async function __resetStorageForTests(): Promise<void> {
  try { (await openDbp)?.close(); } catch { /* ignore */ }
  openDbp = null;
  backend = null;
}
