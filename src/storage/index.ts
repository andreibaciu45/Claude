/**
 * Storage locale (IndexedDB via `idb`) con fallback in memoria se IndexedDB non è disponibile.
 * Firme fisse: vedi docs/ARCHITECTURE.md.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { UNITS } from '../types';
import type { CatalogItem, DocType, ItemKind, Profile, QuoteDocument, Unit } from '../types';

export const BACKUP_VERSION = 1;
const DB_NAME = 'vocepreventivo';
const PROFILE_KEY = 'main';

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
  nextInvoiceNumber: 1,
  quoteValidityDays: 30,
  paymentTerms: 'Bonifico bancario a 30 giorni data fattura',
  footerNotes: '',
});

// ---------------------------------------------------------------- backend

interface Backend {
  getProfile(): Promise<Partial<Profile> | undefined>;
  putProfile(p: Profile): Promise<void>;
  all<T>(store: 'catalog' | 'documents'): Promise<T[]>;
  get<T>(store: 'catalog' | 'documents', id: string): Promise<T | undefined>;
  put(store: 'catalog' | 'documents', v: { id: string }): Promise<void>;
  del(store: 'catalog' | 'documents', id: string): Promise<void>;
  /** Lettura-modifica-scrittura atomica del profilo. */
  updateProfile<R>(fn: (p: Profile) => R): Promise<R>;
  replaceAll(profile: Profile, catalog: CatalogItem[], documents: QuoteDocument[]): Promise<void>;
}

const withDefaults = (p: Partial<Profile> | undefined): Profile => ({ ...defaultProfile(), ...(p ?? {}) });

function memoryBackend(): Backend {
  let profile: Partial<Profile> | undefined;
  const stores = { catalog: new Map<string, unknown>(), documents: new Map<string, unknown>() };
  // coda per serializzare le operazioni read-modify-write
  let chain: Promise<unknown> = Promise.resolve();
  return {
    async getProfile() { return profile && { ...profile }; },
    async putProfile(p) { profile = { ...p }; },
    async all<T>(s: 'catalog' | 'documents') { return [...stores[s].values()].map((v) => structuredCloneSafe(v) as T); },
    async get<T>(s: 'catalog' | 'documents', id: string) { const v = stores[s].get(id); return v === undefined ? undefined : (structuredCloneSafe(v) as T); },
    async put(s, v) { stores[s].set(v.id, structuredCloneSafe(v)); },
    async del(s, id) { stores[s].delete(id); },
    updateProfile<R>(fn: (p: Profile) => R): Promise<R> {
      const run = chain.then(() => {
        const p = withDefaults(profile);
        const r = fn(p);
        profile = p;
        return r;
      });
      chain = run.catch(() => undefined);
      return run;
    },
    async replaceAll(p, c, d) {
      profile = { ...p };
      stores.catalog = new Map(c.map((i) => [i.id, structuredCloneSafe(i)]));
      stores.documents = new Map(d.map((i) => [i.id, structuredCloneSafe(i)]));
    },
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function idbBackend(dbp: Promise<IDBPDatabase>): Backend {
  return {
    async getProfile() { return (await (await dbp).get('profile', PROFILE_KEY)) as Partial<Profile> | undefined; },
    async putProfile(p) { await (await dbp).put('profile', p, PROFILE_KEY); },
    async all<T>(s: 'catalog' | 'documents') { return (await (await dbp).getAll(s)) as T[]; },
    async get<T>(s: 'catalog' | 'documents', id: string) { return (await (await dbp).get(s, id)) as T | undefined; },
    async put(s, v) { await (await dbp).put(s, v); },
    async del(s, id) { await (await dbp).delete(s, id); },
    async updateProfile<R>(fn: (p: Profile) => R): Promise<R> {
      const db = await dbp;
      const tx = db.transaction('profile', 'readwrite');
      const cur = (await tx.store.get(PROFILE_KEY)) as Partial<Profile> | undefined;
      const p = withDefaults(cur);
      const r = fn(p);
      await tx.store.put(p, PROFILE_KEY);
      await tx.done;
      return r;
    },
    async replaceAll(p, c, d) {
      const db = await dbp;
      const tx = db.transaction(['profile', 'catalog', 'documents'], 'readwrite');
      await tx.objectStore('catalog').clear();
      await tx.objectStore('documents').clear();
      await tx.objectStore('profile').put(p, PROFILE_KEY);
      for (const i of c) await tx.objectStore('catalog').put(i);
      for (const i of d) await tx.objectStore('documents').put(i);
      await tx.done;
    },
  };
}

let backend: Backend | null = null;
let openDbp: Promise<IDBPDatabase> | null = null;

function getBackend(): Backend {
  if (backend) return backend;
  if (typeof indexedDB === 'undefined') {
    console.warn('[storage] IndexedDB non disponibile: uso la memoria, i dati andranno persi alla chiusura.');
    return (backend = memoryBackend());
  }
  const dbp = openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
    },
  });
  openDbp = dbp;
  // se l'apertura fallisce (es. navigazione privata di alcuni browser) ripiega su memoria
  const fallback = memoryBackend();
  let broken = false;
  dbp.catch((e) => { broken = true; console.warn('[storage] apertura IndexedDB fallita, uso la memoria:', e); });
  const real = idbBackend(dbp);
  const wrap = <K extends keyof Backend>(k: K): Backend[K] =>
    (async (...args: unknown[]) => {
      if (broken) return (fallback[k] as (...a: unknown[]) => unknown)(...args);
      try {
        return await (real[k] as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        if (!broken) { broken = true; console.warn('[storage] errore IndexedDB, uso la memoria:', e); }
        return (fallback[k] as (...a: unknown[]) => unknown)(...args);
      }
    }) as Backend[K];
  return (backend = {
    getProfile: wrap('getProfile'), putProfile: wrap('putProfile'), all: wrap('all'), get: wrap('get'),
    put: wrap('put'), del: wrap('del'), updateProfile: wrap('updateProfile'), replaceAll: wrap('replaceAll'),
  });
}

