/** Regressione della revisione indipendente: useSpeech non duplica il testo consolidato da stop(). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSpeech, type UseSpeech } from './useSpeech';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = ((e: unknown) => void) | null;
class FakeSR {
  static last: FakeSR | null = null;
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
  onresult: Handler = null; onerror: Handler = null; onend: (() => void) | null = null; onstart: (() => void) | null = null;
  constructor() { FakeSR.last = this; }
  start() { this.onstart?.(); }
  stop() { /* il browser consegna il risultato finale PRIMA di onend */ }
  abort() { /* noop */ }
}
const result = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text } } } });

let root: Root; let host: HTMLElement; let api: UseSpeech;
function Probe() { api = useSpeech(); return null; }

beforeEach(() => {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSR;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });

describe('useSpeech', () => {
  it('stop() con un parziale: il finale consegnato subito dopo non raddoppia il testo', async () => {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { api.start(); });
    await act(async () => { FakeSR.last!.onresult!(result('tre metri di tubo', false)); });
    await act(async () => { api.stop(); });
    expect(api.finalText).toBe('tre metri di tubo');
    await act(async () => { FakeSR.last!.onresult!(result('tre metri di tubo', true)); });
    expect(api.finalText).toBe('tre metri di tubo');
  });
  it('durante l\'ascolto i risultati finali successivi si accodano normalmente', async () => {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { api.start(); });
    await act(async () => { FakeSR.last!.onresult!(result('uno', true)); });
    await act(async () => { FakeSR.last!.onresult!(result('uno', true)); });
    expect(api.finalText).toBe('uno uno');
  });
});
