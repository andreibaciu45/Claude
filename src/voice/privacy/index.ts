/**
 * Informativa sul microfono (docs/PWA.md §5): da mostrare UNA volta prima del primo avvio del riconoscimento vocale.
 * La scelta «Continua con il microfono» è ricordata in `localStorage['vp.voicePrivacyAck']`; se localStorage non è
 * disponibile (navigazione privata, dati bloccati) l'informativa viene riproposta ogni volta.
 */
export const VOICE_PRIVACY_KEY = 'vp.voicePrivacyAck';

export type VoicePrivacyVariant = 'web' | 'native';

export interface VoicePrivacyText { title: string; paragraphs: string[]; accept: string; decline: string }

export const VOICE_PRIVACY_TEXT: Record<VoicePrivacyVariant, VoicePrivacyText> = {
  web: {
    title: 'Dettatura vocale e privacy',
    paragraphs: [
      'Per riconoscere la tua voce, il browser può inviare l’audio al suo fornitore (ad esempio Google su Chrome, Apple su Safari), che lo elabora secondo la propria informativa.',
      'Se usi la registrazione con trascrizione (per esempio su iPhone o se la scegli tu), l’audio viene inviato ai nostri server solo per ottenere il testo e non viene conservato.',
      'VocePreventivo non conserva l’audio. Se preferisci, puoi scrivere il testo con la tastiera: il resto dell’app funziona uguale.',
    ],
    accept: 'Continua con il microfono',
    decline: 'Preferisco scrivere',
  },
  native: {
    title: 'Dettatura vocale e privacy',
    paragraphs: [
      'Il riconoscimento vocale è quello del tuo telefono: l’audio è elaborato dal sistema operativo e, su iPhone, può essere inviato ad Apple secondo la loro informativa.',
      'Se usi la trascrizione tramite il nostro server, l’audio serve solo per ottenere il testo e non viene conservato.',
      'VocePreventivo non conserva l’audio. Se preferisci, puoi scrivere il testo con la tastiera: il resto dell’app funziona uguale.',
    ],
    accept: 'Continua con il microfono',
    decline: 'Preferisco scrivere',
  },
};

export function hasVoicePrivacyAck(): boolean {
  try { return localStorage.getItem(VOICE_PRIVACY_KEY) === '1'; } catch { return false; }
}

/** Ricorda la scelta. Restituisce false se non è possibile salvarla (si chiederà di nuovo). */
export function setVoicePrivacyAck(): boolean {
  try { localStorage.setItem(VOICE_PRIVACY_KEY, '1'); return localStorage.getItem(VOICE_PRIVACY_KEY) === '1'; } catch { return false; }
}
