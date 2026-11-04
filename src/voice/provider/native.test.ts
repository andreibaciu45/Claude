import { afterEach, describe, expect, it } from 'vitest';
import { isNativeSpeechAvailable, NativeSpeechProvider } from './native';
import type { SpeechEvent } from './types';

type L = (e: any) => void;
function fakeBridge(opts: { perm?: string } = {}) {
  const ls: Record<string, L> = {};
  const calls: string[] = [];
  const plugin = {
    available: async () => ({ available: true }),
    checkPermissions: async () => ({ speechRecognition: opts.perm ?? 'granted' }),
    requestPermissions: async () => ({ speechRecognition: opts.perm ?? 'granted' }),
    start: async (o: any) => { calls.push(`start:${o.language}`); return {}; },
    stop: async () => { calls.push('stop'); },
    addListener: async (ev: string, fn: L) => { ls[ev] = fn; return { remove: () => { delete ls[ev]; } }; },
  };
  (globalThis as any).window = { Capacitor: { isNativePlatform: () => true, registerPlugin: () => plugin } };
  return { ls, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { delete (globalThis as any).window; });

describe('NativeSpeechProvider', () => {
  it('non nativo: isNativeSpeechAvailable false e start() -> unsupported', async () => {
    expect(isNativeSpeechAvailable()).toBe(false);
    const p = new NativeSpeechProvider(); const ev: SpeechEvent[] = []; p.subscribe((e) => ev.push(e));
    await p.start();
    expect(ev.find((e) => e.type === 'error')).toMatchObject({ code: 'unsupported' });
  });
  it('parziali -> stop -> final con alternative, lingua it-IT', async () => {
    const { ls, calls } = fakeBridge();
    expect(isNativeSpeechAvailable()).toBe(true);
    const p = new NativeSpeechProvider(); const ev: SpeechEvent[] = []; p.subscribe((e) => ev.push(e));
    await p.start();
    ls.partialResults({ matches: ['rifare il bagno', 'rifare il bagnio'] });
    p.stop(); ls.listeningState({ state: 'stopped' }); await tick();
    expect(calls).toContain('start:it-IT');
    expect(ev.find((e) => e.type === 'partial')).toMatchObject({ text: 'rifare il bagno' });
    expect(ev.find((e) => e.type === 'final')).toMatchObject({ text: 'rifare il bagno', alternatives: ['rifare il bagnio'] });
  });
  it('permesso negato -> not-allowed in italiano', async () => {
    fakeBridge({ perm: 'denied' });
    const p = new NativeSpeechProvider(); const ev: SpeechEvent[] = []; p.subscribe((e) => ev.push(e));
    await p.start();
    const err = ev.find((e) => e.type === 'error') as any;
    expect(err.code).toBe('not-allowed'); expect(err.message).toMatch(/Impostazioni/);
  });
});
