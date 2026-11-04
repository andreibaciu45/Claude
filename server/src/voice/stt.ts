// Provider STT dietro interfaccia. L'audio vive SOLO in memoria; mai su disco, mai nei log.
import type { Env } from '../billing/common';

export interface SttInput { audio: Uint8Array; mime: string; vocabulary?: string[] }
export interface SttResult { text: string; costUsd?: number }
export interface SttProvider { readonly id: string; transcribe(input: SttInput): Promise<SttResult> }

export class MockSttProvider implements SttProvider {
  readonly id = 'mock';
  calls = 0;
  constructor(private text = 'nuovo preventivo per Rossi') {}
  async transcribe() { this.calls++; return { text: this.text, costUsd: 0 }; }
}

/** Adattatore generico per endpoint compatibili OpenAI-audio (`POST {base}/audio/transcriptions`). */
export class HttpSttProvider implements SttProvider {
  readonly id = 'http';
  constructor(
    private cfg: { baseUrl: string; apiKey: string; model: string; usdPerMinute?: number },
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}
  async transcribe(input: SttInput): Promise<SttResult> {
    const form = new FormData();
    const ext = input.mime.includes('mp4') || input.mime.includes('m4a') ? 'm4a' : input.mime.includes('ogg') ? 'ogg'
      : input.mime.includes('wav') ? 'wav' : input.mime.includes('mpeg') ? 'mp3' : 'webm';
    form.append('file', new Blob([input.audio as unknown as ArrayBuffer], { type: input.mime }), `audio.${ext}`);
    form.append('model', this.cfg.model);
    form.append('language', 'it');
    form.append('response_format', 'json');
    if (input.vocabulary?.length) form.append('prompt', input.vocabulary.slice(0, 60).join(', ').slice(0, 600));
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, body: form,
    });
    if (!res.ok) throw new Error(`STT HTTP ${res.status}`); // mai includere il corpo/audio nell'errore
    const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
    if (!json || typeof json.text !== 'string') throw new Error('risposta STT non valida');
    return { text: json.text };
  }
}

export function sttFromEnv(env: Env, fetchImpl?: typeof fetch): SttProvider | null {
  if (env.STT_PROVIDER === 'mock' && env.NODE_ENV !== 'production') return new MockSttProvider();
  if (env.STT_PROVIDER === 'http' && env.STT_BASE_URL && env.STT_API_KEY) {
    return new HttpSttProvider({ baseUrl: env.STT_BASE_URL, apiKey: env.STT_API_KEY, model: env.STT_MODEL ?? 'gpt-4o-mini-transcribe' }, fetchImpl);
  }
  return null;
}
