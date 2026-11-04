/**
 * Storage locale (IndexedDB via `idb`, schema v2) con fallback in memoria se IndexedDB non è disponibile.
 * Firme fisse: vedi docs/ARCHITECTURE.md e docs/CONTRACT-V2.md.
 * - persistenza/transazioni/migrazione: ./db
 * - fatturazione (emissione, note di credito, SDI, pagamenti, audit): ./invoices
 */
import { UNITS } from '../types';
import type { AuditEntry, CatalogItem, DocType, ItemKind, Profile, QuoteDocument, Unit } from '../types';
import { __resetStorageForTests, defaultProfile, getBackend, migrateDocumentV1, newAuditId, withDefaults } from './db';
import { ImmutableDocumentError, assertSaveAllowed, __addAudit } from './invoices';

export const BACKUP_VERSION = 2;
export { defaultProfile, __resetStorageForTests };

// ---------------------------------------------------------------- API

export const getProfile = async (): Promise<Profile> =>
  withDefaults(await getBackend().transact('readonly', (t) => t.getProfile()));

const mergeCounters = (...cs: (Record<string, number> | undefined)[]): Record<string, number> => {
  const r: Record<string, number> = {};
  for (const c of cs) for (const [k, v] of Object.entries(c ?? {})) if (Number.isFinite(v)) r[k] = Math.max(r[k] ?? 0, v);
  return r;
};

/**
 * Salva il profilo. I CONTATORI (`invoiceYearCounters`, `nextProgressivoInvio`, `nextQuoteNumber`) non vengono mai
 * sovrascritti con valori più vecchi: dentro la stessa transazione si rilegge il profilo salvato e vince il massimo.
 * (Bug collaudo: un form aperto prima di un'emissione, salvato dopo, faceva tornare indietro i contatori.)
 */
export const saveProfile = async (p: Profile): Promise<void> => {
  await getBackend().transact('readwrite', async (t) => {
    const stored = withDefaults(await t.getProfile());
    const out = withDefaults(p);
    out.nextQuoteNumber = Math.max(out.nextQuoteNumber, stored.nextQuoteNumber);
    out.nextProgressivoInvio = Math.max(out.nextProgressivoInvio ?? 1, stored.nextProgressivoInvio ?? 1);
    out.invoiceYearCounters = mergeCounters(stored.invoiceYearCounters, out.invoiceYearCounters);
    await t.putProfile(out);
  });
};

export const listCatalog = async (): Promise<CatalogItem[]> => {
  const items = await getBackend().transact('readonly', (t) => t.all<CatalogItem>('catalog'));
  return items.sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
};

export const saveCatalogItem = async (i: CatalogItem): Promise<void> => {
  await getBackend().transact('readwrite', (t) => t.put('catalog', i));
};

export const deleteCatalogItem = async (id: string): Promise<void> => {
  await getBackend().transact('readwrite', (t) => t.del('catalog', id));
};

export const listDocuments = async (): Promise<QuoteDocument[]> => {
  const docs = await getBackend().transact('readonly', (t) => t.all<QuoteDocument>('documents'));
  return docs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
};

export const getDocument = async (id: string): Promise<QuoteDocument | undefined> =>
  getBackend().transact('readonly', (t) => t.get<QuoteDocument>('documents', id));

const persistDocument = (d: QuoteDocument, allowLock: boolean): Promise<void> =>
  getBackend().transact('readwrite', async (t) => {
    const existing = await t.get<QuoteDocument>('documents', d.id);
    assertSaveAllowed(existing, d, allowLock);
    await t.put('documents', d);
    if (d.type === 'fattura') {
      if (!existing) {
        await __addAudit(t, { docId: d.id, action: 'create', detail: d.invoice?.legacy ? 'Fattura di cortesia (non fiscale)' : 'Bozza fattura creata' });
      } else if (existing.status !== d.status && existing.invoice?.lockedAt) {
        await __addAudit(t, { docId: d.id, action: 'edit', detail: `Stato: ${existing.status} -> ${d.status}`, xmlSha256: d.invoice?.xmlSha256 });
      }
    }
  });

/**
 * Salva un documento. Lancia `ImmutableDocumentError` se il documento esistente è una fattura emessa (`invoice.lockedAt`),
 * salvo sdiEvents, payments, paymentStatus e le sole transizioni di stato consentite.
 */
export const saveDocument = async (d: QuoteDocument): Promise<void> => persistDocument(d, false);

/**
 * Per il modulo di sync: salva un documento già emesso altrove (arriva con `lockedAt`). Resta valida l'immutabilità
 * di quelli già bloccati in locale: un contenuto fiscale diverso viene rifiutato.
 */
export const saveSyncedDocument = async (d: QuoteDocument): Promise<void> => persistDocument(d, true);

/**
 * Elimina un documento. Preventivi e bozze fattura (e fatture di cortesia legacy) sì; fatture emesse mai
 * (`ImmutableDocumentError`: si stornano con nota di credito). La cancellazione di una bozza fattura è tracciata in audit.
 */
