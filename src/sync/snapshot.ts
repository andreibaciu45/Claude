/**
 * Rilevamento delle modifiche locali SENZA toccare src/storage: si confronta una fotografia dello stato
 * (profilo, catalogo, documenti, audit) con gli hash dell'ultimo stato sincronizzato.
 * Tutto qui è puro/deterministico e testabile; nessun accesso alla rete.
 */
import type { AuditEntry, CatalogItem, Profile, QuoteDocument } from '../types';
import type { SyncEntity } from '../../shared/api';
import { entityKey, enqueueDelete, enqueueUpsert, listOutbox, removeOps, type SyncedEntry } from './outbox';

/** Sottoinsieme delle funzioni PUBBLICHE di src/storage usate dal sync (iniettabile nei test). */
export interface LocalStore {
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  listCatalog(): Promise<CatalogItem[]>;
  saveCatalogItem(i: CatalogItem): Promise<void>;
  deleteCatalogItem(id: string): Promise<void>;
  listDocuments(): Promise<QuoteDocument[]>;
  saveDocument(d: QuoteDocument): Promise<void>;
  /**
   * Opzionale: salvataggio di un documento che arriva dal server (può essere una fattura già emessa, `lockedAt`, su un altro
   * dispositivo). Lo storage espone `saveSyncedDocument` proprio per questo: `saveDocument` rifiuta di creare fatture bloccate.
   */
  saveRemoteDocument?(d: QuoteDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  /** Opzionale: lo storage fatture può non averla (o lanciare "non implementato"). */
  listAudit?(): Promise<AuditEntry[]>;
  /** Opzionale: scrittura audit remoto (se lo storage la espone in futuro). */
  saveAudit?(e: AuditEntry): Promise<void>;
}

export interface Snapshot {
  profile: Profile;
  catalog: CatalogItem[];
  documents: QuoteDocument[];
  audit: AuditEntry[];
}

/** Limite oltre cui il logo non viaggia nel sync dati (ARCHITECTURE §2.3). */
export const MAX_LOGO_CHARS = 200_000;

export async function takeSnapshot(store: LocalStore): Promise<Snapshot> {
  const [profile, catalog, documents] = await Promise.all([store.getProfile(), store.listCatalog(), store.listDocuments()]);
  let audit: AuditEntry[] = [];
  try { audit = (await store.listAudit?.()) ?? []; } catch { audit = []; }
  return { profile, catalog, documents, audit };
}

// ---------------------------------------------------------------- hash stabile

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** cyrb53: hash non crittografico a 53 bit, sufficiente per rilevare cambiamenti. */
export function hashValue(v: unknown): string {
  const s = stable(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Profilo come viaggia sul server (logo troppo grande escluso). */
export function profilePayload(p: Profile): Profile {
  if (p.logoDataUrl && p.logoDataUrl.length > MAX_LOGO_CHARS) return { ...p, logoDataUrl: undefined };
  return p;
}

/** Profilo "vuoto" = mai compilato: non si carica (eviterebbe di sovrascrivere quello di un altro dispositivo). */
export const isProfileEmpty = (p: Profile): boolean => !p.businessName.trim() && !p.vatNumber.trim();

// ---------------------------------------------------------------- diff

export interface Change {
  entity: SyncEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  payload?: Profile | CatalogItem | QuoteDocument | AuditEntry;
  hash?: string;
  /** updatedAt locale (per aggiornare "synced") */
  updatedAt?: number;
  /** updatedAt che il server aveva all'ultima sincronizzazione */
  baseUpdatedAt?: number;
}

export function diffSnapshot(snap: Snapshot, synced: Map<string, SyncedEntry>): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();
  const consider = (entity: SyncEntity, entityId: string, payload: Change['payload'], updatedAt?: number) => {
    const key = entityKey(entity, entityId);
    seen.add(key);
    const hash = hashValue(payload);
    const prev = synced.get(key);
    if (prev?.hash === hash) return;
    out.push({ entity, entityId, op: 'upsert', payload, hash, updatedAt, baseUpdatedAt: prev?.updatedAt });
  };

  // Un profilo vuoto (storage svuotato/ripristinato ai default) NON si carica mai, nemmeno se il server ne ha già uno:
  // sovrascriverebbe i dati azienda dell'account con un modulo bianco (last-write-wins).
  if (!isProfileEmpty(snap.profile)) consider('profile', 'profile', profilePayload(snap.profile));
  else seen.add(entityKey('profile', 'profile'));
  for (const c of snap.catalog) consider('catalog', c.id, c, c.updatedAt);
  for (const d of snap.documents) consider('document', d.id, d, d.updatedAt);
  for (const a of snap.audit) consider('audit', a.id, a, a.at);

  // cancellazioni: presenti nello stato sincronizzato, assenti in locale (profilo e audit non si cancellano)
  for (const [key, prev] of synced) {
    if (seen.has(key)) continue;
    const [entity, ...rest] = key.split(':');
    if (entity !== 'catalog' && entity !== 'document') continue;
    out.push({ entity, entityId: rest.join(':'), op: 'delete', baseUpdatedAt: prev.updatedAt });
  }
  return out;
}

// ---------------------------------------------------------------- circuit breaker cancellazioni di massa

/** Sotto questa soglia le cancellazioni normali (una voce, un documento) passano sempre senza conferma. */
export const MASS_DELETE_MIN = 5;
/** Quota di elementi sincronizzati la cui scomparsa locale è considerata sospetta. */
export const MASS_DELETE_RATIO = 0.5;

export interface MassDeleteAlert {
  catalog: number;
  documents: number;
  /** chiavi `entity:id` delle cancellazioni trattenute */
  keys: string[];
}

/**
 * Circuit breaker: se in locale sono spariti molti elementi già sincronizzati (storage svuotato, dati del browser cancellati,
 * database non ancora aperto, bug) NON si propaga la cancellazione al server: si chiede conferma all'utente.
 * Sospetto = (>= MASS_DELETE_MIN cancellazioni E >= 50% degli elementi sincronizzati di quel tipo)
 *            oppure (spariti TUTTI, con almeno 3 elementi sincronizzati)
 *            oppure (archivio locale completamente vuoto: nessun documento, nessuna voce, profilo vuoto, ma il server ne ha almeno 2).
 */
export function detectMassDelete(snap: Snapshot, changes: Change[], synced: Map<string, SyncedEntry>): MassDeleteAlert | null {
  const total = { catalog: 0, document: 0 };
  for (const k of synced.keys()) {
    if (k.startsWith('catalog:')) total.catalog++;
    else if (k.startsWith('document:')) total.document++;
  }
  const dels = { catalog: [] as string[], document: [] as string[] };
  for (const c of changes) {
    if (c.op !== 'delete') continue;
    if (c.entity === 'catalog' || c.entity === 'document') dels[c.entity].push(entityKey(c.entity, c.entityId));
  }
  const wiped = !snap.documents.length && !snap.catalog.length && isProfileEmpty(snap.profile) && total.catalog + total.document >= 2;
  const bad = (n: number, t: number) => n > 0 && (wiped || (n >= MASS_DELETE_MIN && n / t >= MASS_DELETE_RATIO) || (t >= 3 && n === t));
  const keys: string[] = [];
  if (bad(dels.catalog.length, total.catalog)) keys.push(...dels.catalog);
  if (bad(dels.document.length, total.document)) keys.push(...dels.document);
  if (!keys.length) return null;
  return {
    catalog: keys.filter((k) => k.startsWith('catalog:')).length,
    documents: keys.filter((k) => k.startsWith('document:')).length,
    keys,
  };
}

export interface ScanResult { queued: number; massDelete: MassDeleteAlert | null }

/**
 * Accoda le operazioni per le modifiche locali non ancora in coda. Idempotente: se la stessa versione
 * (stesso hash) è già in outbox non la riaccoda. Le cancellazioni di massa sospette NON vengono accodate
 * (vedi `detectMassDelete`) salvo `allowMassDelete`.
 */
export async function scanLocalChangesDetailed(store: LocalStore, synced: Map<string, SyncedEntry>, opts: { allowMassDelete?: boolean } = {}): Promise<ScanResult> {
  const snap = await takeSnapshot(store);
  let changes = diffSnapshot(snap, synced);
  const outbox = await listOutbox();
  // cancellazioni già accodate (e quindi già autorizzate) non vanno rivalutate dal circuit breaker
  const queuedDeletes = new Set(outbox.filter((r) => r.status === 'pending' && r.op === 'delete').map((r) => entityKey(r.entity, r.entityId)));
  const massDelete = opts.allowMassDelete ? null : detectMassDelete(snap, changes.filter((c) => !(c.op === 'delete' && queuedDeletes.has(entityKey(c.entity, c.entityId)))), synced);
  const held = new Set(massDelete?.keys ?? []);
  const changedKeys = new Set(changes.map((c) => entityKey(c.entity, c.entityId)));
  changes = changes.filter((c) => !(c.op === 'delete' && held.has(entityKey(c.entity, c.entityId))));
  // upsert in attesa che non corrispondono più a nessuna differenza (modifica annullata, o creato ed
  // eliminato prima del sync): vanno scartati, altrimenti il server riceverebbe uno stato superato.
  const stale = outbox.filter((r) => r.status === 'pending' && r.op === 'upsert' && r.entity !== 'audit' && !changedKeys.has(entityKey(r.entity, r.entityId)));
  if (stale.length) await removeOps(stale.map((r) => r.opId));
  if (!changes.length) return { queued: 0, massDelete };
  const staleIds = new Set(stale.map((r) => r.opId));
  const latest = new Map<string, { op: string; hash?: string }>();
  for (const r of outbox) if (!staleIds.has(r.opId)) latest.set(entityKey(r.entity, r.entityId), { op: r.op, hash: r.hash });
  let n = 0;
  for (const c of changes) {
    const q = latest.get(entityKey(c.entity, c.entityId));
    if (c.op === 'upsert') {
      if (q && q.op === 'upsert' && q.hash === c.hash) continue;
      await enqueueUpsert({ entity: c.entity, entityId: c.entityId, payload: c.payload, baseUpdatedAt: c.baseUpdatedAt, hash: c.hash });
    } else {
      if (q && q.op === 'delete') continue;
      await enqueueDelete({ entity: c.entity, entityId: c.entityId, baseUpdatedAt: c.baseUpdatedAt });
    }
    n++;
  }
  return { queued: n, massDelete };
}

/** Come `scanLocalChangesDetailed`, ritorna solo il numero di operazioni create. */
export async function scanLocalChanges(store: LocalStore, synced: Map<string, SyncedEntry>): Promise<number> {
  return (await scanLocalChangesDetailed(store, synced)).queued;
}

/** Anteprima migrazione ("N documenti, M voci a catalogo"). */
export interface MigrationPreview { documents: number; catalog: number; profile: boolean }
export function previewMigration(snap: Snapshot): MigrationPreview {
  return { documents: snap.documents.length, catalog: snap.catalog.length, profile: !isProfileEmpty(snap.profile) };
}
export const isPreviewEmpty = (p: MigrationPreview): boolean => !p.documents && !p.catalog && !p.profile;
