/**
 * Piano dell'utente (free/pro) lato client.
 *
 * La verità è il server (`GET /v1/me`, alimentato dai webhook Stripe). Il client tiene una copia in cache
 * per funzionare offline:
 *  - Pro verificato di recente => Pro;
 *  - Pro non rinnovabile perché offline => Pro garantito per OFFLINE_GRACE_MS (14 giorni) dall'ultima verifica riuscita,
 *    poi si torna a Free finché non si riesce a verificare di nuovo (i dati non si perdono mai);
 *  - dopo CACHE_TTL_MS la copia è "da riverificare" (si prova ad aggiornarla), ma vale ancora;
 *  - se il server dice Free, il downgrade è immediato;
 *  - senza account => sempre Free.
 *
 * ONESTÀ: la cache è in localStorage, quindi un utente tecnico può alterarla. Non è sicurezza: ciò che
 * il Pro dà di "vincolante" (sincronizzazione, quote) lo applica il server. Qui il piano decide solo i limiti morbidi dell'interfaccia.
 */
import type { MeResponse } from '../../shared/api';
import { FREE_DOCS_PER_MONTH } from './pricing';

export type Plan = 'free' | 'pro';

export const CACHE_TTL_MS = 24 * 3600_000;
export const OFFLINE_GRACE_MS = 14 * 24 * 3600_000;
/** Tolleranza per orologi sballati: una verifica "nel futuro" oltre questo margine non è attendibile. */
export const CLOCK_SKEW_MS = 5 * 60_000;
const CACHE_KEY = 'vp:billing:plan';

export interface PlanCache {
  plan: Plan;
  /** quando il server ha confermato questo stato (epoch ms, orologio del dispositivo) */
  verifiedAt: number;
  email?: string;
  docsThisMonth?: number;
  docsLimit?: number | null;
}

export type PlanReason =
  | 'anonymous'      // nessun account
  | 'server-free'    // il server dice Free
  | 'server-pro'     // Pro verificato di recente
  | 'cache-pro'      // Pro dalla cache, non riverificato da un po' (offline o server irraggiungibile)
  | 'unverified'     // account presente ma mai verificato su questo dispositivo
  | 'expired';       // Pro scaduto per mancata verifica oltre la tolleranza

export interface PlanState {
  plan: Plan;
  reason: PlanReason;
  verifiedAt: number | null;
  /** fino a quando il Pro vale senza una nuova verifica (solo Pro) */
  proValidUntil: number | null;
  /** true se conviene riverificare col server */
  needsRefresh: boolean;
}

/** Pura. Decide il piano effettivo da cache, presenza di account e ora. */
export function resolvePlan(cache: PlanCache | null, signedIn: boolean, now: number, email?: string | null): PlanState {
  if (!signedIn) return { plan: 'free', reason: 'anonymous', verifiedAt: null, proValidUntil: null, needsRefresh: false };
  const valid = cache && Number.isFinite(cache.verifiedAt) && cache.verifiedAt - now <= CLOCK_SKEW_MS
    && !(email && cache.email && cache.email.toLowerCase() !== email.toLowerCase());
  if (!cache || !valid) return { plan: 'free', reason: 'unverified', verifiedAt: null, proValidUntil: null, needsRefresh: true };
  const age = Math.max(0, now - cache.verifiedAt);
  if (cache.plan === 'free') {
    return { plan: 'free', reason: 'server-free', verifiedAt: cache.verifiedAt, proValidUntil: null, needsRefresh: age > CACHE_TTL_MS };
  }
  const proValidUntil = cache.verifiedAt + OFFLINE_GRACE_MS;
  if (age > OFFLINE_GRACE_MS) return { plan: 'free', reason: 'expired', verifiedAt: cache.verifiedAt, proValidUntil, needsRefresh: true };
  return {
    plan: 'pro', reason: age > CACHE_TTL_MS ? 'cache-pro' : 'server-pro',
    verifiedAt: cache.verifiedAt, proValidUntil, needsRefresh: age > CACHE_TTL_MS,
  };
}

// ---- funzioni pure sui limiti ----

/** Limite mensile di documenti nuovi: null = illimitato. */
export const docsLimitFor = (plan: Plan): number | null => (plan === 'pro' ? null : FREE_DOCS_PER_MONTH);

/** Si può creare un NUOVO documento? (Modifica, download e consultazione non passano da qui.) */
export function canCreateDocument(plan: Plan, docsThisMonth: number): boolean {
  const limit = docsLimitFor(plan);
  return limit === null || docsThisMonth < limit;
}

/** Documenti gratuiti ancora disponibili questo mese; null = illimitati (Pro). Mai negativo. */
export function remainingFreeDocs(plan: Plan, docsThisMonth: number): number | null {
  const limit = docsLimitFor(plan);
  return limit === null ? null : Math.max(0, limit - Math.max(0, docsThisMonth));
}

// ---- cache locale (mai fa lanciare l'app) ----
export function readPlanCache(): PlanCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<PlanCache>;
    if ((j.plan !== 'free' && j.plan !== 'pro') || typeof j.verifiedAt !== 'number') return null;
    return {
      plan: j.plan, verifiedAt: j.verifiedAt,
      email: typeof j.email === 'string' ? j.email : undefined,
      docsThisMonth: typeof j.docsThisMonth === 'number' ? j.docsThisMonth : undefined,
      docsLimit: j.docsLimit === null || typeof j.docsLimit === 'number' ? j.docsLimit : undefined,
    };
  } catch { return null; }
}

export function writePlanCache(c: PlanCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignora */ }
}

export function clearPlanCache(): void {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignora */ }
}

/** Costruisce la cache da una risposta di GET /v1/me. */
export function cacheFromMe(me: Pick<MeResponse, 'plan' | 'email' | 'quota'>, now: number): PlanCache {
  return {
    plan: me.plan === 'pro' ? 'pro' : 'free', verifiedAt: now, email: me.email,
    docsThisMonth: me.quota?.docsThisMonth, docsLimit: me.quota?.docsLimit,
  };
}
