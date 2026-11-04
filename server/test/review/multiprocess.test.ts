// Concorrenza reale tra PROCESSI sullo stesso file SQLite (WAL, busy_timeout): stesse operazioni di sync inviate da due processi (retry/doppia consegna).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { docOp, freshEnv, login, quote } from '../core/helpers';
import { SERVER_DIR, TSX, useFileDb, type FileDb } from '../ops/helpers';

let fdb: FileDb;
beforeEach(() => { fdb = useFileDb(); freshEnv(); });
afterEach(() => fdb.cleanup());

const child = (opsFile: string, startAt: number) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  const p = spawn(process.execPath, [TSX, join(SERVER_DIR, 'test', 'review', 'push-child.ts'), opsFile, String(startAt)],
    { env: { ...process.env, DB_PATH: fdb.path, NODE_ENV: 'test', LOG_LEVEL: 'silent', RL_SYNC_OPS_HOUR: '1000000' }, cwd: SERVER_DIR });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});

describe('sync con due processi', () => {
  it('lo stesso opId consegnato a due processi insieme è applicato una volta sola e confermato a entrambi (nessun 500 sulla PK di sync_ops)', async () => {
    await login('a@x.it');
    const u = one<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM users')!;
    setEntitlement(u.tenant_id, { plan: 'pro' });
    const N = 60;
    const ops = Array.from({ length: N }, (_, i) => docOp(quote(`q${i}`)));
    const file = join(fdb.dir, 'ops.json');
    writeFileSync(file, JSON.stringify({ ctx: { tenantId: u.tenant_id, userId: u.id, deviceId: 'dev-1' }, ops }));
    const startAt = Date.now() + 4000; // il caricamento di tsx richiede un po'
    const [a, b] = await Promise.all([child(file, startAt), child(file, startAt)]);
    expect(a.code, a.err).toBe(0);
    expect(b.code, b.err).toBe(0);
    const ra = JSON.parse(a.out.trim().split('\n').pop()!), rb = JSON.parse(b.out.trim().split('\n').pop()!);
    expect(ra.errors + rb.errors).toBe(0);
    expect(ra.accepted).toBe(N);
    expect(rb.accepted).toBe(N);
    expect(all('SELECT 1 FROM sync_ops WHERE tenant_id=?', u.tenant_id)).toHaveLength(N);
    expect(one<{ n: number }>('SELECT docs_created AS n FROM usage WHERE tenant_id=?', u.tenant_id)!.n).toBe(N); // quota contata una volta
    expect(all("SELECT 1 FROM changes WHERE entity='document'")).toHaveLength(N);
  }, 60_000);
});
