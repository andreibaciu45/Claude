// Gestione eventi Stripe -> entitlements. Idempotente per event id.
import { z } from 'zod';
import type { BillingStore, SubscriptionRecord } from './entitlements';
import { DEFAULT_GRACE_DAYS } from './entitlements';

const EventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().optional(), // epoch SECONDI (Stripe)
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export type StripeEvent = z.infer<typeof EventSchema>;
export const parseStripeEvent = (raw: string): StripeEvent | null => {
  try { const r = EventSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export type HandleResult = { handled: boolean; duplicate?: boolean; tenantId?: string; note?: string };

export async function processStripeEvent(
  ev: StripeEvent,
  store: BillingStore,
  nowMs: number,
  graceDays = DEFAULT_GRACE_DAYS,
): Promise<HandleResult> {
  if (!(await store.claimEvent(ev.id))) return { handled: false, duplicate: true };
  try {
    return await dispatch(ev, store, nowMs, graceDays);
  } catch (e) {
    await store.releaseEvent(ev.id); // consente il retry di Stripe
    throw e;
  }
}

async function resolveTenant(obj: Record<string, unknown>, store: BillingStore): Promise<string | undefined> {
  const direct = str(obj.client_reference_id) ?? str(rec(obj.metadata).tenantId);
  if (direct) return direct;
  const customer = str(obj.customer);
  return customer ? (await store.findTenantByCustomer(customer)) ?? undefined : undefined;
}

function periodEndMs(obj: Record<string, unknown>): number | undefined {
  const items = rec(obj.items).data;
  const first = Array.isArray(items) ? rec(items[0]) : {};
  const sec = typeof obj.current_period_end === 'number' ? obj.current_period_end
    : typeof first.current_period_end === 'number' ? first.current_period_end : undefined;
  return sec !== undefined ? sec * 1000 : undefined;
}
function intervalOf(obj: Record<string, unknown>): 'month' | 'year' | undefined {
  const items = rec(obj.items).data;
  const first = Array.isArray(items) ? rec(items[0]) : {};
  const iv = str(rec(rec(first.price).recurring).interval) ?? str(rec(obj.plan).interval);
  return iv === 'month' || iv === 'year' ? iv : undefined;
}

async function dispatch(ev: StripeEvent, store: BillingStore, now: number, graceDays: number): Promise<HandleResult> {
  const obj = ev.data.object;
  const tenantId = await resolveTenant(obj, store);
  if (!tenantId) return { handled: false, note: 'tenant non risolto' };
  const prev = await store.getSubscription(tenantId);
  const base: SubscriptionRecord = prev ?? { tenantId, status: 'canceled', updatedAt: now };
  // Stripe non garantisce l'ordine: un evento più vecchio dell'ultimo applicato non deve far "risorgere" un abbonamento.
  const evAt = typeof ev.created === 'number' && ev.created > 0 ? ev.created * 1000 : undefined;
  if (evAt !== undefined && prev?.lastEventAt !== undefined && evAt < prev.lastEventAt) {
    return { handled: false, tenantId, note: 'evento obsoleto (fuori ordine)' };
  }
  const next: SubscriptionRecord = { ...base, updatedAt: now };
  if (evAt !== undefined) next.lastEventAt = Math.max(evAt, prev?.lastEventAt ?? 0);
  const customer = str(obj.customer);
  if (customer) next.customerId = customer;

  switch (ev.type) {
    case 'checkout.session.completed': {
      if (obj.payment_status === 'unpaid') return { handled: false, tenantId, note: 'pagamento non completato' };
      next.status = 'active';
      delete next.graceUntil;
      const sub = str(obj.subscription);
      if (sub) next.subscriptionId = sub;
      const plan = str(rec(obj.metadata).plan);
      if (plan === 'month' || plan === 'year') next.interval = plan;
      break;
    }
    case 'customer.subscription.updated': {
      const s = str(obj.status);
      const sid = str(obj.id);
      if (sid) next.subscriptionId = sid;
      const iv = intervalOf(obj); if (iv) next.interval = iv;
      const pe = periodEndMs(obj); if (pe) next.currentPeriodEnd = pe;
      if (s === 'active' || s === 'trialing') { next.status = 'active'; delete next.graceUntil; }
      else if (s === 'past_due') {
        next.status = 'past_due';
        if (!(prev?.status === 'past_due' && prev.graceUntil)) next.graceUntil = now + graceDays * 86_400_000;
      } else if (s === 'canceled' || s === 'unpaid' || s === 'incomplete_expired') { next.status = 'canceled'; delete next.graceUntil; }
      else return { handled: false, tenantId, note: `stato ${s ?? '?'} ignorato` };
      break;
    }
    case 'customer.subscription.deleted':
      next.status = 'canceled';
      delete next.graceUntil;
      break;
    case 'invoice.payment_failed':
      if (prev?.status !== 'active' && prev?.status !== 'past_due') return { handled: false, tenantId, note: 'nessun abbonamento attivo' };
      next.status = 'past_due';
      // il retry di Stripe non deve prolungare la grazia
      if (!(prev.status === 'past_due' && prev.graceUntil)) next.graceUntil = now + graceDays * 86_400_000;
      break;
    case 'invoice.paid':
      if (!prev || prev.status !== 'past_due') return { handled: false, tenantId, note: 'niente da ripristinare' };
      next.status = 'active';
      delete next.graceUntil;
      break;
    default:
      return { handled: false, tenantId, note: 'evento non gestito' };
  }
  await store.saveSubscription(next);
  return { handled: true, tenantId };
}
