// Helper dei test SERVER-OPS: riusa quelli di CORE e aggiunge DB su file (per CLI in processi figli, backup, WAL).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { resetDb } from '../../src/db';
import { setClock } from '../../src/db/clock';
import type { CliIO } from '../../scripts/admin';
import { runCli } from '../../scripts/admin';

export * from '../core/helpers';

export const SERVER_DIR = join(__dirname, '..', '..');
export const TSX = join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const ADMIN_TS = join(SERVER_DIR, 'scripts', 'admin.ts');

export interface FileDb { dir: string; path: string; cleanup: () => void }
/** Apre un DB su file (WAL) come DB del processo di test. Ripristina :memory: con cleanup(). */
export function useFileDb(): FileDb {
  const dir = mkdtempSync(join(tmpdir(), 'vp-ops-'));
  const path = join(dir, 'test.sqlite');
  process.env.DB_PATH = path;
  resetDb();
  setClock(null);
  return { dir, path, cleanup: () => { process.env.DB_PATH = ':memory:'; resetDb(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Esegue la CLI in-process e raccoglie l'output. */
export async function cli(args: string[], answers: string[] = []): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [], err: string[] = [];
  const io: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s), ask: async () => answers.shift() ?? '' };
  const code = await runCli(args, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Esegue la CLI come processo figlio (come farebbe l'operatore), con il DB indicato. */
export function cliProc(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [TSX, ADMIN_TS, ...args], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env }, cwd: SERVER_DIR, timeout: 60_000 });
}
export function cliProcAsync(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [TSX, ADMIN_TS, ...args], { env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env }, cwd: SERVER_DIR });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
