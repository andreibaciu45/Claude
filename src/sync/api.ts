/**
 * Client HTTP tipizzato per l'API v2 (shared/api.ts). Nessuna dipendenza da React.
 * - base URL: VITE_API_URL oppure '/v1'
 * - token Bearer in localStorage (tutti gli accessi protetti da try/catch)
 * - retry con backoff esponenziale SOLO per errori di rete/timeout (mai per risposte HTTP)
 * - 401 su una chiamata autenticata => token cancellato + callback onUnauthorized (logout)
 */
import type {
  AuthRequestBody, AuthVerifyBody, AuthVerifyResponse, CheckoutResponse, MeResponse, PortalResponse,
  DeleteAccountBody, SyncPullResponse, SyncPushBody, SyncPushResponse, ApiError as ApiErrorBody,
} from '../../shared/api';
import { uid } from '../types';

const TOKEN_KEY = 'vp:sync:token';
const DEVICE_KEY = 'vp:sync:deviceId';
const ACCOUNT_KEY = 'vp:sync:account';

export const API_BASE_URL: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? '/v1';

/** Errore del client API. `status` 0 = errore di rete/timeout. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  /** secondi da attendere (header Retry-After), se il server li ha indicati */
  readonly retryAfterSec?: number;
  constructor(status: number, code: string, message: string, retryAfterSec?: number) {
    super(message);
    this.retryAfterSec = retryAfterSec;
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
  get isNetwork(): boolean { return this.status === 0; }
}

// ---- persistenza locale (mai fa lanciare l'app) ----
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
function lsDel(k: string): void { try { localStorage.removeItem(k); } catch { /* ignora */ } }

export const tokenStore = {
  get: (): string | null => lsGet(TOKEN_KEY),
  set: (t: string): void => lsSet(TOKEN_KEY, t),
  clear: (): void => lsDel(TOKEN_KEY),
};

/** Id dispositivo: generato una sola volta e mantenuto anche dopo il logout. */
let memDeviceId: string | null = null;
export function getDeviceId(): string {
  const stored = lsGet(DEVICE_KEY);
  if (stored) return stored;
  if (memDeviceId) return memDeviceId;
  const id = uid();
  memDeviceId = id;
  lsSet(DEVICE_KEY, id);
  return id;
}

export interface StoredAccount { email: string; tenantId: string }
export const accountStore = {
  get(): StoredAccount | null {
    const raw = lsGet(ACCOUNT_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as StoredAccount; } catch { return null; }
  },
  set: (a: StoredAccount): void => lsSet(ACCOUNT_KEY, JSON.stringify(a)),
  clear: (): void => lsDel(ACCOUNT_KEY),
};

/** `shared/api.ts` espone solo confirmEmail; il server accetta anche acknowledgeSubscription (cancellare con abbonamento attivo). */
export type DeleteAccountRequest = DeleteAccountBody & { acknowledgeSubscription?: boolean };
/** Risposta di DELETE /v1/me (non ancora tipizzata in shared/api.ts). */
export interface DeleteAccountResult { deleted: boolean; mode?: 'purged' | 'anonymized'; retainedInvoices?: number }

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
  timeoutMs?: number;
  /** tentativi totali per errori di rete (default 3) */
  maxAttempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ApiClient {
  authRequest(email: string): Promise<void>;
  authVerify(body: AuthVerifyBody): Promise<AuthVerifyResponse>;
  me(): Promise<MeResponse>;
  syncPush(body: SyncPushBody): Promise<SyncPushResponse>;
  syncPull(cursor: string): Promise<SyncPullResponse>;
  checkout(plan: 'month' | 'year'): Promise<CheckoutResponse>;
  portal(): Promise<PortalResponse>;
  /** GET /v1/me/export: tutti i dati dell'utente (JSON) come file da salvare. */
  exportData(): Promise<Blob>;
  /** DELETE /v1/me */
  deleteAccount(body: DeleteAccountRequest): Promise<DeleteAccountResult>;
}

