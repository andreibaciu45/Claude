import { canCreateDocument, docsLimitFor, remainingFreeDocs, type Plan, type PlanCache } from './entitlement';
import { monthKey } from './usage';

export interface Allowance {
  plan: Plan;
  /** documenti nuovi creati questo mese (il più alto tra conteggio locale e conteggio del server) */
  used: number;
  /** null = illimitati */
  limit: number | null;
  /** null = illimitati */
  remaining: number | null;
  canCreate: boolean;
}

/** Pura. `serverUsed` = documenti del mese noti al server (solo se la verifica è del mese corrente). */
export function computeAllowance(plan: Plan, localUsed: number, serverUsed?: number | null): Allowance {
  // REV2-B2: la cache sta in localStorage (modificabile, `1e999` diventa Infinity): solo interi finiti >= 0
  const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  const used = Math.max(whole(localUsed), plan === 'free' ? whole(serverUsed) : 0);
  return { plan, used, limit: docsLimitFor(plan), remaining: remainingFreeDocs(plan, used), canCreate: canCreateDocument(plan, used) };
}

/**
 * Documenti del mese noti al server, SOLO se il conteggio riguarda il mese corrente. Il server conta per mese UTC
 * (`periodKey`), il dispositivo per mese locale: confrontare i due fa bloccare per ore, a cavallo del mese, chi ha il contatore
 * già azzerato (o il contrario). Senza `periodKey` (cache vecchia) si usa il mese UTC della verifica.
 */
export function serverUsedFor(cache: Pick<PlanCache, 'verifiedAt' | 'docsThisMonth' | 'periodKey'> | null | undefined, now: number): number | undefined {
  if (!cache) return undefined;
  const period = cache.periodKey ?? monthKey(cache.verifiedAt, 'UTC');
  return period === monthKey(now, 'UTC') ? cache.docsThisMonth : undefined;
}
