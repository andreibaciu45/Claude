// Entitlements e quote: funzioni pure + store iniettabile (in-memory per test; SQLite a cura di CORE).
import type { Clock } from './common';
import { periodSlackMs } from '../db/entitlements';

export type Plan = 'free' | 'pro';
export type SubStatus = 'active' | 'past_due' | 'canceled';
export const FREE_DOCS_PER_MONTH = 3;
export const DEFAULT_GRACE_DAYS = 7;

export interface SubscriptionRecord {
  tenantId: string;
  customerId?: string;
  subscriptionId?: string;
  status: SubStatus;
  interval?: 'month' | 'year';
  currentPeriodEnd?: number; // epoch ms
  graceUntil?: number; // epoch ms, valorizzato con past_due
  /** `created` (epoch ms) dell'ultimo evento Stripe applicato: scarta gli eventi arrivati fuori ordine. */
  lastEventAt?: number;
  /** Disdetto ma attivo fino a currentPeriodEnd. */
  cancelAtPeriodEnd?: boolean;
  updatedAt: number;
}

export interface Entitlement {
  plan: Plan;
  state: 'free' | 'active' | 'grace' | 'canceled';
  docsLimit: number | null; // null = illimitato
  graceUntil?: number;
}

/** Pura: Pro se attivo (e currentPeriodEnd, se noto, non scaduto oltre la tolleranza), oppure past_due entro il periodo di grazia. Stessa regola di db/entitlements.effectivePlan. */
export function computeEntitlement(sub: SubscriptionRecord | null, now: number): Entitlement {
  if (!sub) return { plan: 'free', state: 'free', docsLimit: FREE_DOCS_PER_MONTH };
  if (sub.status === 'active') {
    if (sub.currentPeriodEnd !== undefined && now > sub.currentPeriodEnd + periodSlackMs()) {
      return { plan: 'free', state: 'canceled', docsLimit: FREE_DOCS_PER_MONTH };
    }
    return { plan: 'pro', state: 'active', docsLimit: null };
  }
  if (sub.status === 'past_due' && sub.graceUntil !== undefined && sub.graceUntil > now) {
    return { plan: 'pro', state: 'grace', docsLimit: null, graceUntil: sub.graceUntil };
  }
  return { plan: 'free', state: 'canceled', docsLimit: FREE_DOCS_PER_MONTH };
}

/** Pura: valuta se `amount` documenti stanno nella quota, dato l'usato del mese. */
export function evaluateQuota(ent: Entitlement, used: number, amount = 1) {
  if (ent.docsLimit === null) return { allowed: true, used, remaining: null as number | null };
  const allowed = used + amount <= ent.docsLimit;
  return { allowed, used, remaining: Math.max(0, ent.docsLimit - used - (allowed ? amount : 0)) as number | null };
}

/** Chiave periodo mensile UTC 'YYYY-MM'. */
export function periodKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface BillingStore {
  getSubscription(tenantId: string): Promise<SubscriptionRecord | null>;
  saveSubscription(rec: SubscriptionRecord): Promise<void>;
  findTenantByCustomer(customerId: string): Promise<string | null>;
  getUsage(tenantId: string, period: string): Promise<number>;
  /** Atomico: incrementa solo se used+amount <= limit (limit null = sempre). */
  consume(tenantId: string, period: string, amount: number, limit: number | null): Promise<{ allowed: boolean; used: number }>;
  /** true se l'evento è nuovo (reclamato), false se già visto. */
  claimEvent(eventId: string): Promise<boolean>;
  releaseEvent(eventId: string): Promise<void>;
}

export class InMemoryBillingStore implements BillingStore {
  subs = new Map<string, SubscriptionRecord>();
  usage = new Map<string, number>();
  events = new Set<string>();
  async getSubscription(t: string) { return this.subs.get(t) ?? null; }
  async saveSubscription(r: SubscriptionRecord) { this.subs.set(r.tenantId, { ...r }); }
  async findTenantByCustomer(c: string) {
    for (const s of this.subs.values()) if (s.customerId === c) return s.tenantId;
    return null;
  }
  async getUsage(t: string, p: string) { return this.usage.get(`${t}|${p}`) ?? 0; }
  async consume(t: string, p: string, amount: number, limit: number | null) {
    const k = `${t}|${p}`;
    const used = this.usage.get(k) ?? 0;
    if (limit !== null && used + amount > limit) return { allowed: false, used };
    this.usage.set(k, used + amount);
    return { allowed: true, used: used + amount };
  }
  async claimEvent(id: string) { if (this.events.has(id)) return false; this.events.add(id); return true; }
  async releaseEvent(id: string) { this.events.delete(id); }
}

export interface BillingService {
  getEntitlement(tenantId: string): Promise<Entitlement>;
  /** Consuma `amount` documenti dalla quota mensile. Free: max 3/mese. */
  consumeQuota(tenantId: string, amount?: number): Promise<{ allowed: boolean; used: number; limit: number | null; entitlement: Entitlement }>;
  /** Per GET /v1/me */
  quotaSnapshot(tenantId: string): Promise<{ plan: Plan; quota: { docsThisMonth: number; docsLimit: number | null } }>;
}

/**
 * `manualGrant`: fine (ms) della licenza concessa a mano (db/grants.ts), se attiva. Precedenza = massimo tra Stripe e concessione manuale:
 * la concessione rende Pro un tenant che da Stripe sarebbe Free, senza toccare la sottoscrizione.
 */
export function createBillingService(store: BillingStore, clock: Clock, manualGrant?: (tenantId: string, now: number) => number | null): BillingService {
  const getEntitlement = async (tenantId: string): Promise<Entitlement> => {
    const now = clock.now();
    const e = computeEntitlement(await store.getSubscription(tenantId), now);
    if (e.plan === 'free' && manualGrant) {
      const until = manualGrant(tenantId, now);
      if (until !== null && until > now) return { plan: 'pro', state: 'active', docsLimit: null };
    }
    return e;
  };
  return {
    getEntitlement,
    async consumeQuota(tenantId, amount = 1) {
      const entitlement = await getEntitlement(tenantId);
      const r = await store.consume(tenantId, periodKey(clock.now()), amount, entitlement.docsLimit);
      return { allowed: r.allowed, used: r.used, limit: entitlement.docsLimit, entitlement };
    },
    async quotaSnapshot(tenantId) {
      const ent = await getEntitlement(tenantId);
      const used = await store.getUsage(tenantId, periodKey(clock.now()));
      return { plan: ent.plan, quota: { docsThisMonth: used, docsLimit: ent.docsLimit } };
    },
  };
}
