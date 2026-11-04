import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHolder, createRateLimiter } from '../../src/billing/common';
import {
  ALLOWED_INTENTS, costUsd, HttpIntentLlm, InterpretBodySchema, MockIntentLlm, sanitizeContext, validateLlmOutput,
} from '../../src/voice/interpret';
import { createVoiceRoutes, inMemoryVoiceUsage, type VoiceDeps, type VoiceMetric } from '../../src/voice/routes';
import { HttpSttProvider, MockSttProvider, sttFromEnv } from '../../src/voice/stt';
import { AUTH, fakeAuth, fakeClock } from './helpers';

let deps: VoiceDeps; let stt: MockSttProvider | null; let llm: MockIntentLlm | null; let env: Record<string, string>;
let metrics: VoiceMetric[]; let plan: 'free' | 'pro';
beforeEach(() => {
  authHolder.requireAuth = fakeAuth;
  stt = new MockSttProvider('nuova fattura per Bianchi'); llm = new MockIntentLlm(); env = {}; metrics = []; plan = 'free';
  const clock = fakeClock();
  deps = {
    stt: () => stt, llm: () => llm, getPlan: async () => plan, clock, env: () => env, metric: (m) => metrics.push(m),
    transcribeLimiter: createRateLimiter({ limit: 50, windowMs: 60_000, clock }),
    interpretLimiter: createRateLimiter({ limit: 50, windowMs: 86_400_000, clock }),
    usage: inMemoryVoiceUsage(),
  };
});
const upload = (opts: { type?: string; size?: number; dur?: string; field?: string; headers?: Record<string, string> } = {}) => {
  const fd = new FormData();
  fd.append(opts.field ?? 'audio', new File([new Uint8Array(opts.size ?? 1000)], 'a.webm', { type: opts.type ?? 'audio/webm;codecs=opus' }));
  if (opts.dur !== undefined) fd.append('durationMs', opts.dur);
  return createVoiceRoutes(deps).request('/transcribe', { method: 'POST', headers: opts.headers ?? AUTH, body: fd });
};

describe('POST /transcribe', () => {
  it('ok, con metrica; mime con parametri codec accettato', async () => {
    const r = await upload({ dur: '4000' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: 'nuova fattura per Bianchi' });
    expect(metrics[0]).toMatchObject({ name: 'voice.transcribe', tenantId: 't1', units: 4000 });
  });
  it('401 senza auth; 503 senza provider', async () => {
    expect((await upload({ headers: {} })).status).toBe(401);
    stt = null;
    expect((await upload()).status).toBe(503);
  });
  it('limite dimensione (campo e flusso)', async () => {
    env.VOICE_MAX_AUDIO_BYTES = '5000';
    expect((await upload({ size: 4000 })).status).toBe(200);
    expect((await upload({ size: 5001 })).status).toBe(413);
    expect((await upload({ size: 1_000_000 })).status).toBe(413); // bloccato dal bodyLimit
    expect(stt!.calls).toBe(1);
  });
  it('tipo MIME e campo mancante', async () => {
    expect((await upload({ type: 'application/pdf' })).status).toBe(415);
    expect((await upload({ type: '' })).status).toBe(415);
    expect((await upload({ field: 'altro' })).status).toBe(400);
    expect((await upload({ size: 0 })).status).toBe(400);
  });
  it('durata: oltre 30 s => 413, non numerica => 400', async () => {
    expect((await upload({ dur: '30001' })).status).toBe(413);
    expect((await upload({ dur: '30000' })).status).toBe(200);
    expect((await upload({ dur: 'abc' })).status).toBe(400);
    expect((await upload({ dur: '-5' })).status).toBe(400);
  });
  it('rate-limit per tenant (isolato tra tenant)', async () => {
    deps.transcribeLimiter = createRateLimiter({ limit: 3, windowMs: 60_000, clock: deps.clock });
    for (let i = 0; i < 3; i++) expect((await upload({ dur: '1000' })).status).toBe(200);
    expect((await upload({ dur: '1000' })).status).toBe(429);
    expect((await upload({ dur: '1000', headers: { 'x-test-tenant': 't2' } })).status).toBe(200);
  });
  it('quota minuti mensile per piano', async () => {
    env.VOICE_MINUTES_FREE = '1'; // 60 s
    expect((await upload({ dur: '30000' })).status).toBe(200);
    expect((await upload({ dur: '30000' })).status).toBe(200);
    expect((await upload({ dur: '1000' })).status).toBe(429);
    plan = 'pro';
    expect((await upload({ dur: '1000' })).status).toBe(200);
  });
  it('errore del provider => 502 generico, senza contenuti', async () => {
    stt = { id: 'x', transcribe: async () => { throw new Error('segreto-audio'); } } as unknown as MockSttProvider;
    const r = await upload();
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('segreto');
  });
  it('il buffer audio viene azzerato dopo l\'uso', async () => {
    let seen: Uint8Array | null = null;
    stt = { id: 'x', transcribe: async (i: { audio: Uint8Array }) => { seen = i.audio; i.audio.fill(7); return { text: 'ok' }; } } as unknown as MockSttProvider;
    await upload({ size: 10 });
    expect(Array.from(seen!)).toEqual(new Array(10).fill(0));
  });
});

