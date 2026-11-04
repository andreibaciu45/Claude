/**
 * Adattatore voce NATIVO (wrapper Capacitor, ARCHITECTURE-V2 §3.4 punto 3).
 *
 * - Usa il plugin `@capgo/capacitor-speech-recognition` (iOS SFSpeechRecognizer / Android SpeechRecognizer) in it-IT.
 * - NESSUNA dipendenza nella PWA: il plugin vive in `mobile/` e viene raggiunto tramite il bridge globale
 *   `window.Capacitor` (iniettato solo dalla WebView nativa). Nel browser `isNativePlatform()` è false,
 *   quindi non viene caricato nulla e il bundle web non cresce di un byte.
 * - Stessa interfaccia `SpeechProvider` di WebSpeechProvider/RecorderProvider. Non lancia: gli errori sono eventi.
 *
 * Aggancio (non fatto qui: factory.ts/env.ts non sono di questo agente) — vedi mobile/src-bridge/FILES.md e il report:
 *   in createSpeechProvider(): `if (isNativeSpeechAvailable()) return { provider: new NativeSpeechProvider(opts.lang), selection: {kind:'webspeech', reason:'webspeech'} }`
 * `kind` è 'webspeech' perché ProviderKind non ha ancora 'native' (proposta: aggiungerlo a types.ts).
 */
import { Emitter } from './emitter';
import type { SpeechErrorCode, SpeechProvider } from './types';

// --- tipi minimi del bridge/plugin (evita di importare pacchetti non presenti nella root) ---
interface Handle { remove(): Promise<void> | void }
interface SpeechPlugin {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ speechRecognition: string }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(o: {
    language?: string; maxResults?: number; partialResults?: boolean; popup?: boolean;
    contextualStrings?: string[]; addPunctuation?: boolean;
  }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  forceStop?(o?: { timeout?: number }): Promise<void>;
  addListener(ev: 'partialResults', fn: (e: { matches?: string[] }) => void): Promise<Handle>;
  addListener(ev: 'listeningState', fn: (e: { state?: string; status?: string; reason?: string; errorCode?: string }) => void): Promise<Handle>;
  addListener(ev: 'error', fn: (e: { code: string; message: string }) => void): Promise<Handle>;
  removeAllListeners?(): Promise<void>;
}
interface CapacitorBridge { isNativePlatform(): boolean; registerPlugin<T>(name: string): T }

