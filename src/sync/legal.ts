/**
 * Versioni dei documenti legali accettati al login (UNICO punto da aggiornare).
 * Devono coincidere con le versioni riportate in `public/legal/termini.html` e `public/legal/dpa.html`
 * (intestazione "Versione/Ultimo aggiornamento") e con TERMS_CURRENT_VERSION / DPA_CURRENT_VERSION del server.
 * Quando il testo di Termini o DPA cambia, aumentare la costante: gli utenti dovranno accettare di nuovo.
 */
import type { TermsAcceptance } from '../../shared/api';

export const TERMS_VERSION = '2026-11-04';
export const DPA_VERSION = '2026-11-04';

const base = (): string => {
  const b = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
};

export const LEGAL_LINKS = {
  termini: () => `${base()}legal/termini.html`,
  privacy: () => `${base()}legal/privacy.html`,
  dpa: () => `${base()}legal/dpa.html`,
} as const;

const KEY = 'vp:sync:terms';

/** Ultima accettazione fatta su questo dispositivo (solo comodità: la prova legale è registrata dal server). */
export const termsAcceptanceStore = {
  get(): TermsAcceptance | null {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? (JSON.parse(raw) as TermsAcceptance) : null;
      return v && typeof v.termsVersion === 'string' ? v : null;
    } catch { return null; }
  },
  set(a: TermsAcceptance): void { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignora */ } },
  clear(): void { try { localStorage.removeItem(KEY); } catch { /* ignora */ } },
};

/** Accettazione relativa alle versioni correnti, con data/ora del client (informativa: fa fede il server). */
export const currentAcceptance = (now: number = Date.now()): TermsAcceptance =>
  ({ termsVersion: TERMS_VERSION, dpaVersion: DPA_VERSION, acceptedAt: now });

/** true se questo dispositivo ha già accettato esattamente le versioni correnti. */
export function hasAcceptedCurrent(): boolean {
  const a = termsAcceptanceStore.get();
  return !!a && a.termsVersion === TERMS_VERSION && a.dpaVersion === DPA_VERSION;
}
