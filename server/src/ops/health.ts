// Controlli per GET /health/deep: DB scrivibile, migrazioni applicate, spazio su disco, eta' dell'ultimo backup (se BACKUP_DIR e' noto), manutenzione.
import { readdirSync, statSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { all, getDb, one } from '../db';
import { now } from '../db/clock';
import { listMigrations } from '../db/migrations';
import { getState, lastHousekeepingAt, setState } from './stats';
import { isDraining } from './state';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface Check { status: CheckStatus; detail?: Record<string, string | number | boolean | null> }
export interface DeepHealth { status: 'ok' | 'degraded' | 'fail'; checks: Record<string, Check> }

const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

/** BACKUP_DIR, oppure (se esiste) la cartella `backups` accanto al database: dove scrivono sia il timer di backup sia `admin.ts backup`. */
export function backupDir(): string | null {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const db = process.env.DB_PATH || './data/app.sqlite';
  if (db === ':memory:') return null;
  const d = join(dirname(db), 'backups');
  try { return statSync(d).isDirectory() ? d : null; } catch { return null; }
}

let backupCache: { at: number; value: number | null } | null = null;
/** Istante (ms) dell'ultimo file in BACKUP_DIR (qualunque file non nascosto), oppure null se non configurato o vuoto. */
export function lastBackupAt(): number | null {
  const dir = backupDir();
  if (!dir) return null;
  const t = Date.now();
  if (backupCache && t - backupCache.at < 30_000) return backupCache.value;
  let newest: number | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('.')) continue;
      try { const s = statSync(join(dir, f)); if (s.isFile() && (newest === null || s.mtimeMs > newest)) newest = s.mtimeMs; } catch { /* file sparito */ }
    }
  } catch { newest = null; }
  backupCache = { at: t, value: newest };
  return newest;
}
export function backupAgeSeconds(): number | null {
  const at = lastBackupAt();
  return at === null ? null : Math.max(0, (Date.now() - at) / 1000);
}
export const resetBackupCache = (): void => { backupCache = null; };

/** Sonda di SCRITTURA: solo per chi ha il token metrico (vedi `deepHealth({ write: true })`). */
function checkDbWrite(): Check {
  try {
    setState('health_probe', String(now()));
    getDb().prepare('SELECT 1').get();
    return { status: 'ok' };
  } catch { return { status: 'fail', detail: { error: 'scrittura non riuscita (disco pieno, DB bloccato o in sola lettura?)' } }; }
}

/** Sonda di sola LETTURA (nessuna scrittura): per le chiamate senza token. */
function checkDbRead(): Check {
  try {
    getDb().prepare('SELECT 1').get();
    one('SELECT value FROM ops_state WHERE key = ?', 'health_probe');
    return { status: 'ok' };
  } catch { return { status: 'fail', detail: { error: 'lettura non riuscita' } }; }
}

