/**
 * Rilevamento dell'ambiente e scelta automatica del provider (ARCHITECTURE-V2 §3.4):
 *  1. Web Speech se disponibile E non iOS-standalone (PWA da "Aggiungi a Home": l'API è assente/inaffidabile, DA VERIFICARE su iPhone reale)
 *  2. registrazione + /v1/voice/transcribe se iOS standalone, Web Speech assente o scelta dell'utente (cantiere rumoroso)
 *  3. nessuno: resta il campo di testo.
 */
import type { ProviderKind } from './types';

export interface VoiceEnv {
  hasWebSpeech: boolean;
  /** getUserMedia + MediaRecorder disponibili */
  canRecord: boolean;
  isIOS: boolean;
  /** app installata ("Aggiungi a Home" / display-mode standalone) */
  isStandalone: boolean;
  online: boolean;
}

export type SelectionReason = 'webspeech' | 'ios-standalone' | 'no-webspeech' | 'user-choice' | 'unsupported';
export interface Selection { kind: ProviderKind | 'none'; reason: SelectionReason }

type AnyRec = Record<string, unknown>;

export function detectEnv(win: unknown = typeof window !== 'undefined' ? window : undefined, nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): VoiceEnv {
  const w = (win ?? {}) as AnyRec;
  const n = (nav ?? {}) as AnyRec;
  const ua = String(n.userAgent ?? '');
  const platform = String(n.platform ?? '');
  const touch = Number(n.maxTouchPoints ?? 0);
  // iPadOS 13+ si presenta come "MacIntel" con touch
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  let standalone = n.standalone === true;
  try {
    const mm = w.matchMedia as ((q: string) => { matches: boolean }) | undefined;
    if (!standalone && typeof mm === 'function') standalone = !!mm.call(win, '(display-mode: standalone)').matches;
  } catch { /* ignora */ }
  const md = n.mediaDevices as AnyRec | undefined;
  return {
    hasWebSpeech: !!(w.SpeechRecognition ?? w.webkitSpeechRecognition),
    canRecord: !!md && typeof md.getUserMedia === 'function' && typeof w.MediaRecorder === 'function',
    isIOS,
    isStandalone: standalone,
    online: n.onLine !== false,
  };
}

export function selectProvider(env: VoiceEnv, opts: { preferRecorder?: boolean } = {}): Selection {
  if (opts.preferRecorder && env.canRecord) return { kind: 'recorder', reason: 'user-choice' };
  if (env.hasWebSpeech && !(env.isIOS && env.isStandalone)) return { kind: 'webspeech', reason: 'webspeech' };
  if (env.canRecord) return { kind: 'recorder', reason: env.hasWebSpeech ? 'ios-standalone' : env.isIOS && env.isStandalone ? 'ios-standalone' : 'no-webspeech' };
  return { kind: 'none', reason: 'unsupported' };
}
