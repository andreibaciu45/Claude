// GDPR: portabilità (GET /v1/me/export) e cancellazione account (DELETE /v1/me).
import { beforeEach, describe, expect, it } from 'vitest';
import { call, catalogItem, docOp, freshEnv, invoice, login, opId, push, quote } from './helpers';
import { all, one, run } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';

beforeEach(freshEnv);

async function populate(email: string, deviceId = 'd1') {
  const s = await login(email, deviceId);
  await push(s.token, [
    { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', clientTs: 5, payload: { businessName: 'Rossi Idraulica', vatNumber: '01234567890', iban: 'IT60X0542811101000000123456' } } as any,
    { opId: opId(), entity: 'catalog', entityId: 'c1', op: 'upsert', payload: catalogItem('c1', { name: 'Tubo CATALOGO-' + email }), clientTs: 1 },
    docOp(quote('q1', { notes: 'bozza di ' + email })),
    docOp(invoice('f1', 1, { customer: { id: 'c', name: 'Cliente FATTURA-' + email } })),
    { opId: opId(), entity: 'audit', entityId: 'a1', op: 'upsert', payload: { id: 'a1', at: 5, docId: 'q1', action: 'create', actor: 'user', detail: 'dettaglio ' + email }, clientTs: 5 },
  ]);
  return s;
}

describe('export dei dati (portabilità)', () => {
  it('richiede autenticazione e restituisce TUTTI i dati dell\'utente come file JSON', async () => {
    expect((await call('GET', '/v1/me/export')).status).toBe(401);
    const A = await populate('a@x.it');
    const r = await call('GET', '/v1/me/export', { token: A.token });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="vocepreventivo-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(r.json.exportVersion).toBe(1);
    expect(r.json.account).toMatchObject({ email: 'a@x.it', tenantId: A.tenantId });
    expect(r.json.profile.data).toMatchObject({ businessName: 'Rossi Idraulica', iban: 'IT60X0542811101000000123456' });
    expect(r.json.catalog.map((c: any) => c.id)).toEqual(['c1']);
    expect(r.json.documents.map((d: any) => d.id).sort()).toEqual(['f1', 'q1']);
    expect(r.json.documents.find((d: any) => d.id === 'f1').customer.name).toBe('Cliente FATTURA-a@x.it');
    expect(r.json.devices.map((d: any) => d.id)).toEqual(['d1']);
    expect(r.json.auditLog.some((a: any) => a.action === 'client.create' && a.payload.detail === 'dettaglio a@x.it')).toBe(true);
    expect(JSON.stringify(r.json)).not.toContain(A.token);
    expect(one<any>("SELECT 1 AS x FROM audit_log WHERE action='account.export'")).toBeTruthy();
  });
  it('isolamento: l\'export di B non contiene nulla di A', async () => {
    await populate('a@x.it');
    const B = await populate('b@x.it', 'dB');
    const txt = JSON.stringify((await call('GET', '/v1/me/export', { token: B.token })).json);
    expect(txt).toContain('b@x.it');
    expect(txt).not.toContain('a@x.it');
  });
  it('limitato a poche richieste al giorno', async () => {
    const A = await login('a@x.it');
    process.env.RL_EXPORT_PER_DAY = '2';
    expect((await call('GET', '/v1/me/export', { token: A.token })).status).toBe(200);
    expect((await call('GET', '/v1/me/export', { token: A.token })).status).toBe(200);
    expect((await call('GET', '/v1/me/export', { token: A.token })).status).toBe(429);
    delete process.env.RL_EXPORT_PER_DAY;
  });
});

describe('cancellazione account', () => {
  it('richiede conferma con la propria email', async () => {
    const A = await login('a@x.it');
    expect((await call('DELETE', '/v1/me', { token: A.token })).status).toBe(400);
    const r = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'altro@x.it' } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('confirmation_mismatch');
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(200);
    expect((await call('DELETE', '/v1/me', { body: { confirmEmail: 'a@x.it' } })).status).toBe(401);
  });

  it('senza fatture emesse: purge completo (tenant, utente, dati); l\'email torna libera', async () => {
    const A = await login('a@x.it');
    await push(A.token, [docOp(quote('q1', { notes: 'DATO-A' })), { opId: opId(), entity: 'catalog', entityId: 'c1', op: 'upsert', payload: catalogItem('c1'), clientTs: 1 }]);
    const r = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'A@X.it' } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ deleted: true, mode: 'purged', retainedInvoices: 0 });
    for (const t of ['tenants', 'users', 'sessions', 'devices', 'documents', 'catalog_items', 'profiles', 'changes', 'sync_ops', 'entitlements', 'usage']) {
      expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)!.n, t).toBe(0);
    }
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(401);
    expect(one<any>("SELECT payload FROM audit_log WHERE action='account.delete'")!.payload).toContain('purged');
    const again = await login('a@x.it', 'd9'); // stessa email, nuovo account vuoto
    expect(again.tenantId).not.toBe(A.tenantId);
    expect((await call('GET', '/v1/documents', { token: again.token })).json.documents).toEqual([]);
  });

  it('con fatture emesse: restano SOLO quelle (obbligo di conservazione), tutto il resto è rimosso, nessun accesso possibile', async () => {
    const A = await populate('a@x.it');
    const B = await populate('b@x.it', 'dB');
    const r = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'a@x.it' } });
    expect(r.json).toEqual({ deleted: true, mode: 'anonymized', retainedInvoices: 1 });
    const docs = all<any>('SELECT id, locked_at FROM documents WHERE tenant_id=?', A.tenantId);
    expect(docs.map((d) => d.id)).toEqual(['f1']);
    expect(docs[0].locked_at).not.toBeNull();
    expect(one<any>('SELECT status, deleted_at, name FROM tenants WHERE id=?', A.tenantId)).toMatchObject({ status: 'deleted', name: null });
    for (const t of ['users', 'sessions', 'devices', 'catalog_items', 'profiles', 'changes', 'sync_ops']) {
      expect(one<{ n: number }>(`SELECT COUNT(*) n FROM ${t} WHERE tenant_id=?`, A.tenantId)!.n, t).toBe(0);
    }
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM users WHERE email=?', 'a@x.it')!.n).toBe(0);
    // la fattura emessa resta immutabile anche dopo la cancellazione
    expect(() => run('DELETE FROM documents WHERE tenant_id=?', A.tenantId)).toThrow(/documento_bloccato/);
    // l'altro tenant non è toccato
    expect((await call('GET', '/v1/documents', { token: B.token })).json.documents).toHaveLength(2);
    expect((await call('GET', '/v1/sync/pull', { token: B.token })).json.ops.length).toBeGreaterThan(0);
    // nuovo account con la stessa email = nuovo tenant, vuoto
    const again = await login('a@x.it', 'dX');
    expect(again.tenantId).not.toBe(A.tenantId);
  });

  it('con abbonamento attivo: 409 finché non si conferma esplicitamente', async () => {
    const A = await login('a@x.it');
    await new SqliteBillingStore().saveSubscription({ tenantId: A.tenantId, status: 'active', customerId: 'cus_1', updatedAt: Date.now() });
    const r = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'a@x.it' } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('active_subscription');
    const ok = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'a@x.it', acknowledgeSubscription: true } });
    expect(ok.status).toBe(200);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM billing_subscriptions')!.n).toBe(0);
  });

  it('le prove di accettazione Termini/DPA e l\'audit restano (art. 17(3)(e)); l\'audit non contiene l\'email', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    const { sent } = await import('./helpers');
    const v = await call('POST', '/v1/auth/verify', { body: { email: 'a@x.it', code: sent[0].code, deviceId: 'd', acceptedTerms: { termsVersion: 'v1', dpaVersion: 'v1' } } });
    await call('DELETE', '/v1/me', { token: v.json.token, body: { confirmEmail: 'a@x.it' } });
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM legal_acceptances')!.n).toBe(2);
    expect(JSON.stringify(all('SELECT * FROM audit_log'))).not.toContain('a@x.it');
  });

  it('una sessione di un altro dispositivo dello stesso account non sopravvive', async () => {
    const A1 = await login('a@x.it', 'd1');
    const A2 = await login('a@x.it', 'd2');
    await call('DELETE', '/v1/me', { token: A1.token, body: { confirmEmail: 'a@x.it' } });
    expect((await call('GET', '/v1/me', { token: A2.token })).status).toBe(401);
  });
});
