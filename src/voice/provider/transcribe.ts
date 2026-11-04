/** Invio dell'audio a POST /v1/voice/transcribe (multipart). Nessun segreto nel codice: il token viene dallo stato locale. */
import type { TranscribeResponse } from '../../../shared/api';

export type TranscribeErrorCode = 'offline' | 'network' | 'unauthorized' | 'too-large' | 'quota' | 'server' | 'empty';

const MESSAGES: Record<TranscribeErrorCode, string> = {
  offline: 'Sei offline: la trascrizione vocale richiede internet. Riprova quando sei connesso, oppure scrivi il comando.',
  network: 'Connessione assente o instabile: non sono riuscito a inviare l’audio. Riprova oppure scrivi il comando.',
  unauthorized: 'Per la trascrizione vocale da questo dispositivo serve accedere al tuo account (sezione Account). Oppure scrivi il comando.',
  'too-large': 'La registrazione è troppo lunga. Prova con una frase più breve.',
  quota: 'Hai raggiunto il limite di trascrizioni vocali per ora. Scrivi il comando oppure riprova più tardi.',
  server: 'Il servizio di trascrizione non risponde. Riprova tra poco oppure scrivi il comando.',
  empty: 'Non ho sentito nulla. Avvicinati al telefono e riprova.',
};

export class TranscribeError extends Error {
  readonly code: TranscribeErrorCode;
  constructor(code: TranscribeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'TranscribeError';
    this.code = code;
  }
}

export const DEFAULT_API_BASE: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? '/v1';
const TOKEN_KEY = 'vp:sync:token'; // stessa chiave di src/sync/api.ts (SYNC-CLIENT)

function storedToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export interface TranscribeOptions {
  /** default: VITE_API_URL oppure '/v1' */
  baseUrl?: string;
  /** Bearer token; default: quello salvato dall'account, se presente */
  token?: string | null | (() => string | null);
  /** nomi/alias del catalogo e dei clienti: migliorano il riconoscimento lato server */
  vocabulary?: string[];
  lang?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
}

const extFor = (type: string) => (type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm');

export async function transcribeAudio(blob: Blob, opts: TranscribeOptions = {}): Promise<string> {
  const isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  if (!isOnline()) throw new TranscribeError('offline');
  const base = (opts.baseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const tokenVal = typeof opts.token === 'function' ? opts.token() : opts.token === undefined ? storedToken() : opts.token;

  const form = new FormData();
  form.append('audio', blob, `voce.${extFor(blob.type || '')}`);
  form.append('lang', opts.lang ?? 'it-IT');
  if (opts.vocabulary?.length) form.append('vocabulary', opts.vocabulary.slice(0, 200).join(', ').slice(0, 1500));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${base}/voice/transcribe`, {
      method: 'POST',
      body: form,
      headers: tokenVal ? { Authorization: `Bearer ${tokenVal}` } : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new TranscribeError(isOnline() ? 'network' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new TranscribeError('unauthorized');
    if (res.status === 413) throw new TranscribeError('too-large');
    if (res.status === 402 || res.status === 429) throw new TranscribeError('quota');
    throw new TranscribeError('server');
  }
  let body: Partial<TranscribeResponse>;
  try { body = (await res.json()) as Partial<TranscribeResponse>; } catch { throw new TranscribeError('server'); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new TranscribeError('empty');
  return text;
}
