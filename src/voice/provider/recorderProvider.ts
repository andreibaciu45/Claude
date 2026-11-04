import { Emitter } from './emitter';
import { TranscribeError, transcribeAudio, type TranscribeOptions } from './transcribe';
import type { SpeechErrorCode, SpeechProvider } from './types';

export const MAX_RECORDING_MS = 30_000; // tetto per richiesta (ARCHITECTURE-V2 §3.3)
const MIN_BLOB_BYTES = 800;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

export interface RecorderDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor?: typeof MediaRecorder;
  transcribe?: (b: Blob, o: TranscribeOptions) => Promise<string>;
}

const micMessage = (name: string): { code: SpeechErrorCode; message: string } => {
  if (name === 'NotAllowedError' || name === 'SecurityError') return { code: 'not-allowed', message: 'Permesso al microfono negato. Abilitalo dalle impostazioni, oppure scrivi il comando.' };
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return { code: 'audio-capture', message: 'Microfono non trovato o non disponibile. Controlla che non sia usato da un’altra app.' };
  return { code: 'unknown', message: 'Non riesco ad accedere al microfono. Riprova oppure scrivi il comando.' };
};

/** Registrazione con MediaRecorder + trascrizione sul server (percorso per iOS PWA standalone). */
export class RecorderProvider extends Emitter implements SpeechProvider {
  readonly kind = 'recorder' as const;
  private stream: MediaStream | null = null;
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Blob | null = null;
  private cancelled = false;

  constructor(private readonly opts: TranscribeOptions & RecorderDeps = {}) { super(); }

  private get gum() {
    return this.opts.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
  }

  async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'starting' || this.state === 'processing') return;
    this.cancelled = false;
    this.pending = null;
    this.setState('starting');
    const MR = this.opts.MediaRecorderCtor ?? (typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined);
    if (!MR) { this.fail('unsupported', 'Questo dispositivo non può registrare l’audio. Scrivi il comando.'); return; }
    try {
      this.stream = await this.gum({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const m = micMessage((e as { name?: string })?.name ?? '');
      this.fail(m.code, m.message);
      return;
    }
    if (this.cancelled) { this.release(); return; }
    const mime = MIME_CANDIDATES.find((m) => { try { return MR.isTypeSupported(m); } catch { return false; } });
    try {
      this.mr = mime ? new MR(this.stream, { mimeType: mime }) : new MR(this.stream);
    } catch {
      this.release();
      this.fail('unsupported', 'Questo dispositivo non può registrare l’audio. Scrivi il comando.');
      return;
    }
    this.chunks = [];
    const mr = this.mr;
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) this.chunks.push(ev.data); };
    mr.onerror = () => { this.release(); this.fail('audio-capture', 'Registrazione interrotta. Riprova oppure scrivi il comando.'); };
    mr.onstop = () => { void this.finish(mr.mimeType || mime || 'audio/webm'); };
    mr.start();
    this.setState('listening');
    this.timer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const mr = this.mr;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch { /* ignore */ } }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const mr = this.mr;
    this.mr = null;
    if (mr) { mr.ondataavailable = mr.onstop = mr.onerror = null; try { if (mr.state !== 'inactive') mr.stop(); } catch { /* ignore */ } }
    this.release();
    this.chunks = [];
    this.pending = null;
    this.setState('idle');
  }

  async retry(): Promise<void> {
    if (!this.pending) return;
    await this.send(this.pending);
  }

  destroy(): void { this.cancel(); this.clearListeners(); }

  private release(): void {
    this.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    this.stream = null;
  }

  private async finish(mime: string): Promise<void> {
    this.release();
    this.mr = null;
    if (this.cancelled) return;
    const blob = new Blob(this.chunks, { type: mime });
    this.chunks = [];
    if (blob.size < MIN_BLOB_BYTES) { this.fail('no-speech', 'Non ho sentito nulla. Avvicinati al telefono e riprova.'); return; }
    await this.send(blob);
  }

  private async send(blob: Blob): Promise<void> {
    this.setState('processing');
    try {
      const text = await (this.opts.transcribe ?? transcribeAudio)(blob, this.opts);
      if (this.cancelled) return;
      this.pending = null;
      this.setState('idle');
      this.emit({ type: 'final', text });
    } catch (e) {
      if (this.cancelled) return;
      const te = e instanceof TranscribeError ? e : null;
      // offline/rete: si tiene la registrazione per un nuovo tentativo
      this.pending = te && (te.code === 'offline' || te.code === 'network' || te.code === 'server') ? blob : null;
      const code: SpeechErrorCode = te ? (te.code === 'too-large' ? 'too-large' : te.code) : 'unknown';
      this.fail(code, te ? te.message : 'Trascrizione non riuscita. Riprova oppure scrivi il comando.');
    }
  }

  private fail(code: SpeechErrorCode, message: string): void {
    this.setState('error');
    this.emit({ type: 'error', code, message });
  }
}
