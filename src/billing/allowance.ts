import { canCreateDocument, docsLimitFor, remainingFreeDocs, type Plan } from './entitlement';

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
  const used = Math.max(0, localUsed, plan === 'free' && typeof serverUsed === 'number' ? serverUsed : 0);
  return { plan, used, limit: docsLimitFor(plan), remaining: remainingFreeDocs(plan, used), canCreate: canCreateDocument(plan, used) };
}