/** Solo per i test: azzera la connessione memorizzata. */
export async function __resetStorageForTests(): Promise<void> {
  try { (await openDbp)?.close(); } catch { /* ignore */ }
  openDbp = null;
  backend = null;
}

// ---------------------------------------------------------------- API

export const getProfile = async (): Promise<Profile> => withDefaults(await getBackend().getProfile());

export const saveProfile = async (p: Profile): Promise<void> => { await getBackend().putProfile(withDefaults(p)); };

export const listCatalog = async (): Promise<CatalogItem[]> => {
  const items = await getBackend().all<CatalogItem>('catalog');
  return items.sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
};

export const saveCatalogItem = async (i: CatalogItem): Promise<void> => { await getBackend().put('catalog', i); };

export const deleteCatalogItem = async (id: string): Promise<void> => { await getBackend().del('catalog', id); };

export const listDocuments = async (): Promise<QuoteDocument[]> => {
  const docs = await getBackend().all<QuoteDocument>('documents');
  return docs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
};

export const getDocument = async (id: string): Promise<QuoteDocument | undefined> => getBackend().get<QuoteDocument>('documents', id);

export const saveDocument = async (d: QuoteDocument): Promise<void> => { await getBackend().put('documents', d); };

export const deleteDocument = async (id: string): Promise<void> => { await getBackend().del('documents', id); };

export const nextDocumentNumber = async (type: DocType): Promise<string> =>
  getBackend().updateProfile((p) => {
    const quote = type === 'preventivo';
    const n = Math.max(1, Math.floor(quote ? p.nextQuoteNumber : p.nextInvoiceNumber) || 1);
    if (quote) p.nextQuoteNumber = n + 1; else p.nextInvoiceNumber = n + 1;
    return `${quote ? p.quotePrefix : p.invoicePrefix}${String(n).padStart(4, '0')}`;
  });

// ---------------------------------------------------------------- backup

