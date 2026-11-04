// Manutenzione automatica a basso impatto: pulizia dei dati scaduti (db/housekeeping), checkpoint PASSIVE del WAL, PRAGMA optimize giornaliero
// e VACUUM opzionale (MAINTENANCE_VACUUM=1) solo in orario tranquillo e quando serve davvero.
//
// Compatibilita' con Litestream (vedi server/README.md): niente `wal_checkpoint(TRUNCATE/RESTART)` (bloccano i lettori e confliggono con la replica);
// PASSIVE non blocca nessuno e non tronca il file. VACUUM riscrive tutto il DB (la replica deve ricopiarlo): per questo e' disattivato di default,
// limitato a una finestra oraria, a una volta ogni N giorni e a quando lo spazio recuperabile e' significativo.
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDb } from '../db';
import { now } from '../db/clock';
import { housekeeping } from '../db/housekeeping';
import { logEvent } from '../log';
import { getState, pragmaNum, setState } from './stats';

const DAY = 86_400_000;
const envNum = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : def; };
const onDisk = () => (process.env.DB_PATH || './data/app.sqlite') !== ':memory:';

export function walCheckpointPassive(): { busy: number; log: number; checkpointed: number } | null {
  if (process.env.MAINTENANCE_CHECKPOINT === '0' || !onDisk()) return null;
  const r = getDb().prepare('PRAGMA wal_checkpoint(PASSIVE)').get() as { busy: number; log: number; checkpointed: number };
  return { busy: Number(r.busy), log: Number(r.log), checkpointed: Number(r.checkpointed) };
}

export function optimizeDaily(): boolean {
  const last = Number(getState('last_optimize_at') ?? 0);
  if (now() - last < DAY) return false;
  getDb().exec('PRAGMA optimize');
  setState('last_optimize_at', String(now()));
  return true;
}

export type VacuumResult = 'done' | `skipped:${string}`;
/**
 * VACUUM con tutte le cautele. `force` salta solo opt-in, finestra oraria e frequenza (non i controlli di spazio/dimensione): per test e uso manuale.
 * Condizioni: MAINTENANCE_VACUUM=1; ora UTC == MAINTENANCE_HOUR_UTC (3); non piu' di una volta ogni MAINTENANCE_VACUUM_MIN_DAYS (7);
 * DB <= MAINTENANCE_VACUUM_MAX_MB (500); spazio libero interno >= max(MAINTENANCE_VACUUM_MIN_FREE_MB (8), 20% del file); disco con almeno 2x la dimensione del DB.
 */
export function maybeVacuum(opts: { force?: boolean } = {}): VacuumResult {
  if (!onDisk()) return 'skipped:in-memory';
  if (!opts.force) {
    if (process.env.MAINTENANCE_VACUUM !== '1') return 'skipped:disabled';
    if (new Date(now()).getUTCHours() !== envNum('MAINTENANCE_HOUR_UTC', 3)) return 'skipped:outside-window';
    if (now() - Number(getState('last_vacuum_at') ?? 0) < envNum('MAINTENANCE_VACUUM_MIN_DAYS', 7) * DAY) return 'skipped:too-soon';
  }
  const psize = pragmaNum('page_size');
  const size = pragmaNum('page_count') * psize, free = pragmaNum('freelist_count') * psize;
  if (size > envNum('MAINTENANCE_VACUUM_MAX_MB', 500) * 1048576) return 'skipped:db-too-large';
  if (free < Math.max(envNum('MAINTENANCE_VACUUM_MIN_FREE_MB', 8) * 1048576, size * 0.2)) return 'skipped:not-needed';
  try {
    const s = statfsSync(dirname(process.env.DB_PATH || './data/app.sqlite'));
    if (Number(s.bavail) * Number(s.bsize) < size * 2) return 'skipped:low-disk';
  } catch { return 'skipped:disk-unknown'; }
  try {
    getDb().exec('VACUUM');
  } catch (e) {
    logEvent('warn', 'vacuum_failed', { error: e instanceof Error ? e.name : 'errore' }); // tipicamente SQLITE_BUSY: riproverà
    return 'skipped:busy';
  }
  setState('last_vacuum_at', String(now()));
  logEvent('info', 'vacuum_done', { reclaimedBytes: free });
  return 'done';
}

export interface MaintenanceReport { purged: Record<string, number>; checkpoint: ReturnType<typeof walCheckpointPassive>; optimized: boolean; vacuum: VacuumResult; ms: number }

/** Un ciclo completo. Sicuro da chiamare piu' volte; ogni passo e' isolato (un errore non ferma gli altri). */
export function runMaintenance(): MaintenanceReport {
  const t0 = Date.now();
  const rep: MaintenanceReport = { purged: {}, checkpoint: null, optimized: false, vacuum: 'skipped:disabled', ms: 0 };
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { logEvent('warn', 'maintenance_step_failed', { step: name, error: e instanceof Error ? e.name : 'errore' }); } };
  step('housekeeping', () => { rep.purged = housekeeping(); });
  step('checkpoint', () => { rep.checkpoint = walCheckpointPassive(); });
  step('optimize', () => { rep.optimized = optimizeDaily(); });
  step('vacuum', () => { rep.vacuum = maybeVacuum(); });
  step('state', () => setState('last_housekeeping_at', String(now())));
  rep.ms = Date.now() - t0;
  const purgedRows = Object.values(rep.purged).filter((n) => n > 0).reduce((a, b) => a + b, 0);
  logEvent('info', 'maintenance', { purgedRows, checkpointLog: rep.checkpoint?.log ?? null, optimized: rep.optimized, vacuum: rep.vacuum, ms: rep.ms });
  return rep;
}

export type MaintenanceStop = (() => void) & { drain: () => Promise<void> };
/** Primo ciclo dopo `initialDelayMs` (non rallenta l'avvio), poi ogni `everyMs` (default 1 ora). Timer non bloccante (unref). */
export function startMaintenance(everyMs = 3600_000, initialDelayMs = 30_000): MaintenanceStop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try { runMaintenance(); } catch { /* mai far cadere il processo */ }
    timer = setTimeout(tick, everyMs);
    timer.unref?.();
  };
  timer = setTimeout(tick, initialDelayMs);
  timer.unref?.();
  const stop = (() => { stopped = true; if (timer) clearTimeout(timer); }) as MaintenanceStop;
  stop.drain = async () => { stop(); }; // il ciclo e' sincrono: quando il controllo arriva qui non c'e' nulla in corso
  return stop;
}
