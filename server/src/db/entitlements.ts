// Piano e consumi per tenant. SERVER-EXTRA (billing) scrive con setEntitlement(); il sync legge getPlan().
import { one, run } from './index';
import { monthKey, now } from './clock';

export type Plan = 'free' | 'pro';
export const FREE_DOCS_PER_MONTH = 3;

export interface Entitlement {
  plan: Plan; status: string; currentPeriodEnd: number | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null;
}

export function getEntitlement(tenantId: string): Entitlement {
  const r = one<{ plan: string; status: string; current_period_end: number | null; stripe_customer_id: string | null; stripe_subscription_id: string | null }>(
    'SELECT plan, status, current_period_end, stripe_customer_id, stripe_subscription_id FROM entitlements WHERE tenant_id=?', tenantId);
  if (!r) return { plan: 'free', status: 'active', currentPeriodEnd: null, stripeCustomerId: null, stripeSubscriptionId: null };
  return { plan: r.plan === 'pro' ? 'pro' : 'free', status: r.status, currentPeriodEnd: r.current_period_end,
    stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id };
}

/** Piano effettivo: 'pro' solo se plan='pro' e status attivo/in prova. */
export function getPlan(tenantId: string): Plan {
  const e = getEntitlement(tenantId);
  return e.plan === 'pro' && (e.status === 'active' || e.status === 'trialing') ? 'pro' : 'free';
}

export function setEntitlement(tenantId: string, p: Partial<Entitlement> & { plan: Plan }): void {
  run(
    `INSERT INTO entitlements(tenant_id, plan, status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(tenant_id) DO UPDATE SET plan=excluded.plan, status=excluded.status, current_period_end=excluded.current_period_end,
       stripe_customer_id=COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),
       stripe_subscription_id=COALESCE(excluded.stripe_subscription_id, entitlements.stripe_subscription_id),
       updated_at=excluded.updated_at`,
    tenantId, p.plan, p.status ?? 'active', p.currentPeriodEnd ?? null, p.stripeCustomerId ?? null, p.stripeSubscriptionId ?? null, now());
}

export function getDocsThisMonth(tenantId: string, ts: number = now()): number {
  return one<{ docs_created: number }>('SELECT docs_created FROM usage WHERE tenant_id=? AND month=?', tenantId, monthKey(ts))?.docs_created ?? 0;
}
export function incrementDocsCreated(tenantId: string, ts: number = now()): void {
  run(`INSERT INTO usage(tenant_id, month, docs_created) VALUES (?,?,1)
       ON CONFLICT(tenant_id, month) DO UPDATE SET docs_created = docs_created + 1`, tenantId, monthKey(ts));
}
/** Contatori voce (SERVER-EXTRA): somma stt_seconds / llm_calls nel mese corrente. */
export function addUsage(tenantId: string, d: { sttSeconds?: number; llmCalls?: number }): void {
  run(`INSERT INTO usage(tenant_id, month, stt_seconds, llm_calls) VALUES (?,?,?,?)
       ON CONFLICT(tenant_id, month) DO UPDATE SET stt_seconds = stt_seconds + excluded.stt_seconds, llm_calls = llm_calls + excluded.llm_calls`,
    tenantId, monthKey(), d.sttSeconds ?? 0, d.llmCalls ?? 0);
}
export function getUsage(tenantId: string): { docsCreated: number; sttSeconds: number; llmCalls: number } {
  const r = one<{ docs_created: number; stt_seconds: number; llm_calls: number }>('SELECT docs_created, stt_seconds, llm_calls FROM usage WHERE tenant_id=? AND month=?', tenantId, monthKey());
  return { docsCreated: r?.docs_created ?? 0, sttSeconds: r?.stt_seconds ?? 0, llmCalls: r?.llm_calls ?? 0 };
}
export const docsLimitFor = (plan: Plan): number | null => (plan === 'pro' ? null : FREE_DOCS_PER_MONTH);