describe('provider STT', () => {
  it('disattivato senza chiave/config', () => {
    expect(sttFromEnv({})).toBeNull();
    expect(sttFromEnv({ STT_PROVIDER: 'http', STT_BASE_URL: 'https://x' })).toBeNull();
    expect(sttFromEnv({ STT_PROVIDER: 'mock', NODE_ENV: 'production' })).toBeNull();
  });
  it('adattatore HTTP (fetch mock)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ text: 'ciao' })));
    const p = new HttpSttProvider({ baseUrl: 'https://stt.example/v1/', apiKey: 'k_placeholder', model: 'm' }, f as unknown as typeof fetch);
    expect((await p.transcribe({ audio: new Uint8Array(3), mime: 'audio/webm', vocabulary: ['posa', 'piastrelle'] })).text).toBe('ciao');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://stt.example/v1/audio/transcriptions');
    expect((init.body as FormData).get('prompt')).toBe('posa, piastrelle');
    const bad = new HttpSttProvider({ baseUrl: 'https://x', apiKey: 'k', model: 'm' }, (async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(bad.transcribe({ audio: new Uint8Array(1), mime: 'audio/webm' })).rejects.toThrow('500');
  });
});

describe('POST /interpret', () => {
  const call = (body: unknown, h: Record<string, string> = AUTH) =>
    createVoiceRoutes(deps).request('/interpret', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });

  it('validazione input zod', async () => {
    expect((await call({}, {})).status).toBe(401);
    expect((await call({})).status).toBe(400);
    expect((await call({ transcript: '' })).status).toBe(400);
    expect((await call({ transcript: 'x'.repeat(501) })).status).toBe(400);
    llm = null;
    expect((await call({ transcript: 'ciao' })).status).toBe(503);
  });
  it('output valido, costo loggato, quota giornaliera', async () => {
    deps.interpretLimiter = createRateLimiter({ limit: 2, windowMs: 86_400_000, clock: deps.clock });
    llm = new MockIntentLlm({ intent: 'sconto', args: { percento: 10 }, confidence: 0.9 }, { inputTokens: 400, outputTokens: 80 });
    env.LLM_PRICE_IN_PER_MTOK = '1'; env.LLM_PRICE_OUT_PER_MTOK = '5';
    const r = await call({ transcript: 'sconto dieci per cento', context: { docType: 'fattura', rowCount: 3, cliente: 'Mario Rossi' } });
    expect(await r.json()).toEqual({ intent: 'sconto', args: { percento: 10 }, confidence: 0.9 });
    expect(metrics[0]).toMatchObject({ name: 'voice.interpret', units: 480 });
    expect(metrics[0]!.costUsd).toBeCloseTo(0.0008, 6);
    expect((await call({ transcript: 'a' })).status).toBe(200);
    expect((await call({ transcript: 'b' })).status).toBe(429);
  });
  it('intent fuori elenco o irreversibile => sconosciuto/0', async () => {
    for (const intent of ['emetti_fattura', 'annulla_fattura', 'invia_sdi', 'rm -rf']) {
      llm = new MockIntentLlm({ intent, args: {}, confidence: 1 });
      expect(await (await call({ transcript: 'x' })).json()).toEqual({ intent: 'sconosciuto', args: {}, confidence: 0 });
    }
  });
  it('il contesto non viene inoltrato al modello oltre le chiavi ammesse', async () => {
    const spy = vi.spyOn(llm!, 'complete');
    await call({ transcript: 'x', context: { docType: 'fattura', customerName: 'SEGRETO', piva: '123' } });
    const arg = spy.mock.calls[0]![0];
    expect(arg.user).not.toContain('SEGRETO');
    expect(arg.user).toContain('fattura');
  });
  it('errore LLM => 502 generico', async () => {
    llm = { id: 'x', complete: async () => { throw new Error('dettaglio'); } } as unknown as MockIntentLlm;
    const r = await call({ transcript: 'x' });
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('dettaglio');
  });
});

describe('schemi zod', () => {
  it('validateLlmOutput', () => {
    expect(validateLlmOutput({ intent: 'aiuto', args: {}, confidence: 0.5 }).intent).toBe('aiuto');
    expect(validateLlmOutput({ intent: 'aiuto', args: {}, confidence: 1.5 }).confidence).toBe(0);
    expect(validateLlmOutput({ intent: 'aiuto', args: { a: { nested: 1 } }, confidence: 0.5 }).intent).toBe('sconosciuto');
    expect(validateLlmOutput({ intent: 'aiuto', args: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 1])), confidence: 0.5 }).intent).toBe('sconosciuto');
    expect(validateLlmOutput(null).intent).toBe('sconosciuto');
    expect(validateLlmOutput('testo').confidence).toBe(0);
  });
  it('elenco chiuso senza intent irreversibili', () => {
    for (const x of ['emetti_fattura', 'annulla_fattura', 'invia_sdi']) expect(ALLOWED_INTENTS).not.toContain(x);
  });
  it('body e contesto', () => {
    expect(InterpretBodySchema.safeParse({ transcript: '  ciao ' }).data?.transcript).toBe('ciao');
    expect(sanitizeContext({ docType: 'x'.repeat(100), rowCount: 2, altro: 'z' })).toEqual({ docType: 'x'.repeat(30), rowCount: 2 });
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 1, 5)).toBe(6);
  });
  it('adattatore HTTP LLM (fetch mock) con JSON malformato => raw null', async () => {
    const ok = new HttpIntentLlm({ baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' }, (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"aiuto","args":{},"confidence":0.7}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))) as unknown as typeof fetch);
    expect(await ok.complete({ system: 's', user: 'u' })).toEqual({ raw: { intent: 'aiuto', args: {}, confidence: 0.7 }, usage: { inputTokens: 10, outputTokens: 5 } });
    const bad = new HttpIntentLlm({ baseUrl: 'https://llm.example', apiKey: 'k', model: 'm' }, (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'non json' } }] }))) as unknown as typeof fetch);
    expect((await bad.complete({ system: 's', user: 'u' })).raw).toBeNull();
  });
});
