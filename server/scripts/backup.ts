// Backup e verifica del DB SQLite (node:sqlite, WAL).
//
//   npx tsx scripts/backup.ts backup <db> <destinazione.sqlite>   # snapshot consistente a caldo (API backup di SQLite, ripiego VACUUM INTO)
//   npx tsx scripts/backup.ts verify <file.sqlite>                # integrity_check + foreign_key_check + trigger di immutabilità presenti
//
// Alternative equivalenti (vedi server/README.md): `sqlite3 <db> ".backup '<dest>'"` e Litestream (replica continua, richiede WAL).
// Il file prodotto è un database normale (journal_mode DELETE, senza -wal/-shm): per ripristinare basta copiarlo su DB_PATH a server fermo.
import { DatabaseSync } from 'node:sqlite';
import * as sqlite from 'node:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_TRIGGERS = [
  'trg_audit_no_update', 'trg_audit_no_delete', 'trg_documents_no_delete_locked', 'trg_documents_locked_update',
  'trg_legal_no_update', 'trg_legal_no_delete',
];

/** Snapshot consistente del DB anche mentre il server scrive. `dest` non deve esistere. */
export async function backupDatabase(srcPath: string, destPath: string): Promise<'backup-api' | 'vacuum-into'> {
  if (existsSync(destPath)) throw new Error(`la destinazione esiste già: ${destPath}`);
  const src = new DatabaseSync(srcPath, { readOnly: true });
  try {
    src.exec('PRAGMA busy_timeout = 10000');
    const api = (sqlite as unknown as { backup?: (db: DatabaseSync, path: string) => Promise<number> }).backup;
    if (typeof api === 'function') {
      await api(src, destPath);
      return 'backup-api';
    }
    src.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    return 'vacuum-into';
  } catch (e) {
    rmSync(destPath, { force: true });
    throw e;
  } finally {
    src.close();
  }
}

export interface VerifyReport { ok: boolean; problems: string[]; integrity: string; foreignKeyViolations: number; journalMode: string; schemaVersion: number | null; tables: Record<string, number> }

export function verifyDatabase(path: string): VerifyReport {
  const db = new DatabaseSync(path, { readOnly: true });
  const problems: string[] = [];
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check).join('; ');
    if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
    const fk = db.prepare('PRAGMA foreign_key_check').all().length;
    if (fk > 0) problems.push(`foreign_key_check: ${fk} violazioni`);
    const triggers = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[]).map((r) => r.name));
    for (const t of REQUIRED_TRIGGERS) if (!triggers.has(t)) problems.push(`trigger mancante: ${t}`);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    const tables: Record<string, number> = {};
    for (const n of ['tenants', 'users', 'documents', 'audit_log', 'changes']) {
      if (!names.includes(n)) { problems.push(`tabella mancante: ${n}`); continue; }
      tables[n] = (db.prepare(`SELECT COUNT(*) AS n FROM ${n}`).get() as { n: number }).n;
    }
    const sv = names.includes('schema_migrations') ? (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v : null;
    const journalMode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    return { ok: problems.length === 0, problems, integrity, foreignKeyViolations: fk, journalMode, schemaVersion: sv, tables };
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'backup' && a && b) {
    backupDatabase(a, b).then((m) => console.log(`backup ok (${m}) -> ${b}`), (e) => { console.error(String(e)); process.exit(1); });
  } else if (cmd === 'verify' && a) {
    const r = verifyDatabase(a);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error('uso: backup.ts backup <db> <dest> | backup.ts verify <file>');
    process.exit(2);
  }
}
