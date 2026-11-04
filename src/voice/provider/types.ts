/** Interfaccia uniforme dei provider di riconoscimento vocale (Web Speech, registrazione + server). */
export type ProviderKind = 'webspeech' | 'recorder';

export type ProviderState = 'idle' | 'starting' | 'listening' | 'processing' | 'error';

export type SpeechErrorCode =
  | 'not-allowed' | 'no-speech' | 'audio-capture' | 'network' | 'offline' | 'unauthorized'
  | 'too-large' | 'quota' | 'server' | 'unsupported' | 'empty' | 'unknown';

export type SpeechEvent =
  | { type: 'state'; state: ProviderState }
  /** trascrizione parziale (solo Web Speech) */
  | { type: 'partial'; text: string }
  /** trascrizione finale; `alternatives` = ipotesi n-best diverse dalla principale */
  | { type: 'final'; text: string; alternatives?: string[] }
  /** errore in italiano, mostrabile all'utente */
  | { type: 'error'; code: SpeechErrorCode; message: string };

export interface SpeechProvider {
  readonly kind: ProviderKind;
  readonly state: ProviderState;
  /** avvia l'ascolto (push-to-talk). Non lancia: gli errori arrivano come evento 'error'. */
  start(): Promise<void>;
  /** termina l'ascolto e produce la trascrizione finale */
  stop(): void;
  /** interrompe e scarta tutto */
  cancel(): void;
  /** riprova l'invio dell'ultima registrazione (solo recorder, dopo errore di rete) */
  retry?(): Promise<void>;
  subscribe(listener: (e: SpeechEvent) => void): () => void;
  destroy(): void;
}
