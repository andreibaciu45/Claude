// Router voce (montato da app.ts su /v1/voice): trascrizione server (iOS PWA) e fallback LLM.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  apiError, authGate, systemClock, type AppEnv, type Clock, type Env, type RateLimiter,
} from '../billing/common';
import { addUsage as addCoreUsage, getUsage as getCoreUsage } from '../db/entitlements';
import { dbRateLimitStore } from '../db/ratelimit';
import { billingService } from '../billing/routes';
import type { Plan } from '../billing/entitlements';
import {
  buildPrompt, costUsd, InterpretBodySchema, llmFromEnv, sanitizeContext, validateLlmOutput, type IntentLlm,
} from './interpret';
import { sttFromEnv, type SttProvider } from './stt';

export const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac'];
export const DEFAULTS = {
  maxAudioBytes: 2 * 1024 * 1024,
  maxDurationMs: 30_000,
  minutesFree: 20, // ARCH §3.3
  minutesPro: 120,
  interpretPerDay: 30, // ARCH §4.4
};

export interface VoiceMetric { name: 'voice.transcribe' | 'voice.interpret'; tenantId: string; costUsd: number; units: number; unit: 'ms' | 'tokens' }
export interface VoiceDeps {
  stt: () => SttProvider | null;
  llm: () => IntentLlm | null;
  getPlan: (tenantId: string) => Promise<Plan>;
  clock: Clock;
  env: () => Env;
  /** Metrica di costo: default log JSON su stdout (nessun contenuto utente). */
  metric: (m: VoiceMetric) => void;
  transcribeLimiter: RateLimiter;
  interpretLimiter: RateLimiter;
  /** Consumo STT del mese corrente per tenant (ms). Default: tabella `usage` di CORE. */
  usage: { getMs(tenantId: string, now: number): number; addMs(tenantId: string, ms: number, now: number): void };
}

export function inMemoryVoiceUsage(): VoiceDeps['usage'] {
  const m = new Map<string, number>();
  const k = (t: string, now: number) => `${t}|${new Date(now).toISOString().slice(0, 7)}`;
  return { getMs: (t, n) => m.get(k(t, n)) ?? 0, addMs: (t, ms, n) => void m.set(k(t, n), (m.get(k(t, n)) ?? 0) + ms) };
}

/** RateLimiter su DB (persistito, sopravvive ai riavvii): i limiti di COSTO (STT/LLM) non devono azzerarsi a ogni deploy. */
export function dbLimiter(prefix: string, opts: { limit: number; windowMs: number }): RateLimiter {
  return {
    hit(key) {
      const r = dbRateLimitStore.hit(`${prefix}:${key}`, opts.limit, opts.windowMs);
      return { allowed: r.ok, remaining: r.remaining, resetAt: r.resetAt };
    },
  };
}

/**
 * Durata minima plausibile dell'audio dalla sola dimensione (il client dichiara durationMs, ma non fa fede):
 * si usa il bitrate più alto ragionevole per il formato. Serve ad addebitare la quota anche se il client dichiara 1 ms per un file lungo.
 */
export function estimateMinDurationMs(bytes: number, mime: string): number {
  const bytesPerSec = mime.includes('wav') ? 192_000 : 40_000; // WAV 48 kHz stereo 16 bit; compressi ~320 kbit/s
  return Math.floor((bytes / bytesPerSec) * 1000);
}

