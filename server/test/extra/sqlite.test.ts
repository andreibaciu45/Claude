process.env.DB_PATH = ':memory:';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, run, one } from '../../src/db';
import { getPlan } from '../../src/db/entitlements';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';
import { createBillingService } from '../../src/billing/entitlements';
import { SqliteDocumentSink, SqliteDocumentSource, SqliteJobStore, SqliteSdiStore } from '../../src/sdi/sqlite';
import { createJobRunner } from '../../src/sdi/jobs';
import { fakeClock } from './helpers';

beforeEach(() => {
  resetDb();
  run(`INSERT INTO tenants(id, name, created_at) VALUES ('t1','x',1)`);
});

describe('adattatori SQLite', () => {
  it('billing: sottoscrizione, quota, eventi idempotenti, specchio su entitlements di CORE', async () => {
    const store = new SqliteBillingStore(); const clock = fakeClock();
    const svc = createBillingService(store, clock);
    for (let i = 0; i < 3; i++) expect((await svc.consumeQuota('t1')).allowed).toBe(true);
    expect((await svc.consumeQuota('t1')).allowed).toBe(false);
    expect(await store.claimEvent('e1')).toBe(true);
    expect(await store.claimEvent('e1')).toBe(false);
    await store.saveSubscription({ tenantId: 't1', customerId: 'cus_1', status: 'active', updatedAt: clock.now() });
    expect(getPlan('t1')).toBe('pro');
    expect((await svc.consumeQuota('t1')).allowed).toBe(true);
    expect(await store.findTenantByCustomer('cus_1')).toBe('t1');
  });
  it('job store: dedupe, retry, dead-letter', async () => {
    const js = new SqliteJobStore(); const clock = fakeClock();
    const a = await js.enqueue({ kind: 'x', payload: { a: 1 }, dedupeKey: 'k', maxAttempts: 2 }, clock.now());
    expect((await js.enqueue({ kind: 'x', payload: {}, dedupeKey: 'k' }, clock.now())).id).toBe(a.id);
    const runner = createJobRunner(js, { x: async () => { throw new Error('no'); } }, clock, { baseMs: 10, maxMs: 10 });
    expect((await runner.runOnce()).retried).toBe(1);
    clock.advance(10);
    expect((await runner.runOnce()).dead).toBe(1);
    expect((await js.get(a.id))).toMatchObject({ status: 'dead', attempts: 2 });
  });
  it('sink: applica RC a una fattura bloccata (trigger DB ok), registra change e idempotente', async () => {
    const doc = { id: 'd1', type: 'fattura', status: 'emessa', updatedAt: 1, invoice: { xml: '<x/>', fileName: 'f.xml', sdiEvents: [] } };
    run(`INSERT INTO documents(tenant_id,id,type,status,locked_at,created_at,updated_at,data) VALUES ('t1','d1','fattura','emessa',1,1,1,?)`, JSON.stringify(doc));
    expect((await new SqliteDocumentSource().getIssuedInvoice('t1', 'd1'))).toMatchObject({ xml: '<x/>', status: 'emessa' });
    expect(await new SqliteDocumentSource().getIssuedInvoice('t2', 'd1')).toBeNull();
    const sink = new SqliteDocumentSink();
    await sink.applyEvent('t1', 'd1', { at: 5, type: 'INVIO', channel: 'provider' });
    await sink.applyEvent('t1', 'd1', { at: 9, type: 'NS', channel: 'provider', errorCodes: ['00300'] });
    await sink.applyEvent('t1', 'd1', { at: 9, type: 'NS', channel: 'provider', errorCodes: ['00300'] });
    const row = one<{ status: string; data: string }>(`SELECT status, data FROM documents WHERE id='d1'`)!;
    expect(row.status).toBe('scartata');
    expect(JSON.parse(row.data).invoice.sdiEvents.length).toBe(2);
    expect(one<{ n: number }>(`SELECT COUNT(*) n FROM changes WHERE entity_id='d1'`)!.n).toBe(2);
    expect(JSON.parse(row.data).invoice.xml).toBe('<x/>');
  });
  it('submission store', async () => {
    const s = new SqliteSdiStore();
    await s.saveSubmission({ tenantId: 't1', docId: 'd1', providerId: 'p1' });
    expect(await s.findByProviderId('p1')).toEqual({ tenantId: 't1', docId: 'd1', providerId: 'p1' });
    expect(await s.findByProviderId('zz')).toBeNull();
  });
});