function checkMigrations(): Check {
  try {
    const applied = new Set(all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const expected = listMigrations();
    const missing = expected.filter((m) => !applied.has(m.version)).map((m) => m.version);
    const latest = Math.max(0, ...applied);
    return missing.length ? { status: 'fail', detail: { latest, missing: missing.join(',') } } : { status: 'ok', detail: { latest, expected: expected.length } };
  } catch { return { status: 'fail', detail: { error: 'tabella migrazioni illeggibile' } }; }
}

function checkDisk(): Check {
  const path = process.env.DB_PATH || './data/app.sqlite';
  if (path === ':memory:') return { status: 'ok', detail: { note: 'db in memoria' } };
  try {
    const s = statfsSync(dirname(path));
    const free = Number(s.bavail) * Number(s.bsize), total = Number(s.blocks) * Number(s.bsize);
    const pct = total > 0 ? (free / total) * 100 : 100;
    const critMb = envNum('DISK_CRIT_FREE_MB', 200), warnMb = envNum('DISK_WARN_FREE_MB', 1024);
    const mb = free / 1048576;
    const status: CheckStatus = mb < critMb || pct < 3 ? 'fail' : mb < warnMb || pct < 10 ? 'warn' : 'ok';
    return { status, detail: { freeMb: Math.round(mb), freePercent: Math.round(pct * 10) / 10 } };
  } catch { return { status: 'warn', detail: { error: 'spazio su disco non leggibile' } }; }
}

function checkBackup(): Check {
  if (!backupDir()) return { status: 'ok', detail: { note: 'cartella dei backup non nota (imposta BACKUP_DIR): eta\' non verificabile' } };
  const at = lastBackupAt();
  if (at === null) return { status: 'warn', detail: { error: 'nessun file di backup trovato' } };
  const ageH = (Date.now() - at) / 3_600_000;
  const maxH = envNum('BACKUP_MAX_AGE_HOURS', 36);
  return { status: ageH > maxH ? 'warn' : 'ok', detail: { ageHours: Math.round(ageH * 10) / 10, maxHours: maxH } };
}

function checkMaintenance(): Check {
  const last = lastHousekeepingAt();
  const upH = process.uptime() / 3600;
  if (last === null) return { status: upH > 2 ? 'warn' : 'ok', detail: { note: 'ancora nessuna pulizia periodica' } };
  const ageH = (now() - last) / 3_600_000;
  return { status: ageH > 3 && upH > 3 ? 'warn' : 'ok', detail: { ageHours: Math.round(ageH * 10) / 10, lastVacuum: getState('last_vacuum_at') ?? null } };
}

/** Un controllo che lancia non deve mai far cadere l'endpoint: diventa un 'fail'. */
const guard = (fn: () => Check): Check => { try { return fn(); } catch { return { status: 'fail', detail: { error: 'controllo non eseguibile' } }; } };

/**
 * Stato approfondito. `write: false` (default, chiamate SENZA token) = nessuna scrittura sul DB: solo letture;
 * `write: true` (token metrico valido) = in piu' la sonda di scrittura (`db_write`).
 * Il risultato e' in cache per HEALTH_CACHE_MS (default 5000, 0 = nessuna cache) separatamente per modalita': a una raffica di richieste
 * corrisponde al piu' una valutazione (e una scrittura) ogni pochi secondi, quindi l'endpoint non e' un vettore di DoS verso il disco.
 */
const cache: Partial<Record<'read' | 'write', { at: number; value: DeepHealth }>> = {};
export const resetHealthCache = (): void => { delete cache.read; delete cache.write; };
const cacheMs = (): number => { const n = Number(process.env.HEALTH_CACHE_MS); return Number.isFinite(n) && n >= 0 ? n : 5000; };

export function deepHealth(opts: { write?: boolean } = {}): DeepHealth {
  const mode = opts.write ? 'write' : 'read';
  const t = now();
  const hit = cache[mode];
  if (hit && cacheMs() > 0 && t - hit.at >= 0 && t - hit.at < cacheMs() && !isDraining()) return hit.value;
  const checks: Record<string, Check> = {
    ...(opts.write ? { db_write: guard(checkDbWrite) } : { db_read: guard(checkDbRead) }),
    migrations: guard(checkMigrations), disk: guard(checkDisk), backup: guard(checkBackup), maintenance: guard(checkMaintenance),
  };
  if (isDraining()) checks.shutdown = { status: 'fail', detail: { note: 'arresto in corso' } };
  const sts = Object.values(checks).map((c) => c.status);
  const value: DeepHealth = { status: sts.includes('fail') ? 'fail' : sts.includes('warn') ? 'degraded' : 'ok', checks };
  if (!isDraining()) cache[mode] = { at: t, value };
  return value;
}

/** Versione per chi non e' autenticato: solo gli stati, senza numeri ne' percorsi. */
export const redactHealth = (h: DeepHealth): DeepHealth => ({
  status: h.status, checks: Object.fromEntries(Object.entries(h.checks).map(([k, c]) => [k, { status: c.status }])),
});
