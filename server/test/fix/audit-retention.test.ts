// Audit: retention per classe (fiscale conservata / non fiscale aggregata e potata), tetto per tenant, trigger append-only intatti.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { call, docOp, freshEnv, invoice, login, opId, push, quote } from '../core/helpers';
import { all, one, run, getDb } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { setEntitlement } from '../../src/db/entitlements';
import { audit, pruneAudit } from '../../src/db/audit';
import { housekeeping } from '../../src/db/housekeeping';
import { runMigrations } from '../../src/db/migrations';
import { buildExport } from '../../src/account/service';
import type { SyncOp } from '../../../shared/api';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const KEYS = ['AUDIT_RETENTION_DAYS', 'AUDIT_MAX_ROWS_PER_TENANT', 'AUDIT_MAX_FISCAL_PER_DOC', 'RL_AUDIT_PER_DAY'];
beforeEach(() => { freshEnv(); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) delete process.env[k]; setClock(null); });

let n = 0;
const auditOp = (docId: string, action: string, over: Record<string, unknown> = {}): SyncOp => {
  const id = `au-${++n}-${Math.random().toString(16).slice(2)}`;
  return { opId: opId(), entity: 'audit', entityId: id, op: 'upsert', clientTs: 1000, payload: { id, at: T0, docId, action, actor: 'user', ...over } } as SyncOp;
};
async function setup() {
  const a = await login('a@x.it');
  setEntitlement(a.tenantId, { plan: 'pro' });
  return a;
}
const cls = (tenantId: string, action: string) => all<{ retain: number }>('SELECT retain FROM audit_log WHERE tenant_id=? AND action=? ORDER BY id', tenantId, action).map((r) => r.retain);

describe('classificazione fiscale / non fiscale', () => {
  it('voice_command e bozze = non fiscali; voci su una fattura EMESSA, sdi e consensi = fiscali', async () => {
    const a = await setup();
    const r = await push(a.token, [
      docOp(quote('bozza-1')),
      docOp(invoice('f1', 1)),
      auditOp('bozza-1', 'voice_command', { voiceTranscript: 'crea preventivo' }),
      auditOp('f1', 'issue'),
      auditOp('non-esiste', 'issue'), // il client dichiara «issue» per un documento che il server non conosce come emesso
    ]);
    expect(r.json.conflicts).toEqual([]);
    expect(cls(a.tenantId, 'client.voice_command')).toEqual([0]);
    expect(cls(a.tenantId, 'client.issue')).toEqual([1, 0]);
    const sync = all<{ entity_id: string; retain: number }>("SELECT entity_id, retain FROM audit_log WHERE action='sync.document.upsert' ORDER BY id");
    expect(sync).toEqual([{ entity_id: 'bozza-1', retain: 0 }, { entity_id: 'f1', retain: 1 }]);
    expect(cls(a.tenantId, 'auth.signup')).toEqual([0]);
  });

  it('tetto di voci fiscali per documento: oltre, diventano potabili (nessun modo di riempire il disco con voci intoccabili)', async () => {
    process.env.AUDIT_MAX_FISCAL_PER_DOC = '4';
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1))]);
    for (let i = 0; i < 4; i++) await push(a.token, [auditOp('f1', `edit${i}`)]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id='f1' AND retain=1")!.n).toBe(4);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id='f1' AND retain=0")!.n).toBeGreaterThan(0);
  });
});

