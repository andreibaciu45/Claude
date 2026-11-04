/**
 * Motore di sincronizzazione: push/pull con cursor, conflitti, migrazione iniziale, scheduler e stato osservabile.
 * Regole (docs/CONTRACT-V2.md, ARCHITECTURE-V2 §2):
 *  - last-write-wins per profilo e catalogo (un `stale` si ritenta con la base aggiornata, segnalandolo nel registro di sync);
 *  - BOZZE: mai last-write-wins silenzioso (ARCHITECTURE §2.3). Se il server rifiuta con `stale`, o arriva una versione più recente
 *    di una bozza con modifiche locali non inviate, si crea un conflitto con le due versioni: usa quella del server / tieni la mia /
 *    tieni entrambe (la copia locale diventa una nuova bozza "copia in conflitto");
 *  - documenti bloccati / numeri duplicati / quota / non validi => SyncConflict mostrato all'utente, MAI perdita di dati locali;
 *  - le modifiche remote si applicano allo storage locale SOLO con le sue funzioni pubbliche;
 *    ImmutableDocumentError => la modifica remota viene ignorata e conteggiata.
 */
import type { MeResponse, SyncConflict, SyncOp, TermsAcceptance } from '../../shared/api';
import type { AuditEntry, CatalogItem, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { diffDrafts, isDocLike, makeConflictCopy, type ConflictDiffRow } from './conflictDiff';
import { detectStorageHooks, StorageHookUnavailableError, type StorageHooks } from './storageHooks';
import * as storage from '../storage';
import { ImmutableDocumentError } from '../storage/invoices';
import {
  api as defaultApi, accountStore as defaultAccountStore, describeError, getDeviceId, tokenStore as defaultTokenStore,
  ApiClientError, type ApiClient, type DeleteAccountResult, type StoredAccount,
} from './api';
import { termsAcceptanceStore } from './legal';
import {
  clearSyncState, deleteSynced, enqueueDelete, enqueueUpsert, entityKey, getMeta, getSynced, listConflicts, listOutbox, listPending,
  markAttempt, removeOps, setMeta, setSynced, updateOp, type OutboxRecord,
} from './outbox';
import {
  detectMassDelete, diffSnapshot, hashValue, isPreviewEmpty, previewMigration, profilePayload, scanLocalChangesDetailed, takeSnapshot,
  type LocalStore, type MassDeleteAlert, type MigrationPreview, type Snapshot,
} from './snapshot';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'conflict';

export interface ConflictItem {
  opId: string;
  entity: OutboxRecord['entity'];
  entityId: string;
  reason: SyncConflict['reason'];
  message: string;
  label: string;
  /** true se esiste una versione del server applicabile in locale */
  canUseServer: boolean;
  /** true se è possibile tenere entrambe le copie (solo documenti non bloccati) */
  canKeepBoth: boolean;
  /** presente solo per i conflitti su bozze (`stale`): confronto leggibile delle due versioni */
  draft?: DraftConflictInfo;
}
/** Conflitto su una BOZZA: le due versioni a confronto. */
export interface DraftConflictInfo {
  /** solo i campi diversi (cliente, righe, totale, note, data, stato) */
  rows: ConflictDiffRow[];
  /** true = in locale la bozza è stata eliminata, ma sul server è stata modificata da un altro dispositivo */
  localDeleted: boolean;
  localUpdatedAt?: number;
  serverUpdatedAt?: number;
}
export interface SyncLogEntry { at: number; level: 'info' | 'warn'; message: string }
const LOG_MAX = 50;

export type ConflictChoice = 'use-server' | 'keep-local' | 'keep-both' | 'retry';

export interface SyncStatus {
  signedIn: boolean;
  email: string | null;
  phase: SyncPhase;
  lastSyncAt: number | null;
  pendingOps: number;
  conflicts: ConflictItem[];
  error: string | null;
  /** != null: prima sincronizzazione in attesa di conferma dell'utente */
  migration: MigrationPreview | null;
  /** modifiche remote non applicate (es. documento già emesso e bloccato in locale) nell'ultimo ciclo */
  remoteIgnored: number;
  me: MeResponse | null;
  /** quando `me` è stato ricevuto dal server (epoch ms): serve a non "ringiovanire" una verifica vecchia della cache Pro */
  meAt: number | null;
  /** cancellazione di massa sospetta TRATTENUTA (non inviata al server) in attesa di conferma dell'utente */
  massDelete: { catalog: number; documents: number } | null;
  /** serverTime - ora locale (ms) all'ultimo push; null = mai misurato. Positivo = telefono indietro. */
  clockSkewMs: number | null;
  /** dopo un cambio account: i dati locali in attesa di prima sincronizzazione appartengono a un altro account */
  foreignData: boolean;
  /** registro di sincronizzazione (ultime voci, solo in memoria): sovrascritture last-write-wins di profilo e catalogo, ecc. */
  log: SyncLogEntry[];
}

/** Oltre questo sfasamento (5 minuti) mostriamo l'avviso sull'orologio. */
export const CLOCK_SKEW_WARN_MS = 5 * 60_000;
export const hasClockSkew = (ms: number | null | undefined): boolean => typeof ms === 'number' && Math.abs(ms) > CLOCK_SKEW_WARN_MS;

export interface EngineDeps {
  api: ApiClient;
  store: LocalStore;
  isOnline: () => boolean;
  tokenStore: { get(): string | null; set(t: string): void; clear(): void };
  accountStore: { get(): StoredAccount | null; set(a: StoredAccount): void; clear(): void };
  now: () => number;
  /** funzioni di storage opzionali (cancella dati locali, importa audit): predefinito = quelle di `src/storage` se esistono */
  hooks?: StorageHooks;
}

const PUSH_BATCH = 50;
export const SYNC_INTERVAL_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 15_000;
const DEBOUNCE_MS = 2_000;
/** /me viene riletto dopo un sync riuscito se più vecchio di così (la cache del piano Pro dipende da questa verifica) */
export const ME_REFRESH_MS = 60 * 60_000;

/** Un ciclo di sync interrotto perché nel frattempo l'utente è uscito / ha cambiato account. */
class CycleAborted extends Error { constructor() { super('sync interrotta'); this.name = 'CycleAborted'; } }

/**
 * Due schede aperte condividono lo stesso IndexedDB (outbox, cursor): un solo ciclo alla volta, tra tutte le schede
 * (Web Locks). Se un'altra scheda sta già sincronizzando si salta questo giro. Senza Web Locks: nessun blocco.
 */
async function withTabLock<T>(fn: () => Promise<T>, busy: T): Promise<T> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<T>) => Promise<T> } }).locks : undefined);
  if (!locks || typeof locks.request !== 'function') return fn();
  try {
    return await locks.request('vp-sync-cycle', { ifAvailable: true }, async (lock) => (lock ? fn() : busy));
  } catch (e) {
    if (e instanceof Error && (e.name === 'NotSupportedError' || e.name === 'SecurityError')) return fn();
    throw e;
  }
}
export const STORAGE_CHANGED_EVENT = 'vp:storage-changed';