function bridge(): CapacitorBridge | null {
  const c = (typeof window !== 'undefined' ? (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor : undefined);
  return c && typeof c.isNativePlatform === 'function' ? c : null;
}

/** true solo dentro l'app Capacitor (Android/iOS). Sincrono e senza import. */
export function isNativeSpeechAvailable(): boolean {
  try { return bridge()?.isNativePlatform() === true; } catch { return false; }
}

const MSG: Record<string, string> = {
  'not-allowed': 'Permesso microfono negato. Abilitalo dalle Impostazioni del telefono (VocePreventivo → Microfono e Riconoscimento vocale).',
  'no-speech': 'Non ho sentito nulla. Tieni premuto e parla.',
  'audio-capture': 'Microfono non disponibile.',
  network: 'Riconoscimento vocale non raggiungibile: controlla la connessione.',
  unsupported: 'Riconoscimento vocale non disponibile su questo telefono.',
  server: 'Servizio di riconoscimento momentaneamente non disponibile. Riprova.',
  unknown: 'Errore del riconoscimento vocale. Riprova o scrivi nel campo di testo.',
};

function mapError(raw: string): SpeechErrorCode {
  const c = raw.toUpperCase();
  if (c.includes('PERMISSION') || c.includes('NOT_AUTHORIZED') || c.includes('DENIED')) return 'not-allowed';
  if (c.includes('NO_MATCH') || c.includes('SPEECH_TIMEOUT') || c.includes('NO_SPEECH')) return 'no-speech';
  if (c.includes('AUDIO')) return 'audio-capture';
  if (c.includes('NETWORK')) return 'network';
  if (c.includes('UNSUPPORTED') || c.includes('NOT_AVAILABLE') || c.includes('LANGUAGE')) return 'unsupported';
  if (c.includes('SERVER')) return 'server';
  return 'unknown';
}

export interface NativeSpeechOptions {
  /** parole del dominio (catalogo, clienti) per migliorare il riconoscimento: passate come `contextualStrings` */
  contextualStrings?: () => string[];
}

export class NativeSpeechProvider extends Emitter implements SpeechProvider {
  /** vedi nota in testata: ProviderKind non ha 'native' */
  readonly kind = 'webspeech' as const;
  private plugin: SpeechPlugin | null = null;
  private handles: Handle[] = [];
  private lastMatches: string[] = [];
  private cancelled = false;
  private errored = false;
  private finished = true;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly lang = 'it-IT', private readonly opts: NativeSpeechOptions = {}) { super(); }

  private async load(): Promise<SpeechPlugin | null> {
    if (this.plugin) return this.plugin;
    const b = bridge();
    if (!b || !b.isNativePlatform()) return null;
    // Caricamento "pigro": il proxy del plugin nasce solo al primo uso.
    this.plugin = b.registerPlugin<SpeechPlugin>('SpeechRecognition');
    return this.plugin;
  }

  async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'starting') return;
    this.cancelled = false; this.errored = false; this.lastMatches = []; this.finished = false;
    this.setState('starting');
    try {
      const p = await this.load();
      if (!p) { this.fail('unsupported'); return; }
      try { if (!(await p.available()).available) { this.fail('unsupported'); return; } } catch { /* alcune versioni non espongono available(): si prosegue */ }
      let perm = (await p.checkPermissions()).speechRecognition;
      if (perm !== 'granted') perm = (await p.requestPermissions()).speechRecognition;
      if (perm !== 'granted') { this.fail('not-allowed'); return; }

      await this.detach();
      this.handles.push(await p.addListener('partialResults', (e) => {
        if (this.cancelled || this.finished) return;
        const m = (e.matches ?? []).map((s) => s.trim()).filter(Boolean);
        if (m.length === 0) return;
        this.lastMatches = m;
        this.emit({ type: 'partial', text: m[0] });
      }));
      this.handles.push(await p.addListener('listeningState', (e) => {
        const st = e.state ?? (e.status === 'started' ? 'started' : e.status === 'stopped' ? 'stopped' : '');
        if (st === 'started' && !this.finished) this.setState('listening');
        if (st === 'stopped') this.finishFromPlugin(e.errorCode);
      }));
      this.handles.push(await p.addListener('error', (e) => {
        if (this.cancelled || this.finished) return;
        const code = mapError(e.code ?? '');
        // "nessun risultato" a fine sessione è esito normale se abbiamo già un testo
        if (code === 'no-speech' && this.lastMatches.length) return;
        this.errored = true;
        this.fail(code);
      }));

      const res = await p.start({
        language: this.lang,
        maxResults: 3,
        partialResults: true,
        popup: false,
        addPunctuation: false,
        contextualStrings: this.opts.contextualStrings?.().slice(0, 100),
      });
      if (res?.matches?.length) this.lastMatches = res.matches; // Android senza parziali: start() risolve a fine frase
      if ((this.state as string) === 'starting') this.setState('listening');
      if (res?.matches?.length) this.finishFromPlugin();
    } catch (err) {
      if (this.cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.errored = true;
      this.fail(mapError(msg));
    }
  }

  stop(): void {
    if (this.finished) return;
    this.setState('processing');
    void this.plugin?.stop().catch(() => { /* ignore */ });
    // Rete di sicurezza: se il plugin non segnala 'stopped', chiudiamo col miglior parziale.
    this.fallbackTimer = setTimeout(() => this.finishFromPlugin(), 1500);
  }

  cancel(): void {
    this.cancelled = true; this.finished = true;
    this.clearTimer();
    const p = this.plugin;
    if (p) void (p.forceStop ? p.forceStop({ timeout: 500 }) : p.stop()).catch(() => { /* ignore */ });
    void this.detach();
    this.setState('idle');
  }

  destroy(): void { this.cancel(); this.clearListeners(); }

  private finishFromPlugin(errorCode?: string): void {
    if (this.finished || this.cancelled || this.errored) return;
    this.finished = true;
    this.clearTimer();
    void this.detach();
    const [best, ...rest] = this.lastMatches;
    this.setState('idle');
    if (!best) {
      this.fail(errorCode ? mapError(errorCode) : 'no-speech');
      return;
    }
    this.emit({ type: 'final', text: best, alternatives: rest.filter((a) => a !== best) });
  }

  private async detach(): Promise<void> {
    const hs = this.handles; this.handles = [];
    for (const h of hs) { try { await h.remove(); } catch { /* ignore */ } }
  }

  private clearTimer(): void { if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; } }

  private fail(code: SpeechErrorCode): void {
    this.finished = true;
    this.clearTimer();
    void this.detach();
    this.setState('error');
    this.emit({ type: 'error', code, message: MSG[code] ?? MSG.unknown });
  }
}
