/**
 * Livello di persistenza: IndexedDB (idb). Il ripiego in memoria è ammesso SOLO se IndexedDB non è mai stato apribile
 * (assente o apertura iniziale fallita): dopo un'apertura riuscita ogni errore viene rilanciato (`StorageUnavailableError`),
 * lo stato è osservabile in ./health e la connessione si riapre da sola con backoff. Vedi REV-DB1.
 * Tutta la logica "di dominio" passa da `transact`: UNA transazione su profile+catalog+documents+audit.
 * Schema v2: nuovo store `audit` (append-only) + indici su `documents`; migrazione dei documenti v1.
 * Schema v3: nuovo store `customers` (rubrica clienti, solo locale), popolato UNA volta dai clienti dei documenti.
 */
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { AuditEntry, CatalogItem, InvoiceFiscal, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { seedCustomersFromDocuments, type StoredCustomer } from './customerModel';
import { isFiscalRecord, planRecovery, snapshotSize, type MemorySnapshot } from './memoryRecovery';
import { LOW_SPACE_BYTES, StorageUnavailableError, __patchStorageState, __resetStorageHealthForTests, getStorageStatus, type StorageReason } from './health';
export { StorageUnavailableError } from './health';

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

const errName = (e: unknown): string => (typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '');

/** Classifica un errore IndexedDB NON di dominio (null = errore di dominio, da rilanciare così com'è: es. ConstraintError). */
export function classifyStorageError(e: unknown): StorageReason | null {
  if (e instanceof StorageUnavailableError) return e.reason;
  switch (errName(e)) {
    case 'QuotaExceededError': return 'quota';
    case 'InvalidStateError': return 'connection-closed';
    case 'VersionError': return 'version-change';
    case 'AbortError': case 'TransactionInactiveError': return 'aborted';
    case 'UnknownError': case 'NotFoundError': case 'DataError': return 'unknown';
    default: return null;
  }
}

const isLostReason = (r: StorageReason): boolean => r === 'connection-closed' || r === 'version-change' || r === 'blocked';

let backend: Backend | null = null;
let db: IDBPDatabase | null = null;
let connected = false;
let everOpened = false;
let memoryActive = false;
let initialOpen: Promise<IDBPDatabase | null> | null = null;
let initialPending = false;
let reopening: Promise<IDBPDatabase> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let persistAsked = false;
let lastEstimateAt = 0;
let visibilityHooked = false;
let memory: Backend | null = null;

/** Attese del backoff di riapertura (ms): 0,5 s, 1 s, 2 s ... fino a 30 s. Modificabile solo dai test. */
let backoffBase = 500;
export const __setBackoffForTests = (ms: number): void => { backoffBase = ms; };

function openConnection(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(d, oldVersion, _newVersion, tx) { await upgrade(d, oldVersion, tx as unknown as UpgradeTx); },
    // un'altra scheda vuole aggiornare/eliminare il database: chiudiamo la nostra connessione (altrimenti resta bloccata) e riapriamo dopo
    blocking() { markLost('version-change'); },
    blocked() { __patchStorageState({ lostReason: 'blocked', persistent: false, retrying: true }); },
    terminated() { markLost('connection-closed'); },
  });
}

function onOpened(nd: IDBPDatabase): void {
  // REV2-DB1: mai lasciare aperta una connessione sostituita (due aperture in parallelo): resterebbe orfana e un futuro
  // aggiornamento/eliminazione del database da un'altra scheda resterebbe bloccato per sempre (`blocking` chiude solo `db`).
  if (db && db !== nd) { try { db.close(); } catch { /* già chiusa */ } }
  db = nd;
  connected = true;
  everOpened = true;
  memoryActive = false;
  attempts = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  __patchStorageState({ persistent: true, memoryOnly: false, retrying: false, lostReason: undefined, writeFailure: undefined });
  void requestPersistence();
  void refreshSpace(true);
  // REV2-A1: l'archivio era stato inutilizzabile e l'app ha lavorato in memoria: ora si trasferisce quel lavoro nell'archivio vero
  if (memory) void recoverMemoryData();
}

const readSnapshot = (t: Tx): Promise<MemorySnapshot> =>
  Promise.all([t.all<CatalogItem>('catalog'), t.all<StoredCustomer>('customers'), t.all<QuoteDocument>('documents'), t.all<AuditEntry>('audit')])
    .then(([catalog, customers, documents, audit]) => ({ catalog, customers, documents, audit }));

