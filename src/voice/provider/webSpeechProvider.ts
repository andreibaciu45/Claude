import { getSpeechCtor, speechErrorMessage, type SRInstance } from '../../hooks/useSpeech';
import { Emitter } from './emitter';
import type { SpeechErrorCode, SpeechProvider } from './types';

const CODE: Record<string, SpeechErrorCode> = {
  'not-allowed': 'not-allowed', 'service-not-allowed': 'not-allowed', 'no-speech': 'no-speech',
  'audio-capture': 'audio-capture', network: 'network', 'language-not-supported': 'unsupported',
};

/** Web Speech API, modalità "una frase" (push-to-talk) con n-best (maxAlternatives = 3). */
export class WebSpeechProvider extends Emitter implements SpeechProvider {
  readonly kind = 'webspeech' as const;
  private rec: SRInstance | null = null;
  private finalText = '';
  private interim = '';
  private alts: string[] = [];
  private errored = false;
  private cancelled = false;

  constructor(private readonly lang = 'it-IT') { super(); }

  async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'starting') return;
    const Ctor = getSpeechCtor();
    if (!Ctor) { this.fail('unsupported', speechErrorMessage('language-not-supported')); return; }
    this.finalText = ''; this.interim = ''; this.alts = []; this.errored = false; this.cancelled = false;
    this.setState('starting');
    const r = new Ctor();
    this.rec = r;
    r.lang = this.lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.onstart = () => this.setState('listening');
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const best = res[0]?.transcript ?? '';
        if (res.isFinal) {
          this.finalText = `${this.finalText} ${best}`.replace(/\s+/g, ' ').trim();
          const others: string[] = [];
          for (let k = 1; k < res.length; k++) { const a = res[k]?.transcript?.trim(); if (a) others.push(a); }
          this.alts = others;
        } else interim += best;
      }
      this.interim = interim.trim();
      this.emit({ type: 'partial', text: `${this.finalText} ${this.interim}`.trim() });
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      this.errored = true;
      this.fail(CODE[e.error] ?? 'unknown', speechErrorMessage(e.error));
    };
    r.onend = () => {
      this.rec = null;
      if (this.errored || this.cancelled) { if (this.state !== 'error') this.setState('idle'); return; }
      const text = `${this.finalText} ${this.interim}`.replace(/\s+/g, ' ').trim();
      this.setState('idle');
      if (!text) { this.fail('no-speech', speechErrorMessage('no-speech')); return; }
      this.emit({ type: 'final', text, alternatives: this.alts.filter((a) => a !== text) });
    };
    try { r.start(); } catch { this.fail('unknown', speechErrorMessage('other')); }
  }

  stop(): void { try { this.rec?.stop(); } catch { /* già fermo */ } }

  cancel(): void {
    this.cancelled = true;
    const r = this.rec;
    this.rec = null;
    if (r) { r.onresult = r.onerror = r.onend = r.onstart = null; try { r.abort(); } catch { /* ignore */ } }
    this.setState('idle');
  }

  destroy(): void { this.cancel(); this.clearListeners(); }

  private fail(code: SpeechErrorCode, message: string): void {
    this.setState('error');
    this.emit({ type: 'error', code, message });
  }
}