const isImmutable = (e: unknown): boolean =>
  e instanceof ImmutableDocumentError || (e instanceof Error && e.name === 'ImmutableDocumentError');

const toSyncOp = (r: OutboxRecord): SyncOp => ({
  opId: r.opId, entity: r.entity, entityId: r.entityId, op: r.op, baseUpdatedAt: r.baseUpdatedAt, payload: r.payload, clientTs: r.clientTs,
});

function labelOf(r: OutboxRecord): string {
  const p = r.payload as Record<string, unknown> | undefined;
  if (r.entity === 'profile') return 'Dati azienda';
  if (r.entity === 'catalog') return `Voce di catalogo${p?.name ? `: ${String(p.name)}` : ''}`;
  if (r.entity === 'document') {
    const d = p as Partial<QuoteDocument> | undefined;
    const kind = d?.type === 'fattura' ? 'Fattura' : 'Preventivo';
    return `${kind}${d?.number ? ` ${d.number}` : ''}${d?.customer?.name ? ` - ${d.customer.name}` : ''}`;
  }
  return 'Registro attività';
}

const isLockedDoc = (p: unknown): boolean => !!(p as QuoteDocument | undefined)?.invoice?.lockedAt;
const updatedAtOf = (p: unknown): number | undefined => {
  const o = p as { updatedAt?: unknown; at?: unknown } | undefined;
  return typeof o?.updatedAt === 'number' ? o.updatedAt : typeof o?.at === 'number' ? o.at : undefined;
};

