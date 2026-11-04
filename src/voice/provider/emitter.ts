import type { ProviderState, SpeechEvent } from './types';

/** Base comune: stato + sottoscrittori. */
export class Emitter {
  private listeners = new Set<(e: SpeechEvent) => void>();
  private _state: ProviderState = 'idle';
  get state(): ProviderState { return this._state; }
  subscribe(l: (e: SpeechEvent) => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  protected emit(e: SpeechEvent): void {
    for (const l of [...this.listeners]) { try { l(e); } catch { /* un ascoltatore difettoso non ferma gli altri */ } }
  }
  protected setState(s: ProviderState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit({ type: 'state', state: s });
  }
  protected clearListeners(): void { this.listeners.clear(); }
}
