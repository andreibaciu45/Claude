import { describe, expect, it, vi } from 'vitest';
import { createSpeechProvider, detectEnv, RecorderProvider, selectProvider, transcribeAudio, TranscribeError, type SpeechEvent, type VoiceEnv } from './index';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';

const win = (o: Record<string, unknown> = {}) => ({ matchMedia: () => ({ matches: false }), ...o });
const nav = (o: Record<string, unknown> = {}) => ({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5, onLine: true, mediaDevices: { getUserMedia: () => Promise.resolve({}) }, ...o });

describe('detectEnv', () => {
  it('Android Chrome: Web Speech + registrazione, non iOS', () => {
    const e = detectEnv(win({ webkitSpeechRecognition: class {}, MediaRecorder: class {} }), nav());
    expect(e).toMatchObject({ hasWebSpeech: true, canRecord: true, isIOS: false, isStandalone: false, online: true });
  });
  it('iOS PWA standalone via navigator.standalone', () => {
    const e = detectEnv(win({ webkitSpeechRecognition: class {}, MediaRecorder: class {} }), nav({ userAgent: IPHONE, standalone: true }));
    expect(e).toMatchObject({ isIOS: true, isStandalone: true });
  });
  it('standalone via display-mode', () => {
    const e = detectEnv(win({ matchMedia: (q: string) => ({ matches: q.includes('standalone') }) }), nav({ userAgent: IPHONE }));
    expect(e.isStandalone).toBe(true);
  });
  it('iPadOS che si presenta come Mac', () => {
    expect(detectEnv(win(), nav({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).isIOS).toBe(true);
    expect(detectEnv(win(), nav({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).isIOS).toBe(false);
  });
  it('nessuna API: tutto falso, senza lanciare', () => {
    expect(detectEnv({}, {})).toMatchObject({ hasWebSpeech: false, canRecord: false, isIOS: false, online: true });
    expect(detectEnv(undefined, undefined).hasWebSpeech).toBe(false);
  });
  it('offline', () => { expect(detectEnv(win(), nav({ onLine: false })).online).toBe(false); });
});

describe('selectProvider', () => {
  const base: VoiceEnv = { hasWebSpeech: true, canRecord: true, isIOS: false, isStandalone: false, online: true };
  it('Android Chrome -> Web Speech', () => { expect(selectProvider(base)).toEqual({ kind: 'webspeech', reason: 'webspeech' }); });
  it('iOS Safari in scheda -> Web Speech', () => { expect(selectProvider({ ...base, isIOS: true }).kind).toBe('webspeech'); });
  it('iOS standalone -> registrazione + server', () => {
    expect(selectProvider({ ...base, isIOS: true, isStandalone: true })).toEqual({ kind: 'recorder', reason: 'ios-standalone' });
  });
  it('Android standalone (WebAPK) -> Web Speech', () => { expect(selectProvider({ ...base, isStandalone: true }).kind).toBe('webspeech'); });
  it('Web Speech assente (Firefox) -> registrazione', () => {
    expect(selectProvider({ ...base, hasWebSpeech: false })).toEqual({ kind: 'recorder', reason: 'no-webspeech' });
  });
  it('scelta utente (cantiere rumoroso)', () => {
    expect(selectProvider(base, { preferRecorder: true })).toEqual({ kind: 'recorder', reason: 'user-choice' });
  });
  it('preferenza ignorata se non si può registrare', () => {
    expect(selectProvider({ ...base, canRecord: false }, { preferRecorder: true }).kind).toBe('webspeech');
  });
  it('iOS standalone senza registrazione -> nessuno (resta il campo di testo)', () => {
    expect(selectProvider({ ...base, isIOS: true, isStandalone: true, canRecord: false })).toEqual({ kind: 'none', reason: 'unsupported' });
  });
  it('Firefox desktop senza getUserMedia', () => {
    const e = detectEnv(win(), nav({ userAgent: FIREFOX, mediaDevices: undefined }));
    expect(selectProvider(e).kind).toBe('none');
  });
  it('createSpeechProvider rispetta la selezione', () => {
    expect(createSpeechProvider({ env: { ...selectEnv(), isIOS: true, isStandalone: true } }).provider?.kind).toBe('recorder');
    expect(createSpeechProvider({ env: selectEnv() }).provider?.kind).toBe('webspeech');
    expect(createSpeechProvider({ env: { ...selectEnv(), hasWebSpeech: false, canRecord: false } }).provider).toBeNull();
  });
});
function selectEnv(): VoiceEnv { return { hasWebSpeech: true, canRecord: true, isIOS: false, isStandalone: false, online: true }; }

describe('transcribeAudio', () => {
  const blob = new Blob([new Uint8Array(2000)], { type: 'audio/webm' });
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('invia multipart a /v1/voice/transcribe con Bearer e vocabolario', async () => {
    const f = ok({ text: ' emetti la fattura ' });
    const text = await transcribeAudio(blob, { fetchImpl: f as unknown as typeof fetch, token: 'tok123', vocabulary: ['tubo rame', 'raccordo'], isOnline: () => true });
    expect(text).toBe('emetti la fattura');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/voice\/transcribe$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    const form = init.body as FormData;
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(form.get('vocabulary')).toBe('tubo rame, raccordo');
    expect(form.get('lang')).toBe('it-IT');
  });
  it('base URL configurabile, senza token niente header', async () => {
    const f = ok({ text: 'ciao' });
    await transcribeAudio(blob, { fetchImpl: f as unknown as typeof fetch, baseUrl: 'https://api.example.test/v1/', token: null, isOnline: () => true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/voice/transcribe');
    expect(init.headers).toBeUndefined();
  });
  it('offline: errore senza chiamare la rete', async () => {
    const f = ok({ text: 'x' });
    await expect(transcribeAudio(blob, { fetchImpl: f as unknown as typeof fetch, isOnline: () => false })).rejects.toMatchObject({ code: 'offline' });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([[401, 'unauthorized'], [413, 'too-large'], [429, 'quota'], [500, 'server']])('HTTP %i -> %s', async (status, code) => {
    await expect(transcribeAudio(blob, { fetchImpl: ok({ error: {} }, status) as unknown as typeof fetch, isOnline: () => true })).rejects.toMatchObject({ code });
  });
  it('errore di rete e risposta vuota', async () => {
    const boom = vi.fn(async () => { throw new TypeError('fail'); });
    await expect(transcribeAudio(blob, { fetchImpl: boom as unknown as typeof fetch, isOnline: () => true })).rejects.toMatchObject({ code: 'network' });
    await expect(transcribeAudio(blob, { fetchImpl: ok({ text: '  ' }) as unknown as typeof fetch, isOnline: () => true })).rejects.toBeInstanceOf(TranscribeError);
  });
});

describe('RecorderProvider', () => {
  function fakeMR() {
    class MR {
      static isTypeSupported = () => true;
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null; onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)]) }); this.onstop?.(); }
    }
    return MR as unknown as typeof MediaRecorder;
  }
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  const collect = (p: RecorderProvider) => { const ev: SpeechEvent[] = []; p.subscribe((e) => ev.push(e)); return ev; };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('registra, trascrive ed emette il testo finale', async () => {
    const p = new RecorderProvider({ MediaRecorderCtor: fakeMR(), getUserMedia: async () => stream, transcribe: async () => 'emetti la fattura' });
    const ev = collect(p);
    await p.start();
    expect(p.state).toBe('listening');
    p.stop();
    await flush();
    expect(ev).toContainEqual({ type: 'final', text: 'emetti la fattura' });
    expect(p.state).toBe('idle');
  });
  it('permesso negato -> errore italiano', async () => {
    const p = new RecorderProvider({ MediaRecorderCtor: fakeMR(), getUserMedia: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
    const ev = collect(p);
    await p.start();
    expect(ev.find((e) => e.type === 'error')).toMatchObject({ code: 'not-allowed' });
    expect(p.state).toBe('error');
  });
  it('offline: errore e retry riusa la registrazione', async () => {
    let calls = 0;
    const p = new RecorderProvider({
      MediaRecorderCtor: fakeMR(), getUserMedia: async () => stream,
      transcribe: async () => { if (calls++ === 0) throw new TranscribeError('offline'); return 'apri la fattura 12'; },
    });
    const ev = collect(p);
    await p.start(); p.stop(); await flush();
    expect(ev.find((e) => e.type === 'error')).toMatchObject({ code: 'offline' });
    await p.retry();
    expect(ev).toContainEqual({ type: 'final', text: 'apri la fattura 12' });
  });
  it('cancel scarta senza emettere', async () => {
    const p = new RecorderProvider({ MediaRecorderCtor: fakeMR(), getUserMedia: async () => stream, transcribe: async () => 'x' });
    const ev = collect(p);
    await p.start(); p.cancel(); await flush();
    expect(ev.some((e) => e.type === 'final')).toBe(false);
    expect(p.state).toBe('idle');
  });
});
