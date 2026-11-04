/**
 * Client HTTP tipizzato per l'API v2 (shared/api.ts). Nessuna dipendenza da React.
 * - base URL: VITE_API_URL oppure '/v1'
 * - token Bearer in localStorage (tutti gli accessi protetti da try/catch)
 * - retry con backoff esponenziale SOLO per errori di rete/timeout (mai per risposte HTTP)
 * - 401 su una chiamata autenticata => token cancellato + callback onUnauthorized (logout)
 */
import type {
  AuthRequestBody, AuthVerifyBody, AuthVerifyResponse, CheckoutResponse, MeResponse, PortalResponse,
  SyncPullResponse, SyncPushBody, SyncPushResponse, ApiError as ApiErrorBody,
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
  constructor(status: number, code: string, message: string) {
    super(message);
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

  async function request<T>(method: string, path: string, body: unknown, auth = true): Promise<T> {
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
    throw new ApiClientError(res.status, code, message);
  }

  return {
    authRequest: (email) => request<void>('POST', '/auth/request', { email } satisfies AuthRequestBody, false),
    authVerify: (body) => request<AuthVerifyResponse>('POST', '/auth/verify', body, false),
    me: () => request<MeResponse>('GET', '/me', undefined),
    syncPush: (body) => request<SyncPushResponse>('POST', '/sync/push', body),
    syncPull: (cursor) => request<SyncPullResponse>('GET', `/sync/pull?cursor=${encodeURIComponent(cursor)}`, undefined),
    checkout: (plan) => request<CheckoutResponse>('POST', '/billing/checkout', { plan }),
    portal: () => request<PortalResponse>('POST', '/billing/portal', {}),
  };
}

/** Messaggio italiano leggibile per qualsiasi errore. */
export function describeError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.isNetwork) return 'Impossibile contattare il server. Controlla la connessione e riprova.';
    if (e.status === 429) return 'Troppi tentativi. Attendi qualche minuto e riprova.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Errore imprevisto.';
}

// ---- istanza predefinita dell'app ----
let unauthorizedHandler: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null): void => { unauthorizedHandler = fn; };
export const api: ApiClient = createApiClient({ onUnauthorized: () => unauthorizedHandler?.() });
