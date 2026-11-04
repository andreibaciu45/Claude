// Accesso al DB (node:sqlite). Tutte le query di dominio vivono in server/src/db|documents|sync|auth
// e ricevono SEMPRE tenantId come primo argomento (vedi ARCHITECTURE-V2 §1.6).
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations';

export type { SQLInputValue };
export { registerMigration } from './migrations';

let db: DatabaseSync | null = null;
let depth = 0;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  if (path !== ':memory:') d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec('PRAGMA busy_timeout = 5000');
  d.exec('PRAGMA synchronous = NORMAL');
  runMigrations(d);
  return d;
}

export function getDb(): DatabaseSync {
  if (!db) db = openDb(process.env.DB_PATH || './data/app.sqlite');
  return db;
}
export function closeDb(): void {
  if (db) db.close();
  db = null;
  depth = 0;
}
/** Solo test: chiude e riapre un DB pulito (con DB_PATH=:memory: è vuoto). */
export function resetDb(): DatabaseSync {
  closeDb();
  return getDb();
}

/** Transazione (BEGIN IMMEDIATE); se annidata usa un SAVEPOINT. Rollback su eccezione. */
export function transaction<T>(fn: () => T): T {
  const d = getDb();
  const outer = depth === 0;
  const sp = `sp${depth}`;
  d.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    d.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    d.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export const one = <T>(sql: string, ...p: SQLInputValue[]): T | undefined =>
  getDb().prepare(sql).get(...p) as unknown as T | undefined;
export const all = <T>(sql: string, ...p: SQLInputValue[]): T[] =>
  getDb().prepare(sql).all(...p) as unknown as T[];
export const run = (sql: string, ...p: SQLInputValue[]) => getDb().prepare(sql).run(...p);