export function createSyncEngine(deps: EngineDeps) {
  const { api, store } = deps;
  const hooks: StorageHooks = deps.hooks ?? detectStorageHooks();
  let status: SyncStatus = {
    signedIn: !!deps.tokenStore.get(), email: deps.accountStore.get()?.email ?? null, phase: 'idle', lastSyncAt: null,
    pendingOps: 0, conflicts: [], error: null, migration: null, remoteIgnored: 0, me: null, meAt: null, massDelete: null, clockSkewMs: null, foreignData: false, log: [],
  };
  const subs = new Set<() => void>();
  const set = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; subs.forEach((f) => f()); };
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
  const getStatus = () => status;
  const addLog = (level: SyncLogEntry['level'], message: string) => set({ log: [...status.log, { at: deps.now(), level, message }].slice(-LOG_MAX) });

  async function refreshCounts(): Promise<void> {
    const [p, c] = await Promise.all([listPending(), listConflicts()]);
    let forfettario = false;
    if (c.some((r) => r.entity === 'document')) { try { forfettario = !!(await store.getProfile()).regimeForfettario; } catch { /* totali senza forfettario */ } }
    const items: ConflictItem[] = c.map((r) => {
      const server = r.conflict?.serverVersion;
      const draft = isDraftStale(r) ? buildDraftInfo(r, forfettario) : undefined;
      return {
        opId: r.opId, entity: r.entity, entityId: r.entityId, reason: r.conflict?.reason ?? 'invalid',
        message: r.conflict?.message ?? 'Operazione non accettata dal server.', label: labelOf(r),
        canUseServer: r.entity !== 'audit' && server != null && typeof server === 'object',
        canKeepBoth: r.entity === 'document' && r.op === 'upsert' && !isLockedDoc(r.payload),
        ...(draft ? { draft } : {}),
      };
    });
    set({ pendingOps: p.length, conflicts: items });
  }

  /** Conflitto `stale` su una bozza (documento non bloccato, né in locale né sul server). */
  const isDraftStale = (r: OutboxRecord): boolean =>
    r.entity === 'document' && r.conflict?.reason === 'stale' && !isLockedDoc(r.payload) && !isLockedDoc(r.conflict.serverVersion);

  function buildDraftInfo(r: OutboxRecord, forfettario: boolean): DraftConflictInfo {
    const server = r.conflict?.serverVersion;
    const serverDoc = isDocLike(server) ? server : undefined;
    const localDoc = r.op === 'upsert' && isDocLike(r.payload) ? r.payload : undefined;
    return {
      rows: localDoc && serverDoc ? diffDrafts(localDoc, serverDoc, { forfettario }) : [],
      localDeleted: r.op === 'delete',
      localUpdatedAt: localDoc?.updatedAt,
      serverUpdatedAt: serverDoc?.updatedAt,
    };
  }

  // ------------------------------------------------------------ applicazione modifiche remote
  type RemoteOp = Omit<SyncOp, 'clientTs'>;

  /** Applica UNA modifica remota tramite lo storage pubblico. Ritorna l'esito. */
  async function applyRemote(op: RemoteOp): Promise<'applied' | 'ignored' | 'skipped'> {
    try {
      if (op.entity === 'profile') {
        if (op.op === 'delete' || !op.payload) return 'skipped';
        const remote = op.payload as Profile;
        const local = await store.getProfile();
        await store.saveProfile({ ...remote, logoDataUrl: remote.logoDataUrl ?? local.logoDataUrl });
        return 'applied';
      }
      if (op.entity === 'catalog') {
        if (op.op === 'delete') await store.deleteCatalogItem(op.entityId);
        else if (op.payload) await store.saveCatalogItem(op.payload as CatalogItem);
        else return 'skipped';
        return 'applied';
      }
      if (op.entity === 'document') {
        if (op.op === 'delete') await store.deleteDocument(op.entityId);
        // le fatture già emesse su un altro dispositivo (lockedAt) si possono creare solo col percorso "sincronizzato" dello storage
        else if (op.payload) await (store.saveRemoteDocument ?? store.saveDocument).call(store, op.payload as QuoteDocument);
        else return 'skipped';
        return 'applied';
      }
      if (op.entity === 'audit') {
        if (op.op === 'upsert' && op.payload && store.saveAudit) { await store.saveAudit(op.payload as AuditEntry); return 'applied'; }
        // voci di altri dispositivi: servono funzioni di storage che (ancora) possono non esistere -> senza, restano non importate
        if (op.op === 'upsert' && op.payload && hooks.available.importAuditEntries) {
          await hooks.importAuditEntries([op.payload as AuditEntry]);
          return 'applied';
        }
        return 'skipped';
      }
      return 'skipped';
    } catch (e) {
      if (isImmutable(e)) return 'ignored';
      throw e;
    }
  }

  /** Dopo aver applicato, rilegge lo storage e registra l'hash REALE (lo storage può normalizzare i dati). */
  async function markSyncedFromStorage(ops: RemoteOp[]): Promise<void> {
    if (!ops.length) return;
    const snap = await takeSnapshot(store);
    const current = currentHashes(snap);
    const puts: [string, { hash: string; updatedAt?: number }][] = [];
    const dels: string[] = [];
    for (const op of ops) {
      const key = entityKey(op.entity, op.entityId);
      const h = current.get(key);
      if (op.op === 'delete' || h === undefined) dels.push(key);
      else puts.push([key, { hash: h, updatedAt: updatedAtOf(op.payload) }]);
    }
    if (puts.length) await setSynced(puts);
    if (dels.length) await deleteSynced(dels);
  }

  function currentHashes(snap: Snapshot): Map<string, string> {
    const m = new Map<string, string>();
    m.set(entityKey('profile', 'profile'), hashValue(profilePayload(snap.profile)));
    for (const c of snap.catalog) m.set(entityKey('catalog', c.id), hashValue(c));
    for (const d of snap.documents) m.set(entityKey('document', d.id), hashValue(d));
    for (const a of snap.audit) m.set(entityKey('audit', a.id), hashValue(a));
    return m;
  }

  // ------------------------------------------------------------ push
  async function handleConflict(rec: OutboxRecord, c: SyncConflict, retried: Set<string>): Promise<void> {
    const key = entityKey(rec.entity, rec.entityId);
    const draft = rec.entity === 'document' && !isLockedDoc(rec.payload) && !isLockedDoc(c.serverVersion);
    if (c.reason === 'stale' && draft) {
      // BOZZA: niente last-write-wins silenzioso. La versione locale resta in coda come conflitto con la versione del server.
      // Un eventuale conflitto precedente sulla stessa bozza viene sostituito da questo (più recente).
      const older = (await listConflicts()).filter((r) => r.opId !== rec.opId && entityKey(r.entity, r.entityId) === key).map((r) => r.opId);
      if (older.length) await removeOps(older);
      await updateOp(rec.opId, { status: 'conflict', conflict: c, attempts: rec.attempts + 1 });
      addLog('warn', `${labelOf(rec)}: modificata anche su un altro dispositivo. Scegli quale versione tenere in "Da controllare".`);
      return;
    }
    const lww = rec.entity !== 'audit' && !(rec.entity === 'document' && isLockedDoc(rec.payload));
    if (c.reason === 'stale' && lww && !retried.has(key)) {
      // last-write-wins (profilo, catalogo): l'ultimo push vince. Nuova operazione con la base aggiornata alla versione del server.
      retried.add(key);
      addLog('warn', `${labelOf(rec)}: sul server c'era una versione più recente, sostituita dalla tua (vince l'ultima modifica).`);
      await removeOps([rec.opId]);
      const base = updatedAtOf(c.serverVersion) ?? rec.baseUpdatedAt;
      if (rec.op === 'delete') await enqueueDelete({ entity: rec.entity, entityId: rec.entityId, baseUpdatedAt: base });
      else await enqueueUpsert({ entity: rec.entity, entityId: rec.entityId, payload: rec.payload, baseUpdatedAt: base, hash: rec.hash });
      return;
    }
    await updateOp(rec.opId, { status: 'conflict', conflict: c, attempts: rec.attempts + 1 });
  }

  /**
   * Modifica remota che tocca un'entità con modifiche locali non inviate. Profilo e catalogo: vince l'ultimo push (si segnala nel
   * registro). Bozze: se la versione remota è più recente della base della modifica locale si crea un conflitto (nulla viene sovrascritto).
   */
  async function noteDirtyRemote(op: RemoteOp, snap: Snapshot, synced: Map<string, { hash: string; updatedAt?: number }>, box: OutboxRecord[]): Promise<void> {
    if (op.op !== 'upsert' || !op.payload) return;
    const key = entityKey(op.entity, op.entityId);
    if (op.entity === 'profile' || op.entity === 'catalog') {
      if (currentHashes(snap).get(key) !== hashValue(op.entity === 'profile' ? profilePayload(op.payload as Profile) : op.payload)) {
        addLog('warn', `${op.entity === 'profile' ? 'Dati azienda' : `Voce di catalogo${(op.payload as CatalogItem).name ? `: ${(op.payload as CatalogItem).name}` : ''}`}: modificata su un altro dispositivo, ma hai modifiche locali non inviate: vince la tua (ultima modifica).`);
      }
      return;
    }
    if (op.entity !== 'document' || !isDocLike(op.payload) || isLockedDoc(op.payload)) return;
    const local = snap.documents.find((d) => d.id === op.entityId);
    if (!local || isLockedDoc(local) || hashValue(local) === hashValue(op.payload)) return;
    const mine = box.filter((r) => r.entity === 'document' && r.entityId === op.entityId).pop();
    const base = mine?.baseUpdatedAt ?? synced.get(key)?.updatedAt;
    const remoteAt = updatedAtOf(op.payload);
    if (remoteAt === undefined || (base !== undefined && remoteAt <= base)) return; // non più recente della base: è un'eco
    const conflict: SyncConflict = { opId: '', reason: 'stale', message: 'La bozza è stata modificata anche su un altro dispositivo.', serverVersion: op.payload };
    if (mine?.status === 'conflict') {
      if (mine.conflict?.reason === 'stale') await updateOp(mine.opId, { conflict: { ...conflict, opId: mine.opId } });
      return;
    }
    const rec = mine ?? await enqueueUpsert({ entity: 'document', entityId: op.entityId, payload: local, baseUpdatedAt: base, hash: hashValue(local) });
    await updateOp(rec.opId, { status: 'conflict', conflict: { ...conflict, opId: rec.opId } });
    addLog('warn', `${labelOf({ ...rec, payload: local })}: modificata anche su un altro dispositivo. Scegli quale versione tenere in "Da controllare".`);
  }

  /** incrementato a ogni uscita/cambio account: i cicli già in volo non devono più scrivere stato */
  let epoch = 0;
  let switching = false;
  const alive = (my: number) => { if (my !== epoch) throw new CycleAborted(); };

  async function pushAll(my: number): Promise<void> {
    const retried = new Set<string>();
    let size = PUSH_BATCH;
    for (let guard = 0; guard < 1000; guard++) {
      alive(my);
      const batch = (await listPending()).slice(0, size);
      if (!batch.length) return;
      const t0 = deps.now();
      let res: Awaited<ReturnType<ApiClient['syncPush']>>;
      try {
        res = await api.syncPush({ deviceId: getDeviceId(), ops: batch.map(toSyncOp) });
      } catch (e) {
        // una richiesta rifiutata (400/413/422) non deve bloccare per sempre tutta la coda: si dimezza il lotto, e se anche una
        // singola operazione viene rifiutata la si segna come "non valida" (resta sul dispositivo, l'utente la vede in "Da controllare")
        if (e instanceof ApiClientError && !e.isNetwork && (e.status === 400 || e.status === 413 || e.status === 422)) {
          alive(my);
          if (batch.length > 1) { size = Math.max(1, Math.floor(batch.length / 2)); continue; }
          await updateOp(batch[0].opId, {
            status: 'conflict', attempts: batch[0].attempts + 1,
            conflict: { opId: batch[0].opId, reason: 'invalid', message: e.status === 413 ? 'Il documento è troppo grande per essere sincronizzato.' : e.message },
          });
          continue;
        }
        throw e;
      }
      alive(my);
      if (typeof res.serverTime === 'number' && Number.isFinite(res.serverTime)) {
        // ora locale a metà della richiesta: compensa la latenza
        const skew = Math.round(res.serverTime - (t0 + deps.now()) / 2);
        if (skew !== status.clockSkewMs) set({ clockSkewMs: skew });
      }
      const accepted = new Set(res.accepted);
      const byId = new Map(batch.map((r) => [r.opId, r]));
      const puts: [string, { hash: string; updatedAt?: number }][] = [];
      const dels: string[] = [];
      for (const r of batch) {
        if (!accepted.has(r.opId)) continue;
        const key = entityKey(r.entity, r.entityId);
        if (r.op === 'delete') dels.push(key);
        else puts.push([key, { hash: r.hash ?? hashValue(r.payload), updatedAt: updatedAtOf(r.payload) }]);
      }
      if (puts.length) await setSynced(puts);
      if (dels.length) await deleteSynced(dels);
      await removeOps([...accepted].filter((id) => byId.has(id)));
      let handled = accepted.size;
      for (const c of res.conflicts) {
        const rec = byId.get(c.opId);
        if (!rec || accepted.has(c.opId)) continue;
        handled++;
        await handleConflict(rec, c, retried);
      }
      if (handled === 0) {
        // il server non ha né accettato né rifiutato: evita il ciclo infinito, riproverà al prossimo giro
        await markAttempt(batch.map((r) => r.opId), 'Nessuna risposta per questa operazione');
        throw new ApiClientError(500, 'push_no_progress', 'Il server non ha elaborato le modifiche. Riprovo più tardi.');
      }
    }
  }

  // ------------------------------------------------------------ pull
  async function pullAll(my: number): Promise<number> {
    let ignored = 0;
    let cursor = ((await getMeta<string>('cursor')) ?? '0') as string;
    for (let guard = 0; guard < 10_000; guard++) {
      alive(my);
      const res = await api.syncPull(cursor);
      alive(my);
      if (res.ops.length) {
        const synced = await getSynced();
        const snap = await takeSnapshot(store);
        const local = currentHashes(snap);
        // modifiche locali non ancora sincronizzate (anche in conflitto): non vanno sovrascritte dal pull
        const dirty = new Set(diffSnapshot(snap, synced).map((c) => entityKey(c.entity, c.entityId)));
        const box = await listOutbox();
        for (const r of box) dirty.add(entityKey(r.entity, r.entityId));
        const done: RemoteOp[] = [];
        // più operazioni sulla stessa entità nella pagina: conta solo l'ultima (le precedenti sono superate)
        const lastByKey = new Map<string, RemoteOp>();
        for (const op of res.ops) lastByKey.set(entityKey(op.entity, op.entityId), op);
        for (const op of lastByKey.values()) {
          const key = entityKey(op.entity, op.entityId);
          if (dirty.has(key)) { await noteDirtyRemote(op, snap, synced, box); continue; } // profilo/catalogo: vince l'ultimo push; bozze: conflitto
          if (op.op === 'upsert' && local.get(key) === hashValue(op.entity === 'profile' ? profilePayload(op.payload as Profile) : op.payload)) {
            done.push(op); // eco di una nostra scrittura: già identico, basta registrarlo
            continue;
          }
          const out = await applyRemote(op);
          if (out === 'ignored') ignored++;
          else if (out === 'applied') done.push(op);
        }
        await markSyncedFromStorage(done);
      }
      const advanced = res.cursor !== cursor;
      cursor = res.cursor;
      await setMeta('cursor', cursor);
      if (!res.hasMore || !advanced) break;
    }
    return ignored;
  }

  // ------------------------------------------------------------ ciclo
  let running: Promise<void> | null = null;
  let rerun = false;
  let started = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 5_000;

  const clearRetry = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } };
  function scheduleRetry() {
    if (!started || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; void syncNow(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
  }

  function signedOutState() {
    clearRetry();
    set({ signedIn: false, email: null, phase: 'idle', error: null, migration: null, me: null, meAt: null, massDelete: null, conflicts: [], pendingOps: status.pendingOps, clockSkewMs: null, foreignData: false });
  }

  async function cycle(): Promise<void> {
    if (switching) return;
    if (!deps.tokenStore.get()) { signedOutState(); return; }
    if (!status.signedIn) set({ signedIn: true, email: deps.accountStore.get()?.email ?? status.email });
    if (!deps.isOnline()) { await refreshCounts(); set({ phase: 'offline', error: null }); return; }
    const my = epoch;
    // lo stato di sync (cursor, hash, coda) appartiene a un solo tenant: se manca l'etichetta (installazioni precedenti) la si imposta ora
    const acc = deps.accountStore.get();
    if (acc && !(await getMeta<string>('tenant'))) await setMeta('tenant', acc.tenantId);

    // una volta sola, quando lo storage sa importare l'audit: rilegge dall'inizio le voci di altri dispositivi saltate in precedenza
    if (hooks.available.importAuditEntries && !(await getMeta<boolean>('auditBackfill'))) {
      await setMeta('auditBackfill', true);
      if ((await getMeta<string>('cursor')) && (await getMeta<string>('cursor')) !== '0') await setMeta('cursor', '0');
    }

    if (!(await getMeta<boolean>('migrated'))) {
      const prev = previewMigration(await takeSnapshot(store));
      if (isPreviewEmpty(prev)) await setMeta('migrated', true);
      else { await refreshCounts(); set({ migration: prev, phase: 'idle', error: null, foreignData: !!(await getMeta<boolean>('foreignData')) }); return; }
    }
    if (status.migration) set({ migration: null, foreignData: false });

    set({ phase: 'syncing', error: null });
    try {
      await runScan();
      await pushAll(my);
      const ignored = await pullAll(my);
      alive(my);
      const now = deps.now();
      await setMeta('lastSyncAt', now);
      await refreshCounts();
      retryDelay = 5_000;
      clearRetry();
      set({ lastSyncAt: now, remoteIgnored: ignored, phase: status.conflicts.length ? 'conflict' : 'idle' });
      // il piano (Pro) dipende da /me: una scheda aperta per giorni non deve lasciare scadere la cache
      if (!status.me || deps.now() - (status.meAt ?? 0) > ME_REFRESH_MS) await refreshMe();
    } catch (e) {
      if (e instanceof CycleAborted) return;
      await refreshCounts().catch(() => undefined);
      if (e instanceof ApiClientError && e.status === 401) { signedOutState(); return; }
      if (e instanceof ApiClientError && e.isNetwork) set({ phase: 'offline', error: null });
      else set({ phase: 'error', error: describeError(e) });
      scheduleRetry();
    }
  }

  /** Rilevamento delle modifiche locali + circuit breaker sulle cancellazioni di massa. */
  async function runScan(opts: { allowMassDelete?: boolean } = {}): Promise<number> {
    const r = await scanLocalChangesDetailed(store, await getSynced(), opts);
    const md = r.massDelete ? { catalog: r.massDelete.catalog, documents: r.massDelete.documents } : null;
    if (JSON.stringify(md) !== JSON.stringify(status.massDelete)) set({ massDelete: md });
    return r.queued;
  }

  function syncNow(): Promise<void> {
    if (running) { rerun = true; return running; }
    running = (async () => {
      try {
        do {
          rerun = false;
          const ran = await withTabLock(async () => { await cycle(); return true; }, false);
          if (!ran) { await refreshCounts().catch(() => undefined); const l = await getMeta<number>('lastSyncAt'); if (typeof l === 'number' && l !== status.lastSyncAt) set({ lastSyncAt: l }); }
        } while (rerun);
      } finally { running = null; }
    })();
    return running;
  }

  /** Solo rilevamento: accoda le modifiche locali e, se ce ne sono, pianifica un sync (debounce). */
  async function scan(): Promise<number> {
    if (running || !deps.tokenStore.get() || status.migration || !(await getMeta<boolean>('migrated'))) return 0;
    const n = await withTabLock(() => runScan(), 0);
    if (n) { await refreshCounts(); onLocalChange(); }
    return n;
  }

  /** L'utente conferma che le cancellazioni trattenute vanno applicate anche all'account. */
  async function confirmMassDelete(): Promise<void> {
    await runScan({ allowMassDelete: true });
    set({ massDelete: null });
    await refreshCounts();
    await syncNow();
  }

  /**
   * L'utente NON vuole cancellare: i dati vengono ripresi dal server. Le voci sparite in locale vengono "dimenticate"
   * dallo stato sincronizzato e il cursor riparte da zero, così il pull le riscrive in locale.
   */
  async function restoreFromServer(): Promise<void> {
    const snap = await takeSnapshot(store);
    const synced = await getSynced();
    const alert: MassDeleteAlert | null = detectMassDelete(snap, diffSnapshot(snap, synced), synced);
    if (alert) await deleteSynced(alert.keys);
    await setMeta('cursor', '0');
    set({ massDelete: null });
    await syncNow();
  }

  let debounce: ReturnType<typeof setTimeout> | null = null;
  function onLocalChange(): void {
    if (!deps.tokenStore.get()) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void syncNow(); }, DEBOUNCE_MS);
  }

  // ------------------------------------------------------------ account
  async function refreshMe(): Promise<MeResponse | null> {
    if (!deps.tokenStore.get() || !deps.isOnline()) return status.me;
    try { const me = await api.me(); set({ me, meAt: deps.now() }); return me; } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) signedOutState();
      return status.me;
    }
  }

  const requestCode = (email: string) => api.authRequest(email.trim().toLowerCase());

  /** `acceptedTerms`: versioni di Termini/DPA accettate dall'utente (il server le registra con data/ora). */
  async function verifyCode(email: string, code: string, acceptedTerms?: TermsAcceptance, inviteCode?: string): Promise<void> {
    const mail = email.trim().toLowerCase();
    const ownerP = getMeta<string>('tenant').catch(() => undefined);
    const invite = inviteCode?.replace(/\s+/g, '').toUpperCase();
    const res = await api.authVerify({
      email: mail, code: code.trim(), deviceId: getDeviceId(),
      ...(acceptedTerms ? { acceptedTerms } : {}), ...(invite ? { inviteCode: invite } : {}),
    });
    if (acceptedTerms) termsAcceptanceStore.set(acceptedTerms);
    const prev = deps.accountStore.get();
    // un altro account: lo stato di sync (cursor/hash/coda) appartiene al vecchio tenant. Dopo un'uscita `accountStore` è vuoto,
    // quindi il proprietario si legge anche dall'etichetta persistita insieme allo stato: altrimenti la coda dell'account A
    // verrebbe inviata all'account B.
    epoch++;
    switching = true; // finché lo stato non è pulito nessun ciclo può partire con il nuovo token
    deps.tokenStore.set(res.token);
    deps.accountStore.set({ email: mail, tenantId: res.tenantId });
    set({ signedIn: true, email: mail, error: null, phase: 'idle' });
    try {
      const owner = await ownerP;
      if ((prev && (prev.email !== mail || prev.tenantId !== res.tenantId)) || (owner && owner !== res.tenantId)) {
        await clearSyncState();
        // i dati locali sono dell'account precedente: la scheda "Prima sincronizzazione" lo dice e (se lo storage lo permette) offre di svuotarli
        await setMeta('foreignData', true);
      }
      await setMeta('tenant', res.tenantId);
    } finally { switching = false; }
    await refreshMe();
    await syncNow();
  }

  /** Esci: il token viene cancellato; i dati locali restano intatti. */
  function signOut(): void {
    epoch++;
    deps.tokenStore.clear();
    deps.accountStore.clear();
    if (debounce) { clearTimeout(debounce); debounce = null; }
    signedOutState();
  }

  /**
   * Cancella l'account sul server (DELETE /v1/me), poi esce e azzera SOLO lo stato di sync (coda, cursor, hash).
   * I dati locali (documenti, catalogo, profilo) restano sul dispositivo. Se il server rifiuta, lancia ApiClientError
   * (`confirmation_mismatch`, `active_subscription`) e non cambia nulla.
   */
  async function deleteAccount(confirmEmail: string, acknowledgeSubscription = false): Promise<DeleteAccountResult> {
    const res = await api.deleteAccount({ confirmEmail: confirmEmail.trim(), ...(acknowledgeSubscription ? { acknowledgeSubscription: true } : {}) });
    epoch++;
    deps.tokenStore.clear();
    deps.accountStore.clear();
    termsAcceptanceStore.clear();
    if (debounce) { clearTimeout(debounce); debounce = null; }
    await clearSyncState();
    signedOutState();
    set({ pendingOps: 0, lastSyncAt: null, remoteIgnored: 0 });
    return res;
  }

  /** L'utente conferma la prima sincronizzazione: tutti i dati locali vengono caricati sull'account. */
  async function confirmMigration(): Promise<void> {
    await setMeta('migrated', true);
    await setMeta('foreignData', false);
    set({ migration: null, foreignData: false });
    await syncNow();
  }

  /** Lo storage sa cancellare i dati locali? (altrimenti l'interfaccia non offre "Svuota i dati locali") */
  const canDiscardLocalData = (): boolean => hooks.available.clearLocalData;

  /**
   * Dopo un cambio account: l'utente NON vuole caricare i dati dell'altro account. Svuota i dati locali (funzione di storage
   * opzionale; lancia `StorageHookUnavailableError` se non c'è) e riparte scaricando quelli dell'account attuale.
   * Disponibile solo mentre la prima sincronizzazione è in attesa di conferma e i dati sono "di un altro account".
   */
  async function discardLocalData(): Promise<{ backupJson?: string }> {
    if (!status.migration || !status.foreignData) throw new Error('Non ci sono dati di un altro account da svuotare.');
    if (!hooks.available.clearLocalData) throw new StorageHookUnavailableError('clearLocalData');
    epoch++;
    switching = true;
    let backup: { backupJson?: string } | void = undefined;
    try {
      backup = await hooks.clearLocalData();
      await clearSyncState();
      await setMeta('tenant', deps.accountStore.get()?.tenantId);
    } finally { switching = false; }
    set({ migration: null, foreignData: false, massDelete: null });
    addLog('info', 'Dati locali di un altro account svuotati su richiesta.');
    await syncNow();
    return backup && typeof backup === 'object' ? backup : {};
  }

  // ------------------------------------------------------------ risoluzione conflitti
  async function resolveConflict(opId: string, choice: ConflictChoice): Promise<void> {
    const rec = (await listConflicts()).find((r) => r.opId === opId);
    if (!rec) return;
    const server = rec.conflict?.serverVersion;
    const key = entityKey(rec.entity, rec.entityId);
    const draftStale = isDraftStale(rec);
    const requeue = async () => {
      // nuova operazione con base = versione del server: ora il server la accetterà e la nostra versione prevale
      await removeOps([rec.opId]);
      const base = updatedAtOf(server) ?? rec.baseUpdatedAt;
      if (rec.op === 'delete') await enqueueDelete({ entity: rec.entity, entityId: rec.entityId, baseUpdatedAt: base });
      else await enqueueUpsert({ entity: rec.entity, entityId: rec.entityId, payload: rec.payload, baseUpdatedAt: base, hash: rec.hash });
    };
    const useServer = async () => {
      if ((rec.op === 'upsert' || draftStale) && server && typeof server === 'object') {
        const out = await applyRemote({ opId: rec.opId, entity: rec.entity, entityId: rec.entityId, op: 'upsert', payload: server as SyncOp['payload'] });
        if (out === 'ignored') throw new Error('Il documento locale è già emesso e non può essere sostituito.');
        await markSyncedFromStorage([{ opId: rec.opId, entity: rec.entity, entityId: rec.entityId, op: 'upsert', payload: server as SyncOp['payload'] }]);
      }
      await removeOps([rec.opId]);
    };
    if (choice === 'use-server') {
      if (!server) throw new Error('Nessuna versione del server disponibile.');
      await useServer();
    } else if (choice === 'keep-both') {
      if (rec.entity !== 'document' || !rec.payload || isLockedDoc(rec.payload)) throw new Error('Non è possibile tenere entrambe le copie.');
      // la copia locale diventa una NUOVA bozza (nuovo id, nota "copia in conflitto", nessun numero fiscale); l'originale adotta il server
      await store.saveDocument(makeConflictCopy(rec.payload as QuoteDocument, uid(), deps.now()));
      if (server) await useServer(); else await removeOps([rec.opId]);
    } else if (choice === 'keep-local' && draftStale) {
      // "Tieni la mia": la bozza locale sostituisce quella del server (scelta esplicita dell'utente)
      await requeue();
      addLog('info', `${labelOf(rec)}: per scelta tua la versione di questo dispositivo ha sostituito quella del server.`);
    } else if (choice === 'keep-local') {
      // L'utente accetta che la copia locale resti diversa da quella del server: non verrà più inviata.
      await setSynced([[key, { hash: rec.hash ?? hashValue(rec.payload), updatedAt: updatedAtOf(server) ?? rec.baseUpdatedAt }]]);
      await removeOps([rec.opId]);
    } else {
      // retry: nuova operazione, base = versione del server (es. dopo il passaggio a Pro)
      await requeue();
    }
    await refreshCounts();
    if (!status.conflicts.length && status.phase === 'conflict') set({ phase: 'idle' });
    if (choice === 'retry' || (choice === 'keep-local' && draftStale)) void syncNow();
  }

  // ------------------------------------------------------------ scheduler
  /** Avvia timer e listener (online, visibilità, intervallo, evento di modifica). Ritorna la funzione di stop. */
  function start(opts: { intervalMs?: number; scanMs?: number } = {}): () => void {
    if (started) return () => undefined;
    started = true;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const onOnline = () => { retryDelay = 5_000; void syncNow(); };
    const onOffline = () => { if (status.signedIn) set({ phase: 'offline' }); };
    const onVisible = () => { if (visible()) void syncNow(); };
    const onChanged = () => onLocalChange();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(STORAGE_CHANGED_EVENT, onChanged);
    const every = setInterval(() => { if (visible()) void syncNow(); }, opts.intervalMs ?? SYNC_INTERVAL_MS);
    const scanning = setInterval(() => { if (visible()) void scan().catch(() => undefined); }, opts.scanMs ?? SCAN_INTERVAL_MS);
    setApiUnauthorized(() => signedOutState());
    void refreshCounts().catch(() => undefined);
    void syncNow();
    void refreshMe();
    return () => {
      started = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(STORAGE_CHANGED_EVENT, onChanged);
      clearInterval(every); clearInterval(scanning); clearRetry();
      if (debounce) { clearTimeout(debounce); debounce = null; }
    };
  }

  return {
    getStatus, subscribe, syncNow, scan, onLocalChange, start,
    requestCode, verifyCode, signOut, deleteAccount, refreshMe, confirmMigration, resolveConflict, refreshCounts,
    canDiscardLocalData, discardLocalData,
    confirmMassDelete, restoreFromServer,
  };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;

// ---------------------------------------------------------------- istanza predefinita
import { setUnauthorizedHandler } from './api';
let defaultUnauthorized: (() => void) | null = null;
function setApiUnauthorized(fn: () => void) { defaultUnauthorized = fn; }
setUnauthorizedHandler(() => defaultUnauthorized?.());

export const defaultLocalStore: LocalStore = {
  getProfile: storage.getProfile, saveProfile: storage.saveProfile,
  listCatalog: storage.listCatalog, saveCatalogItem: storage.saveCatalogItem, deleteCatalogItem: storage.deleteCatalogItem,
  listDocuments: storage.listDocuments, saveDocument: storage.saveDocument, deleteDocument: storage.deleteDocument,
  listAudit: () => storage.listAudit(),
  saveRemoteDocument: storage.saveSyncedDocument,
};

export const syncEngine: SyncEngine = createSyncEngine({
  api: defaultApi,
  store: defaultLocalStore,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  tokenStore: defaultTokenStore,
  accountStore: defaultAccountStore,
  now: () => Date.now(),
});
