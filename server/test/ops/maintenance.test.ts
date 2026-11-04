// Manutenzione automatica: pulizie, checkpoint, VACUUM a basso impatto.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { docOp, freshEnv, invoice, login, push, quote, useFileDb, type FileDb } from './helpers';
import { all, one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { housekeeping } from '../../src/db/housekeeping';
import { maybeVacuum, optimizeDaily, runMaintenance, startMaintenance, walCheckpointPassive } from '../../src/ops/maintenance';
import { lastHousekeepingAt, recordError, bumpDaily } from '../../src/ops/stats';
import { createInvite } from '../../src/auth/invites';
import { setEntitlement } from '../../src/db/entitlements';

const DAY = 86_400_000;
let fdb: FileDb | null = null;
beforeEach(freshEnv);
afterEach(() => { fdb?.cleanup(); fdb = null; vi.useRealTimers(); for (const k of ['MAINTENANCE_VACUUM', 'MAINTENANCE_HOUR_UTC', 'MAINTENANCE_VACUUM_MIN_FREE_MB', 'TOMBSTONE_RETENTION_DAYS', 'MAINTENANCE_CHECKPOINT']) delete process.env[k]; });

describe('pulizia periodica', () => {
  it('elimina bozze/preventivi cancellati e voci di catalogo oltre la conservazione, errori, inviti; MAI le fatture emesse', async () => {
    const a = await login('a@x.it');
    setEntitlement(a.tenantId, { plan: 'pro' });
    const T = 1_800_000_000_000;
    setClock(() => T);
    await push(a.token, [docOp(quote('q-old', { updatedAt: T })), docOp(quote('q-new', { updatedAt: T, number: 'P2' })), docOp(invoice('f1', 1, { updatedAt: T }))]);
    setClock(() => T + 1);
    await push(a.token, [{ opId: 'del1', entity: 'document', entityId: 'q-old', op: 'delete', clientTs: T + 1 }]);
    run('INSERT INTO catalog_items(tenant_id, id, data, updated_at, deleted_at) VALUES (?,?,?,?,?)', a.tenantId, 'c-old', '{}', 1, T);
    recordError('http_500', '/x', 'Error');
    createInvite({ days: 1 });
    setClock(() => T + 100 * DAY);
    let r = housekeeping();
    expect(r.documents_tombstones).toBe(0); // 100 giorni < 180 di conservazione
    setClock(() => T + 200 * DAY);
    r = housekeeping();
    expect(r.documents_tombstones).toBe(1);
    expect(r.catalog_tombstones).toBe(1);
    expect(r.ops_errors).toBe(1);
    expect(r.invite_codes).toBe(1);
    expect(all('SELECT id FROM documents ORDER BY id').map((d: any) => d.id)).toEqual(['f1', 'q-new']);
    // retention configurabile
    process.env.TOMBSTONE_RETENTION_DAYS = '1';
    expect(housekeeping().documents_tombstones).toBe(0);
  });

  it('elimina a blocchi (lavoro bounded per ciclo) e resta idempotente', () => {
    run("INSERT INTO tenants(id, created_at) VALUES ('t', 1)");
    const ins = (n: number) => { for (let i = 0; i < n; i++) run("INSERT INTO otp_codes(email, code_hash, created_at, expires_at) VALUES ('e', 'h', 1, 2)"); };
    ins(5000);
    expect(housekeeping().otp_codes).toBe(5000);
    expect(housekeeping().otp_codes).toBe(0);
    expect(one<any>('SELECT COUNT(*) AS n FROM otp_codes').n).toBe(0);
  });

  it('sessioni scadute, OTP e rate-limit vecchi vengono rimossi, i dati attivi restano', async () => {
    const a = await login('a@x.it');
    run("INSERT INTO rate_limits(key, window_start, count) VALUES ('old', 1, 1)");
    setClock(() => Date.now() + 200 * DAY);
    housekeeping();
    expect(one('SELECT 1 AS x FROM rate_limits WHERE key=?', 'old')).toBeUndefined();
    expect(one('SELECT 1 AS x FROM sessions WHERE tenant_id=?', a.tenantId)).toBeUndefined(); // scaduta (90 giorni + 30)
    expect(one('SELECT 1 AS x FROM users')).toBeTruthy();
  });
});

describe('checkpoint, optimize, VACUUM', () => {
  it('wal_checkpoint PASSIVE sul DB su file; disattivabile; no-op in memoria', async () => {
    expect(walCheckpointPassive()).toBeNull();
    fdb = useFileDb();
    await login('a@x.it');
    expect(existsSync(`${fdb.path}-wal`)).toBe(true);
    const r = walCheckpointPassive()!;
    expect(r.busy).toBe(0);
    expect(r.checkpointed).toBeGreaterThanOrEqual(0);
    process.env.MAINTENANCE_CHECKPOINT = '0';
    expect(walCheckpointPassive()).toBeNull();
  });

  it('PRAGMA optimize al massimo una volta al giorno', () => {
    expect(optimizeDaily()).toBe(true);
    expect(optimizeDaily()).toBe(false);
    setClock(() => Date.now() + 2 * DAY);
    expect(optimizeDaily()).toBe(true);
  });

  it('VACUUM: disattivato di default, solo nella finestra oraria, solo se serve, una volta ogni N giorni', async () => {
    fdb = useFileDb();
    expect(maybeVacuum()).toBe('skipped:disabled');
    process.env.MAINTENANCE_VACUUM = '1';
    const hour = new Date().getUTCHours();
    process.env.MAINTENANCE_HOUR_UTC = String((hour + 5) % 24);
    expect(maybeVacuum()).toBe('skipped:outside-window');
    process.env.MAINTENANCE_HOUR_UTC = String(hour);
    expect(maybeVacuum()).toBe('skipped:not-needed'); // DB piccolo, nessuno spazio libero
    // crea spazio recuperabile: righe grosse inserite e cancellate
    run("INSERT INTO tenants(id, created_at) VALUES ('t', 1)");
    for (let i = 0; i < 300; i++) run("INSERT INTO catalog_items(tenant_id, id, data, updated_at) VALUES ('t', ?, ?, 1)", `c${i}`, 'x'.repeat(20_000));
    run('DELETE FROM catalog_items');
    const before = statSync(fdb.path).size;
    process.env.MAINTENANCE_VACUUM_MIN_FREE_MB = '1';
    expect(maybeVacuum()).toBe('done');
    expect(statSync(fdb.path).size).toBeLessThan(before / 4);
    expect(maybeVacuum()).toBe('skipped:too-soon');
    expect(one<any>("SELECT value FROM ops_state WHERE key='last_vacuum_at'")).toBeTruthy();
    // dati e trigger intatti
    expect(() => run('DELETE FROM audit_log')).toThrow(/append-only/);
  });

  it('runMaintenance: ogni passo isolato, registra l\'ultimo ciclo', () => {
    expect(lastHousekeepingAt()).toBeNull();
    const rep = runMaintenance();
    expect(rep.purged).toHaveProperty('sessions');
    expect(lastHousekeepingAt()).toBeGreaterThan(0);
    run('DROP TABLE ops_errors'); // un passo che fallisce non ferma gli altri
    expect(() => runMaintenance()).not.toThrow();
  });

  it('startMaintenance: primo ciclo dopo il ritardo iniziale, poi periodico, fermabile', () => {
    vi.useFakeTimers();
    const stop = startMaintenance(1000, 100);
    expect(lastHousekeepingAt()).toBeNull();
    vi.advanceTimersByTime(150);
    const first = lastHousekeepingAt();
    expect(first).not.toBeNull();
    vi.advanceTimersByTime(1000);
    stop();
    run('DELETE FROM ops_state');
    vi.advanceTimersByTime(5000);
    expect(lastHousekeepingAt()).toBeNull(); // dopo lo stop non gira piu'
  });
});

describe('contatori giornalieri', () => {
  it('bumpDaily accumula per giorno e metrica', () => {
    bumpDaily('x'); bumpDaily('x', 2);
    expect(one<any>("SELECT value FROM ops_daily WHERE metric='x'").value).toBe(3);
  });
});
