// End-to-end del SERVER in-process (nessuna rete esterna): OTP -> sessione -> sync da due dispositivi -> fattura scartata e corretta
// -> quota Free -> licenza Pro concessa dalla CLI (processo figlio sullo stesso DB) -> export -> cancellazione account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, call, catalogItem, cliProc, cliProcAsync, docOp, invoice, opId, push, quote, sent, useFileDb, freshEnv, type FileDb } from './helpers';
import { all, one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { resetMetrics } from '../../src/ops/metrics';
import { setClock } from '../../src/db/clock';

const TOKEN = 'metrics-token-0123456789abcdef';
const EMAIL = 'mario.rossi@example.test';
let fdb: FileDb;
const ENV_KEYS = ['APP_ENCRYPTION_KEY', 'REQUIRE_TERMS', 'METRICS_TOKEN', 'TERMS_CURRENT_VERSION', 'RL_OTP_REQUEST_IP_HOUR', 'RL_OTP_VERIFY_IP_10MIN'];

beforeAll(() => {
  freshEnv();
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.REQUIRE_TERMS = '1';
  process.env.METRICS_TOKEN = TOKEN;
  process.env.RL_OTP_REQUEST_IP_HOUR = '100000'; process.env.RL_OTP_VERIFY_IP_10MIN = '100000'; // il peer di test non ha IP: tutti condividono la stessa chiave
  resetMetrics();
  fdb = useFileDb();
});
afterAll(() => { fdb.cleanup(); for (const k of ENV_KEYS) delete process.env[k]; });

const pull = (token: string, cursor = '0') => call('GET', `/v1/sync/pull?cursor=${cursor}`, { token });
async function loginDevice(deviceId: string, withTerms: boolean) {
  await call('POST', '/v1/auth/request', { body: { email: EMAIL } });
  const code = [...sent].reverse().find((m) => m.email === EMAIL)!.code;
  return call('POST', '/v1/auth/verify', { body: { email: EMAIL, code, deviceId, deviceName: deviceId, ...(withTerms ? { acceptedTerms: { termsVersion: '1.0', dpaVersion: '1.0' } } : {}) } });
}

describe('percorso completo di un cliente', () => {
  let A: { token: string; tenantId: string }, B: { token: string };
  const state: Record<string, any> = {};

  it('1. registrazione con OTP e accettazione dei Termini; secondo dispositivo', async () => {
    const noTerms = await loginDevice('telefono', false);
    expect(noTerms.status).toBe(400);
    expect(noTerms.json.error.code).toBe('terms_required');
    const a = await loginDevice('telefono', true);
    expect(a.status).toBe(200);
    A = a.json;
    const b = await loginDevice('tablet', false); // gia' registrato: niente Termini
    expect(b.status).toBe(200);
    B = b.json;
    const me = await call('GET', '/v1/me', { token: A.token });
    expect(me.json).toMatchObject({ email: EMAIL, plan: 'free', quota: { docsThisMonth: 0, docsLimit: 3 } });
    expect(all('SELECT kind FROM legal_acceptances ORDER BY id').map((r: any) => r.kind)).toEqual(['terms', 'dpa']);
  });

  it('2. push di profilo, catalogo, preventivo e fattura emessa; 3. pull dal secondo dispositivo (dati cifrati a riposo)', async () => {
    const profile = { businessName: 'Rossi Idraulica', vatNumber: '01234567890', iban: 'IT60X0542811101000000123456', address: 'Via Roma 1', zip: '00100', city: 'Roma', province: 'RM' };
    const f1: any = invoice('f1', 1, { customer: { id: 'c1', name: 'Bianchi Srl', vatNumber: '09876543210' }, notes: 'Pagamento a 30 giorni' });
    f1.invoice.xml = '<FatturaElettronica>Bianchi Srl</FatturaElettronica>'; f1.invoice.xmlHistory = [];
    const r = await push(A.token, [
      { opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: profile, clientTs: 100 },
      { opId: opId(), entity: 'catalog', entityId: 'c1', op: 'upsert', payload: catalogItem('c1'), clientTs: 100 },
      docOp(quote('q1')), docOp(f1),
    ] as any, 'telefono');
    expect(r.json.conflicts).toEqual([]);
    expect(r.json.accepted).toHaveLength(4);
    state.cursor = r.json.cursor;

    const p = await pull(B.token);
    expect(p.status).toBe(200);
    const byEntity = Object.fromEntries(p.json.ops.map((o: any) => [`${o.entity}:${o.entityId}`, o.payload]));
    expect(byEntity['profile:profile']).toMatchObject({ businessName: 'Rossi Idraulica', iban: profile.iban });
    expect(byEntity['catalog:c1'].name).toBe('Tubo rame');
    expect(byEntity['document:q1'].customer.name).toBe('Mario Rossi');
    expect(byEntity['document:f1']).toMatchObject({ status: 'emessa', customer: { name: 'Bianchi Srl' }, invoice: { seq: 1, sectional: 'FT' } });
    expect(p.json.cursor).toBe(state.cursor);
    // a riposo: cifrato; in chiaro restano solo gli indici
    const raw = one<any>("SELECT data FROM documents WHERE id='f1'").data + one<any>('SELECT data FROM profiles').data;
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('Bianchi Srl');
    expect(raw).not.toContain('IT60X0542811101000000123456');
  });

  it('4. fattura scartata dallo SDI e corretta: il tablet vede esito e correzione, stesso numero', async () => {
    const f1: any = (await pull(B.token)).json.ops.find((o: any) => o.entityId === 'f1').payload;
    setClock(() => Date.now() + 1000);
    const rejected = { ...f1, status: 'scartata', updatedAt: Date.now(), invoice: { ...f1.invoice, sdiEvents: [{ at: Date.now(), type: 'NS', channel: 'manual', errorCodes: ['00400'] }] } };
    expect((await push(B.token, [docOp(rejected)], 'tablet')).json.conflicts).toEqual([]);
    const seenByA = (await pull(A.token, state.cursor)).json.ops[0].payload;
    expect(seenByA.status).toBe('scartata');
    expect(seenByA.invoice.sdiEvents[0].errorCodes).toEqual(['00400']);

    setClock(() => Date.now() + 2000);
    const fixed = { ...rejected, status: 'emessa', updatedAt: Date.now(), customer: { id: 'c1', name: 'Bianchi S.r.l.', vatNumber: '09876543210' },
      invoice: { ...rejected.invoice, xml: '<FatturaElettronica>Bianchi S.r.l.</FatturaElettronica>', xmlHistory: [f1.invoice.xml] } };
    const ok = await push(A.token, [docOp(fixed)], 'telefono');
    expect(ok.json.conflicts).toEqual([]);
    const got = (await call('GET', '/v1/documents/f1', { token: B.token })).json;
    expect(got.customer.name).toBe('Bianchi S.r.l.');
    expect(got.invoice).toMatchObject({ seq: 1, number: '1/2026', xmlHistory: ['<FatturaElettronica>Bianchi Srl</FatturaElettronica>'] });
    // cambiare il numero invece e' vietato
    const wrong = { ...fixed, updatedAt: Date.now() + 5, invoice: { ...fixed.invoice, seq: 2, number: '2/2026' } };
    expect((await push(A.token, [docOp(wrong)])).json.conflicts[0].reason).toBe('locked_document');
    setClock(null);
  });

  it('5. quota Free: il 4o documento del mese e\' rifiutato', async () => {
    expect((await push(A.token, [docOp(quote('q2', { number: 'P2' }))])).json.conflicts).toEqual([]); // 3o
    const r = await push(A.token, [docOp(quote('q3', { number: 'P3' }))]);
    expect(r.json.conflicts[0].reason).toBe('quota_exceeded');
    expect((await call('GET', '/v1/me', { token: A.token })).json.quota.docsThisMonth).toBe(3);
    state.q3 = docOp(quote('q3', { number: 'P3' }));
  });

  it('6. grant-pro dalla CLI (processo separato sullo stesso DB) sblocca la quota senza riavviare nulla', async () => {
    const g = cliProc(['grant-pro', EMAIL, '--giorni', '30', '--nota', 'e2e'], { DB_PATH: fdb.path });
    expect(g.status).toBe(0);
    expect(g.stdout).toContain('Piano effettivo ora: pro (manuale');
    const me = await call('GET', '/v1/me', { token: A.token });
    expect(me.json).toMatchObject({ plan: 'pro', billingStatus: 'none', quota: { docsLimit: null } });
    expect((await push(A.token, [state.q3])).json.conflicts).toEqual([]);
    // revoca: torna Free (con 4 documenti nel mese non se ne creano altri)
    expect(cliProc(['revoke-pro', EMAIL], { DB_PATH: fdb.path }).status).toBe(0);
    expect((await call('GET', '/v1/me', { token: A.token })).json.plan).toBe('free');
    expect((await push(A.token, [docOp(quote('q4', { number: 'P4' }))])).json.conflicts[0].reason).toBe('quota_exceeded');
    cliProc(['grant-pro', EMAIL, '--giorni', '30'], { DB_PATH: fdb.path });
  });

  it('metriche e stato coerenti con quanto accaduto', async () => {
    const t = await (await app.request('/metrics', { headers: { authorization: `Bearer ${TOKEN}` } })).text();
    expect(t).toContain('vp_sync_conflicts_total{reason="quota_exceeded"} 2');
    expect(t).toContain('vp_sync_conflicts_total{reason="locked_document"} 1');
    expect(t).toMatch(/^vp_signups_total 1$/m);
    expect(t).toMatch(/^vp_manual_grants_active 1$/m);
    expect(t).not.toContain(EMAIL);
    const deep = await call('GET', '/health/deep');
    expect(deep.status).toBe(200);
    const stats = JSON.parse(cliProc(['stats', '--json'], { DB_PATH: fdb.path }).stdout);
    expect(stats.syncConflicts.last7d).toMatchObject({ quota_exceeded: 2, locked_document: 1 });
    expect(stats.plans.proManual).toBe(1);
    expect(cliProc(['integrity-check'], { DB_PATH: fdb.path, APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY! }).status).toBe(0);
  });

  it('7. export GDPR completo; 8. cancellazione: bozze via, fattura emessa conservata, sessioni chiuse', async () => {
    const ex = await call('GET', '/v1/me/export', { token: A.token });
    expect(ex.status).toBe(200);
    expect(ex.json.account.email).toBe(EMAIL);
    expect(ex.json.documents.map((d: any) => d.id).sort()).toEqual(['f1', 'q1', 'q2', 'q3']);
    expect(ex.json.profile.data.iban).toBe('IT60X0542811101000000123456');
    expect(JSON.stringify(ex.json)).not.toContain(A.token);

    expect((await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: 'altra@example.test' } })).json.error.code).toBe('confirmation_mismatch');
    const del = await call('DELETE', '/v1/me', { token: A.token, body: { confirmEmail: EMAIL } });
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ deleted: true, mode: 'anonymized', retainedInvoices: 1 });
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: B.token })).status).toBe(401);
    expect(all('SELECT id FROM documents').map((d: any) => d.id)).toEqual(['f1']);
    expect(one('SELECT 1 AS x FROM users')).toBeUndefined();
    // l'operatore vede il tenant anonimizzato; la traccia amministrativa resta; l'integrita' regge
    const list = JSON.parse(cliProc(['tenants', '--json'], { DB_PATH: fdb.path }).stdout);
    expect(list[0]).toMatchObject({ email: '(cancellato)', stato: 'deleted', fattureEmesse: 1 });
    expect(all("SELECT action FROM admin_actions WHERE action LIKE '%pro'").length).toBeGreaterThanOrEqual(3);
    expect(cliProc(['integrity-check'], { DB_PATH: fdb.path }).status).toBe(0);
    // la stessa email puo' registrarsi di nuovo, con un tenant nuovo
    const again = await loginDevice('nuovo', true);
    expect(again.status).toBe(200);
    expect(again.json.tenantId).not.toBe(A.tenantId);
  });
});

