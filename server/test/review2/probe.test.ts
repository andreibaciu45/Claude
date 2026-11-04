import { beforeEach, describe, expect, it } from 'vitest';
import { call, docOp, freshEnv, invoice, login, opId, push, quote, sent } from '../core/helpers';
import { all, one, run } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { setClock } from '../../src/db/clock';
beforeEach(() => { freshEnv(); });
const PROXY = '172.18.0.2';
const reqOtp = (email: string, ip: string) => call('POST', '/v1/auth/request', { body: { email }, ip, peer: PROXY });
const ver = (email: string, code: string, ip: string) => call('POST', '/v1/auth/verify', { body: { email, code, deviceId: 'd1' }, ip, peer: PROXY });

describe('probe', () => {
  it('P1 trusted owner locked out of requesting', async () => {
    await reqOtp('v@x.it', '9.9.9.9');
    expect((await ver('v@x.it', sent[0].code, '9.9.9.9')).status).toBe(200);
    for (let i = 0; i < 10; i++) await reqOtp('v@x.it', `20.0.0.${i}`);
    const r = await reqOtp('v@x.it', '9.9.9.9');
    console.log('P1 owner request status', r.status);
  });
  it('P2 alias', async () => {
    let ok = 0;
    for (let i = 0; i < 20; i++) { const r = await reqOtp(`v+${i}@gmail.com`, '8.8.8.8'); if (r.status === 204) ok++; }
    let ok2 = 0;
    for (let i = 0; i < 20; i++) { const r = await reqOtp(`v@gmail.com`, `7.7.${i}.1`); if (r.status === 204) ok2++; }
    console.log('P2 alias ok', ok, 'same address ok', ok2);
  });
  it('P3 audit before doc', async () => {
    const a = await login('a@x.it'); setEntitlement(a.tenantId, { plan: 'pro' });
    const id = 'au1';
    await push(a.token, [{ opId: opId(), entity: 'audit', entityId: id, op: 'upsert', clientTs: 1, payload: { id, at: 1, docId: 'f1', action: 'issue', actor: 'user' } } as any, docOp(invoice('f1', 1))]);
    console.log('P3', all("SELECT action, retain FROM audit_log WHERE entity_id='f1' OR ref_id='au1'"));
  });
  it('P4 old clock new item', async () => {
    const a = await login('a@x.it'); setEntitlement(a.tenantId, { plan: 'pro' });
    const T = 1_800_000_000_000; setClock(() => T);
    const { housekeeping } = await import('../../src/db/housekeeping'); housekeeping();
    const r = await push(a.token, [docOp(quote('new1', { updatedAt: T - 400 * 86400000 }))]);
    console.log('P4', JSON.stringify(r.json));
  });
});
