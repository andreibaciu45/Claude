import { describe, it, expect, beforeEach } from 'vitest';
import { call, freshEnv, login, docOp, invoice, quote, opId, push } from './core/helpers';
import { all, one, run } from '../src/db';
import { SqliteBillingStore } from '../src/billing/sqlite-store';
import { processStripeEvent } from '../src/billing/webhook';
import { getPlan } from '../src/db/entitlements';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

describe('probe', () => {
  beforeEach(freshEnv);
  it('poison', async () => {
    const { token } = await login('a@x.it');
    const d = quote('q1', { notes: 'enc:v1:k1:AAAA' });
    const r = await push(token, [docOp(d)]);
    console.log('push', JSON.stringify(r.json.conflicts));
    const g = await call('GET', '/v1/documents/q1', { token });
    const e = await call('GET', '/v1/me/export', { token });
    console.log('get', g.status, 'export', e.status);
  });
  it('delete-before-create', async () => {
    const { token } = await login('a@x.it');
    const d = quote('q2', { updatedAt: 1000 });
    const r1 = await push(token, [{ opId: opId(), entity: 'document', entityId: 'q2', op: 'delete', clientTs: 2000 }]);
    const r2 = await push(token, [docOp(d)]);
    const p = await call('GET', '/v1/sync/pull?cursor=0', { token });
    console.log('del', JSON.stringify(r1.json.accepted.length), 'create', r2.json.accepted.length, p.json.ops.map((o: any) => o.op));
  });
  it('dup label', async () => {
    const { token } = await login('a@x.it');
    const a = invoice('i1', 1);
    const b = invoice('i2', 1, { }); (b.invoice as any).sectional = 'ft';
    const r = await push(token, [docOp(a), docOp(b)]);
    console.log('dup', JSON.stringify(r.json.conflicts));
    const c = invoice('i3', 2); (c.invoice as any).seq = 5; // number '2/2026' seq 5
    const d = invoice('i4', 7); (d.invoice as any).seq = 7; d.number = '2/2026'; (d.invoice as any).number = '2/2026';
    const r2 = await push(token, [docOp(c), docOp(d)]);
    console.log('dup2', JSON.stringify(r2.json.conflicts));
  });
  it('audit big', async () => {
    const { token } = await login('a@x.it');
    const big = 'x'.repeat(18000);
    const r = await push(token, [{ opId: opId(), entity: 'audit', entityId: 'a1', op: 'upsert', clientTs: 1, payload: { id: 'a1', at: 1, docId: 'd', action: 'edit', actor: 'user', junk: big } }]);
    console.log('audit', r.json.accepted.length, JSON.stringify(r.json.conflicts));
  });
  it('resubscribe', async () => {
    const { token, tenantId } = await login('a@x.it');
    const store = new SqliteBillingStore();
    const t0 = Date.now();
    const day = 86400_000;
    await processStripeEvent({ id: 'e1', type: 'checkout.session.completed', created: Math.floor((t0 - 200 * day) / 1000), data: { object: { client_reference_id: tenantId, customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'month' } } } }, store, t0 - 200 * day);
    await processStripeEvent({ id: 'e2', type: 'customer.subscription.updated', created: Math.floor((t0 - 199 * day) / 1000), data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: Math.floor((t0 - 170 * day) / 1000), cancel_at_period_end: true, metadata: { tenantId } } } }, store, t0 - 199 * day);
    await processStripeEvent({ id: 'e3', type: 'customer.subscription.deleted', created: Math.floor((t0 - 170 * day) / 1000), data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { tenantId } } } }, store, t0 - 170 * day);
    await processStripeEvent({ id: 'e4', type: 'checkout.session.completed', created: Math.floor((t0 - 1000) / 1000), data: { object: { client_reference_id: tenantId, customer: 'cus_1', subscription: 'sub_2', metadata: { plan: 'month' } } } }, store, t0);
    console.log('plan after resubscribe', getPlan(tenantId), JSON.stringify(await store.getSubscription(tenantId)));
  });
});
