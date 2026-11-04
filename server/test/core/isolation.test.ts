// Test di leakage: due tenant, ogni endpoint, ID dell'altro tenant (ARCHITECTURE-V2 §1.6).
import { beforeEach, describe, expect, it } from 'vitest';
import { call, catalogItem, docOp, freshEnv, invoice, login, opId, push, quote } from './helpers';
import { one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { getDocument } from '../../src/documents/repo';

beforeEach(freshEnv);

async function twoTenants() {
  const A = await login('a@x.it', 'dA');
  const B = await login('b@x.it', 'dB');
  for (const t of [A, B]) setEntitlement(t.tenantId, { plan: 'pro' });
  await push(A.token, [
    docOp(quote('qa', { notes: 'SEGRETO-A' })), docOp(invoice('fa', 1)),
    { opId: opId(), entity: 'catalog', entityId: 'ca', op: 'upsert', payload: catalogItem('ca', { name: 'SEGRETO-A' }), clientTs: 1 },
    { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: { businessName: 'SEGRETO-A', vatNumber: '1' } as any, clientTs: 1 },
  ]);
  return { A, B };
}

describe('isolamento tenant', () => {
  it('GET /documents/:id e lista: l\'altro tenant vede 404 / lista vuota', async () => {
    const { A, B } = await twoTenants();
    expect((await call('GET', '/v1/documents/qa', { token: A.token })).status).toBe(200);
    expect((await call('GET', '/v1/documents/qa', { token: B.token })).status).toBe(404);
    expect((await call('GET', '/v1/documents/fa', { token: B.token })).status).toBe(404);
    expect((await call('GET', '/v1/documents', { token: B.token })).json.documents).toEqual([]);
    expect((await call('GET', '/v1/documents', { token: A.token })).json.documents).toHaveLength(2);
  });

  it('pull: B non riceve nulla di A, nemmeno con cursore 0', async () => {
    const { B } = await twoTenants();
    const p = await call('GET', '/v1/sync/pull?cursor=0', { token: B.token });
    expect(p.json.ops).toEqual([]);
    expect(JSON.stringify(p.json)).not.toContain('SEGRETO-A');
  });

  it('push di B su ID di A: nessuna sovrascrittura, crea record separati nel proprio tenant', async () => {
    const { A, B } = await twoTenants();
    const r = await push(B.token, [docOp(quote('qa', { notes: 'DI-B', updatedAt: 9999 })), docOp(invoice('fa', 1, { notes: 'DI-B', updatedAt: 9999 }))]);
    expect(r.json.accepted).toHaveLength(2); // numero 1 è libero per B: UNIQUE è per tenant
    expect(getDocument(A.tenantId, 'qa')!.notes).toBe('SEGRETO-A');
    expect(getDocument(B.tenantId, 'qa')!.notes).toBe('DI-B');
    expect(getDocument(A.tenantId, 'fa')!.notes).not.toBe('DI-B');
    const del = await push(B.token, [{ opId: opId(), entity: 'catalog', entityId: 'ca', op: 'delete', clientTs: 9999 }]);
    expect(del.json.accepted).toHaveLength(1); // no-op sul proprio tenant
    expect(one('SELECT 1 AS x FROM catalog_items WHERE tenant_id=? AND id=? AND deleted_at IS NULL', A.tenantId, 'ca')).toBeTruthy();
  });

  it('tenantId nel body/query/header è ignorato: conta solo la sessione', async () => {
    const { A, B } = await twoTenants();
    const r = await call('POST', '/v1/sync/push', { token: B.token, body: { deviceId: 'dB', tenantId: A.tenantId, ops: [docOp(quote('x', { notes: 'ok' }))] }, headers: { 'x-tenant-id': A.tenantId } });
    expect(r.status).toBe(200);
    expect(getDocument(A.tenantId, 'x')).toBeUndefined();
    expect(getDocument(B.tenantId, 'x')).toBeTruthy();
    const p = await call('GET', `/v1/sync/pull?cursor=0&tenantId=${A.tenantId}`, { token: B.token, headers: { 'x-tenant-id': A.tenantId } });
    expect(JSON.stringify(p.json)).not.toContain('SEGRETO-A');
  });

  it('me e quota separati; logout di B non tocca A; token di B non vale come A', async () => {
    const { A, B } = await twoTenants();
    expect((await call('GET', '/v1/me', { token: A.token })).json.tenantId).toBe(A.tenantId);
    expect((await call('GET', '/v1/me', { token: B.token })).json.quota.docsThisMonth).toBe(0);
    await call('POST', '/v1/auth/logout', { token: B.token });
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(200);
  });

  it('opId uguali in tenant diversi non interferiscono (idempotenza per tenant)', async () => {
    const { A, B } = await twoTenants();
    const op = docOp(quote('shared-op'));
    expect((await push(A.token, [op])).json.accepted).toEqual([op.opId]);
    expect((await push(B.token, [op])).json.accepted).toEqual([op.opId]);
    expect(getDocument(B.tenantId, 'shared-op')).toBeTruthy();
  });

  it('endpoint non autenticati non espongono dati', async () => {
    await twoTenants();
    for (const [m, p] of [['GET', '/v1/documents'], ['GET', '/v1/documents/qa'], ['GET', '/v1/me'], ['GET', '/v1/sync/pull'], ['POST', '/v1/sync/push'], ['POST', '/v1/auth/logout']]) {
      expect((await call(m, p)).status).toBe(401);
    }
  });
});