describe('potatura', () => {
  it('dopo AUDIT_RETENTION_DAYS le non fiscali sono aggregate in audit_daily e cancellate; le fiscali restano; la manutenzione la esegue', async () => {
    process.env.AUDIT_RETENTION_DAYS = '100';
    let t = T0; setClock(() => t);
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1)), docOp(quote('b1')), auditOp('b1', 'voice_command'), auditOp('b1', 'voice_command'), auditOp('f1', 'issue')]);
    const fiscalBefore = all("SELECT id FROM audit_log WHERE retain=1");
    const nonFiscal = one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log WHERE retain=0')!.n;
    expect(nonFiscal).toBeGreaterThanOrEqual(5);
    t += 99 * DAY;
    expect(housekeeping().audit_pruned_age).toBe(0); // non ancora
    t += 2 * DAY;
    expect(housekeeping().audit_pruned_age).toBe(nonFiscal);
    expect(all('SELECT id FROM audit_log WHERE retain=1')).toEqual(fiscalBefore);
    expect(one('SELECT 1 AS x FROM audit_log WHERE retain=0')).toBeUndefined();
    const agg = all<{ action: string; n: number }>('SELECT action, SUM(n) AS n FROM audit_daily WHERE tenant_id=? GROUP BY action ORDER BY action', a.tenantId);
    expect(agg.find((x) => x.action === 'client.voice_command')!.n).toBe(2);
    expect(agg.reduce((s, x) => s + x.n, 0)).toBe(nonFiscal); // nessuna voce persa nel conteggio
    expect(one('SELECT 1 AS x FROM audit_prune_ctl')).toBeUndefined(); // il permesso di cancellare non resta aperto
    expect(pruneAudit()).toEqual({ byAge: 0, byCap: 0, aggregated: 0 }); // idempotente
  });

  it('la data della voce dichiarata dal client non fa fede: contano l\'orologio del server (nessuna voce «già vecchia» potata subito, nessuna «dal futuro» immortale)', async () => {
    process.env.AUDIT_RETENTION_DAYS = '30';
    const t = T0; setClock(() => t);
    const a = await setup();
    await push(a.token, [auditOp('x', 'voice_command', { at: 1000 }), auditOp('x', 'voice_command', { at: T0 + 900 * DAY })]);
    expect(pruneAudit().byAge).toBe(0);
    setClock(() => T0 + 31 * DAY);
    expect(cls(a.tenantId, 'client.voice_command')).toEqual([0, 0]);
    expect(pruneAudit().byAge).toBeGreaterThanOrEqual(2);
    expect(cls(a.tenantId, 'client.voice_command')).toEqual([]);
  });

  it('tetto per tenant: oltre AUDIT_MAX_ROWS_PER_TENANT le non fiscali più vecchie vengono potate (anche se recenti), le fiscali mai', async () => {
    process.env.AUDIT_MAX_ROWS_PER_TENANT = '10';
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1))]);
    for (let i = 0; i < 40; i++) audit(a.tenantId, null, 'auth.login', 'device', `d${i}`);
    const fiscal = all('SELECT id FROM audit_log WHERE retain=1');
    const r = pruneAudit();
    expect(r.byCap).toBeGreaterThanOrEqual(30);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id=? AND retain=0', a.tenantId)!.n).toBe(10);
    expect(all('SELECT id FROM audit_log WHERE retain=1')).toEqual(fiscal);
    // restano i PIU' RECENTI
    expect(all<{ entity_id: string }>("SELECT entity_id FROM audit_log WHERE action='auth.login' ORDER BY id").map((x) => x.entity_id).at(-1)).toBe('d39');
    // un tenant sotto il tetto non è toccato dal tetto di un altro
    const b = await login('b@x.it');
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id=?', b.tenantId)!.n).toBeGreaterThan(0);
  });

  it('i tenant restano isolati: la potatura per età conta per tenant', async () => {
    process.env.AUDIT_RETENTION_DAYS = '10';
    let t = T0; setClock(() => t);
    const a = await login('a@x.it'); const b = await login('b@x.it');
    t += 11 * DAY;
    pruneAudit();
    const rows = all<{ tenant_id: string; n: number }>('SELECT tenant_id, SUM(n) AS n FROM audit_daily GROUP BY tenant_id');
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([a.tenantId, b.tenantId].sort());
  });
});

