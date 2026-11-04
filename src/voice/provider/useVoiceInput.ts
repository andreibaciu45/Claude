import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSpeechProvider } from './factory';
import type { ProviderState, SpeechProvider } from './types';

const PREF_KEY = 'vp:voice:recorder';
const readPref = (): boolean => { try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; } };

export interface UseVoiceInput {
  kind: SpeechProvider['kind'] | 'none';
  state: ProviderState;
  listening: boolean;
  /** trascrizione parziale (Web Speech) */
  partial: string;
  error: string | null;
  /** dispositivo che registra l'audio e lo invia al server (iOS PWA o scelta dell'utente) */
  usesServer: boolean;
  preferRecorder: boolean;
  setPreferRecorder: (v: boolean) => void;
  canRetry: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
}

/** Hook React sopra `SpeechProvider`: scelta automatica del provider + stato per l'interfaccia. */
export function useVoiceInput(onFinal: (text: string, alternatives: string[]) => void, getVocabulary?: () => string[]): UseVoiceInput {
  const [preferRecorder, setPrefer] = useState(readPref);
  const [state, setState] = useState<ProviderState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const vocabRef = useRef(getVocabulary);
  vocabRef.current = getVocabulary;
  const [canRetry, setCanRetry] = useState(false);

  const { provider, selection } = useMemo(
    () => createSpeechProvider({ preferRecorder, transcribe: { vocabulary: () => vocabRef.current?.() ?? [] } }),
    [preferRecorder],
  );

  useEffect(() => {
    if (!provider) return;
    const off = provider.subscribe((e) => {
      if (e.type === 'state') {
        setState(e.state);
        if (e.state === 'listening' || e.state === 'starting') { setError(null); setPartial(''); setCanRetry(false); }
      } else if (e.type === 'partial') setPartial(e.text);
      else if (e.type === 'error') { setError(e.message); setPartial(''); setCanRetry(!!provider.retry && (e.code === 'offline' || e.code === 'network' || e.code === 'server')); }
      else if (e.type === 'final') { setPartial(''); finalRef.current(e.text, e.alternatives ?? []); }
    });
    return () => { off(); provider.destroy(); setState('idle'); };
  }, [provider]);

  const setPreferRecorder = useCallback((v: boolean) => {
    try { localStorage.setItem(PREF_KEY, v ? '1' : '0'); } catch { /* ignora */ }
    setPrefer(v);
  }, []);

  return {
    kind: provider?.kind ?? 'none',
    state: provider ? state : 'idle',
    listening: state === 'listening' || state === 'starting',
    partial, error,
    usesServer: selection.kind === 'recorder',
    preferRecorder, setPreferRecorder, canRetry,
    start: () => { void provider?.start(); },
    stop: () => provider?.stop(),
    cancel: () => provider?.cancel(),
    retry: () => { void provider?.retry?.(); },
  };
}
