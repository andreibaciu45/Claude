/**
 * Motore di sincronizzazione: push/pull con cursor, conflitti, migrazione iniziale, scheduler e stato osservabile.
 * Regole (docs/CONTRACT-V2.md, ARCHITECTURE-V2 §2):
 *  - last-write-wins per profilo, catalogo e bozze (un `stale` si ritenta una volta con la base aggiornata);
 *  - documenti bloccati / numeri duplicati / quota / non validi => SyncConflict mostrato all'utente, MAI perdita di dati locali;
 *  - le modifiche remote si applicano allo storage locale SOLO con le sue funzioni pubbliche;
 *    ImmutableDocumentError => la modifica remota viene ignorata e conteggiata.
 */
import type { MeResponse, SyncConflict, SyncOp, TermsAcceptance } from '../../shared/api';
import type { AuditEntry, CatalogItem, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
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
  diffSnapshot, hashValue, isPreviewEmpty, previewMigration, profilePayload, scanLocalChanges, takeSnapshot,
  type LocalStore, type MigrationPreview, type Snapshot,
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
}
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
  /** serverTime - ora locale (ms) all'ultimo push; null = mai misurato. Positivo = telefono indietro. */
  clockSkewMs: number | null;
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
}

const PUSH_BATCH = 50;
export const SYNC_INTERVAL_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 15_000;
const DEBOUNCE_MS = 2_000;
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
  let status: SyncStatus = {
    signedIn: !!deps.tokenStore.get(), email: deps.accountStore.get()?.email ?? null, phase: 'idle', lastSyncAt: null,
    pendingOps: 0, conflicts: [], error: null, migration: null, remoteIgnored: 0, me: null, clockSkewMs: null,
  };
  const subs = new Set<() => void>();
  const set = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; subs.forEach((f) => f()); };
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
  const getStatus = () => status;

  async function refreshCounts(): Promise<void> {
    const [p, c] = await Promise.all([listPending(), listConflicts()]);
    const items: ConflictItem[] = c.map((r) => ({
      opId: r.opId, entity: r.entity, entityId: r.entityId, reason: r.conflict?.reason ?? 'invalid',
      message: r.conflict?.message ?? 'Operazione non accettata dal server.', label: labelOf(r),
      canUseServer: r.entity !== 'audit' && r.conflict?.serverVersion != null && typeof r.conflict.serverVersion === 'object',
      canKeepBoth: r.entity === 'document' && r.op === 'upsert' && !isLockedDoc(r.payload),
    }));
    set({ pendingOps: p.length, conflicts: items });
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
        else if (op.payload) await store.saveDocument(op.payload as QuoteDocument);
        else return 'skipped';
        return 'applied';
      }
      if (op.entity === 'audit') {
        if (op.op === 'upsert' && op.payload && store.saveAudit) { await store.saveAudit(op.payload as AuditEntry); return 'applied'; }
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
    const lww = rec.entity !== 'audit' && !(rec.entity === 'document' && isLockedDoc(rec.payload));
    if (c.reason === 'stale' && lww && !retried.has(key)) {
      // last-write-wins: l'ultimo push vince. Nuova operazione con la base aggiornata alla versione del server.
      retried.add(key);
      await removeOps([rec.opId]);
      const base = updatedAtOf(c.serverVersion) ?? rec.baseUpdatedAt;
      if (rec.op === 'delete') await enqueueDelete({ entity: rec.entity, entityId: rec.entityId, baseUpdatedAt: base });
      else await enqueueUpsert({ entity: rec.entity, entityId: rec.entityId, payload: rec.payload, baseUpdatedAt: base, hash: rec.hash });
      return;
    }
    await updateOp(rec.opId, { status: 'conflict', conflict: c, attempts: rec.attempts + 1 });
  }

  async function pushAll(): Promise<void> {
    const retried = new Set<string>();
    for (let guard = 0; guard < 1000; guard++) {
      const batch = (await listPending()).slice(0, PUSH_BATCH);
      if (!batch.length) return;
      const t0 = deps.now();
      const res = await api.syncPush({ deviceId: getDeviceId(), ops: batch.map(toSyncOp) });
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
  async function pullAll(): Promise<number> {
    let ignored = 0;
    let cursor = ((await getMeta<string>('cursor')) ?? '0') as string;
    for (let guard = 0; guard < 10_000; guard++) {
      const res = await api.syncPull(cursor);
      if (res.ops.length) {
        const synced = await getSynced();
        const snap = await takeSnapshot(store);
        const local = currentHashes(snap);
        // modifiche locali non ancora sincronizzate (anche in conflitto): non vanno sovrascritte dal pull
        const dirty = new Set(diffSnapshot(snap, synced).map((c) => entityKey(c.entity, c.entityId)));
        for (const r of await listOutbox()) dirty.add(entityKey(r.entity, r.entityId));
        const done: RemoteOp[] = [];
        // più operazioni sulla stessa entità nella pagina: conta solo l'ultima (le precedenti sono superate)
        const lastByKey = new Map<string, RemoteOp>();
        for (const op of res.ops) lastByKey.set(entityKey(op.entity, op.entityId), op);
        for (const op of lastByKey.values()) {
          const key = entityKey(op.entity, op.entityId);
          if (dirty.has(key)) continue; // vincerà l'ultimo push (LWW) o l'utente risolve il conflitto
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
    set({ signedIn: false, email: null, phase: 'idle', error: null, migration: null, me: null, conflicts: [], pendingOps: status.pendingOps, clockSkewMs: null });
  }

  async function cycle(): Promise<void> {
    if (!deps.tokenStore.get()) { signedOutState(); return; }
    if (!status.signedIn) set({ signedIn: true, email: deps.accountStore.get()?.email ?? status.email });
    if (!deps.isOnline()) { await refreshCounts(); set({ phase: 'offline', error: null }); return; }

    if (!(await getMeta<boolean>('migrated'))) {
      const prev = previewMigration(await takeSnapshot(store));
      if (isPreviewEmpty(prev)) await setMeta('migrated', true);
      else { await refreshCounts(); set({ migration: prev, phase: 'idle', error: null }); return; }
    }
    if (status.migration) set({ migration: null });

    set({ phase: 'syncing', error: null });
    try {
      await scanLocalChanges(store, await getSynced());
      await pushAll();
      const ignored = await pullAll();
      const now = deps.now();
      await setMeta('lastSyncAt', now);
      await refreshCounts();
      retryDelay = 5_000;
      clearRetry();
      set({ lastSyncAt: now, remoteIgnored: ignored, phase: status.conflicts.length ? 'conflict' : 'idle' });
    } catch (e) {
      await refreshCounts().catch(() => undefined);
      if (e instanceof ApiClientError && e.status === 401) { signedOutState(); return; }
      if (e instanceof ApiClientError && e.isNetwork) set({ phase: 'offline', error: null });
      else set({ phase: 'error', error: describeError(e) });
      scheduleRetry();
    }
  }

  function syncNow(): Promise<void> {
    if (running) { rerun = true; return running; }
    running = (async () => {
      try { do { rerun = false; await cycle(); } while (rerun); } finally { running = null; }
    })();
    return running;
  }

  /** Solo rilevamento: accoda le modifiche locali e, se ce ne sono, pianifica un sync (debounce). */
  async function scan(): Promise<number> {
    if (running || !deps.tokenStore.get() || status.migration || !(await getMeta<boolean>('migrated'))) return 0;
    const n = await scanLocalChanges(store, await getSynced());
    if (n) { await refreshCounts(); onLocalChange(); }
    return n;
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
    try { const me = await api.me(); set({ me }); return me; } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) signedOutState();
      return status.me;
    }
  }

  const requestCode = (email: string) => api.authRequest(email.trim().toLowerCase());

  /** `acceptedTerms`: versioni di Termini/DPA accettate dall'utente (il server le registra con data/ora). */
  async function verifyCode(email: string, code: string, acceptedTerms?: TermsAcceptance): Promise<void> {
    const mail = email.trim().toLowerCase();
    const res = await api.authVerify({ email: mail, code: code.trim(), deviceId: getDeviceId(), ...(acceptedTerms ? { acceptedTerms } : {}) });
    if (acceptedTerms) termsAcceptanceStore.set(acceptedTerms);
    const prev = deps.accountStore.get();
    // un altro account: lo stato di sync (cursor/hash) appartiene al vecchio tenant
    if (prev && (prev.email !== mail || prev.tenantId !== res.tenantId)) await clearSyncState();
    deps.tokenStore.set(res.token);
    deps.accountStore.set({ email: mail, tenantId: res.tenantId });
    set({ signedIn: true, email: mail, error: null, phase: 'idle' });
    await refreshMe();
    await syncNow();
  }

  /** Esci: il token viene cancellato; i dati locali restano intatti. */
  function signOut(): void {
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
    set({ migration: null });
    await syncNow();
  }

  // ------------------------------------------------------------ risoluzione conflitti
  async function resolveConflict(opId: string, choice: ConflictChoice): Promise<void> {
    const rec = (await listConflicts()).find((r) => r.opId === opId);
    if (!rec) return;
    const server = rec.conflict?.serverVersion;
    const key = entityKey(rec.entity, rec.entityId);
    const useServer = async () => {
      if (rec.op === 'upsert' && server && typeof server === 'object') {
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
      const d = rec.payload as QuoteDocument;
      const now = deps.now();
      await store.saveDocument({ ...d, id: uid(), number: `${d.number} (copia)`, createdAt: now, updatedAt: now });
      if (server) await useServer(); else await removeOps([rec.opId]);
    } else if (choice === 'keep-local') {
      // L'utente accetta che la copia locale resti diversa da quella del server: non verrà più inviata.
      await setSynced([[key, { hash: rec.hash ?? hashValue(rec.payload), updatedAt: updatedAtOf(server) ?? rec.baseUpdatedAt }]]);
      await removeOps([rec.opId]);
    } else {
      // retry: nuova operazione, base = versione del server (es. dopo il passaggio a Pro)
      await removeOps([rec.opId]);
      const base = updatedAtOf(server) ?? rec.baseUpdatedAt;
      if (rec.op === 'delete') await enqueueDelete({ entity: rec.entity, entityId: rec.entityId, baseUpdatedAt: base });
      else await enqueueUpsert({ entity: rec.entity, entityId: rec.entityId, payload: rec.payload, baseUpdatedAt: base, hash: rec.hash });
    }
    await refreshCounts();
    if (!status.conflicts.length && status.phase === 'conflict') set({ phase: 'idle' });
    if (choice === 'retry') void syncNow();
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
};

export const syncEngine: SyncEngine = createSyncEngine({
  api: defaultApi,
  store: defaultLocalStore,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  tokenStore: defaultTokenStore,
  accountStore: defaultAccountStore,
  now: () => Date.now(),
});
