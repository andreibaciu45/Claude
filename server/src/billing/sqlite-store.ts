// BillingStore su SQLite (DB di CORE). Migrazione 100 registrata all'import (PRIMA della prima apertura del DB).
// Riusa le tabelle `entitlements` e `usage` di CORE per piano e consumi; aggiunge sottoscrizione dettagliata ed eventi.
import { one, registerMigration, run, transaction } from '../db';
import { setEntitlement } from '../db/entitlements';
import type { BillingStore, SubscriptionRecord } from './entitlements';

registerMigration(100, 'extra_billing', `
CREATE TABLE billing_subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  customer_id TEXT, subscription_id TEXT, status TEXT NOT NULL, interval TEXT,
  current_period_end INTEGER, grace_until INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_billing_customer ON billing_subscriptions(customer_id);
CREATE TABLE billing_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
`);
registerMigration(102, 'extra_billing_event_order', `ALTER TABLE billing_subscriptions ADD COLUMN last_event_at INTEGER;`);

interface Row { tenant_id: string; customer_id: string | null; subscription_id: string | null; status: string; interval: string | null; current_period_end: number | null; grace_until: number | null; last_event_at: number | null; updated_at: number }

export class SqliteBillingStore implements BillingStore {
  async getSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const r = one<Row>('SELECT * FROM billing_subscriptions WHERE tenant_id=?', tenantId);
    if (!r) return null;
    return {
      tenantId: r.tenant_id, customerId: r.customer_id ?? undefined, subscriptionId: r.subscription_id ?? undefined,
      status: r.status as SubscriptionRecord['status'], interval: (r.interval as 'month' | 'year' | null) ?? undefined,
      currentPeriodEnd: r.current_period_end ?? undefined, graceUntil: r.grace_until ?? undefined, lastEventAt: r.last_event_at ?? undefined, updatedAt: r.updated_at,
    };
  }
  async saveSubscription(s: SubscriptionRecord): Promise<void> {
    transaction(() => {
      run(`INSERT INTO billing_subscriptions(tenant_id, customer_id, subscription_id, status, interval, current_period_end, grace_until, last_event_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id) DO UPDATE SET customer_id=excluded.customer_id, subscription_id=excluded.subscription_id,
             status=excluded.status, interval=excluded.interval, current_period_end=excluded.current_period_end,
             grace_until=excluded.grace_until, last_event_at=excluded.last_event_at, updated_at=excluded.updated_at`,
        s.tenantId, s.customerId ?? null, s.subscriptionId ?? null, s.status, s.interval ?? null,
        s.currentPeriodEnd ?? null, s.graceUntil ?? null, s.lastEventAt ?? null, s.updatedAt);
      // Specchio sulla tabella di CORE con lo stato FEDELE (active/past_due/canceled), periodo e grazia:
      // getPlan() di CORE decide il piano effettivo nel tempo (periodo di grazia, currentPeriodEnd).
      setEntitlement(s.tenantId, {
        plan: s.status === 'canceled' ? 'free' : 'pro', status: s.status,
        currentPeriodEnd: s.currentPeriodEnd ?? null, graceUntil: s.graceUntil ?? null,
        stripeCustomerId: s.customerId ?? null, stripeSubscriptionId: s.subscriptionId ?? null,
      });
    });
  }
  async findTenantByCustomer(customerId: string) {
    return one<{ tenant_id: string }>('SELECT tenant_id FROM billing_subscriptions WHERE customer_id=?', customerId)?.tenant_id ?? null;
  }
  async getUsage(tenantId: string, period: string) {
    return one<{ docs_created: number }>('SELECT docs_created FROM usage WHERE tenant_id=? AND month=?', tenantId, period)?.docs_created ?? 0;
  }
  async consume(tenantId: string, period: string, amount: number, limit: number | null) {
    return transaction(() => {
      const used = one<{ docs_created: number }>('SELECT docs_created FROM usage WHERE tenant_id=? AND month=?', tenantId, period)?.docs_created ?? 0;
      if (limit !== null && used + amount > limit) return { allowed: false, used };
      run(`INSERT INTO usage(tenant_id, month, docs_created) VALUES (?,?,?)
           ON CONFLICT(tenant_id, month) DO UPDATE SET docs_created = docs_created + ?`, tenantId, period, amount, amount);
      return { allowed: true, used: used + amount };
    });
  }
  async claimEvent(eventId: string) {
    const r = run('INSERT OR IGNORE INTO billing_events(event_id, received_at) VALUES (?,?)', eventId, Date.now());
    return Number(r.changes) === 1;
  }
  async releaseEvent(eventId: string) { run('DELETE FROM billing_events WHERE event_id=?', eventId); }
}