describe('concorrenza con piu\' processi sullo stesso DB', () => {
  it('backup e grant-pro da processi figli MENTRE il server scrive: nessuna scrittura persa, backup valido', async () => {
    const mk = async (email: string) => { await call('POST', '/v1/auth/request', { body: { email, } }); const code = [...sent].reverse().find((m) => m.email === email)!.code; return (await call('POST', '/v1/auth/verify', { body: { email, code, deviceId: 'd', acceptedTerms: { termsVersion: '1', dpaVersion: '1' } } })).json as { token: string; tenantId: string }; };
    const users = await Promise.all(['c1@x.it', 'c2@x.it', 'c3@x.it', 'c4@x.it'].map(mk));
    setEntitlement(users[0]!.tenantId, { plan: 'pro' }); setEntitlement(users[1]!.tenantId, { plan: 'pro' }); // c1/c2 pagano (Stripe); c3/c4 sono Free
    const bk = `${fdb.dir}/concurrent.sqlite`;
    const children = [
      cliProcAsync(['backup', bk], { DB_PATH: fdb.path }),
      cliProcAsync(['grant-pro', 'c1@x.it', '--giorni', '5'], { DB_PATH: fdb.path }),
      cliProcAsync(['grant-pro', 'c2@x.it', '--giorni', '6'], { DB_PATH: fdb.path }),
      cliProcAsync(['stats', '--json'], { DB_PATH: fdb.path }),
    ];
    // finche' i processi figli lavorano (tsx impiega ~1 s ad avviarsi) i 4 tenant continuano a scrivere a ondate: le scritture si sovrappongono davvero
    let running = true;
    const finished = Promise.all(children).then((r) => { running = false; return r; });
    const accepted = [0, 0, 0, 0];
    let non200 = 0, wave = 0;
    while (running) {
      wave++;
      for (const [ti, u] of users.entries()) {
        const r = await push(u.token, Array.from({ length: 5 }, (_, j) => docOp(quote(`w-${ti}-${wave}-${j}`, { number: `W${wave}${j}` }))), 'd');
        if (r.status !== 200) non200++;
        accepted[ti]! += r.json.accepted?.length ?? 0;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    const out = await finished;
    expect(out.map((c) => c.code)).toEqual([0, 0, 0, 0]);
    expect(wave).toBeGreaterThan(5);
    expect(non200).toBe(0); // mai 5xx / SQLITE_BUSY verso i client
    const grants = all("SELECT tenant_id FROM admin_actions WHERE action='grant_pro' ORDER BY id").map((r: any) => r.tenant_id);
    expect(grants).toEqual(expect.arrayContaining([users[0]!.tenantId, users[1]!.tenantId]));
    // il backup preso a caldo e' un DB valido
    const t = cliProc(['restore-test', bk], { DB_PATH: fdb.path });
    expect(t.status, t.stdout + t.stderr).toBe(0);
    // le scritture dei tenant Pro (c1, c2) sono arrivate TUTTE nonostante backup e CLI concorrenti; quelle Free si fermano a 3 (quota)
    const n = (ti: number) => one<any>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=?', users[ti]!.tenantId).n;
    for (const ti of [0, 1]) { expect(n(ti)).toBe(accepted[ti]); expect(n(ti)).toBe(wave * 5); } // nessuna scrittura persa
    expect(n(2)).toBe(3);
    expect(n(3)).toBe(3);
  }, 60_000);

  it('100 richieste parallele di tenant diversi: nessun errore 5xx e dati isolati', async () => {
    const mk = async (i: number) => { const email = `par${i}@x.it`; await call('POST', '/v1/auth/request', { body: { email }, ip: `10.9.${i}.1` }); const code = [...sent].reverse().find((m) => m.email === email)!.code; return (await call('POST', '/v1/auth/verify', { body: { email, code, deviceId: 'd', acceptedTerms: { termsVersion: '1', dpaVersion: '1' } }, ip: `10.9.${i}.1` })).json as { token: string; tenantId: string }; };
    const us = await Promise.all(Array.from({ length: 20 }, (_, i) => mk(i)));
    const res = await Promise.all(us.flatMap((u, i) => Array.from({ length: 5 }, (_, k) => k === 4 ? call('GET', '/v1/me', { token: u.token }) : push(u.token, [docOp(quote(`p${i}-${k}`, { number: `N${k}` }))]))));
    expect(res.every((r) => r.status === 200)).toBe(true);
    for (const u of us) expect(one<any>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=?', u.tenantId).n).toBe(3); // quota Free
  });
});
