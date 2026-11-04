// Migrazioni: upgrade da DB vecchi (versione N-2 e versione 1) con dati reali, senza perdere nulla e con i trigger ricreati.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/db';
import '../../src/app'; // registra le migrazioni di tutti i moduli
import { listMigrations, registerMigration, runMigrations, unregisterMigration } from '../../src/db/migrations';
import { checkIntegrity } from '../../src/ops/integrity';
import { grantPro, manualGrantUntil } from '../../src/db/grants';
import { resetDb } from '../../src/db';

const dir = mkdtempSync(join(tmpdir(), 'vp-mig-'));
afterEach(() => { process.env.DB_PATH = ':memory:'; resetDb(); });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** DB "vecchio": applica solo le migrazioni fino a `upTo` (come se il server non fosse mai stato aggiornato). */
function oldDb(name: string, upTo: number): { path: string; db: DatabaseSync } {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON');
  runMigrations(db, upTo);
  return { path, db };
}
const versions = (db: DatabaseSync) => (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);

function seedLegacy(db: DatabaseSync) {
  const t = Date.now();
  db.exec(`INSERT INTO tenants(id, name, created_at) VALUES ('t1', 'Rossi Idraulica', ${t})`);
  db.exec(`INSERT INTO users(id, email, tenant_id, created_at, last_login_at) VALUES ('u1', 'rossi@x.it', 't1', ${t}, ${t})`);
  db.exec(`INSERT INTO entitlements(tenant_id, plan, status, updated_at) VALUES ('t1', 'pro', 'active', ${t})`);
  db.exec(`INSERT INTO usage(tenant_id, month, docs_created) VALUES ('t1', '2026-10', 7)`);
  const inv = (id: string, seq: number) => JSON.stringify({ id, type: 'fattura', status: 'emessa', number: `${seq}/2026`, updatedAt: 1, invoice: { year: 2026, sectional: 'FT', seq, number: `${seq}/2026`, lockedAt: 5, sdiEvents: [] } });
  const ins = db.prepare(`INSERT INTO documents(tenant_id,id,type,status,number,inv_year,inv_sectional,inv_seq,locked_at,created_at,updated_at,data) VALUES ('t1',?,?,?,?,?,?,?,?,1,1,?)`);
  for (let i = 1; i <= 3; i++) ins.run(`f${i}`, 'fattura', 'emessa', `${i}/2026`, 2026, 'FT', i, 5, inv(`f${i}`, i));
  ins.run('q1', 'preventivo', 'bozza', null, null, null, null, null, JSON.stringify({ id: 'q1', type: 'preventivo', status: 'bozza' }));
  db.exec(`INSERT INTO audit_log(tenant_id, at, action) VALUES ('t1', ${t}, 'auth.signup')`);
  db.exec(`INSERT INTO changes(tenant_id, op_id, entity, entity_id, op, payload, created_at) VALUES ('t1', 'o1', 'document', 'q1', 'upsert', '{}', ${t})`);
}

describe('upgrade da un DB alla versione N-2', () => {
  it('applica le migrazioni mancanti, conserva i dati, ricrea i trigger, il DB funziona', () => {
    const all = listMigrations().map((m) => m.version);
    expect(all.length).toBeGreaterThanOrEqual(8);
    const n2 = all[all.length - 3]!; // N-2: mancano le ultime DUE migrazioni
    const { path, db } = oldDb('n2.sqlite', n2);
    expect(versions(db)).toEqual(all.slice(0, -2));
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='invite_codes'").get()).toBeUndefined();
    seedLegacy(db);
    db.close();

    const up = openDb(path); // apertura "come produzione": applica le migrazioni mancanti
    expect(versions(up)).toEqual(all);
    expect((up.prepare('SELECT COUNT(*) AS n FROM documents').get() as any).n).toBe(4);
    expect((up.prepare("SELECT email FROM users").get() as any).email).toBe('rossi@x.it');
    expect((up.prepare("SELECT docs_created AS d FROM usage").get() as any).d).toBe(7);
    for (const t of ['admin_actions', 'ops_state', 'ops_daily', 'ops_errors', 'invite_codes']) expect(up.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(t), t).toBeTruthy();
    const rep = checkIntegrity(up);
    expect(rep.errors).toEqual([]);
    expect(rep.warnings).toEqual([]);
    expect(() => up.exec("DELETE FROM documents WHERE id='f1'")).toThrow(/documento_bloccato/);
    expect(() => up.exec("UPDATE audit_log SET action='x'")).toThrow(/append-only/);
    up.exec("INSERT INTO admin_actions(at, actor, action) VALUES (1, 'x', 'prova')");
    expect(() => up.exec('DELETE FROM admin_actions')).toThrow(/append-only/);
    // idempotente: una seconda apertura non rifa' nulla
    up.close();
    const again = openDb(path);
    expect(versions(again)).toEqual(all);
    again.close();
  });

  it('con il server vero: la concessione manuale funziona su un DB appena migrato', async () => {
    const all = listMigrations().map((m) => m.version);
    const { path, db } = oldDb('n2b.sqlite', all[all.length - 3]!);
    seedLegacy(db);
    db.close();
    process.env.DB_PATH = path;
    const { resetDb: reset } = await import('../../src/db');
    reset();
    expect(manualGrantUntil('t1')).toBeNull();
    grantPro('t1', Date.now() + 86_400_000, 'dopo upgrade');
    expect(manualGrantUntil('t1')).not.toBeNull();
  });
});

describe('upgrade da un DB alla primissima versione', () => {
  it('versione 1 -> ultima: dati, indice univoco di numerazione e trigger di reinvio scartate (v4)', () => {
    const { path, db } = oldDb('v1.sqlite', 1);
    expect(versions(db)).toEqual([1]);
    seedLegacy(db);
    db.close();
    const up = openDb(path);
    expect(versions(up)).toEqual(listMigrations().map((m) => m.version));
    // colonne aggiunte dalle migrazioni successive presenti e con default sensati
    const e = up.prepare('SELECT grace_until, cancel_at_period_end FROM entitlements').get() as any;
    expect(e).toEqual({ grace_until: null, cancel_at_period_end: null });
    expect((up.prepare('SELECT deleted_at FROM tenants').get() as any).deleted_at).toBeNull();
    // il trigger sostituito dalla v4 ammette il reinvio di una scartata ma non altre modifiche
    up.exec("UPDATE documents SET status='scartata' WHERE id='f1'");
    expect(() => up.exec("UPDATE documents SET data = json_set(data, '$.invoice.seq', 99) WHERE id='f2'")).toThrow(/documento_bloccato/);
    expect(checkIntegrity(up).errors).toEqual([]);
    up.close();
  });

  it('una migrazione che fallisce fa rollback completo (nessuna versione registrata a meta\')', () => {
    const { db } = oldDb('fail.sqlite', 1);
    registerMigration(9999, 'rotta', 'CREATE TABLE ok_prima(x INTEGER); CREATE TABLE ok_prima(x INTEGER);');
    try { expect(() => runMigrations(db, 9999)).toThrow(); } finally { unregisterMigration(9999); }
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ok_prima'").get()).toBeUndefined();
    expect(versions(db).includes(9999)).toBe(false);
    expect(versions(db)).toEqual(listMigrations().map((m) => m.version)); // le altre si sono applicate, quella rotta no
    db.close();
  });
});
