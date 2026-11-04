// Piano e consumi per tenant. SERVER-EXTRA (billing) scrive con setEntitlement(); il sync legge getPlan().
import { one, run } from './index';
import { monthKey, now } from './clock';

export type Plan = 'free' | 'pro';
export const FREE_DOCS_PER_MONTH = 3;

export interface Entitlement {
  plan: Plan; status: string; currentPeriodEnd: number | null;
  /** Fine del periodo di grazia dopo un pagamento fallito (status 'past_due'). */
  graceUntil: number | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null;
}

/** Tolleranza oltre currentPeriodEnd prima di declassare un abbonamento ancora 'active' (webhook di rinnovo in ritardo). Default 3 giorni. */
export const periodSlackMs = (): number => {
  const raw = process.env.BILLING_PERIOD_SLACK_DAYS;
  const d = raw === undefined || raw === '' ? 3 : Number(raw);
  return (Number.isFinite(d) && d >= 0 ? d : 3) * 86_400_000;
};

export function getEntitlement(tenantId: string): Entitlement {
  const r = one<{ plan: string; status: string; current_period_end: number | null; grace_until: number | null; stripe_customer_id: string | null; stripe_subscription_id: string | null }>(
    'SELECT plan, status, current_period_end, grace_until, stripe_customer_id, stripe_subscription_id FROM entitlements WHERE tenant_id=?', tenantId);
  if (!r) return { plan: 'free', status: 'active', currentPeriodEnd: null, graceUntil: null, stripeCustomerId: null, stripeSubscriptionId: null };
  return { plan: r.plan === 'pro' ? 'pro' : 'free', status: r.status, currentPeriodEnd: r.current_period_end, graceUntil: r.grace_until,
    stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id };
}

/**
 * Piano effettivo a un istante (funzione pura, usata da getPlan e dai test):
 *  - 'active'/'trialing': Pro, ma se currentPeriodEnd è noto ed è passato da più di `periodSlackMs` (rinnovo mai arrivato) => Free;
 *  - 'past_due' (pagamento fallito): Pro SOLO fino a graceUntil (periodo di grazia), poi Free;
 *  - qualunque altro stato ('canceled', 'unpaid', ...) => Free.
 */
export function effectivePlan(e: Pick<Entitlement, 'plan' | 'status' | 'currentPeriodEnd' | 'graceUntil'>, ts: number): Plan {
  if (e.plan !== 'pro') return 'free';
  if (e.status === 'active' || e.status === 'trialing') {
    return e.currentPeriodEnd !== null && ts > e.currentPeriodEnd + periodSlackMs() ? 'free' : 'pro';
  }
  if (e.status === 'past_due') return e.graceUntil !== null && ts < e.graceUntil ? 'pro' : 'free';
  return 'free';
}

/** Piano effettivo del tenant adesso (rispetta periodo di grazia e currentPeriodEnd). */
export function getPlan(tenantId: string, ts: number = now()): Plan {
  return effectivePlan(getEntitlement(tenantId), ts);
}

export function setEntitlement(tenantId: string, p: Partial<Entitlement> & { plan: Plan }): void {
  run(
    `INSERT INTO entitlements(tenant_id, plan, status, current_period_end, grace_until, stripe_customer_id, stripe_subscription_id, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(tenant_id) DO UPDATE SET plan=excluded.plan, status=excluded.status, current_period_end=excluded.current_period_end,
       grace_until=excluded.grace_until,
       stripe_customer_id=COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),
       stripe_subscription_id=COALESCE(excluded.stripe_subscription_id, entitlements.stripe_subscription_id),
       updated_at=excluded.updated_at`,
    tenantId, p.plan, p.status ?? 'active', p.currentPeriodEnd ?? null, p.graceUntil ?? null, p.stripeCustomerId ?? null, p.stripeSubscriptionId ?? null, now());
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
