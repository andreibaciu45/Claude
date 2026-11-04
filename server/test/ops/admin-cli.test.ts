// CLI amministrativa: export/cancellazione, stats, integrity-check, backup/restore-test, rotate-key, inviti.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { call, cli, cliProc, docOp, freshEnv, invoice, login, push, quote, useFileDb, type FileDb } from './helpers';
import { all, one, run } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';

let fdb: FileDb | null = null;
beforeEach(() => { freshEnv(); });
afterEach(() => { fdb?.cleanup(); fdb = null; delete process.env.APP_ENCRYPTION_KEY; delete process.env.APP_ENCRYPTION_KEY_ID; delete process.env.APP_ENCRYPTION_OLD_KEYS; });

async function seedTenant(email: string, nInvoices = 0) {
  const a = await login(email);
  if (nInvoices) {
    setEntitlement(a.tenantId, { plan: 'pro' });
    await push(a.token, Array.from({ length: nInvoices }, (_, i) => docOp(invoice(`f${i + 1}`, i + 1))));
  }
  return a;
}

describe('help e uso', () => {
  it('senza comando mostra l\'aiuto (64), con help (0); comando e opzioni sconosciuti -> 64', async () => {
    expect((await cli([])).code).toBe(64);
    const h = await cli(['help']);
    expect(h.code).toBe(0);
    for (const c of ['grant-pro', 'revoke-pro', 'export-tenant', 'delete-tenant', 'stats', 'integrity-check', 'backup', 'restore-test', 'rotate-key', 'create-invite-code']) expect(h.out).toContain(c);
    expect((await cli(['boh'])).code).toBe(64);
    expect((await cli(['stats', '--non-esiste'])).code).toBe(64);
  });
  it('DB inesistente: errore chiaro, nessun DB creato per sbaglio', async () => {
    const fdb2 = useFileDb(); fdb = fdb2;
    const r = await cli(['stats', '--db', join(fdb2.dir, 'altro.sqlite')]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Database non trovato');
    expect(existsSync(join(fdb2.dir, 'altro.sqlite'))).toBe(false);
  });
});

describe('tenants', () => {
  it('elenca clienti con piano, ultimo accesso e uso del mese; filtro --cerca', async () => {
    const a = await seedTenant('anna@x.it');
    await seedTenant('bruno@x.it', 2);
    await push(a.token, [docOp(quote('q1'))]);
    const r = await cli(['tenants']);
    expect(r.out).toContain('anna@x.it');
    expect(r.out).toContain('bruno@x.it');
    expect(r.out).toContain('2 clienti (1 Pro)');
    const j = JSON.parse((await cli(['tenants', '--json', '--cerca', 'anna'])).out);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ email: 'anna@x.it', piano: 'free', usoMese: { documenti: 1 }, fattureEmesse: 0 });
    expect(j[0].ultimoAccesso).toBeGreaterThan(0);
  });
});

describe('export-tenant', () => {
  it('scrive il JSON completo con permessi 0600 e lo registra', async () => {
    fdb = useFileDb();
    const a = await seedTenant('anna@x.it', 2);
    const out = join(fdb.dir, 'exp.json');
    const r = await cli(['export-tenant', 'ANNA@x.it', '--out', out]);
    expect(r.code).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    expect(j.account.email).toBe('anna@x.it');
    expect(j.documents).toHaveLength(2);
    expect(one<any>("SELECT tenant_id FROM admin_actions WHERE action='export_tenant'")).toEqual({ tenant_id: a.tenantId });
    expect((await cli(['export-tenant', 'chi@x.it'])).code).toBe(1);
    const std = await cli(['export-tenant', 'anna@x.it', '--out', '-']);
    expect(JSON.parse(std.out).exportVersion).toBe(1);
  });
});

