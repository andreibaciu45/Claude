// Seconda revisione indipendente del server (docs/CODE-REVIEW-SERVER-2.md): regressioni dei difetti confermati.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, catalogItem, docOp, freshEnv, invoice, login, opId, push, quote, sent } from '../core/helpers';
import { all, getDb, one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { setEntitlement } from '../../src/db/entitlements';
import { housekeeping } from '../../src/db/housekeeping';
import { checkIntegrity } from '../../src/ops/integrity';
import { rlHash } from '../../src/auth/crypto';
import { mailboxKey } from '../../src/auth/service';
import { cli } from '../ops/helpers';
import type { SyncOp } from '../../../shared/api';

const PROXY = '172.18.0.2';
const reqOtp = (email: string, ip: string) => call('POST', '/v1/auth/request', { body: { email }, ip, peer: PROXY });
const ver = (email: string, code: string, ip: string) => call('POST', '/v1/auth/verify', { body: { email, code, deviceId: 'd1' }, ip, peer: PROXY });
beforeEach(() => { freshEnv(); delete process.env.AUDIT_MAX_FISCAL_PER_DOC; });
afterEach(() => setClock(null));

async function pro(email = 'a@x.it') { const a = await login(email); setEntitlement(a.tenantId, { plan: 'pro' }); return a; }
const auditOp = (docId: string, action: string, id: string): SyncOp =>
  ({ opId: opId(), entity: 'audit', entityId: id, op: 'upsert', clientTs: 1, payload: { id, at: 1, docId, action, actor: 'user' } }) as SyncOp;

describe('OTP: richieste di codice', () => {
  it('il proprietario su una rete nota riceve il codice anche se un attacco distribuito ha esaurito il tetto per email', async () => {
    await reqOtp('v@x.it', '9.9.9.9');
    expect((await ver('v@x.it', sent[0].code, '9.9.9.9')).status).toBe(200);
    for (let i = 0; i < 10; i++) await reqOtp('v@x.it', `20.0.0.${i}`);
    expect((await reqOtp('v@x.it', `30.0.0.1`)).status).toBe(429); // rete nuova: il tetto vale ancora
    expect((await reqOtp('v@x.it', '9.9.9.9')).status).toBe(204);  // rete nota: esente
  });

  it('alias della stessa casella (+tag, punti gmail, googlemail, punto finale, Unicode) condividono il tetto per email', async () => {
    let ok = 0;
    const aliases = ['v@gmail.com', 'v+1@gmail.com', 'V.@gmail.com', 'v@googlemail.com', 'v@gmail.com.', 'ｖ@gmail.com', 'v+x@GMAIL.com', 'v+y@gmail.com', 'v+z@gmail.com', 'v+a@gmail.com', 'v+b@gmail.com', 'v+c@gmail.com'];
    for (let i = 0; i < aliases.length; i++) if ((await reqOtp(aliases[i], `40.0.${i}.1`)).status === 204) ok++;
    expect(ok).toBe(10);
    expect(mailboxKey('A.B+tag@Googlemail.com.')).toBe('ab@gmail.com');
    expect(mailboxKey('a.b@example.com')).toBe('a.b@example.com'); // i punti contano fuori da gmail
  });

  it('otp-unlock toglie anche il tetto di richieste per email', async () => {
    for (let i = 0; i < 10; i++) await reqOtp('w@x.it', `50.0.0.${i}`);
    expect((await reqOtp('w@x.it', '51.0.0.1')).status).toBe(429);
    const r = await cli(['otp-unlock', 'w@x.it']);
    expect(r.code).toBe(0);
    expect((await reqOtp('w@x.it', '51.0.0.2')).status).toBe(204);
  });

  it('le chiavi dei limiti persistiti non sono SHA-256 semplici di email/IP (invertibili con un dizionario)', async () => {
    const { createHash } = await import('node:crypto');
    await reqOtp('priv@x.it', '8.8.8.8');
    const keys = all<{ key: string }>('SELECT key FROM rate_limits').map((r) => r.key);
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) { const h = k.split(':').pop()!; expect([sha('priv@x.it'), sha('8.8.8.8')]).not.toContain(h); }
    expect(keys.some((k) => k.endsWith(rlHash('8.8.8.8')))).toBe(true);
  });
});

