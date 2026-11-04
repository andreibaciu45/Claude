import { detectEnv, selectProvider, type Selection, type VoiceEnv } from './env';
import { isNativeSpeechAvailable, NativeSpeechProvider } from './native';
import { RecorderProvider } from './recorderProvider';
import type { TranscribeOptions } from './transcribe';
import type { SpeechProvider } from './types';
import { WebSpeechProvider } from './webSpeechProvider';

/** Crea il provider adatto all'ambiente (o null se né Web Speech né registrazione sono possibili). */
export function createSpeechProvider(
  opts: { env?: VoiceEnv; preferRecorder?: boolean; lang?: string; transcribe?: TranscribeOptions } = {},
): { provider: SpeechProvider | null; selection: Selection } {
  // App nativa (Capacitor): riconoscimento vocale del sistema, più affidabile della Web Speech su iOS.
  if (!opts.env && !opts.preferRecorder && isNativeSpeechAvailable()) {
    return { provider: new NativeSpeechProvider(opts.lang), selection: { kind: 'webspeech', reason: 'webspeech' } };
  }
  const env = opts.env ?? detectEnv();
  const selection = selectProvider(env, { preferRecorder: opts.preferRecorder });
  if (selection.kind === 'webspeech') return { provider: new WebSpeechProvider(opts.lang), selection };
  if (selection.kind === 'recorder') return { provider: new RecorderProvider({ lang: opts.lang, ...opts.transcribe }), selection };
  return { provider: null, selection };
}
