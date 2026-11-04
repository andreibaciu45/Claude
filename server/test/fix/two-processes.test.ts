// DUE processi reali sullo stesso file SQLite: contatori di difesa OTP, catena fiscale e potatura dell'audit devono restare esatti (nessun aggiornamento perso, nessun doppio conteggio).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { all, one, run } from '../../src/db';
import { createOtp } from '../../src/auth/service';
import { emailKey } from '../../src/auth/guard';
import { verifyChain } from '../../src/db/chain';
import { freshEnv } from '../core/helpers';
import { SERVER_DIR, TSX, useFileDb, type FileDb } from '../ops/helpers';
import { getDb } from '../../src/db';

let fdb: FileDb;
beforeEach(() => { fdb = useFileDb(); freshEnv(); });
afterEach(() => fdb.cleanup());

const child = (mode: string, startAt: number, idx: number, env: Record<string, string> = {}) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  const p = spawn(process.execPath, [TSX, join(SERVER_DIR, 'test', 'fix', 'proc-child.ts'), mode, String(startAt), String(idx)],
    { env: { ...process.env, DB_PATH: fdb.path, NODE_ENV: 'test', LOG_LEVEL: 'silent', OTP_MAX_ATTEMPTS: '1000', ...env }, cwd: SERVER_DIR });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});
const result = (r: { code: number | null; out: string; err: string }) => { expect(r.code, r.err).toBe(0); return JSON.parse(r.out.trim().split('\n').pop()!) as { errors: number; ok: number }; };
const both = async (mode: string, env: Record<string, string> = {}) => {
  const startAt = Date.now() + 4000;
  return Promise.all([child(mode, startAt, 1, env), child(mode, startAt, 2, env)]).then((rs) => rs.map(result));
};

describe('due processi', () => {
  it('OTP: i fallimenti globali per email e i tentativi sul codice sono contati esattamente (30 + 30), il cooldown scatta', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    createOtp('v@x.it');
    const [a, b] = await both('otp');
    expect(a!.errors + b!.errors).toBe(0);
    expect(one<{ fails: number; locked_until: number }>('SELECT fails, locked_until FROM otp_guard WHERE email_hash=?', emailKey('v@x.it'))!.fails).toBe(30);
    expect(one<{ attempts: number }>('SELECT attempts FROM otp_codes')!.attempts).toBe(30);
    expect(one<{ locked_until: number }>('SELECT locked_until FROM otp_guard')!.locked_until).toBeGreaterThan(0);
  }, 60_000);

  it('catena fiscale: 40 emissioni concorrenti dallo stesso tenant = n da 1 a 40 senza buchi né duplicati, catena valida', async () => {
    run("INSERT INTO tenants(id, created_at) VALUES ('t1', 1)");
    // i documenti devono esistere perche' la verifica li confronti
    for (const p of [1, 2]) for (let i = 0; i < 20; i++) {
      run(`INSERT INTO documents(tenant_id, id, type, status, number, inv_year, inv_sectional, inv_seq, locked_at, created_at, updated_at, data)
           VALUES ('t1', ?, 'fattura', 'emessa', ?, 2026, 'FT', ?, 5000, 1, 1, '{}')`, `p${p}-d${i}`, `${i}/2026`, p * 100 + i + 1);
    }
    const [a, b] = await both('chain');
    expect(a!.errors + b!.errors).toBe(0);
    const rows = all<{ n: number }>('SELECT n FROM fiscal_chain WHERE tenant_id=? ORDER BY n', 't1');
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(verifyChain(getDb())).toMatchObject({ errors: [], rows: 40 });
  }, 60_000);

  it('potatura audit: due processi insieme aggregano ogni voce una volta sola (nessun doppio conteggio) e non ne perdono', async () => {
    run("INSERT INTO tenants(id, created_at) VALUES ('t1', 1)");
    const ins = getDb().prepare("INSERT INTO audit_log(tenant_id, at, action, entity, entity_id, retain, recorded_at) VALUES ('t1', 1000, 'auth.login', 'device', ?, 0, 1000)");
    run('BEGIN'); for (let i = 0; i < 3000; i++) ins.run(`d${i}`); run('COMMIT');
    const [a, b] = await both('prune', { AUDIT_RETENTION_DAYS: '30' });
    expect(a!.errors + b!.errors).toBe(0);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')!.n).toBe(0);
    expect(one<{ n: number }>("SELECT SUM(n) AS n FROM audit_daily WHERE tenant_id='t1'")!.n).toBe(3000);
    expect(one('SELECT 1 AS x FROM audit_prune_ctl')).toBeUndefined();
  }, 60_000);
});