/** Contenuto attuale dell'archivio in memoria (null = nessun ripiego in memoria avvenuto). Serve al backup di emergenza. */
export async function readMemorySnapshot(): Promise<MemorySnapshot | null> {
  if (!memory) return null;
  return memory.transact('readonly', readSnapshot);
}

let recovering: Promise<boolean> | null = null;

/**
 * Trasferisce nell'archivio persistente i dati NON fiscali scritti in memoria (preventivi, bozze, rubrica, listino): id preservati,
 * nessuna sovrascrittura (in caso di conflitto restano entrambi), fatture emesse MAI trasferite. Un'unica transazione: o tutto o niente.
 * Solo a trasferimento riuscito la memoria viene svuotata; se fallisce resta intatta e lo stato avvisa (e il backup di emergenza la include).
 */
export function recoverMemoryData(): Promise<boolean> {
  if (recovering) return recovering;
  const m = memory;
  if (!m) return Promise.resolve(true);
  const run = (async (): Promise<boolean> => {
    let total = 1;
    try {
      const snap = await m.transact('readonly', readSnapshot);
      total = Math.max(1, snapshotSize({ ...snap, documents: snap.documents.filter((d) => !isFiscalRecord(d)) }));
      if (snapshotSize(snap) === 0) return true;
      const plan = await persistentTransact('readwrite', async (t) => {
        const pl = planRecovery(snap, await readSnapshot(t));
        for (const x of pl.documents) await t.put('documents', x);
        for (const x of pl.customers) await t.put('customers', x);
        for (const x of pl.catalog) await t.put('catalog', x);
        for (const x of pl.audit) await t.put('audit', x);
        return pl;
      });
      await m.transact('readwrite', async (t) => {
        for (const id of plan.taken.documents) await t.del('documents', id);
        for (const id of plan.taken.customers) await t.del('customers', id);
        for (const id of plan.taken.catalog) await t.del('catalog', id);
        for (const id of plan.taken.audit) await t.del('audit', id);
      });
      if (plan.itemCount > 0) __patchStorageState({ recovery: { kind: 'recovered', documents: plan.documentCount, items: plan.itemCount } });
      else if (getStorageStatus().reason === 'recovery-failed') __patchStorageState({ recovery: undefined });
      return true;
    } catch (e) {
      console.warn('[storage] trasferimento dei dati creati in memoria fallito (restano in memoria):', e);
      __patchStorageState({ recovery: { kind: 'failed', documents: 0, items: total } });
      return false;
    }
  })();
  recovering = run;
  const clear = (): void => { if (recovering === run) recovering = null; };
  run.then(clear, clear);
  return run;
}

/** Chiude l'avviso informativo sul recupero (l'utente lo ha letto). Non tocca un recupero fallito. */
export function dismissStorageNotice(): void {
  if (getStorageStatus().reason === 'memory-recovered') __patchStorageState({ recovery: undefined });
}

/** Connessione persa dopo un'apertura riuscita: niente memoria, si riapre con backoff. */
function markLost(reason: StorageReason): void {
  if (connected) {
    connected = false;
    try { db?.close(); } catch { /* già chiusa */ }
  }
  __patchStorageState({ persistent: false, lostReason: reason, writeFailure: undefined, retrying: true });
  scheduleReopen();
}

function scheduleReopen(): void {
  if (timer || typeof setTimeout === 'undefined') return;
  const delay = Math.min(30_000, backoffBase * 2 ** attempts);
  attempts++;
  timer = setTimeout(() => { timer = null; void reopenNow().catch(() => undefined); }, delay);
}