let sttEnv: SttProvider | null | undefined;
let llmEnv: IntentLlm | null | undefined;
export const defaultVoiceDeps: VoiceDeps = {
  stt: () => (sttEnv ??= sttFromEnv(process.env)),
  llm: () => (llmEnv ??= llmFromEnv(process.env)),
  getPlan: async (t) => (await billingService.getEntitlement(t)).plan,
  clock: systemClock,
  env: () => process.env,
  metric: (m) => console.info(JSON.stringify({ metric: m.name, tenantId: m.tenantId, costUsd: m.costUsd, units: m.units, unit: m.unit })),
  transcribeLimiter: dbLimiter('voice:tr', { limit: 10, windowMs: 60_000 }),
  interpretLimiter: dbLimiter('voice:int', { limit: DEFAULTS.interpretPerDay, windowMs: 86_400_000 }),
  usage: {
    getMs: (t) => getCoreUsage(t).sttSeconds * 1000,
    addMs: (t, ms) => addCoreUsage(t, { sttSeconds: ms >= 0 ? Math.ceil(ms / 1000) : -Math.ceil(-ms / 1000) }),
  },
};

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export function createVoiceRoutes(deps: VoiceDeps = defaultVoiceDeps) {
  const r = new Hono<AppEnv>();

  r.post(
    '/transcribe',
    authGate,
    // Limite sul flusso reale (non solo su Content-Length). Margine per l'overhead multipart.
    (c, next) => bodyLimit({
      maxSize: num(deps.env().VOICE_MAX_AUDIO_BYTES, DEFAULTS.maxAudioBytes) + 8192,
      onError: (cc) => cc.json(apiError('payload_too_large', 'Audio troppo grande'), 413),
    })(c, next),
    async (c) => {
      const env = deps.env();
      const stt = deps.stt();
      if (!stt) return c.json(apiError('stt_unavailable', 'Trascrizione server non disponibile: usa il campo di testo'), 503);
      const tenantId = c.get('tenantId');
      const rl = deps.transcribeLimiter.hit(tenantId);
      if (!rl.allowed) return c.json(apiError('rate_limited', 'Troppe richieste, riprova tra poco'), 429);

      const maxBytes = num(env.VOICE_MAX_AUDIO_BYTES, DEFAULTS.maxAudioBytes);
      const maxMs = num(env.VOICE_MAX_DURATION_MS, DEFAULTS.maxDurationMs);
      let form: FormData;
      try { form = await c.req.formData(); } catch { return c.json(apiError('invalid_body', 'Richiesta multipart attesa'), 400); }
      const file = form.get('audio');
      if (!(file instanceof File)) return c.json(apiError('invalid_body', "Campo 'audio' mancante"), 400);
      const mime = (file.type || '').split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED_AUDIO_MIME.includes(mime)) return c.json(apiError('unsupported_media_type', 'Formato audio non supportato'), 415);
      if (file.size === 0) return c.json(apiError('invalid_body', 'Audio vuoto'), 400);
      if (file.size > maxBytes) return c.json(apiError('payload_too_large', 'Audio troppo grande'), 413);
      const durRaw = form.get('durationMs');
      let durationMs = maxMs; // dichiarata dal client; se assente si assume il tetto (prudente per la quota)
      if (typeof durRaw === 'string' && durRaw !== '') {
        const d = Number(durRaw);
        if (!Number.isFinite(d) || d <= 0) return c.json(apiError('invalid_body', 'durationMs non valido'), 400);
        if (d > maxMs) return c.json(apiError('audio_too_long', `Durata massima ${Math.round(maxMs / 1000)} s`), 413);
        durationMs = d;
      }

      durationMs = Math.max(durationMs, estimateMinDurationMs(file.size, mime)); // addebito prudente (vedi estimateMinDurationMs)
      // Quota minuti mensile per piano
      const plan = await deps.getPlan(tenantId);
      const limitMs = (plan === 'pro' ? num(env.VOICE_MINUTES_PRO, DEFAULTS.minutesPro) : num(env.VOICE_MINUTES_FREE, DEFAULTS.minutesFree)) * 60_000;
      const used = deps.usage.getMs(tenantId, deps.clock.now());
      if (used + durationMs > limitMs) return c.json(apiError('quota_exceeded', 'Quota di trascrizione mensile esaurita'), 429);
      // PRENOTAZIONE immediata (nessun await tra controllo e addebito): addebitando solo a trascrizione finita, N richieste in parallelo
      // passavano tutte il controllo con lo stesso consumo e la quota mensile veniva superata di N volte la durata massima.
      deps.usage.addMs(tenantId, durationMs, deps.clock.now());

      let buf: Uint8Array | null = null;
      try {
        buf = new Uint8Array(await file.arrayBuffer());
        const vocab = typeof form.get('vocabulary') === 'string'
          ? String(form.get('vocabulary')).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60) : undefined;
        const res = await stt.transcribe({ audio: buf, mime, vocabulary: vocab });
        deps.metric({ name: 'voice.transcribe', tenantId, costUsd: res.costUsd ?? 0, units: durationMs, unit: 'ms' });
        return c.json({ text: res.text });
      } catch {
        try { deps.usage.addMs(tenantId, -durationMs, deps.clock.now()); } catch { /* la prenotazione resta: meglio addebitare che regalare quota */ } // trascrizione fallita: nessun addebito
        return c.json(apiError('stt_failed', 'Trascrizione non riuscita'), 502); // nessun dettaglio/audio
      } finally {
        buf?.fill(0); // cancellazione best-effort dalla memoria
        buf = null;
      }
    },
  );

  r.post('/interpret', authGate, async (c) => {
    const llm = deps.llm();
    if (!llm) return c.json(apiError('llm_unavailable', 'Interpretazione avanzata non disponibile'), 503);
    const parsed = InterpretBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(apiError('invalid_body', 'transcript mancante o troppo lungo (max 500)'), 400);
    const tenantId = c.get('tenantId');
    if (!deps.interpretLimiter.hit(tenantId).allowed) return c.json(apiError('quota_exceeded', 'Limite giornaliero di interpretazioni raggiunto'), 429);

    const env = deps.env();
    const { system, user } = buildPrompt(parsed.data.transcript, sanitizeContext(parsed.data.context));
    try {
      const { raw, usage } = await llm.complete({ system, user });
      const cost = costUsd(usage, Number(env.LLM_PRICE_IN_PER_MTOK) || 0, Number(env.LLM_PRICE_OUT_PER_MTOK) || 0);
      deps.metric({ name: 'voice.interpret', tenantId, costUsd: cost, units: usage.inputTokens + usage.outputTokens, unit: 'tokens' });
      return c.json(validateLlmOutput(raw));
    } catch {
      return c.json(apiError('llm_failed', 'Interpretazione non riuscita'), 502);
    }
  });

  return r;
}

export const voiceRoutes = createVoiceRoutes();
