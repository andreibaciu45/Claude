// Accesso al DB (node:sqlite). Tutte le query di dominio vivono in server/src/db|documents|sync|auth
// e ricevono SEMPRE tenantId come primo argomento (vedi ARCHITECTURE-V2 §1.6).
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrations';

export type { SQLInputValue };
export { registerMigration } from './migrations';

let db: DatabaseSync | null = null;
let depth = 0;
const resetHooks: (() => void)[] = [];
/** Per stato in memoria legato al DB (es. rate-limit in memoria): chiamato da resetDb() e closeDb(). */
export const registerResetHook = (fn: () => void): void => { resetHooks.push(fn); };

export function openDb(path: string): DatabaseSync {
  // Cartella dati 0700 e file 0600: il DB contiene dati personali e fiscali.
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const d = new DatabaseSync(path);
  if (path !== ':memory:') d.exec('PRAGMA journal_mode = WAL'); // richiesto da Litestream (vedi server/README.md)
  d.exec('PRAGMA foreign_keys = ON');
  d.exec('PRAGMA busy_timeout = 5000');
  d.exec('PRAGMA synchronous = NORMAL');
  d.exec('PRAGMA secure_delete = ON'); // le pagine liberate vengono azzerate (cancellazioni GDPR)
  runMigrations(d);
  if (path !== ':memory:') for (const f of [path, `${path}-wal`, `${path}-shm`]) {
    try { if (existsSync(f)) chmodSync(f, 0o600); } catch { /* filesystem senza permessi POSIX */ }
  }
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
  for (const h of resetHooks) h();
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