function reopenNow(): Promise<IDBPDatabase> {
  if (reopening) return reopening;
  if (timer) { clearTimeout(timer); timer = null; }
  if (typeof indexedDB === 'undefined') return Promise.reject(new StorageUnavailableError('no-indexeddb'));
  // REV2-DB1: l'apertura iniziale è ancora in corso (es. bloccata da un'altra scheda alla versione precedente): si attende
  // quella, senza lanciarne una seconda in parallelo.
  if (initialPending && initialOpen) {
    return initialOpen.then((d) => d ?? Promise.reject(new StorageUnavailableError('open-failed')));
  }
  __patchStorageState({ retrying: true });
  const attempt = (async () => {
    await Promise.resolve(); // mai sincrona: `reopening` è assegnato prima di poter essere azzerato
    try {
      const nd = await openConnection();
      onOpened(nd);
      return nd;
    } catch (e) {
      console.warn('[storage] riapertura dell\'archivio fallita:', e);
      const r = classifyStorageError(e) ?? 'open-failed';
      __patchStorageState({ persistent: false, lostReason: everOpened ? (isLostReason(r) ? r : 'connection-closed') : 'open-failed', retrying: true });
      scheduleReopen();
      throw new StorageUnavailableError(everOpened ? r : 'open-failed', undefined, e);
    }
  })();
  reopening = attempt;
  const clear = (): void => { if (reopening === attempt) reopening = null; };
  attempt.then(clear, clear);
  return attempt;
}

async function requestPersistence(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) return;
    const already = s.persisted ? await s.persisted() : false;
    __patchStorageState({ persisted: already || (await s.persist()) });
  } catch { /* non supportato */ }
}

/** Avvisa quando lo spazio libero è basso (< 50 MB). Al massimo una stima al minuto (salvo `force`). */
async function refreshSpace(force = false): Promise<void> {
  try {
    const now = Date.now();
    if (!force && now - lastEstimateAt < 60_000) return;
    lastEstimateAt = now;
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.estimate) return;
    const { quota, usage } = await s.estimate();
    if (typeof quota !== 'number' || typeof usage !== 'number') return;
    const free = Math.max(0, quota - usage);
    __patchStorageState({ freeBytes: free, lowSpace: free < LOW_SPACE_BYTES });
  } catch { /* non supportato */ }
}

/** Il primo accesso: se l'apertura iniziale fallisce si ripiega sulla memoria (null), MAI più dopo un'apertura riuscita. */
async function acquire(): Promise<IDBPDatabase | null> {
  if (db && connected) return db;
  if (initialOpen) { await initialOpen; if (db && connected) return db; }
  if (!everOpened) return null; // mai aperto: memoria
  return reopenNow();
}

function memoryBackendInstance(): Backend { return (memory ??= memoryBackend()); }

function toStorageError(e: unknown, fallback: StorageReason = 'unknown'): StorageUnavailableError {
  if (e instanceof StorageUnavailableError) return e;
  return new StorageUnavailableError(classifyStorageError(e) ?? fallback, undefined, e);
}

/** Registra il fallimento di un'operazione su archivio persistente aperto e lo rilancia come StorageUnavailableError. */
function failPersistent(e: unknown): never {
  const err = toStorageError(e);
  if (isLostReason(err.reason)) markLost(err.reason);
  else __patchStorageState({ writeFailure: err.reason });
  console.warn('[storage] errore IndexedDB (nessun ripiego in memoria):', e);
  throw err;
}

function persistentTransact<R>(mode: 'readonly' | 'readwrite', fn: (t: Tx) => Promise<R>): Promise<R> {
  const run = async (): Promise<R> => {
    for (let attempt = 0; ; attempt++) {
      let d: IDBPDatabase | null;
      try { d = await acquire(); } catch (e) { throw toStorageError(e, 'connection-closed'); }
      if (!d) return memoryBackendInstance().transact(mode, fn);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tx: any;
      try { tx = d.transaction([...ALL_STORES], mode); } catch (e) {
        // connessione chiusa prima ancora di iniziare: nessuna scrittura avvenuta, si può riaprire e riprovare UNA volta
        if (classifyStorageError(e) === 'connection-closed' && attempt === 0) { markLost('connection-closed'); continue; }
        failPersistent(e);
      }
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
        if (classifyStorageError(e) === null) throw e; // errore di dominio (anche ConstraintError): nessun ripiego
        failPersistent(e);
      }
      try { await tx.done; } catch (e) { failPersistent(classifyStorageError(e) ? e : new StorageUnavailableError('aborted', undefined, e)); }
      if (mode === 'readwrite') {
        if (getStorageStatus().health === 'degraded' && getStorageStatus().reason !== 'low-space') __patchStorageState({ writeFailure: undefined });
        void refreshSpace();
        // Avvisa chi osserva (es. src/sync) che i dati locali sono cambiati: sync con debounce senza polling.
        if (typeof window !== 'undefined') {
          try { window.dispatchEvent(new Event('vp:storage-changed')); } catch { /* ambiente senza eventi */ }
        }
      }
      return r;
    }
  };
  return run();
}

