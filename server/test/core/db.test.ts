import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, one, run } from '../../src/db';
import { freshEnv } from './helpers';

beforeEach(freshEnv);

const seedTenant = (id = 't1') => run('INSERT INTO tenants(id, created_at) VALUES (?, 1)', id);
const docJson = (o: any = {}) => JSON.stringify({ id: 'f1', type: 'fattura', status: 'emessa', updatedAt: 1,
  lines: [{ id: 'l', qty: 1 }], invoice: { sdiEvents: [], payments: [], paymentStatus: 'non_pagata', xml: '<x/>' }, ...o });
const insertDoc = (tenant: string, id: string, seq: number | null, locked: number | null, data = docJson({ id })) =>
  run(`INSERT INTO documents(tenant_id, id, type, status, number, inv_year, inv_sectional, inv_seq, locked_at, created_at, updated_at, data)
       VALUES (?,?, 'fattura', 'emessa', ?, 2026, 'FT', ?, ?, 1, 1, ?)`, tenant, id, seq ? `${seq}/2026` : null, seq, locked, data);

describe('schema e trigger', () => {
  it('migrazioni applicate e foreign_keys attive', () => {
    expect(one<{ v: number }>('SELECT version AS v FROM schema_migrations WHERE version = 1')!.v).toBe(1);
    expect(one<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
    expect(() => run('INSERT INTO users(id,email,tenant_id,created_at) VALUES (?,?,?,1)', 'u', 'e@x.it', 'inesistente')).toThrow();
  });

  it('fattura bloccata: UPDATE dei campi fiscali e DELETE vietati', () => {
    seedTenant(); insertDoc('t1', 'f1', 1, 5000);
    expect(() => run("UPDATE documents SET data = ? WHERE id='f1'", docJson({ lines: [{ id: 'l', qty: 99 }] }))).toThrow(/documento_bloccato/);
    expect(() => run("UPDATE documents SET inv_seq = 2 WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => run("UPDATE documents SET locked_at = NULL WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => run("UPDATE documents SET status = 'bozza' WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => run("UPDATE documents SET deleted_at = 5 WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => run("DELETE FROM documents WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => run("UPDATE documents SET data = ? WHERE id='f1'", docJson({ invoice: { sdiEvents: [], payments: [], paymentStatus: 'non_pagata', xml: '<manomesso/>' } }))).toThrow(/documento_bloccato/);
  });

  it('fattura bloccata: ammessi sdiEvents, payments, paymentStatus, status, updatedAt', () => {
    seedTenant(); insertDoc('t1', 'f1', 1, 5000);
    const ok = docJson({ status: 'consegnata', updatedAt: 99, invoice: { sdiEvents: [{ type: 'RC' }], payments: [{ amount: 10 }], paymentStatus: 'parziale', xml: '<x/>' } });
    run("UPDATE documents SET status='consegnata', updated_at=99, data=? WHERE id='f1'", ok);
    expect(one<{ status: string }>("SELECT status FROM documents WHERE id='f1'")!.status).toBe('consegnata');
  });

  it('bozze e preventivi restano modificabili ed eliminabili', () => {
    seedTenant(); insertDoc('t1', 'b1', null, null, docJson({ id: 'b1', status: 'bozza' }));
    run("UPDATE documents SET data = ? WHERE id='b1'", docJson({ id: 'b1', lines: [] }));
    run("DELETE FROM documents WHERE id='b1'");
    expect(one("SELECT 1 AS x FROM documents WHERE id='b1'")).toBeUndefined();
  });

  it('emissione: una bozza può diventare bloccata (transizione ammessa)', () => {
    seedTenant(); insertDoc('t1', 'b1', null, null, docJson({ id: 'b1' }));
    run("UPDATE documents SET locked_at = 5, inv_seq = 1, number='1/2026' WHERE id='b1'");
    expect(() => run("DELETE FROM documents WHERE id='b1'")).toThrow();
  });

  it('UNIQUE (tenant, sezionale, anno, seq) per le emesse; tenant diversi indipendenti; bozze senza seq non collidono', () => {
    seedTenant('t1'); seedTenant('t2');
    insertDoc('t1', 'f1', 1, 5000);
    expect(() => insertDoc('t1', 'f2', 1, 5000)).toThrow(/UNIQUE/);
    insertDoc('t2', 'f1', 1, 5000);
    insertDoc('t1', 'b1', null, null); insertDoc('t1', 'b2', null, null);
  });

  it('audit_log append-only', () => {
    run("INSERT INTO audit_log(tenant_id, at, action) VALUES ('t1', 1, 'x')");
    expect(() => run("UPDATE audit_log SET action='y'")).toThrow(/append-only/);
    expect(() => run('DELETE FROM audit_log')).toThrow(/append-only/);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
  });
});
