/**
 * Flusso di aggiornamento del service worker (senza React, testabile con un finto `navigator.serviceWorker`).
 *
 * - rileva una nuova versione: `registration.waiting` all'avvio, `updatefound` -> `installed`, oppure
 *   `controllerchange` quando c'era già un controller (il sw.js v3 fa skipWaiting da solo);
 * - controllo periodico (ogni ora) e quando l'app torna in primo piano;
 * - `apply()` NON ricarica finché il registro `busy` ha lavori in corso: la richiesta resta in attesa e
 *   parte da sola appena tutto è libero;
 * - non ricarica mai senza che l'utente abbia premuto "Aggiorna ora".
 * Tutti gli errori sono assorbiti (al massimo un console.debug): l'app funziona anche senza service worker.
 */
import { busy as defaultBusy, type BusyRegistry } from './busy';

export interface UpdateState {
  /** c'è una versione nuova pronta */
  available: boolean;
  /** l'utente ha chiesto l'aggiornamento ma c'è un lavoro in corso: parte appena finisce */
  waitingForIdle: boolean;
  /** utente ha scelto "Più tardi" (per questa sessione e fino alla prossima nuova versione) */
  dismissed: boolean;
}

export interface SwContainerLike {
  controller: unknown;
  register(url: string, opts?: unknown): Promise<RegistrationLike>;
  addEventListener(type: string, l: () => void): void;
}
export interface RegistrationLike {
  waiting: { postMessage(m: unknown): void } | null;
  installing: (EventTargetLike & { state: string }) | null;
  addEventListener(type: string, l: () => void): void;
  update(): Promise<unknown>;
}
interface EventTargetLike { addEventListener(type: string, l: () => void): void }

export interface UpdaterDeps {
  container: SwContainerLike;
  busy?: BusyRegistry;
  reload?: () => void;
  /** ms tra due controlli periodici (default 1 ora) */
  checkEveryMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  /** per sottoscriversi al ritorno in primo piano; restituisce una funzione di rimozione */
  onForeground?: (fn: () => void) => void;
  log?: (msg: string, err?: unknown) => void;
}

export interface Updater {
  getState(): UpdateState;
  subscribe(l: () => void): () => void;
  register(swUrl: string): Promise<void>;
  checkNow(): Promise<void>;
  apply(): void;
  dismiss(): void;
}

export const HOUR_MS = 60 * 60 * 1000;

export function createUpdater(deps: UpdaterDeps): Updater {
  const { container } = deps;
  const busy = deps.busy ?? defaultBusy;
  const reload = deps.reload ?? (() => window.location.reload());
  const log = deps.log ?? ((m, e) => { try { console.debug(`[pwa] ${m}`, e ?? ''); } catch { /* */ } });
  let state: UpdateState = { available: false, waitingForIdle: false, dismissed: false };
  const listeners = new Set<() => void>();
  let reg: RegistrationLike | null = null;
  let hadController = !!container.controller;
  let reloadOnControllerChange = false;
  let reloading = false;

  const set = (patch: Partial<UpdateState>) => {
    const next = { ...state, ...patch };
    if (next.available === state.available && next.waitingForIdle === state.waitingForIdle && next.dismissed === state.dismissed) return;
    state = next;
    for (const l of [...listeners]) { try { l(); } catch { /* */ } }
  };
  const markAvailable = () => {
    if (!state.available) set({ available: true, dismissed: false });
  };
  const doReload = () => {
    if (reloading) return;
    reloading = true;
    try { reload(); } catch (e) { reloading = false; log('reload fallito', e); }
  };
  /** Esegue l'aggiornamento adesso (da chiamare solo quando non c'è lavoro in corso). */
  const run = () => {
    set({ waitingForIdle: false });
    const w = reg?.waiting;
    if (w) {
      reloadOnControllerChange = true;
      try { w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { log('SKIP_WAITING fallito', e); doReload(); }
    } else {
      doReload(); // il nuovo worker ha già il controllo (sw.js v3): basta ricaricare per avere i file nuovi
    }
  };
  busy.subscribe(() => { if (state.waitingForIdle && !busy.isBusy()) run(); });

  const watch = (r: RegistrationLike) => {
    if (r.waiting && container.controller) markAvailable();
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && container.controller) markAvailable();
      });
    });
  };

  const api: Updater = {
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    async register(swUrl) {
      try {
        reg = await container.register(swUrl);
        watch(reg);
      } catch (e) { log('registrazione non riuscita', e); return; }
      container.addEventListener('controllerchange', () => {
        if (reloadOnControllerChange) { doReload(); return; } // l'utente l'aveva chiesto e non c'è lavoro in corso
        if (hadController) markAvailable();                    // nuova versione già attiva: serve ricaricare per i file nuovi
        hadController = true;
      });
      const every = deps.checkEveryMs ?? HOUR_MS;
      (deps.setInterval ?? ((fn, ms) => window.setInterval(fn, ms)))(() => { void api.checkNow(); }, every);
      deps.onForeground?.(() => { void api.checkNow(); });
    },
    async checkNow() {
      try { await reg?.update(); } catch (e) { log('controllo aggiornamenti non riuscito', e); }
    },
    apply() {
      if (!state.available) return;
      if (busy.isBusy()) { set({ waitingForIdle: true, dismissed: false }); return; }
      run();
    },
    dismiss() { set({ dismissed: true, waitingForIdle: false }); },
  };
  return api;
}

let singleton: Updater | null = null;
/** Updater condiviso dell'app (browser reale). */
export function getUpdater(): Updater | null {
  if (singleton) return singleton;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  singleton = createUpdater({
    container: navigator.serviceWorker as unknown as SwContainerLike,
    onForeground: (fn) => document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fn(); }),
  });
  return singleton;
}
