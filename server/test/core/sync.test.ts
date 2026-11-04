import { beforeEach, describe, expect, it } from 'vitest';
import { call, catalogItem, docOp, freshEnv, invoice, login, opId, push, quote } from './helpers';
import { getDb, one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { setClock } from '../../src/db/clock';
import { patchLockedDocument, getDocument } from '../../src/documents/repo';

beforeEach(freshEnv);
const pull = (token: string, cursor = '0', limit?: number) => call('GET', `/v1/sync/pull?cursor=${cursor}${limit ? `&limit=${limit}` : ''}`, { token });

describe('sync push/pull', () => {
  it('richiede autenticazione', async () => {
    expect((await call('POST', '/v1/sync/push', { body: { deviceId: 'd', ops: [] } })).status).toBe(401);
    expect((await call('GET', '/v1/sync/pull')).status).toBe(401);
  });

  it('upsert di profilo, catalogo, documento, audit e pull', async () => {
    const { token } = await login('a@x.it');
    const ops = [
      { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: { businessName: 'Rossi Idraulica', vatNumber: '01234567890' }, clientTs: 10 },
      { opId: opId(), entity: 'catalog', entityId: 'c1', op: 'upsert', payload: catalogItem('c1'), clientTs: 10 },
      docOp(quote('q1')),
      { opId: opId(), entity: 'audit', entityId: 'a1', op: 'upsert', payload: { id: 'a1', at: 5, docId: 'q1', action: 'create', actor: 'user' }, clientTs: 5 },
    ] as any;
    const r = await push(token, ops);
    expect(r.status).toBe(200);
    expect(r.json.accepted).toHaveLength(4);
    expect(r.json.conflicts).toEqual([]);
    const p = await pull(token);
    expect(p.json.hasMore).toBe(false);
    expect(p.json.ops.map((o: any) => o.entity).sort()).toEqual(['audit', 'catalog', 'document', 'profile']);
    expect(p.json.cursor).toBe(r.json.cursor);
    expect((await pull(token, p.json.cursor)).json.ops).toEqual([]);
  });

  it('idempotenza per opId: riapplicare la stessa op non duplica né conta due volte la quota', async () => {
    const { token } = await login('a@x.it');
    const op = docOp(quote('q1'));
    const r1 = await push(token, [op]);
    const r2 = await push(token, [op, op]);
    expect(r1.json.accepted).toEqual([op.opId]);
    expect(r2.json.accepted).toEqual([op.opId, op.opId]);
    expect((await pull(token)).json.ops).toHaveLength(1);
    expect((await call('GET', '/v1/me', { token })).json.quota.docsThisMonth).toBe(1);
  });

  it('payload non valido -> conflitto invalid, senza fermare le altre op', async () => {
    const { token } = await login('a@x.it');
    const badOp = docOp({ ...quote('q1'), lines: 'no' } as any);
    const mismatch = docOp(quote('q2'), { entityId: 'altro' });
    const good = docOp(quote('q3'));
    const r = await push(token, [badOp, mismatch, good]);
    expect(r.json.accepted).toEqual([good.opId]);
    expect(r.json.conflicts.map((c: any) => c.reason)).toEqual(['invalid', 'invalid']);
    expect((await call('POST', '/v1/sync/push', { token, body: { deviceId: 'd', ops: 'x' } })).status).toBe(400);
  });

  it('stale: op più vecchia del server non sovrascrive (LWW) e restituisce serverVersion', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1', { notes: 'nuova', updatedAt: 2000 }))]);
    const r = await push(token, [docOp(quote('q1', { notes: 'vecchia', updatedAt: 1500 }))]);
    expect(r.json.conflicts[0].reason).toBe('stale');
    expect(r.json.conflicts[0].serverVersion.notes).toBe('nuova');
    expect((await push(token, [docOp(quote('q1', { notes: 'ancora più nuova', updatedAt: 3000 }))])).json.accepted).toHaveLength(1);
    expect(getDocument(one<{ tenant_id: string }>('SELECT tenant_id FROM documents')!.tenant_id, 'q1')!.notes).toBe('ancora più nuova');
  });

  it('catalogo: LWW, delete = tombstone nel pull, stale su cancellazione vecchia', async () => {
    const { token } = await login('a@x.it');
    await push(token, [{ opId: opId(), entity: 'catalog', entityId: 'c1', op: 'upsert', payload: catalogItem('c1', { updatedAt: 100 }), clientTs: 100 }]);
    const stale = await push(token, [{ opId: opId(), entity: 'catalog', entityId: 'c1', op: 'delete', clientTs: 50 }]);
    expect(stale.json.conflicts[0].reason).toBe('stale');
    const del = await push(token, [{ opId: opId(), entity: 'catalog', entityId: 'c1', op: 'delete', clientTs: 200 }]);
    expect(del.json.accepted).toHaveLength(1);
    const p = await pull(token);
    expect(p.json.ops).toEqual([expect.objectContaining({ entity: 'catalog', entityId: 'c1', op: 'delete' })]);
    expect(p.json.ops[0].payload).toBeUndefined();
  });

  it('profilo: LWW su clientTs; non eliminabile', async () => {
    const { token } = await login('a@x.it');
    const mk = (ts: number, name: string) => ({ opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: { businessName: name, vatNumber: '1' }, clientTs: ts }) as any;
    await push(token, [mk(100, 'A')]);
    expect((await push(token, [mk(50, 'B')])).json.conflicts[0].reason).toBe('stale');
    expect((await push(token, [mk(150, 'C')])).json.accepted).toHaveLength(1);
    expect((await push(token, [{ opId: opId(), entity: 'profile', entityId: 'profile', op: 'delete', clientTs: 999 }])).json.conflicts[0].reason).toBe('invalid');
  });

  it('bozza eliminabile (tombstone), eliminazione idempotente', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1'))]);
    const d = { opId: opId(), entity: 'document', entityId: 'q1', op: 'delete', clientTs: 2000 } as any;
    expect((await push(token, [d])).json.accepted).toHaveLength(1);
    expect((await push(token, [{ ...d, opId: opId() }])).json.accepted).toHaveLength(1);
    expect((await call('GET', '/v1/documents/q1', { token })).status).toBe(404);
    expect((await pull(token)).json.ops[0].op).toBe('delete');
  });

  it('paginazione pull: limit, hasMore, cursore monotono, nessun duplicato', async () => {
    const { token } = await login('a@x.it');
    setEntitlement(one<{ tenant_id: string }>('SELECT tenant_id FROM users')!.tenant_id, { plan: 'pro' });
    await push(token, Array.from({ length: 7 }, (_, i) => docOp(quote(`q${i}`))));
    const seen: string[] = [];
    let cursor = '0'; let pages = 0; let prev = 0;
    for (;;) {
      const p = await pull(token, cursor, 3);
      pages++;
      expect(Number(p.json.cursor)).toBeGreaterThanOrEqual(prev);
      prev = Number(p.json.cursor); cursor = p.json.cursor;
      seen.push(...p.json.ops.map((o: any) => o.entityId));
      if (!p.json.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect((await pull(token, 'abc')).status).toBe(400);
    expect((await pull(token, '-1')).status).toBe(400);
  });

  it('pull restituisce solo l\'ultima versione di ogni entità', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1', { notes: 'v1', updatedAt: 1 })), docOp(quote('q1', { notes: 'v2', updatedAt: 2 }))]);
    const p = await pull(token);
    expect(p.json.ops).toHaveLength(1);
    expect(p.json.ops[0].payload.notes).toBe('v2');
  });

  it('audit lato server append-only per ogni op accettata, senza contenuto del documento', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1', { notes: 'segreto-cliente' }))]);
    const rows = getDb().prepare("SELECT action, payload FROM audit_log WHERE action LIKE 'sync.%'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).not.toContain('segreto-cliente');
  });
});

