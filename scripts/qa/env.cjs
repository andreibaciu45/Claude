'use strict';
/**
 * Ambiente per la suite E2E: build privata della PWA (e2e/tmp/dist, per non toccare dist/ condiviso),
 * server statico (scripts/qa/static-server.cjs) su :4180 e server locale su :8798 con DB temporaneo e OTP in chiaro (solo test).
 * Usa SOLO segreti fittizi. Nessun dato reale, nessuna rete esterna.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, 'e2e', 'tmp');

const isOpen = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* ritenta */ } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('timeout in attesa di ' + url);
}

async function startEnv({ build = true } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const procs = [];
  if (build) {
    console.log('> build PWA in e2e/tmp/dist');
    const r = spawnSync('npx', ['vite', 'build', '--outDir', 'e2e/tmp/dist', '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('vite build fallita:\n' + (r.stdout + r.stderr).slice(-1500));
  }
  if (await isOpen(4180)) console.log('! porta 4180 gia in uso: riuso il preview esistente (potrebbe servire un build diverso)');
  else {
    procs.push(spawn(process.execPath, [path.join(__dirname, 'static-server.cjs'), 'e2e/tmp/dist', '4180'], { cwd: ROOT, stdio: 'ignore', detached: true }));
  }
  if (await isOpen(8798)) console.log('! porta 8798 gia in uso: riuso il server esistente');
  else {
    const db = path.join(TMP, `qa-${Date.now()}.sqlite`);
    procs.push(spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: path.join(ROOT, 'server'), stdio: 'ignore', detached: true,
      env: { ...process.env, DB_PATH: db, AUTH_DEV_RETURN_CODE: '1', AUTH_SECRET: 'test-secret-not-real', PORT: '8798', NODE_ENV: 'development', LOG_LEVEL: 'silent' },
    }));
  }
  await waitFor('http://127.0.0.1:4180/');
  await waitFor('http://127.0.0.1:8798/healthz');
  const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gia terminato */ } } };
  return { stop };
}

module.exports = { startEnv, isOpen, ROOT };