describe('audit: classe fiscale indipendente dall\'ordine delle operazioni', () => {
  it('una voce del client arrivata PRIMA della fattura viene promossa a fiscale all\'emissione', async () => {
    const a = await pro();
    await push(a.token, [auditOp('f1', 'issue', 'au-1'), auditOp('f1', 'voice_command', 'au-2'), docOp(invoice('f1', 1))]);
    const cls = (ref: string) => one<{ retain: number }>('SELECT retain FROM audit_log WHERE ref_id=?', ref)!.retain;
    expect(cls('au-1')).toBe(1);
    expect(cls('au-2')).toBe(0); // la trascrizione vocale non diventa mai fiscale
  });

  it('voice_command su una fattura GIA\' emessa resta non fiscale (coerente con migrazione 6 e documentazione)', async () => {
    const a = await pro();
    await push(a.token, [docOp(invoice('f1', 1))]);
    await push(a.token, [auditOp('f1', 'voice_command', 'au-3')]);
    expect(one<{ retain: number }>('SELECT retain FROM audit_log WHERE ref_id=?', 'au-3')!.retain).toBe(0);
  });

  it('la promozione rispetta il tetto per documento e il trigger vieta ogni altra UPDATE', async () => {
    process.env.AUDIT_MAX_FISCAL_PER_DOC = '3';
    const a = await pro();
    await push(a.token, [1, 2, 3, 4, 5].map((i) => auditOp('f1', 'edit', `au-p${i}`)).concat([docOp(invoice('f1', 1))]));
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id='f1' AND retain=1")!.n).toBe(3);
    const db = getDb();
    expect(() => db.exec("UPDATE audit_log SET payload='x' WHERE ref_id='au-p1'")).toThrow(/append-only/);
    expect(() => db.exec("UPDATE audit_log SET retain=0 WHERE retain=1")).toThrow(/append-only/);
    expect(() => db.exec("UPDATE audit_log SET retain=1, action='x' WHERE retain=0")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM audit_log WHERE retain=1")).toThrow(/append-only/);
  });
});

describe('sync: resync_required solo per voci davvero esistite', () => {
  const T = 1_800_000_000_000;
  it('un elemento NUOVO creato da un dispositivo con l\'orologio indietro non riceve resync_required; un tombstone purgato sì', async () => {
    setClock(() => T);
    const a = await pro();
    housekeeping(); // alza il confine a T - 180 giorni
    const old = T - 400 * 86_400_000;
    const r = await push(a.token, [docOp(quote('nuovo', { updatedAt: old })), { opId: opId(), entity: 'catalog', entityId: 'cat-nuovo', op: 'upsert', clientTs: old, payload: catalogItem('cat-nuovo', { updatedAt: old }) } as SyncOp]);
    expect(r.json.conflicts).toEqual([]);
    // voce cancellata e tombstone purgato: la upsert vecchia resta respinta
    await push(a.token, [{ opId: opId(), entity: 'document', entityId: 'del', op: 'delete', clientTs: T - 100 * 86_400_000 } as SyncOp]);
    setClock(() => T + 200 * 86_400_000); housekeeping();
    setClock(() => T); // il confine e' solo crescente
    expect(one("SELECT 1 AS x FROM documents WHERE id='del'")).toBeUndefined();
    const b = await login('a@x.it', 'dev-2'); // la pulizia ha eliminato la vecchia sessione
    const r2 = await push(b.token, [docOp(quote('del', { updatedAt: T - 350 * 86_400_000 }))]);
    expect(r2.json.conflicts[0]?.reason).toBe('resync_required');
  });
});

describe('prestazioni: indici sui tombstone e potatura audit', () => {
  const plan = (sql: string, ...p: any[]) => JSON.stringify(getDb().prepare('EXPLAIN QUERY PLAN ' + sql).all(...p));
  it('il tetto MAX_TOMBSTONES e la potatura oraria usano indici parziali', () => {
    expect(plan('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND deleted_at IS NOT NULL', 't')).toContain('idx_documents_tombstones');
    expect(plan('SELECT COUNT(*) AS n FROM catalog_items WHERE tenant_id=? AND deleted_at IS NOT NULL', 't')).toContain('idx_catalog_tombstones');
    expect(plan('SELECT rowid FROM documents WHERE deleted_at IS NOT NULL AND locked_at IS NULL AND deleted_at < ? LIMIT 5', 1)).toContain('idx_documents_tombstones');
  });
  it('la potatura per età non scandisce tutta la tabella audit', () => {
    expect(plan('SELECT MAX(id) AS m FROM (SELECT id FROM audit_log WHERE retain=0 AND recorded_at < ? ORDER BY recorded_at LIMIT 2000)', 1)).toContain('idx_audit_prunable_at');
  });
});

describe('integrity-check: tabelle e trigger manomessi', () => {
  it('trigger ricreato con corpo neutralizzato e tabella della catena eliminata sono ERRORI', async () => {
    const a = await pro();
    await push(a.token, [docOp(invoice('f1', 1))]);
    expect(checkIntegrity(getDb(), { encryptionSample: 0 }).errors).toEqual([]);
    const db = getDb();
    db.exec('DROP TRIGGER trg_fiscal_chain_no_delete');
    db.exec("CREATE TRIGGER trg_fiscal_chain_no_delete BEFORE DELETE ON fiscal_chain WHEN 0 BEGIN SELECT RAISE(ABORT, 'x'); END");
    expect(checkIntegrity(db, { encryptionSample: 0 }).errors.join('\n')).toMatch(/trigger MODIFICATO.*trg_fiscal_chain_no_delete/);
    db.exec('DROP TRIGGER trg_fiscal_chain_no_delete');
    db.exec('DROP TRIGGER trg_fiscal_chain_no_update');
    db.exec('DROP TABLE fiscal_chain');
    expect(checkIntegrity(db, { encryptionSample: 0 }).errors.join('\n')).toMatch(/tabella mancante: fiscal_chain/);
  });
});