export const deleteDocument = async (id: string): Promise<void> => {
  await getBackend().transact('readwrite', async (t) => {
    const d = await t.get<QuoteDocument>('documents', id);
    if (!d) return;
    if (d.type === 'fattura') {
      const legacy = !!d.invoice?.legacy;
      if (!legacy && (d.invoice?.lockedAt || d.status !== 'bozza')) {
        throw new ImmutableDocumentError('Una fattura emessa non si elimina: per annullarla emetti una nota di credito.');
      }
      await __addAudit(t, {
        docId: id, action: 'delete_draft',
        detail: legacy ? `Eliminata fattura di cortesia ${d.number}` : `Eliminata bozza fattura per ${d.customer?.name ?? '—'}`,
      });
      // la bozza nata da un preventivo: il preventivo torna disponibile
      if (d.convertedFromQuoteId) {
        const q = await t.get<QuoteDocument>('documents', d.convertedFromQuoteId);
        if (q && q.convertedToInvoiceId === id) {
          const { convertedToInvoiceId: _drop, ...rest } = q;
          await t.put('documents', { ...rest, status: q.status === 'convertito' ? 'accettato' : q.status, updatedAt: Date.now() });
        }
      }
    }
    await t.del('documents', id);
  });
};

/**
 * Numeratore NON fiscale: usalo per i PREVENTIVI (la sequenza può avere buchi) e per le bozze "legacy" v1.
 * NON usarlo per le fatture fiscali: il loro numero si assegna solo in `issueInvoice` (contatori per anno e sezionale).
 */
export const nextDocumentNumber = async (type: DocType): Promise<string> =>
  getBackend().transact('readwrite', async (t) => {
    const p = withDefaults(await t.getProfile());
    const quote = type === 'preventivo';
    const n = Math.max(1, Math.floor(quote ? p.nextQuoteNumber : p.nextInvoiceNumber) || 1);
    if (quote) p.nextQuoteNumber = n + 1; else p.nextInvoiceNumber = n + 1;
    await t.putProfile(p);
    return `${quote ? p.quotePrefix : p.invoicePrefix}${String(n).padStart(4, '0')}`;
  });

// ---------------------------------------------------------------- backup

export async function exportBackup(): Promise<string> {
  const { profile, catalog, documents, audit } = await getBackend().transact('readonly', async (t) => ({
    profile: withDefaults(await t.getProfile()),
    catalog: await t.all<CatalogItem>('catalog'),
    documents: await t.all<QuoteDocument>('documents'),
    audit: await t.all<AuditEntry>('audit'),
  }));
  catalog.sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
  documents.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  audit.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return JSON.stringify({ version: BACKUP_VERSION, exportedAt: new Date().toISOString(), profile, catalog, documents, audit }, null, 2);
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

function checkAudit(v: unknown, idx: number): AuditEntry {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.docId !== 'string' || !isNum(v.at) || typeof v.action !== 'string') {
    fail(`voce di audit #${idx + 1} non valida`);
  }
  return v as unknown as AuditEntry;
}

export interface ParsedBackup {
  profile: Profile;
  catalog: CatalogItem[];
  documents: QuoteDocument[];
  audit: AuditEntry[];
  version: number;
  exportedAt?: string;
}

/** Massimo `seq` per chiave `${sezionale}-${anno}` nei documenti fiscali. */
export function maxSeqByKey(docs: QuoteDocument[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const d of docs) {
    const i = d.invoice;
    if (!i || i.legacy || typeof i.seq !== 'number') continue;
    const k = `${i.sectional}-${i.year}`;
    r[k] = Math.max(r[k] ?? 0, i.seq);
  }
  return r;
}

/** Valida e normalizza il JSON di un backup (v1 o v2); lancia Error con messaggio in italiano. */
export function parseBackup(json: string): ParsedBackup {
  let data: unknown;
  try { data = JSON.parse(json); } catch { fail('il file non è un JSON valido'); }
  if (!isObj(data)) fail('struttura inattesa');
  if (!isNum(data.version)) fail('manca il numero di versione');
  if (data.version > BACKUP_VERSION) fail(`versione ${data.version} più recente di quella supportata (${BACKUP_VERSION})`);
  if (!isObj(data.profile)) fail('manca il profilo');
  if (!Array.isArray(data.catalog)) fail('manca il catalogo');
  if (!Array.isArray(data.documents)) fail('mancano i documenti');
  if (data.audit !== undefined && !Array.isArray(data.audit)) fail('registro audit non valido');
  const catalog = data.catalog.map(checkCatalogItem);
  const audit = ((data.audit as unknown[] | undefined) ?? []).map(checkAudit);
  const documents = data.documents.map(checkDocument).map((d) => {
    // documenti v1 (fatture di cortesia, stato 'pagato'): stessa migrazione dell'upgrade IndexedDB
    const m = migrateDocumentV1(d);
    if (!m) return d;
    if (m.audit) audit.push(m.audit);
    return m.doc;
  });
  const ids = new Set<string>();
  for (const c of catalog) { if (ids.has(c.id)) fail(`id catalogo duplicato (${c.id})`); ids.add(c.id); }
  const dids = new Set<string>();
  const nums = new Set<string>();
  for (const d of documents) {
    if (dids.has(d.id)) fail(`id documento duplicato (${d.id})`);
    dids.add(d.id);
    const i = d.invoice;
    if (i && !i.legacy && typeof i.seq === 'number') {
      const k = `${i.sectional}/${i.year}/${i.seq}`;
      if (nums.has(k)) fail(`numero fattura duplicato (${i.number ?? k})`);
      nums.add(k);
    }
  }
  const aids = new Set<string>();
  for (const a of audit) { if (aids.has(a.id)) fail(`id audit duplicato (${a.id})`); aids.add(a.id); }
  return {
    profile: withDefaults(data.profile as Partial<Profile>),
    catalog,
    documents,
    audit,
    version: data.version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
  };
}