describe('fatture emesse', () => {
  it('emissione accettata; il documento diventa bloccato e non è modificabile/eliminabile', async () => {
    const { token } = await login('a@x.it');
    setEntitlement(one<{ tenant_id: string }>('SELECT tenant_id FROM users')!.tenant_id, { plan: 'pro' });
    await push(token, [docOp(invoice('f1', 1, {}, false))]); // bozza
    expect((await push(token, [docOp(invoice('f1', 1, { updatedAt: 2000 }))])).json.accepted).toHaveLength(1); // emissione
    const alt = invoice('f1', 1, { updatedAt: 3000 });
    alt.lines[0].unitPrice = 1;
    const r = await push(token, [docOp(alt)]);
    expect(r.json.conflicts[0].reason).toBe('locked_document');
    expect(r.json.conflicts[0].serverVersion.lines[0].unitPrice).toBe(50);
    const del = await push(token, [{ opId: opId(), entity: 'document', entityId: 'f1', op: 'delete', clientTs: 9999 }]);
    expect(del.json.conflicts[0].reason).toBe('locked_document');
    const back = invoice('f1', 1, { updatedAt: 4000 }, false);
    expect((await push(token, [docOp(back)])).json.conflicts[0].reason).toBe('locked_document'); // tornare a bozza
  });

  it('su fattura bloccata sono ammessi sdiEvents/payments/status; non si perdono eventi', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(invoice('f1', 1))]);
    const upd = invoice('f1', 1, { status: 'consegnata', updatedAt: 6000 });
    (upd.invoice as any).sdiEvents = [{ at: 1, type: 'INVIO', channel: 'portale_ade' }, { at: 2, type: 'RC', channel: 'portale_ade' }];
    (upd.invoice as any).payments = [{ date: '2026-11-05', amount: 10 }];
    (upd.invoice as any).paymentStatus = 'parziale';
    expect((await push(token, [docOp(upd)])).json.accepted).toHaveLength(1);
    const stored = (await call('GET', '/v1/documents/f1', { token })).json;
    expect(stored.status).toBe('consegnata');
    expect(stored.invoice.sdiEvents).toHaveLength(2);
    // client con copia vecchia (meno eventi) non può cancellarli
    const old = invoice('f1', 1, { status: 'emessa', updatedAt: 7000 });
    expect((await push(token, [docOp(old)])).json.conflicts[0].reason).toBe('stale');
    expect((await call('GET', '/v1/documents/f1', { token })).json.invoice.sdiEvents).toHaveLength(2);
  });

  it('numero duplicato (sezionale, anno, seq) -> duplicate_invoice_number; sezionale/anno diversi ok', async () => {
    const { token } = await login('a@x.it');
    setEntitlement(one<{ tenant_id: string }>('SELECT tenant_id FROM users')!.tenant_id, { plan: 'pro' });
    await push(token, [docOp(invoice('f1', 1))]);
    const dup = await push(token, [docOp(invoice('f2', 1))]);
    expect(dup.json.conflicts[0].reason).toBe('duplicate_invoice_number');
    const nc = invoice('n1', 1); (nc.invoice as any).sectional = 'NC'; (nc.invoice as any).tipoDocumento = 'TD04';
    const y = invoice('f3', 1); (y.invoice as any).year = 2027;
    expect((await push(token, [docOp(nc), docOp(y), docOp(invoice('f4', 2))])).json.accepted).toHaveLength(3);
    expect(one('SELECT 1 AS x FROM documents WHERE id = ?', 'f2')).toBeUndefined();
  });

  it('fattura emessa incompleta (senza seq) -> invalid', async () => {
    const { token } = await login('a@x.it');
    const f = invoice('f1', 1); delete (f.invoice as any).seq;
    expect((await push(token, [docOp(f)])).json.conflicts[0].reason).toBe('invalid');
  });

  it('patchLockedDocument (per SDI): aggiorna solo campi ammessi e genera un cambio nel pull', async () => {
    const { token, tenantId } = await login('a@x.it');
    await push(token, [docOp(invoice('f1', 1))]);
    expect(patchLockedDocument(tenantId, 'f1', { status: 'scartata', sdiEvents: [{ type: 'NS' }] })).toBe(true);
    expect(patchLockedDocument('altro-tenant', 'f1', { status: 'consegnata' })).toBe(false);
    const p = await pull(token);
    expect(p.json.ops[0].payload.status).toBe('scartata');
    expect(p.json.ops[0].payload.invoice.lockedAt).toBe(5000);
  });
});

