// Backup/ripristino: compatibilità con Litestream (WAL), `sqlite3 .backup`, API backup di node:sqlite e VACUUM INTO.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/db';
import '../../src/app'; // registra le migrazioni di tutti i moduli (core + extra)
import { backupDatabase, REQUIRED_TRIGGERS, verifyDatabase } from '../../scripts/backup';

const dir = mkdtempSync(join(tmpdir(), 'vp-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function seed(path: string) {
  const db = openDb(path);
  db.exec(`INSERT INTO tenants(id, created_at) VALUES ('t1', 1)`);
  const ins = db.prepare(`INSERT INTO documents(tenant_id,id,type,status,locked_at,created_at,updated_at,data) VALUES ('t1',?,?,?,?,1,1,?)`);
  for (let i = 0; i < 200; i++) ins.run(`d${i}`, 'fattura', 'emessa', i % 2 ? 1 : null, JSON.stringify({ id: `d${i}`, n: i }));
  db.exec(`INSERT INTO audit_log(tenant_id, at, action) VALUES ('t1', 1, 'x')`);
  return db;
}

describe('DB compatibile con Litestream', () => {
  it('journal_mode=WAL, synchronous=NORMAL, busy_timeout>=5s, nessun locking esclusivo; un lettore esterno (come Litestream) legge mentre si scrive', () => {
    const path = join(dir, 'live.sqlite');
    const db = seed(path);
    const q = (p: string) => Object.values(db.prepare(`PRAGMA ${p}`).get() as object)[0];
    expect(q('journal_mode')).toBe('wal');
    expect(q('synchronous')).toBe(1); // NORMAL
    expect(q('busy_timeout')).toBeGreaterThanOrEqual(5000);
    expect(q('locking_mode')).toBe('normal');
    expect(q('foreign_keys')).toBe(1);
    expect(q('secure_delete')).toBe(1);
    // il file -wal esiste e un secondo processo/connessione in sola lettura vede i dati committati
    expect(existsSync(`${path}-wal`)).toBe(true);
    const reader = new DatabaseSync(path, { readOnly: true });
    reader.exec('BEGIN');
    expect((reader.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n).toBe(200);
    db.exec(`INSERT INTO documents(tenant_id,id,type,status,created_at,updated_at,data) VALUES ('t1','nuovo','preventivo','bozza',1,1,'{}')`); // la scrittura non è bloccata dal lettore
    expect((reader.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n).toBe(200); // snapshot coerente
    reader.exec('COMMIT');
    reader.close();
    db.close();
  });

  it('permessi: cartella dati 0700 e file DB 0600', () => {
    const sub = join(dir, 'perm', 'data');
    const db = openDb(join(sub, 'app.sqlite'));
    db.close();
    expect(statSync(sub).mode & 0o777).toBe(0o700);
    expect(statSync(join(sub, 'app.sqlite')).mode & 0o777).toBe(0o600);
  });
});

describe('backup e ripristino', () => {
  it('API backup di SQLite a caldo -> verifica -> ripristino: dati, indici e trigger di immutabilità intatti', async () => {
    const path = join(dir, 'a.sqlite');
    const db = seed(path);
    const dest = join(dir, 'a.backup.sqlite');
    // scritture concorrenti durante il backup
    const writer = (async () => { for (let i = 0; i < 50; i++) { db.exec(`UPDATE documents SET updated_at=updated_at+1 WHERE id='d0'`); await new Promise((r) => setImmediate(r)); } })();
    const how = await backupDatabase(path, dest);
    await writer;
    expect(['backup-api', 'vacuum-into']).toContain(how);
    const rep = verifyDatabase(dest);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.tables.documents).toBeGreaterThanOrEqual(200);
    expect(rep.schemaVersion).toBeGreaterThanOrEqual(102);
    // ripristino = aprire la copia come DB di produzione
    db.close();
    const restored = openDb(dest);
    expect(() => restored.exec(`DELETE FROM documents WHERE id='d1'`)).toThrow(/documento_bloccato/); // d1 è bloccata
    expect(() => restored.exec(`UPDATE audit_log SET action='y'`)).toThrow(/append-only/);
    for (const t of REQUIRED_TRIGGERS) expect(restored.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(t), t).toBeTruthy();
    restored.close();
  });

  it('VACUUM INTO produce un backup equivalente', () => {
    const path = join(dir, 'b.sqlite');
    const db = seed(path);
    const dest = join(dir, 'b.vacuum.sqlite');
    db.exec(`VACUUM INTO '${dest}'`);
    db.close();
    expect(verifyDatabase(dest).ok).toBe(true);
  });

  it('backupDatabase non sovrascrive una destinazione esistente', async () => {
    const path = join(dir, 'c.sqlite');
    seed(path).close();
    const dest = join(dir, 'c.bak');
    await backupDatabase(path, dest);
    await expect(backupDatabase(path, dest)).rejects.toThrow(/esiste/);
  });

  it('verifyDatabase segnala un DB senza trigger o corrotto', () => {
    const p = join(dir, 'd.sqlite');
    const d = new DatabaseSync(p);
    d.exec('CREATE TABLE tenants(id); CREATE TABLE users(id); CREATE TABLE documents(id); CREATE TABLE audit_log(id); CREATE TABLE changes(id);');
    d.close();
    const rep = verifyDatabase(p);
    expect(rep.ok).toBe(false);
    expect(rep.problems.some((x) => x.includes('trigger mancante'))).toBe(true);
  });

  const hasSqlite3 = spawnSync('sqlite3', ['-version']).status === 0;
  it.skipIf(!hasSqlite3)('sqlite3 CLI: `.backup` a caldo su DB WAL produce un file valido (presente nell\'immagine Docker)', () => {
    const path = join(dir, 'e.sqlite');
    const db = seed(path);
    const dest = join(dir, 'e.cli.sqlite');
    execFileSync('sqlite3', [path, `.backup '${dest}'`]);
    db.close();
    expect(verifyDatabase(dest).ok).toBe(true);
    expect(readFileSync(dest).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