/**
 * Importa un backup (v1 o v2) in modalità sostituzione. NON riduce mai i contatori: per ogni chiave vince il massimo tra
 * contatore del backup, massimo `seq` presente nei documenti del backup e contatore attuale del dispositivo.
 * Il registro audit non si cancella: le voci attuali restano e si aggiungono quelle del backup.
 * Ritorna gli avvisi da mostrare all'utente (un backup vecchio può far perdere fatture emesse dopo la sua creazione).
 */
export async function importBackup(json: string): Promise<{ warnings: string[] }> {
  const b = parseBackup(json);
  const warnings: string[] = [];
  await getBackend().transact('readwrite', async (t) => {
    warnings.length = 0; // la funzione può essere rieseguita dal fallback
    const cur = withDefaults(await t.getProfile());
    const curDocs = await t.all<QuoteDocument>('documents');
    const curAudit = await t.all<AuditEntry>('audit');

    const fromDocs = maxSeqByKey(b.documents);
    const backupCounters = mergeCounters(b.profile.invoiceYearCounters);
    const curCounters = mergeCounters(cur.invoiceYearCounters, maxSeqByKey(curDocs));
    const restored = mergeCounters(backupCounters, fromDocs);
    const counters = mergeCounters(restored, curCounters);

    for (const [k, v] of Object.entries(fromDocs)) {
      if ((backupCounters[k] ?? 0) < v) warnings.push(`Il contatore ${k} del backup (${backupCounters[k] ?? 0}) era inferiore ai numeri già presenti nei documenti (${v}): è stato corretto.`);
    }
    const raised = Object.entries(curCounters).filter(([k, v]) => v > (restored[k] ?? 0));
    if (raised.length) {
      warnings.push(`Questo backup è più vecchio dei dati attuali: i contatori delle fatture (${raised.map(([k, v]) => `${k}: ${v}`).join(', ')}) sono stati mantenuti per non riutilizzare numeri già emessi.`);
    }
    const backupIds = new Set(b.documents.map((d) => d.id));
    const lost = curDocs.filter((d) => d.invoice?.lockedAt && !backupIds.has(d.id));
    if (lost.length) {
      const one = lost.length === 1;
      warnings.push(`Attenzione: ${lost.length} fattur${one ? 'a emessa' : 'e emesse'} su questo dispositivo (${lost.map((d) => d.number).join(', ')}) non ${one ? 'è presente' : 'sono presenti'} nel backup e ${one ? 'verrà sostituita' : 'verranno sostituite'}. Ripristinare un backup vecchio può creare buchi o duplicati di numerazione: verifica con il tuo commercialista. Il registro delle operazioni (audit) è stato conservato.`);
    }
    if (b.version < 2 && b.documents.some((d) => d.type === 'fattura')) {
      warnings.push('Backup in formato v1: le fatture contenute sono state marcate "di cortesia" (non fiscali, senza numero fiscale).');
    }

    const profile: Profile = {
      ...b.profile,
      invoiceYearCounters: counters,
      nextProgressivoInvio: Math.max(b.profile.nextProgressivoInvio ?? 1, cur.nextProgressivoInvio ?? 1),
      nextQuoteNumber: Math.max(b.profile.nextQuoteNumber, cur.nextQuoteNumber),
    };
    await t.clear('catalog');
    await t.clear('documents');
    await t.putProfile(profile);
    for (const i of b.catalog) await t.put('catalog', i);
    for (const d of b.documents) await t.put('documents', d);
    // audit: unione per id (append-only, mai cancellato)
    const have = new Set(curAudit.map((a) => a.id));
    for (const a of b.audit) if (!have.has(a.id)) await t.add('audit', a);
    await t.add('audit', {
      id: newAuditId(), at: Date.now(), docId: '-', action: 'edit', actor: 'user',
      detail: `Ripristino backup v${b.version}${b.exportedAt ? ` del ${b.exportedAt}` : ''}: ${b.documents.length} documenti${warnings.length ? ` | Avvisi: ${warnings.join(' ')}` : ''}`,
    } satisfies AuditEntry);
  });
  return { warnings };
}

export * from './invoices';