describe('append-only: i trigger reggono', () => {
  it('UPDATE sempre vietato; DELETE vietato senza potatura autorizzata; le fiscali non si cancellano nemmeno con il permesso aperto', async () => {
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1)), docOp(quote('b1'))]);
    expect(() => run("UPDATE audit_log SET action='x'")).toThrow(/append-only/);
    expect(() => run('UPDATE audit_log SET retain=0')).toThrow(/append-only/); // non si «declassa» una voce fiscale
    expect(() => run('DELETE FROM audit_log')).toThrow(/append-only/);
    expect(() => run('DELETE FROM audit_log WHERE retain=0')).toThrow(/append-only/); // serve la potatura
    expect(() => run('INSERT OR REPLACE INTO audit_log(id, tenant_id, at, action) SELECT id, tenant_id, at, action FROM audit_log WHERE retain=1 LIMIT 1')).toThrow(/append-only/);
    run('INSERT INTO audit_prune_ctl(id, cutoff_at) VALUES (1, 9999999999999)'); // permesso aperto «da fuori»...
    expect(() => run('DELETE FROM audit_log WHERE retain=1')).toThrow(/append-only/); // ...non basta per le fiscali
    run('DELETE FROM audit_prune_ctl');
    expect(() => run('DELETE FROM audit_log WHERE retain=0')).toThrow(/append-only/); // chiuso di nuovo
  });

  it('se la potatura fallisce a metà, il permesso sparisce con la transazione e nulla è cancellato', async () => {
    process.env.AUDIT_RETENTION_DAYS = '1';
    const a = await login('a@x.it');
    setClock(() => T0 + 400 * DAY);
    const before = one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')!.n;
    run('DROP TABLE audit_daily'); // l'aggregazione fallisce
    expect(() => pruneAudit()).toThrow();
    expect(one('SELECT 1 AS x FROM audit_prune_ctl')).toBeUndefined();
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')!.n).toBe(before);
    expect(a.tenantId).toBeTruthy();
  });

  it('export GDPR e conservazione dopo cancellazione account non cambiano per le voci fiscali', async () => {
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1))]);
    const ex = buildExport(a.tenantId, one<{ id: string }>('SELECT id FROM users')!.id);
    expect(ex.auditLog.length).toBeGreaterThan(0);
  });
});

describe('migrazione 6: classificazione delle voci già presenti', () => {
  it('DB alla versione 5: le voci esistenti ricevono classe e recorded_at, i trigger sono ricreati', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 5);
    db.exec(`INSERT INTO tenants(id, created_at) VALUES ('t1', 1)`);
    db.exec(`INSERT INTO documents(tenant_id, id, type, status, number, inv_year, inv_sectional, inv_seq, locked_at, created_at, updated_at, data)
             VALUES ('t1','f1','fattura','emessa','1/2026',2026,'FT',1,5000,1,1,'{}'), ('t1','b1','fattura','bozza',NULL,NULL,NULL,NULL,NULL,1,1,'{}')`);
    const ins = db.prepare('INSERT INTO audit_log(tenant_id, at, action, entity, entity_id) VALUES (?,?,?,?,?)');
    ins.run('t1', 111, 'auth.login', 'device', 'd');
    ins.run('t1', 222, 'sync.document.upsert', 'document', 'f1');
    ins.run('t1', 333, 'sync.document.upsert', 'document', 'b1');
    ins.run('t1', 444, 'client.voice_command', 'audit', 'f1');
    ins.run('t1', 555, 'sdi_event', 'document', 'f1');
    ins.run('t1', 666, 'legal.accept', 'legal', null as unknown as string);
    runMigrations(db);
    const rows = db.prepare('SELECT action, entity_id, retain, recorded_at, at FROM audit_log ORDER BY id').all() as { action: string; retain: number; recorded_at: number; at: number }[];
    expect(rows.map((r) => r.retain)).toEqual([0, 1, 0, 0, 1, 1]);
    expect(rows.every((r) => r.recorded_at === r.at)).toBe(true);
    expect(() => db.exec('UPDATE audit_log SET action=1')).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM audit_log')).toThrow(/append-only/);
    db.close();
  });
});