/** Retry-After: secondi interi oppure data HTTP. */
export function parseRetryAfter(v: string | null | undefined, nowMs = Date.now()): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d+$/.test(t)) return Math.min(Number(t), 86_400);
  const d = Date.parse(t);
  return Number.isFinite(d) ? Math.min(Math.max(0, Math.ceil((d - nowMs) / 1000)), 86_400) : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const base = (opts.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 20000;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const backoff = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const getToken = opts.getToken ?? tokenStore.get;

  async function once(method: string, path: string, body: unknown, auth: boolean): Promise<Response> {
    const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) {
        const t = getToken();
        if (t) headers.Authorization = `Bearer ${t}`;
      }
      return await f(`${base}${path}`, {
        method, headers, signal: ctrl.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(method: string, path: string, body: unknown, auth = true, as: 'json' | 'blob' = 'json'): Promise<T> {
    let res: Response | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await once(method, path, body, auth);
        break;
      } catch (e) {
        // solo errori di rete / timeout arrivano qui
        if (attempt >= maxAttempts) {
          const timedOut = e instanceof DOMException && e.name === 'AbortError';
          throw new ApiClientError(0, timedOut ? 'timeout' : 'network', timedOut ? 'Il server non risponde.' : 'Nessuna connessione al server.');
        }
        await sleep(backoff * 2 ** (attempt - 1));
      }
    }
    if (!res) throw new ApiClientError(0, 'network', 'Nessuna connessione al server.');
    if (res.ok) {
      if (as === 'blob') return (await res.blob()) as T;
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    let code = 'http_error';
    let message = `Errore del server (${res.status}).`;
    try {
      const j = (await res.json()) as Partial<ApiErrorBody>;
      if (j?.error) { code = j.error.code ?? code; message = j.error.message ?? message; }
    } catch { /* corpo non JSON */ }
    if (res.status === 401 && auth) {
      tokenStore.clear();
      opts.onUnauthorized?.();
    }
    throw new ApiClientError(res.status, code, message, parseRetryAfter(res.headers?.get('Retry-After')));
  }

  return {
    authRequest: (email) => request<void>('POST', '/auth/request', { email } satisfies AuthRequestBody, false),
    authVerify: (body) => request<AuthVerifyResponse>('POST', '/auth/verify', body, false),
    me: () => request<MeResponse>('GET', '/me', undefined),
    syncPush: (body) => request<SyncPushResponse>('POST', '/sync/push', body),
    syncPull: (cursor) => request<SyncPullResponse>('GET', `/sync/pull?cursor=${encodeURIComponent(cursor)}`, undefined),
    checkout: (plan) => request<CheckoutResponse>('POST', '/billing/checkout', { plan }),
    portal: () => request<PortalResponse>('POST', '/billing/portal', {}),
    exportData: () => request<Blob>('GET', '/me/export', undefined, true, 'blob'),
    deleteAccount: (body) => request<DeleteAccountResult>('DELETE', '/me', body),
  };
}

/** "tra 30 secondi" / "tra 2 minuti" */
export function waitPhrase(sec: number): string {
  if (sec < 90) { const n = Math.max(1, Math.round(sec)); return `${n} ${n === 1 ? 'secondo' : 'secondi'}`; }
  const m = Math.round(sec / 60);
  if (m < 90) return `${m} minuti`;
  const h = Math.round(m / 60);
  return `${h} ${h === 1 ? 'ora' : 'ore'}`;
}

/** Messaggio italiano leggibile per qualsiasi errore (rete, limiti, codici noti del server). */
export function describeError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.isNetwork) {
      return e.code === 'timeout'
        ? 'Il server non risponde. Riprova tra poco.'
        : 'Impossibile contattare il server. Controlla la connessione e riprova.';
    }
    switch (e.code) {
      case 'terms_required': return 'Per creare l\u2019account devi accettare i Termini di servizio, l\u2019Informativa privacy e il DPA.';
      case 'terms_version_mismatch': return 'I Termini sono stati aggiornati. Ricarica l\u2019app per avere la versione pi\u00f9 recente, poi accetta di nuovo.';
      case 'confirmation_mismatch': return 'L\u2019email scritta non coincide con quella dell\u2019account. Controlla e riprova.';
      case 'active_subscription': return 'Hai un abbonamento attivo: annullalo dal portale di fatturazione prima di cancellare l\u2019account.';
      default: break;
    }
    if (e.status === 429) {
      return e.retryAfterSec ? `Troppe richieste. Riprova tra ${waitPhrase(e.retryAfterSec)}.` : 'Troppe richieste. Attendi qualche minuto e riprova.';
    }
    if (e.status >= 500) return `Il servizio ha un problema temporaneo (errore ${e.status}). Riprova tra qualche minuto: i tuoi dati sul dispositivo sono al sicuro.`;
    if (e.status === 401) return 'La sessione \u00e8 scaduta. Accedi di nuovo.';
    if (e.status === 413) return 'La richiesta \u00e8 troppo grande per il server.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Errore imprevisto.';
}

// ---- istanza predefinita dell'app ----
let unauthorizedHandler: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null): void => { unauthorizedHandler = fn; };
export const api: ApiClient = createApiClient({ onUnauthorized: () => unauthorizedHandler?.() });
