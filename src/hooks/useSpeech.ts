import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechStatus = 'idle' | 'listening' | 'error' | 'unsupported';

// Tipi minimi per la Web Speech API (non presenti in lib.dom di tutte le versioni)
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SRInstance;
export type { SRInstance, SRCtor, SREvent, SRErrorEvent };

const getCtor = (): SRCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Costruttore della Web Speech API del browser, se presente (usato anche da src/voice/provider). */
export const getSpeechCtor = (): SRCtor | null => getCtor();

export const speechErrorMessage = (code: string): string => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permesso al microfono negato. Abilitalo dalle impostazioni del browser, oppure scrivi il testo qui sotto.';
    case 'no-speech':
      return 'Non ho sentito nulla. Avvicinati al telefono e riprova.';
    case 'audio-capture':
      return 'Microfono non trovato o non disponibile. Controlla che non sia usato da un’altra app.';
    case 'network':
      return 'Errore di rete: il riconoscimento vocale richiede la connessione internet. Riprova oppure scrivi il testo.';
    case 'language-not-supported':
      return 'La lingua italiana non è supportata dal riconoscimento vocale di questo dispositivo.';
    case 'aborted':
      return '';
    default:
      return 'Si è verificato un errore con il riconoscimento vocale. Riprova oppure scrivi il testo.';
  }
};

export interface UseSpeech {
  status: SpeechStatus;
  listening: boolean;
  unsupported: boolean;
  /** testo definitivo accumulato */
  finalText: string;
  /** testo parziale ancora in elaborazione */
  interimText: string;
  /** finalText + interimText */
  transcript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
}

const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network']);

export function useSpeech(lang = 'it-IT'): UseSpeech {
  const Ctor = getCtor();
  const [status, setStatus] = useState<SpeechStatus>(Ctor ? 'idle' : 'unsupported');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SRInstance | null>(null);
  const wantRef = useRef(false); // l'utente vuole ascoltare
  const finalRef = useRef('');
  const interimRef = useRef('');
  const restartsRef = useRef(0);
  const lastStartRef = useRef(0);

  const teardown = useCallback(() => {
    const r = recRef.current;
    if (r) {
      r.onresult = r.onerror = r.onend = r.onstart = null;
      try { r.abort(); } catch { /* già fermo */ }
    }
    recRef.current = null;
  }, []);

  const create = useCallback((): SRInstance | null => {
    const C = getCtor();
    if (!C) return null;
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { restartsRef.current = 0; setStatus('listening'); };
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) {
          finalRef.current = (finalRef.current + ' ' + t).replace(/\s+/g, ' ').trim();
        } else {
          interim += t;
        }
      }
      interimRef.current = interim.trim();
      setFinalText(finalRef.current);
      setInterimText(interimRef.current);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech') {
        // non fatale: se l'utente è ancora in ascolto, onend riavvia
        if (!wantRef.current) setError(speechErrorMessage('no-speech'));
        return;
      }
      if (e.error === 'aborted') return;
      if (FATAL.has(e.error) || !wantRef.current) {
        wantRef.current = false;
        setError(speechErrorMessage(e.error));
        setStatus('error');
        setInterimText('');
      }
    };
    r.onend = () => {
      if (wantRef.current) {
        // il browser ha chiuso per silenzio/timeout: riavvia (con limite anti-loop)
        const tooFast = Date.now() - lastStartRef.current < 400;
        restartsRef.current = tooFast ? restartsRef.current + 1 : 0;
        if (restartsRef.current > 5) {
          wantRef.current = false;
          setError('Il riconoscimento vocale si interrompe di continuo. Riprova tra poco oppure scrivi il testo.');
          setStatus('error');
          return;
        }
        try {
          lastStartRef.current = Date.now();
          r.start();
          return;
        } catch {
          wantRef.current = false;
        }
      }
      setInterimText('');
      setStatus((s) => (s === 'error' || s === 'unsupported' ? s : 'idle'));
    };
    return r;
  }, [lang]);

  const start = useCallback(() => {
    if (!getCtor()) { setStatus('unsupported'); return; }
    if (wantRef.current) return;
    setError(null);
    interimRef.current = '';
    setInterimText('');
    teardown();
    const r = create();
    if (!r) return;
    recRef.current = r;
    wantRef.current = true;
    restartsRef.current = 0;
    try {
      lastStartRef.current = Date.now();
      r.start();
      setStatus('listening');
    } catch {
      wantRef.current = false;
      setError(speechErrorMessage('other'));
      setStatus('error');
    }
  }, [create, teardown]);

  const stop = useCallback(() => {
    wantRef.current = false;
    const r = recRef.current;
    if (r) { try { r.stop(); } catch { /* ignore */ } }
    // Il testo parziale non ancora finalizzato viene consolidato
    if (interimRef.current) {
      finalRef.current = (finalRef.current + ' ' + interimRef.current).replace(/\s+/g, ' ').trim();
      setFinalText(finalRef.current);
    }
    interimRef.current = '';
    setInterimText('');
    setStatus((s) => (s === 'listening' ? 'idle' : s));
  }, []);

  const toggle = useCallback(() => {
    if (wantRef.current) stop(); else start();
  }, [start, stop]);

  const reset = useCallback(() => {
    finalRef.current = '';
    interimRef.current = '';
    setFinalText('');
    setInterimText('');
    setError(null);
    setStatus((s) => (s === 'error' ? 'idle' : s));
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    teardown();
  }, [teardown]);

  return {
    status,
    listening: status === 'listening',
    unsupported: status === 'unsupported',
    finalText,
    interimText,
    transcript: (finalText + (interimText ? ' ' + interimText : '')).trim(),
    error,
    start, stop, toggle, reset,
  };
}
