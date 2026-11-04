// Arresto ordinato: drenaggio delle richieste, stop dei worker, chiusura del DB, forzatura entro il tempo massimo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createApp } from '../../src/app';
import { closeDb, resetDb } from '../../src/db';
import { createShutdown } from '../../src/ops/shutdown';
import { drainGuard } from '../../src/ops/routes';
import { setDraining, isDraining } from '../../src/ops/state';
import { startSdiWorker } from '../../src/sdi/routes';
import { startMaintenance } from '../../src/ops/maintenance';
import { InMemoryJobStore } from '../../src/sdi/jobs';
import { SqliteSdiStore } from '../../src/sdi/sqlite';
import { systemClock } from '../../src/billing/common';

type Srv = ReturnType<typeof serve>;
let server: Srv | null = null;
let slowStarted: (() => void) | null = null;
const url = () => `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;

async function start(): Promise<Srv> {
  resetDb();
  setDraining(false);
  const inner = createApp();
  const app = new Hono();
  // rotte di prova: una lenta (300 ms) e una che non finisce mai
  app.get('/slow', async (c) => { slowStarted?.(); await new Promise((r) => setTimeout(r, 300)); return c.text('fatto'); });
  app.get('/hang', () => new Promise<Response>(() => {}));
  app.route('/', inner);
  const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => s.once('listening', r));
  return s;
}
beforeEach(async () => { server = await start(); });
afterEach(() => { try { (server as any)?.closeAllConnections?.(); server?.close(); } catch { /* gia' chiuso */ } server = null; setDraining(false); });

const mkWorkers = () => {
  const sdi = startSdiWorker({ provider: () => null, jobs: new InMemoryJobStore(), store: new SqliteSdiStore(), documents: null, sink: null, clock: systemClock, env: () => ({}) }, 20);
  return [sdi, startMaintenance(60_000, 60_000)];
};

describe('createShutdown', () => {
  it('SIGTERM con una richiesta in corso: la richiesta finisce (200), le nuove ricevono errore, DB chiuso, exit 0 in < 10 s', async () => {
    const exit = vi.fn();
    let closed = 0;
    const sd = createShutdown({ server: server as any, workers: mkWorkers(), closeDb: () => { closed++; closeDb(); }, exit });
    const base = url();
    const started = new Promise<void>((r) => { slowStarted = r; });
    const inflight = fetch(`${base}/slow`).then(async (r) => ({ status: r.status, body: await r.text() }));
    await started;
    const t0 = Date.now();
    const done = sd('SIGTERM');
    expect(isDraining()).toBe(true);
    const res = await inflight;
    expect(res).toEqual({ status: 200, body: 'fatto' });
    const result = await done;
    expect(result).toMatchObject({ forced: false, code: 0 });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(closed).toBe(1);
    await expect(fetch(`${base}/health`)).rejects.toThrow(); // il listener e' chiuso
  });

  it('segnali ripetuti: un solo arresto', async () => {
    const exit = vi.fn();
    const sd = createShutdown({ server: server as any, workers: [], closeDb, exit });
    const [a, b] = await Promise.all([sd('SIGTERM'), sd('SIGINT')]);
    expect(a).toBe(b);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('richiesta che non finisce mai: dopo il tempo massimo chiude a forza, chiude il DB, exit 1', async () => {
    const exit = vi.fn();
    const sd = createShutdown({ server: server as any, workers: mkWorkers(), closeDb, exit, timeoutMs: 600 });
    const hung = fetch(`${url()}/hang`).catch((e) => e);
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    const r = await sd('SIGTERM');
    expect(r).toMatchObject({ forced: true, code: 1 });
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(exit).toHaveBeenCalledWith(1);
    expect(await hung).toBeInstanceOf(Error); // connessione chiusa dal server
  });

  it('connessioni keep-alive inattive non ritardano l\'arresto', async () => {
    const exit = vi.fn();
    const sock: Socket = connect((server!.address() as AddressInfo).port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    sock.write('GET /health HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
    await new Promise((r) => sock.once('data', r));
    const sd = createShutdown({ server: server as any, workers: [], closeDb, exit });
    const t0 = Date.now();
    expect(await sd('SIGTERM')).toMatchObject({ forced: false, code: 0 });
    expect(Date.now() - t0).toBeLessThan(1500);
    sock.destroy();
  });

  it('uscita con errore (uncaughtException): codice 1 anche se pulito; un worker che fallisce non impedisce di chiudere il DB', async () => {
    const exit = vi.fn();
    let closed = false;
    const bad = Object.assign(() => { throw new Error('boom'); }, {});
    const sd = createShutdown({ server: server as any, workers: [bad], closeDb: () => { closed = true; closeDb(); }, exit });
    expect(await sd('uncaughtException', true)).toMatchObject({ code: 1, forced: false });
    expect(closed).toBe(true);
  });

  it('un worker che non termina viene abbandonato entro il budget', async () => {
    const exit = vi.fn();
    const stuck = Object.assign(() => {}, { drain: () => new Promise<void>(() => {}) });
    const sd = createShutdown({ server: server as any, workers: [stuck], closeDb, exit, timeoutMs: 400 });
    const t0 = Date.now();
    expect(await sd('SIGTERM')).toMatchObject({ forced: true, code: 1 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('i worker vengono davvero fermati (SDI e manutenzione non girano piu\')', async () => {
    const exit = vi.fn();
    const [sdi, maint] = mkWorkers();
    const sd = createShutdown({ server: server as any, workers: [sdi!, maint!], closeDb, exit });
    await sd('SIGTERM');
    await expect(sdi!.drain()).resolves.toBeUndefined();
  });
});

describe('drainGuard', () => {
  it('durante l\'arresto risponde 503 con Connection: close', async () => {
    const app = new Hono();
    app.use('*', drainGuard);
    app.get('/x', (c) => c.text('ok'));
    expect((await app.request('/x')).status).toBe(200);
    setDraining(true);
    const r = await app.request('/x');
    expect(r.status).toBe(503);
    expect(r.headers.get('connection')).toBe('close');
    expect(r.headers.get('retry-after')).toBe('5');
  });
});

describe('processo reale: SIGTERM', () => {
  it('src/index.ts risponde a SIGTERM chiudendo il DB e uscendo con 0 entro 10 s', async () => {
    const { spawn } = await import('node:child_process');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'vp-sigterm-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(__dirname, '..', '..', 'src', 'index.ts')], {
      env: { ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'silent', PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(dir, 'app.sqlite'), AUTH_SECRET: 'sigterm-test-secret-0123456789' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    try {
      for (let i = 0; i < 100 && !out.includes('in ascolto'); i++) await new Promise((r) => setTimeout(r, 100));
      expect(out).toContain('in ascolto');
      expect((await fetch(`http://127.0.0.1:${port}/health/deep`)).status).toBe(200);
      const t0 = Date.now();
      const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(existsSync(join(dir, 'app.sqlite-wal'))).toBe(false); // chiusura pulita: WAL integrato e rimosso
    } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