describe('delete-tenant: stesse regole dell\'endpoint DELETE /v1/me', () => {
  it('richiede la conferma dell\'email (flag o interattiva); conferma errata = nessuna modifica', async () => {
    await seedTenant('anna@x.it');
    expect((await cli(['delete-tenant', 'anna@x.it', '--conferma', 'altro@x.it'])).code).toBe(1);
    expect(one('SELECT 1 AS x FROM users WHERE email=?', 'anna@x.it')).toBeTruthy();
    expect((await cli(['delete-tenant', 'anna@x.it'], ['sbagliata'])).code).toBe(1);
    expect(one('SELECT 1 AS x FROM users WHERE email=?', 'anna@x.it')).toBeTruthy();
    const r = await cli(['delete-tenant', 'anna@x.it'], ['Anna@X.it']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('eliminazione completa');
  });

  it('senza fatture emesse: tenant eliminato del tutto; con fatture: anonimizzato e fatture intatte', async () => {
    const plain = await seedTenant('plain@x.it');
    await push(plain.token, [docOp(quote('q1'))]);
    await cli(['delete-tenant', 'plain@x.it', '--conferma', 'plain@x.it']);
    expect(one('SELECT 1 AS x FROM tenants WHERE id=?', plain.tenantId)).toBeUndefined();
    expect(one('SELECT 1 AS x FROM documents WHERE tenant_id=?', plain.tenantId)).toBeUndefined();

    const inv = await seedTenant('fat@x.it', 2);
    await push(inv.token, [docOp(quote('bozza-1', { number: 'B-1' }))]);
    const r = await cli(['delete-tenant', 'fat@x.it', '--conferma', 'fat@x.it']);
    expect(r.out).toContain('anonimizzato, 2 fatture conservate');
    expect(one<any>('SELECT status, name FROM tenants WHERE id=?', inv.tenantId)).toEqual({ status: 'deleted', name: null });
    expect(all('SELECT id FROM documents WHERE tenant_id=? ORDER BY id', inv.tenantId).map((d: any) => d.id)).toEqual(['f1', 'f2']); // bozza eliminata, fatture no
    expect(one('SELECT 1 AS x FROM users WHERE tenant_id=?', inv.tenantId)).toBeUndefined();
    expect((await call('GET', '/v1/me', { token: inv.token })).status).toBe(401); // sessioni rimosse
    expect(one<any>("SELECT note FROM admin_actions WHERE action='delete_tenant' AND tenant_id=?", inv.tenantId).note).toContain('anonymized');
    expect((await cli(['delete-tenant', 'fat@x.it', '--conferma', 'fat@x.it'])).code).toBe(1); // utente non c'e' piu'
  });

  it('abbonamento Stripe attivo: rifiuta senza --ack-subscription', async () => {
    const a = await seedTenant('paga@x.it');
    await new SqliteBillingStore().saveSubscription({ tenantId: a.tenantId, customerId: 'cus_1', status: 'active', updatedAt: Date.now() });
    const r = await cli(['delete-tenant', 'paga@x.it', '--conferma', 'paga@x.it']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('abbonamento Stripe ATTIVO');
    expect(one('SELECT 1 AS x FROM users WHERE email=?', 'paga@x.it')).toBeTruthy();
    const ok = await cli(['delete-tenant', 'paga@x.it', '--conferma', 'paga@x.it', '--ack-subscription']);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('annulla a mano l\'abbonamento');
  });

  it('non interattivo senza --conferma: errore d\'uso', async () => {
    await seedTenant('anna@x.it');
    const { runCli } = await import('../../scripts/admin');
    const err: string[] = [];
    expect(await runCli(['delete-tenant', 'anna@x.it'], { out: () => {}, err: (s) => err.push(s) })).toBe(64);
  });
});

describe('stats', () => {
  it('conta utenti attivi 7/30 giorni, documenti, fatture, conflitti e errori', async () => {
    const a = await seedTenant('anna@x.it', 2);
    await seedTenant('bruno@x.it');
    run('UPDATE users SET last_login_at = ? WHERE email = ?', Date.now() - 20 * 86_400_000, 'bruno@x.it');
    run('UPDATE sessions SET last_seen_at = ? WHERE tenant_id <> ?', Date.now() - 20 * 86_400_000, a.tenantId);
    await push(a.token, [docOp(invoice('dup', 1, { id: 'dup' }))]); // numero gia' usato -> conflitto
    const s = JSON.parse((await cli(['stats', '--json'])).out);
    expect(s.users).toMatchObject({ total: 2, active7d: 1, active30d: 2 });
    expect(s.invoices.issued).toBe(2);
    expect(s.syncConflicts.last7d.duplicate_invoice_number).toBe(1);
    expect(s.plans).toMatchObject({ proStripe: 1, proManual: 0, free: 1 });
    const txt = (await cli(['stats'])).out;
    expect(txt).toContain('attivi 7 giorni 1');
    expect(txt).toContain('duplicate_invoice_number: 1');
  });
});

describe('integrity-check', () => {
  it('DB sano: exit 0; buco nella numerazione: avviso (2); duplicati/trigger mancanti: errore (1)', async () => {
    fdb = useFileDb();
    const a = await seedTenant('anna@x.it', 3);
    let r = await cli(['integrity-check']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('3 fatture emesse in 1 serie');

    await push(a.token, [docOp(invoice('f5', 5)), docOp(invoice('nc1', 1, { id: 'nc1' }))]); // buco: manca 4
    r = await cli(['integrity-check']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/buco nella numerazione.*mancano 4/);
    const j = JSON.parse((await cli(['integrity-check', '--json'])).out);
    expect(j.numbering[0]).toMatchObject({ sectional: 'FT', year: 2026, min: 1, max: 5, count: 4, gaps: [4] });

    // indice univoco rimosso + doppione: errore
    run('DROP INDEX uq_documents_invoice_number');
    run(`INSERT INTO documents(tenant_id,id,type,status,number,inv_year,inv_sectional,inv_seq,locked_at,created_at,updated_at,data)
         SELECT tenant_id,'f1bis',type,status,number,inv_year,inv_sectional,inv_seq,locked_at,created_at,updated_at,data FROM documents WHERE id='f1'`);
    r = await cli(['integrity-check', '--rapido']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('numerazione duplicata');
    expect(r.out).toContain('numero fattura duplicato');

    run('DROP TRIGGER trg_documents_locked_update');
    r = await cli(['integrity-check']);
    expect(r.out).toContain('trigger mancante: trg_documents_locked_update');
  });

  it('indici incoerenti con il contenuto e dati cifrati con chiave sbagliata vengono segnalati', async () => {
    fdb = useFileDb();
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const a = await seedTenant('anna@x.it', 1);
    await push(a.token, [docOp(quote('q1'))]);
    expect((await cli(['integrity-check'])).code).toBe(0);
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64'); // chiave sbagliata
    const bad = await cli(['integrity-check']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('NON leggibili');
    delete process.env.APP_ENCRYPTION_KEY;
    run('DROP TRIGGER trg_documents_locked_update');
    run("UPDATE documents SET inv_seq = 9 WHERE id = 'f1'");
    expect((await cli(['integrity-check'])).out).toContain('indici (seq/anno/sezionale) diversi');
  });
});

describe('backup e restore-test', () => {
  it('backup consistente e verificato; restore-test su copia fresca e su file; produzione intatta', async () => {
    fdb = useFileDb();
    await seedTenant('anna@x.it', 3);
    const dest = join(fdb.dir, 'bk', 'b.sqlite');
    const b = await cli(['backup', dest]);
    expect(b.code).toBe(0);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    const t = await cli(['restore-test']);
    expect(t.code).toBe(0);
    expect(t.out).toContain('ESITO: OK');
    const t2 = await cli(['restore-test', dest]);
    expect(t2.code).toBe(0);
    expect(t2.out).toContain('documenti 3');
    // backup di default nella cartella `backups` accanto al DB
    const def = await cli(['backup']);
    expect(def.code).toBe(0);
    expect(readdirSync(join(fdb.dir, 'backups')).some((f) => f.startsWith('vocepreventivo-'))).toBe(true);
    expect(one<any>('SELECT COUNT(*) AS n FROM documents').n).toBe(3);
  });

  it('restore-test fallisce su un file corrotto o privo dei trigger; legge anche i .gz', async () => {
    fdb = useFileDb();
    await seedTenant('anna@x.it', 1);
    const good = join(fdb.dir, 'g.sqlite');
    await cli(['backup', good]);
    const { gzipSync } = await import('node:zlib');
    const gz = join(fdb.dir, 'g.sqlite.gz');
    writeFileSync(gz, gzipSync(readFileSync(good)));
    expect((await cli(['restore-test', gz])).code).toBe(0);

    const bad = join(fdb.dir, 'bad.sqlite');
    writeFileSync(bad, Buffer.concat([readFileSync(good).subarray(0, 8192), Buffer.alloc(4096, 1)]));
    expect((await cli(['restore-test', bad])).code).toBe(1);

    const notrig = join(fdb.dir, 'nt.sqlite');
    await cli(['backup', notrig]);
    const d = new DatabaseSync(notrig); d.exec('DROP TRIGGER trg_audit_no_delete'); d.close();
    const r = await cli(['restore-test', notrig]);
    expect(r.out).toContain('trigger mancante: trg_audit_no_delete');
    expect(r.code).toBe(1);
    expect((await cli(['restore-test', join(fdb.dir, 'non-esiste')])).code).toBe(1);
  });

  it('da processo figlio (come l\'operatore): stats e backup funzionano sul DB su file', async () => {
    fdb = useFileDb();
    await seedTenant('anna@x.it', 1);
    const s = cliProc(['stats', '--json'], { DB_PATH: fdb.path });
    expect(s.status).toBe(0);
    expect(JSON.parse(s.stdout).invoices.issued).toBe(1);
    const b = cliProc(['backup', join(fdb.dir, 'child.sqlite')], { DB_PATH: fdb.path });
    expect(b.status).toBe(0);
    expect(existsSync(join(fdb.dir, 'child.sqlite'))).toBe(true);
  });
});

describe('rotate-key', () => {
  it('senza chiave: errore; con chiave: backup automatico e ricifratura; --report non modifica', async () => {
    fdb = useFileDb();
    expect((await cli(['rotate-key'])).code).toBe(1);
    const k1 = Buffer.alloc(32, 1).toString('base64'), k2 = Buffer.alloc(32, 2).toString('base64');
    process.env.APP_ENCRYPTION_KEY = k1; process.env.APP_ENCRYPTION_KEY_ID = 'k1';
    const a = await seedTenant('anna@x.it');
    await push(a.token, [docOp(quote('q1'))]);
    expect(one<any>("SELECT data FROM documents WHERE id='q1'").data).toContain('enc:v1:k1:');
    process.env.APP_ENCRYPTION_KEY = k2; process.env.APP_ENCRYPTION_KEY_ID = 'k2'; process.env.APP_ENCRYPTION_OLD_KEYS = `k1:${k1}`;
    const rep = await cli(['rotate-key', '--report']);
    expect(rep.out).toContain('SIMULAZIONE');
    expect(one<any>("SELECT data FROM documents WHERE id='q1'").data).toContain('enc:v1:k1:');
    expect(existsSync(join(fdb.dir, 'backups'))).toBe(false);
    const r = await cli(['rotate-key']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Backup di sicurezza');
    expect(readdirSync(join(fdb.dir, 'backups'))).toHaveLength(1);
    expect(one<any>("SELECT data FROM documents WHERE id='q1'").data).toContain('enc:v1:k2:');
    expect((await call('GET', '/v1/documents/q1', { token: a.token })).json.customer.name).toBe('Mario Rossi'); // ancora leggibile
    expect(one<any>("SELECT COUNT(*) AS n FROM admin_actions WHERE action='rotate_key'").n).toBe(1);
  });
});

describe('inviti', () => {
  it('create-invite-code / invite-codes / revoke-invite', async () => {
    const c = await cli(['create-invite-code', '--quanti', '2', '--nota', 'beta']);
    expect(c.code).toBe(0);
    const codes = c.out.match(/VP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/g)!;
    expect(codes).toHaveLength(2);
    expect(new Set(codes).size).toBe(2);
    expect(c.out).toContain('INVITE_ONLY=1 non e\' impostato');
    expect(JSON.stringify(all('SELECT * FROM invite_codes'))).not.toContain(codes[0]!.replace(/-/g, '')); // solo hash
    expect((await cli(['invite-codes'])).out).toContain('disponibile');
    expect((await cli(['revoke-invite', codes[0]!.toLowerCase()])).code).toBe(0);
    expect((await cli(['revoke-invite', codes[0]!])).code).toBe(1);
    expect((await cli(['create-invite-code', '--quanti', '2', '--email', 'a@b.it'])).code).toBe(64);
  });
});
