// Test di carico semplice, senza dipendenze: avvia il server IN PROCESSO su una porta effimera (DB temporaneo) oppure punta a un server esistente.
//
//   npx tsx scripts/loadtest.ts                              # in-process, 10 s, 20 connessioni, 5 tenant
//   npx tsx scripts/loadtest.ts --duration=30 --concurrency=50 --tenants=10
//   BASE_URL=https://staging.example.com TOKENS=tok1,tok2 npx tsx scripts/loadtest.ts   # server esterno: servono sessioni già create
//
// Scenario per ogni worker (tenant a rotazione): 60% GET /v1/sync/pull, 25% POST /v1/sync/push (upsert di una bozza), 10% GET /v1/me, 5% GET /health.
// Output: richieste/s, latenza p50/p95/p99, conteggio per status. In-process i limiti di rate sono alzati (si misura il server, non il limiter).
// Uscita con codice 1 se compaiono 5xx o se p95 supera --max-p95-ms (se indicato).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

export interface LoadOptions { baseUrl?: string; tokens?: string[]; durationSec: number; concurrency: number; tenants: number }
export interface LoadReport { requests: number; rps: number; p50: number; p95: number; p99: number; max: number; byStatus: Record<string, number>; errors5xx: number; networkErrors: number }

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0);

export async function runLoadTest(o: LoadOptions): Promise<LoadReport> {
  let base = o.baseUrl;
  let tokens = o.tokens ?? [];
  let cleanup = async () => {};
  if (!base) {
    const dir = mkdtempSync(join(tmpdir(), 'vp-load-'));
    Object.assign(process.env, {
      DB_PATH: join(dir, 'load.sqlite'), NODE_ENV: 'test', LOG_LEVEL: 'silent', AUTH_SECRET: 'loadtest-secret-loadtest-secret',
      RL_IP_PER_MIN: '100000000', RL_TENANT_PER_MIN: '100000000', RL_TENANT_WRITES_PER_MIN: '100000000', RL_SYNC_OPS_HOUR: '100000000', RL_OTP_REQUEST_IP_HOUR: '100000', RL_OTP_REQUEST_PAIR_HOUR: '100000', RL_OTP_REQUEST_EMAIL_HOUR: '100000', RL_OTP_VERIFY_IP_10MIN: '100000',
      AUTH_DEV_RETURN_CODE: '1',
    });
    const { serve } = await import('@hono/node-server');
    const { createApp } = await import('../src/app');
    const { closeDb, getDb } = await import('../src/db');
    const { setEntitlement } = await import('../src/db/entitlements');
    getDb();
    const server = serve({ fetch: createApp().fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (let i = 0; i < o.tenants; i++) {
      const email = `load${i}@example.test`;
      const rq = await fetch(`${base}/v1/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      const { devCode } = (await rq.json()) as { devCode: string };
      const vr = await fetch(`${base}/v1/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: devCode, deviceId: `load-${i}` }) });
      const v = (await vr.json()) as { token: string; tenantId: string };
      setEntitlement(v.tenantId, { plan: 'pro' }); // niente quota Free: si misura il sync
      tokens.push(v.token);
    }
    cleanup = async () => { server.close(); closeDb(); rmSync(dir, { recursive: true, force: true }); };
  }
  if (!tokens.length) throw new Error('servono dei token (TOKENS=a,b,c) per un server esterno');

  const lat: number[] = [];
  const byStatus: Record<string, number> = {};
  let net = 0, e5 = 0, seq = 0;
  const end = Date.now() + o.durationSec * 1000;
  const t0 = Date.now();
  const worker = async (w: number) => {
    const token = tokens[w % tokens.length]!;
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    while (Date.now() < end) {
      const r = Math.random();
      const s = performance.now();
      try {
        let res: Response;
        if (r < 0.6) res = await fetch(`${base}/v1/sync/pull?cursor=0&limit=50`, { headers: auth });
        else if (r < 0.85) {
          const id = `d-${w}-${++seq}`;
          const now = Date.now();
          const doc = { id, type: 'preventivo', number: `P-${seq}`, date: '2026-01-15', customer: { id: 'c', name: 'Cliente di prova' }, lines: [{ id: 'l', description: 'Voce', qty: 1, unit: 'h', unitPrice: 10, vat: 22 }], status: 'bozza', createdAt: now, updatedAt: now };
          res = await fetch(`${base}/v1/sync/push`, { method: 'POST', headers: auth, body: JSON.stringify({ deviceId: `load-${w}`, ops: [{ opId: crypto.randomUUID(), entity: 'document', entityId: id, op: 'upsert', payload: doc, clientTs: now }] }) });
        } else if (r < 0.95) res = await fetch(`${base}/v1/me`, { headers: auth });
        else res = await fetch(`${base}/health`);
        await res.arrayBuffer();
        lat.push(performance.now() - s);
        byStatus[res.status] = (byStatus[res.status] ?? 0) + 1;
        if (res.status >= 500) e5++;
      } catch { net++; }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;
  await cleanup();
  lat.sort((a, b) => a - b);
  return { requests: lat.length, rps: Math.round(lat.length / elapsed), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +(lat[lat.length - 1] ?? 0).toFixed(1), byStatus, errors5xx: e5, networkErrors: net };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]) || d;
  runLoadTest({
    baseUrl: process.env.BASE_URL, tokens: process.env.TOKENS?.split(',').filter(Boolean),
    durationSec: arg('duration', 10), concurrency: arg('concurrency', 20), tenants: arg('tenants', 5),
  }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    const maxP95 = arg('max-p95-ms', 0);
    process.exit(r.errors5xx > 0 || r.networkErrors > 0 || (maxP95 > 0 && r.p95 > maxP95) ? 1 : 0);
  });
}
