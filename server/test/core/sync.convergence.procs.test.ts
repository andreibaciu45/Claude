// DUE processi reali sullo stesso file SQLite consegnano le STESSE operazioni in ordini/duplicati diversi, in concorrenza:
// lo stato finale deve essere identico al modello di riferimento puro (e quindi a qualunque altro ordine).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { one } from '../../src/db';
import { pullChanges } from '../../src/db/changes';
import { setEntitlement } from '../../src/db/entitlements';
import { freshEnv, login } from './helpers';
import { SERVER_DIR, TSX, useFileDb, type FileDb } from '../ops/helpers';
import { canon, genOps, modelState } from './convergence-model';

let fdb: FileDb;
beforeEach(() => { fdb = useFileDb(); freshEnv(); });
afterEach(() => fdb.cleanup());

const child = (file: string, tenantId: string, userId: string, seed: number, startAt: number) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  const p = spawn(process.execPath, [TSX, join(SERVER_DIR, 'test', 'core', 'sync-conv-child.ts'), file, tenantId, userId, String(seed), String(startAt)],
    { env: { ...process.env, DB_PATH: fdb.path, NODE_ENV: 'test', LOG_LEVEL: 'silent', RL_SYNC_OPS_HOUR: '1000000' }, cwd: SERVER_DIR });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});

describe('sync: convergenza con due processi sullo stesso DB', () => {
  for (const seed of [11, 12, 13]) {
    it(`seed ${seed}: due processi che consegnano le stesse op in ordini diversi convergono al modello`, async () => {
      const { tenantId } = await login('p@x.it');
      setEntitlement(tenantId, { plan: 'pro' });
      const userId = one<{ id: string }>('SELECT id FROM users WHERE email=?', 'p@x.it')!.id;
      const ops = genOps(seed, { n: 30 }).map((d) => d.op);
      const file = join(fdb.dir, 'ops.json');
      writeFileSync(file, JSON.stringify(ops));
      const startAt = Date.now() + 4000;
      const [a, b] = await Promise.all([child(file, tenantId, userId, seed * 2, startAt), child(file, tenantId, userId, seed * 2 + 1, startAt)]);
      for (const r of [a, b]) {
        expect(r.code, r.err).toBe(0);
        const o = JSON.parse(r.out.trim().split('\n').pop()!);
        expect(o.errors).toBe(0);
        expect(Object.keys(o.conflicts).filter((k) => k !== 'stale')).toEqual([]);
      }
      // stato dal log di sync (ultima modifica per entità, come lo vedrebbe un dispositivo che fa pull)
      const got: Record<string, string> = {};
      for (const c of pullChanges(tenantId, 0, 10_000)) if (c.op === 'upsert') got[`${c.entity}:${c.entity_id}`] = canon(JSON.parse(c.payload!));
      const want = Object.fromEntries(Object.entries(modelState(ops)).map(([k, v]) => [k, canon(JSON.parse(v))]));
      expect(got).toEqual(want);
      expect(Object.keys(want).length).toBeGreaterThan(0);
    }, 90_000);
  }
});