describe('quota Free', () => {
  it('Free: 3 documenti NUOVI al mese; modificare esistenti non conta; Pro illimitato', async () => {
    const { token, tenantId } = await login('a@x.it');
    const r = await push(token, ['a', 'b', 'c', 'd'].map((id) => docOp(quote(id))));
    expect(r.json.accepted).toHaveLength(3);
    expect(r.json.conflicts).toEqual([expect.objectContaining({ reason: 'quota_exceeded' })]);
    expect((await push(token, [docOp(quote('a', { notes: 'x', updatedAt: 2000 }))])).json.accepted).toHaveLength(1);
    expect((await call('GET', '/v1/me', { token })).json.quota).toEqual({ docsThisMonth: 3, docsLimit: 3 });
    setEntitlement(tenantId, { plan: 'pro' });
    expect((await push(token, [docOp(quote('d'))])).json.accepted).toHaveLength(1);
    const me = (await call('GET', '/v1/me', { token })).json;
    expect(me.plan).toBe('pro');
    expect(me.quota.docsLimit).toBeNull();
    setEntitlement(tenantId, { plan: 'pro', status: 'canceled' });
    expect((await call('GET', '/v1/me', { token })).json.plan).toBe('free');
  });

  it('la quota riparte col nuovo mese; eliminare e ricreare non rimborsa', async () => {
    let t = Date.UTC(2026, 10, 15);
    setClock(() => t);
    const { token } = await login('a@x.it');
    await push(token, ['a', 'b', 'c'].map((id) => docOp(quote(id))));
    await push(token, [{ opId: opId(), entity: 'document', entityId: 'a', op: 'delete', clientTs: 5000 }]);
    expect((await push(token, [docOp(quote('e'))])).json.conflicts[0].reason).toBe('quota_exceeded');
    t = Date.UTC(2026, 11, 1);
    expect((await push(token, [docOp(quote('e'))])).json.accepted).toHaveLength(1);
    expect((await call('GET', '/v1/me', { token })).json.quota.docsThisMonth).toBe(1);
  });
});