export function getBackend(): Backend {
  if (backend) return backend;
  if (typeof indexedDB === 'undefined') {
    console.warn('[storage] IndexedDB non disponibile: uso la memoria, i dati andranno persi alla chiusura.');
    memoryActive = true;
    __patchStorageState({ persistent: false, memoryOnly: true, lostReason: 'no-indexeddb', retrying: false });
  } else {
    initialPending = true;
    initialOpen = openConnection().then(
      (nd) => { initialPending = false; onOpened(nd); return nd; },
      (e) => {
        initialPending = false;
        // ripiego ammesso SOLO qui: l'archivio persistente non è mai stato aperto (es. navigazione privata di alcuni browser)
        console.warn('[storage] apertura IndexedDB fallita, uso la memoria (dati non salvati):', e);
        memoryActive = true;
        __patchStorageState({ persistent: false, memoryOnly: true, lostReason: 'open-failed', retrying: true });
        scheduleReopen();
        return null;
      },
    );
    if (!visibilityHooked && typeof document !== 'undefined') {
      visibilityHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !getStorageStatus().persistent && typeof indexedDB !== 'undefined') void reopenNow().catch(() => undefined);
      });
    }
  }
  return (backend = { transact: persistentTransact });
}

/** Avvia l'apertura dell'archivio (se non già avviata): serve al banner, che deve conoscere lo stato anche prima del primo accesso ai dati. */
export function ensureStorageStarted(): void { getBackend(); }

/**
 * "Riprova": riapre subito l'archivio. Dopo un'apertura iniziale fallita passa dalla memoria all'archivio persistente
 * (i dati non fiscali scritti in memoria nel frattempo vengono trasferiti nell'archivio, vedi `recoverMemoryData`).
 */
export async function retryStorage(): Promise<boolean> {
  getBackend();
  if (typeof indexedDB === 'undefined') return false;
  if (initialOpen) await initialOpen;
  if (getStorageStatus().persistent && connected) {
    void refreshSpace(true);
    dismissStorageNotice();
    if (getStorageStatus().reason === 'recovery-failed') return recoverMemoryData();
    return true;
  }
  try { await reopenNow(); return true; } catch { return false; }
}

/**
 * Da chiamare PRIMA di ogni scrittura fiscale (emissione, nota di credito, contatore, esito SDI, incasso):
 * se l'archivio non è persistente lancia `StorageUnavailableError` invece di scrivere in memoria. Se la connessione era stata
 * persa prova a riaprirla subito.
 */
export async function requirePersistentStorage(action = 'questa operazione'): Promise<void> {
  getBackend();
  if (initialOpen) {
    // REV2-DB2: apertura bloccata da un'altra scheda (migrazione v3 con una scheda ancora alla v2): NON restare in attesa. Un'emissione
    // messa in coda così partirebbe da sola, magari minuti dopo, quando l'utente ha già rinunciato o riprovato (doppio tentativo).
    if (initialPending && getStorageStatus().reason === 'blocked') {
      throw new StorageUnavailableError('blocked', `Impossibile ${action}: ${getStorageStatus().message} Non è stato scritto nulla.`);
    }
    await initialOpen;
  }
  if (connected && db) return;
  if (everOpened && typeof indexedDB !== 'undefined') {
    try { await reopenNow(); return; } catch { /* sotto */ }
  }
  const st = getStorageStatus();
  const reason: StorageReason = st.reason && st.reason !== 'low-space' ? st.reason : memoryActive ? 'open-failed' : 'connection-closed';
  throw new StorageUnavailableError(reason, `Impossibile ${action}: ${st.message} Non è stato scritto nulla.`);
}

/** Solo per i test: azzera la connessione memorizzata. */
export async function __resetStorageForTests(): Promise<void> {
  try { (await initialOpen)?.close(); } catch { /* ignore */ }
  try { db?.close(); } catch { /* ignore */ }
  if (timer) { clearTimeout(timer); timer = null; }
  initialOpen = null; initialPending = false; reopening = null; db = null; connected = false; everOpened = false; memoryActive = false;
  attempts = 0; persistAsked = false; lastEstimateAt = 0; memory = null; recovering = null; backend = null; backoffBase = 500;
  __resetStorageHealthForTests();
}