export async function exportBackup(): Promise<string> {
  const [profile, catalog, documents] = await Promise.all([getProfile(), listCatalog(), listDocuments()]);
  return JSON.stringify({ version: BACKUP_VERSION, exportedAt: new Date().toISOString(), profile, catalog, documents }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS: ItemKind[] = ['materiale', 'manodopera', 'servizio'];

function fail(msg: string): never { throw new Error(`Backup non valido: ${msg}`); }

function checkCatalogItem(v: unknown, idx: number): CatalogItem {
  if (!isObj(v)) fail(`voce di catalogo #${idx + 1} non è un oggetto`);
  if (typeof v.id !== 'string' || !v.id) fail(`voce di catalogo #${idx + 1} senza id`);
  if (typeof v.name !== 'string') fail(`voce di catalogo #${idx + 1} senza nome`);
  if (!isNum(v.price)) fail(`voce "${v.name}" con prezzo non valido`);
  const now = Date.now();
  return {
    id: v.id,
    name: v.name,
    aliases: Array.isArray(v.aliases) ? v.aliases.filter((a): a is string => typeof a === 'string') : [],
    unit: UNITS.includes(v.unit as Unit) ? (v.unit as Unit) : 'pz',
    price: v.price,
    vat: isNum(v.vat) ? v.vat : 22,
    kind: KINDS.includes(v.kind as ItemKind) ? (v.kind as ItemKind) : 'materiale',
    category: typeof v.category === 'string' && v.category ? v.category : undefined,
    stock: isNum(v.stock) ? v.stock : undefined,
    createdAt: isNum(v.createdAt) ? v.createdAt : now,
    updatedAt: isNum(v.updatedAt) ? v.updatedAt : now,
  };
}

function checkDocument(v: unknown, idx: number): QuoteDocument {
  if (!isObj(v)) fail(`documento #${idx + 1} non è un oggetto`);
  if (typeof v.id !== 'string' || !v.id) fail(`documento #${idx + 1} senza id`);
  if (v.type !== 'preventivo' && v.type !== 'fattura') fail(`documento #${idx + 1} con tipo non valido`);
  if (typeof v.number !== 'string') fail(`documento #${idx + 1} senza numero`);
  if (!Array.isArray(v.lines)) fail(`documento ${v.number} senza righe`);
  if (!isObj(v.customer)) fail(`documento ${v.number} senza cliente`);
  return v as unknown as QuoteDocument;
}

export interface ParsedBackup { profile: Profile; catalog: CatalogItem[]; documents: QuoteDocument[]; exportedAt?: string }

/** Valida e normalizza il JSON di un backup; lancia Error con messaggio in italiano. */
export function parseBackup(json: string): ParsedBackup {
  let data: unknown;
  try { data = JSON.parse(json); } catch { fail('il file non è un JSON valido'); }
  if (!isObj(data)) fail('struttura inattesa');
  if (!isNum(data.version)) fail('manca il numero di versione');
  if (data.version > BACKUP_VERSION) fail(`versione ${data.version} più recente di quella supportata (${BACKUP_VERSION})`);
  if (!isObj(data.profile)) fail('manca il profilo');
  if (!Array.isArray(data.catalog)) fail('manca il catalogo');
  if (!Array.isArray(data.documents)) fail('mancano i documenti');
  const catalog = data.catalog.map(checkCatalogItem);
  const documents = data.documents.map(checkDocument);
  const ids = new Set<string>();
  for (const c of catalog) { if (ids.has(c.id)) fail(`id catalogo duplicato (${c.id})`); ids.add(c.id); }
  const dids = new Set<string>();
  for (const d of documents) { if (dids.has(d.id)) fail(`id documento duplicato (${d.id})`); dids.add(d.id); }
  return {
    profile: withDefaults(data.profile as Partial<Profile>),
    catalog,
    documents,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
  };
}

/** Importa un backup in modalità sostituzione: i dati attuali vengono sostituiti. */
export async function importBackup(json: string): Promise<void> {
  const { profile, catalog, documents } = parseBackup(json);
  await getBackend().replaceAll(profile, catalog, documents);
}
export * from './invoices';
