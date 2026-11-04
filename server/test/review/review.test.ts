// Regressioni della revisione indipendente del server (docs/CODE-REVIEW-SERVER.md). Ogni test fallisce sul codice precedente alla correzione.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authHolder, createRateLimiter, type Clock } from '../../src/billing/common';
import { call, docOp, freshEnv, invoice, login, opId, push, quote } from '../core/helpers';
import { all, getDb, one, openDb, run, transaction } from '../../src/db';
import { runMigrations } from '../../src/db/migrations';
import { setEntitlement, getPlan } from '../../src/db/entitlements';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';
import { processStripeEvent } from '../../src/billing/webhook';
import { InMemoryJobStore } from '../../src/sdi/jobs';
import { SqliteDocumentSink, SqliteJobStore } from '../../src/sdi/sqlite';
import { HttpSdiProvider } from '../../src/sdi/http-provider';
import { InMemorySdiStore } from '../../src/sdi/types';
import { createSdiRoutes, type SdiDeps } from '../../src/sdi/routes';
import { createVoiceRoutes, inMemoryVoiceUsage, type VoiceDeps } from '../../src/voice/routes';
import { MockIntentLlm } from '../../src/voice/interpret';
import type { SttProvider } from '../../src/voice/stt';
import { encryptionConfigProblem } from '../../src/db/seal-check';
import { getKeyRing } from '../../src/db/seal';
import { AUTH, fakeAuth, fakeClock } from '../extra/helpers';

const KEY = Buffer.alloc(32, 9).toString('base64');
const KEY2 = Buffer.alloc(32, 5).toString('base64');
const ENV_KEYS = ['APP_ENCRYPTION_KEY', 'APP_ENCRYPTION_KEY_ID', 'APP_ENCRYPTION_OLD_KEYS', 'RL_AUDIT_PER_DAY', 'SDI_JOB_STALE_MS'];
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => { savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); freshEnv(); });
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

const pro = (tenantId: string) => setEntitlement(tenantId, { plan: 'pro' });
const tenantOf = (email: string) => one<{ tenant_id: string }>('SELECT tenant_id FROM users WHERE email=?', email)!.tenant_id;

describe('db: transazioni e apertura', () => {
  it('un COMMIT che fallisce (FK differita) non lascia il contatore di annidamento negativo: la transazione successiva funziona', () => {
    expect(() => transaction(() => {
      run('PRAGMA defer_foreign_keys = ON');
      run("INSERT INTO users(id, email, tenant_id, created_at) VALUES ('u1', 'a@b.it', 'tenant-che-non-esiste', 1)");
    })).toThrow(/FOREIGN KEY/);
    // Prima della correzione: depth = -1 => "SAVEPOINT sp-1" (sintassi non valida) per ogni transazione, fino al riavvio del processo.
    expect(transaction(() => { run("INSERT INTO tenants(id, created_at) VALUES ('t1', 1)"); return 7; })).toBe(7);
    expect(one('SELECT 1 AS x FROM tenants WHERE id=?', 't1')).toBeTruthy();
    expect(one('SELECT 1 AS x FROM users WHERE id=?', 'u1')).toBeUndefined();
  });

  it('una transazione annidata con RELEASE fallito non corrompe lo stato', () => {
    transaction(() => {
      run("INSERT INTO tenants(id, created_at) VALUES ('t1', 1)");
      expect(() => transaction(() => { run("INSERT INTO tenants(id, created_at) VALUES ('t1', 2)"); })).toThrow(/UNIQUE/);
    });
    expect(all('SELECT * FROM tenants')).toHaveLength(1);
    expect(transaction(() => 1)).toBe(1);
  });

  it('migrazioni: se un altro processo ha già applicato una migrazione tra la lettura e il lock, non si riesegue (niente "table already exists")', () => {
    const d = new DatabaseSync(':memory:');
    runMigrations(d);
    // Simula la lettura "vecchia" dell'elenco delle migrazioni già applicate (un altro processo le ha applicate dopo).
    const stale = new Proxy(d, {
      get(t, p) {
        if (p === 'prepare') return (sql: string) => (sql.includes('SELECT version FROM schema_migrations') ? { all: () => [] } : t.prepare(sql));
        const v = (t as any)[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    expect(() => runMigrations(stale as DatabaseSync)).not.toThrow();
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')!.n).toBeGreaterThan(0);
    d.close();
  });

  it('openDb attende un lock tenuto da un altro processo (busy_timeout impostato PRIMA di journal_mode=WAL)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-review-'));
    const path = join(dir, 'locked.sqlite');
    const holder = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(process.argv[1]);
      d.exec('CREATE TABLE x (a)');
      d.exec('BEGIN EXCLUSIVE');
      console.log('locked');
      setTimeout(() => { d.exec('COMMIT'); process.exit(0); }, 1200);
    `, path], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise<void>((resolve, reject) => { holder.stdout.on('data', (b) => { if (String(b).includes('locked')) resolve(); }); holder.on('error', reject); });
      const t0 = Date.now();
      const d = openDb(path); // prima della correzione: SQLITE_BUSY immediato ("database is locked")
      expect(Date.now() - t0).toBeGreaterThan(300);
      d.close();
    } finally {
      holder.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parametri numerici di query', () => {
  it('limit/offset frazionari o enormi non producono 500 (SQLite rifiuta LIMIT 1.5)', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1'))]);
    for (const q of ['limit=1.5', 'offset=1.5', 'offset=1e300', 'offset=Infinity', 'limit=abc', 'limit=-3', 'offset=-1']) {
      expect((await call('GET', `/v1/documents?${q}`, { token })).status, `documents?${q}`).toBe(200);
      expect((await call('GET', `/v1/sync/pull?cursor=0&${q}`, { token })).status, `pull?${q}`).toBe(200);
    }
    const r = await call('GET', '/v1/sync/pull?cursor=0&limit=1.9', { token });
    expect(r.json.ops).toHaveLength(1);
  });
});

describe('cifratura: prefisso riservato', () => {
  it('un testo che inizia con "enc:v1:" è rifiutato (altrimenti il documento non si legge più: GET, export GDPR, rotazione)', async () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const { token } = await login('a@x.it');
    pro(tenantOf('a@x.it')); // (il piano Free si fermerebbe a 3 documenti e nasconderebbe l'esito)
    const bad = [quote('n1', { notes: 'enc:v1:k1:AAAA' }), quote('n2', { transcript: 'enc:v1:k1:AAAA' }),
      { ...invoice('n3', 1, {}, false), invoice: { ...invoice('n3', 1, {}, false).invoice, xml: 'enc:v1:k1:AAAA' } } as any];
    const r = await push(token, [...bad.map((d) => docOp(d)), docOp(quote('ok1', { notes: 'nota normale' }))]);
    expect(r.json.conflicts.map((c: any) => c.reason)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(r.json.accepted).toHaveLength(1);
    expect((await call('GET', '/v1/documents/ok1', { token })).json.notes).toBe('nota normale');
    expect((await call('GET', '/v1/me/export', { token })).status).toBe(200);
  });
});

describe('audit del client: append-only quindi limitato all\'ingresso', () => {
  const auditOp = (id: string, extra: Record<string, unknown> = {}) => ({
    opId: opId(), entity: 'audit' as const, entityId: id, op: 'upsert' as const, clientTs: 1,
    payload: { id, at: 1, docId: 'd1', action: 'edit', actor: 'user', ...extra },
  });

  it('i campi extra (fino a 20 KB per voce, non cancellabili) non vengono memorizzati', async () => {
    const { token } = await login('a@x.it');
    const r = await push(token, [auditOp('a1', { junk: 'x'.repeat(18_000) })] as any);
    expect(r.json.accepted).toHaveLength(1);
    const row = one<{ payload: string }>("SELECT payload FROM audit_log WHERE ref_id='a1'")!;
    expect(row.payload.length).toBeLessThan(1000);
    expect(row.payload).not.toContain('xxxx');
    expect(one<{ payload: string }>("SELECT payload FROM changes WHERE entity='audit'")!.payload).not.toContain('xxxx');
  });

  it('voce troppo grande rifiutata; tetto giornaliero per tenant', async () => {
    process.env.RL_AUDIT_PER_DAY = '3';
    const { token } = await login('a@x.it');
    const big = await push(token, [auditOp('big', { detail: 'd'.repeat(1900), voiceTranscript: 'v'.repeat(9000) })] as any);
    expect(big.json.conflicts[0].reason).toBe('invalid');
    const r = await push(token, [1, 2, 3, 4, 5].map((i) => auditOp('a' + i)) as any);
    expect(r.json.accepted).toHaveLength(3);
    expect(r.json.conflicts).toHaveLength(2);
    // un altro tenant non è toccato
    const b = await login('b@x.it');
    expect((await push(b.token, [auditOp('b1')] as any)).json.accepted).toHaveLength(1);
  });
});

describe('numerazione fatture: duplicati non rilevati dall\'indice UNIQUE', () => {
  it('sezionale in minuscolo (ft/FT) rifiutato; stesso numero mostrato con seq diverso => duplicate_invoice_number', async () => {
    const { token } = await login('a@x.it');
    pro(tenantOf('a@x.it'));
    expect((await push(token, [docOp(invoice('i1', 1))])).json.accepted).toHaveLength(1);
    const lower = invoice('i2', 1); (lower.invoice as any).sectional = 'ft';
    expect((await push(token, [docOp(lower)])).json.conflicts[0]?.reason).toBe('invalid');
    const sameLabel = invoice('i3', 5); (sameLabel.invoice as any).number = '1/2026'; sameLabel.number = '1/2026';
    expect((await push(token, [docOp(sameLabel)])).json.conflicts[0]?.reason).toBe('duplicate_invoice_number');
    expect(one('SELECT 1 AS x FROM documents WHERE id IN (?, ?)', 'i2', 'i3')).toBeUndefined();
    // altro tenant: stessi numeri, nessun conflitto; la stessa fattura rinviata (stesso id) non confligge con se stessa
    const b = await login('b@x.it'); pro(tenantOf('b@x.it'));
    expect((await push(b.token, [docOp(invoice('i1', 1))])).json.accepted).toHaveLength(1);
    const again = invoice('i1', 1, { updatedAt: 2000, status: 'inviata' });
    expect((await push(token, [docOp(again)])).json.accepted).toHaveLength(1);
  });
});

describe('fattura consegnata: lo stato "scartata" non è un grimaldello per riscriverla', () => {
  it('consegnata -> scartata dal client è rifiutato; inviata -> scartata + rinvio corretto resta possibile', async () => {
    const { token } = await login('a@x.it'); pro(tenantOf('a@x.it'));
    await push(token, [docOp(invoice('f1', 1))]);
    const st = (id: string, status: string, t: number) => { const d = invoice(id, 1, { status: status as any, updatedAt: t }); return d; };
    expect((await push(token, [docOp(st('f1', 'inviata', 2000))])).json.accepted).toHaveLength(1);
    expect((await push(token, [docOp(st('f1', 'consegnata', 3000))])).json.accepted).toHaveLength(1);
    const r = await push(token, [docOp(st('f1', 'scartata', 4000))]);
    expect(r.json.conflicts[0]?.reason).toBe('locked_document');
    // ... quindi non si può nemmeno arrivare al "rinvio" con contenuto modificato
    const edited = st('f1', 'scartata', 5000); edited.lines[0].unitPrice = 1; (edited.invoice as any).xmlHistory = ['<old/>'];
    expect((await push(token, [docOp(edited)])).json.conflicts[0]?.reason).toBe('locked_document');
    expect(JSON.parse(one<{ data: string }>("SELECT data FROM documents WHERE id='f1'")!.data).lines[0].unitPrice).toBe(50);

    // percorso legittimo: inviata -> scartata -> rinvio corretto
    await push(token, [docOp(invoice('f2', 2))]);
    await push(token, [docOp(invoice('f2', 2, { status: 'inviata', updatedAt: 2000 }))]);
    expect((await push(token, [docOp(invoice('f2', 2, { status: 'scartata', updatedAt: 3000 }))])).json.accepted).toHaveLength(1);
    const fixed = invoice('f2', 2, { status: 'inviata', updatedAt: 4000 }); fixed.lines[0].unitPrice = 60; (fixed.invoice as any).xmlHistory = ['<old/>'];
    expect((await push(token, [docOp(fixed)])).json.accepted).toHaveLength(1);
  });

  it('SDI: un NS tardivo/duplicato su una fattura già consegnata si registra ma non cambia lo stato', async () => {
    const { token } = await login('a@x.it'); const tid = tenantOf('a@x.it'); pro(tid);
    await push(token, [docOp(invoice('f1', 1))]);
    const sink = new SqliteDocumentSink();
    await sink.applyEvent(tid, 'f1', { at: 5, type: 'INVIO', channel: 'provider' });
    await sink.applyEvent(tid, 'f1', { at: 6, type: 'RC', channel: 'provider' });
    await sink.applyEvent(tid, 'f1', { at: 7, type: 'NS', channel: 'provider' });
    const row = one<{ status: string; data: string }>("SELECT status, data FROM documents WHERE id='f1'")!;
    expect(row.status).toBe('consegnata');
    expect(JSON.parse(row.data).invoice.sdiEvents).toHaveLength(3);
  });
});

describe('sync: idempotenza di opId', () => {
  it('un opId già applicato è riconfermato senza riapplicare (controllo dentro la transazione)', async () => {
    const { token } = await login('a@x.it');
    const op = docOp(quote('q1'));
    expect((await push(token, [op])).json.accepted).toEqual([op.opId]);
    const seq1 = one<{ m: number }>('SELECT MAX(seq) AS m FROM changes')!.m;
    expect((await push(token, [op, op])).json.accepted).toEqual([op.opId, op.opId]);
    expect(one<{ m: number }>('SELECT MAX(seq) AS m FROM changes')!.m).toBe(seq1);
  });
});

describe('billing: nuovo abbonamento dopo una disdetta', () => {
  const ev = (id: string, type: string, tSec: number, object: Record<string, unknown>) => ({ id, type, created: tSec, data: { object } });
  it('chi si riabbona torna Pro subito (fine periodo e flag di disdetta del vecchio abbonamento non valgono più)', async () => {
    await login('a@x.it'); const tid = tenantOf('a@x.it');
    const store = new SqliteBillingStore();
    const DAY = 86_400_000, t0 = Date.now();
    const sec = (ms: number) => Math.floor(ms / 1000);
    await processStripeEvent(ev('e1', 'checkout.session.completed', sec(t0 - 200 * DAY), { client_reference_id: tid, customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'month' } }), store, t0 - 200 * DAY);
    await processStripeEvent(ev('e2', 'customer.subscription.updated', sec(t0 - 199 * DAY), { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: sec(t0 - 170 * DAY), cancel_at_period_end: true, metadata: { tenantId: tid } }), store, t0 - 199 * DAY);
    await processStripeEvent(ev('e3', 'customer.subscription.deleted', sec(t0 - 170 * DAY), { id: 'sub_1', customer: 'cus_1', metadata: { tenantId: tid } }), store, t0 - 170 * DAY);
    expect(getPlan(tid)).toBe('free');
    await processStripeEvent(ev('e4', 'checkout.session.completed', sec(t0 - 1000), { client_reference_id: tid, customer: 'cus_1', subscription: 'sub_2', metadata: { plan: 'month' } }), store, t0);
    expect(getPlan(tid)).toBe('pro');
    const sub = await store.getSubscription(tid);
    expect(sub?.cancelAtPeriodEnd).toBeFalsy();
    expect(sub?.subscriptionId).toBe('sub_2');
    // il nuovo abbonamento riceve il suo periodo dall'evento `created`
    const end = t0 + 30 * DAY;
    await processStripeEvent(ev('e5', 'customer.subscription.created', sec(t0), { id: 'sub_2', customer: 'cus_1', status: 'active', current_period_end: sec(end), metadata: { tenantId: tid } }), store, t0);
    expect((await store.getSubscription(tid))?.currentPeriodEnd).toBe(sec(end) * 1000);
  });

  it('un evento di una sottoscrizione VECCHIA (deleted/canceled) non disdice quella attiva', async () => {
    await login('a@x.it'); const tid = tenantOf('a@x.it');
    const store = new SqliteBillingStore();
    const t0 = Date.now(); const s = Math.floor(t0 / 1000);
    await processStripeEvent(ev('e1', 'checkout.session.completed', s - 100, { client_reference_id: tid, customer: 'cus_1', subscription: 'sub_new' }), store, t0);
    const r = await processStripeEvent(ev('e2', 'customer.subscription.deleted', s, { id: 'sub_old', customer: 'cus_1' }), store, t0);
    expect(r.handled).toBe(false);
    expect(getPlan(tid)).toBe('pro');
    const r2 = await processStripeEvent(ev('e3', 'customer.subscription.deleted', s + 1, { id: 'sub_new', customer: 'cus_1' }), store, t0);
    expect(r2.handled).toBe(true);
    expect(getPlan(tid)).toBe('free');
  });
});

describe('SDI: coda job', () => {
  it('un job "dead" non blocca per sempre un nuovo invio con la stessa chiave (SQLite e in memoria)', async () => {
    for (const store of [new SqliteJobStore(), new InMemoryJobStore()]) {
      const a = await store.enqueue({ kind: 'sdi.submit', payload: { n: 1 }, dedupeKey: 'submit:t:d', maxAttempts: 1 }, 1000);
      await store.claimDue(1000, 10);
      await store.markFailed(a.id, 'x', null);
      expect((await store.get(a.id))?.status).toBe('dead');
      const b = await store.enqueue({ kind: 'sdi.submit', payload: { n: 2 }, dedupeKey: 'submit:t:d' }, 2000);
      expect(b.id).toBe(a.id); // stessa riga (chiave unica), ma di nuovo in coda
      expect(b.status).toBe('queued');
      expect(b.attempts).toBe(0);
      expect((await store.claimDue(2000, 10)).map((j) => j.id)).toEqual([a.id]);
      // un job in coda o completato NON viene riattivato
      const c = await store.enqueue({ kind: 'sdi.submit', payload: {}, dedupeKey: 'submit:t:d' }, 3000);
      expect(c.status).toBe('running');
    }
  });

  it('un job rimasto "running" dopo un crash viene ripreso (o va in dead se ha esaurito i tentativi)', async () => {
    process.env.SDI_JOB_STALE_MS = '60000';
    const js = new SqliteJobStore();
    const a = await js.enqueue({ kind: 'k', payload: {}, dedupeKey: 'a', maxAttempts: 3 }, 1000);
    const b = await js.enqueue({ kind: 'k', payload: {}, dedupeKey: 'b', maxAttempts: 1 }, 1000);
    expect((await js.claimDue(1000, 10)).map((j) => j.id).sort()).toEqual([a.id, b.id].sort()); // il processo muore qui
    expect(await js.claimDue(1000 + 30_000, 10)).toEqual([]); // ancora entro la soglia: potrebbe essere in corso
    const again = await js.claimDue(1000 + 61_000, 10);
    expect(again.map((j) => j.id)).toEqual([a.id]);
    expect(again[0]!.attempts).toBe(2);
    expect((await js.get(b.id))?.status).toBe('dead'); // 1 tentativo su 1 già speso
  });

  it('l\'Idempotency-Key verso il provider dipende dal contenuto: il rinvio CORRETTO di una scartata non è un duplicato', async () => {
    const keys: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { keys.push((init.headers as Record<string, string>)['Idempotency-Key']!); return new Response('{"id":"p1"}', { status: 200 }); }) as unknown as typeof fetch;
    const p = new HttpSdiProvider({ baseUrl: 'https://sdi.example', apiKey: 'k', submitPath: '/invoices', idField: 'id', signatureHeader: 'x-signature', statusMap: {} }, f);
    const meta = { docId: 'd1', tenantId: 't1' };
    await p.submit('<a/>', meta); await p.submit('<a/>', meta); await p.submit('<b/>', meta);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('webhook senza "at": un retry identico del provider non duplica l\'evento', async () => {
    authHolder.requireAuth = fakeAuth;
    const clock = fakeClock();
    const deps: SdiDeps = {
      provider: () => new HttpSdiProvider({ baseUrl: 'https://sdi.example', apiKey: 'k', submitPath: '/i', idField: 'id', webhookSecret: 'w', signatureHeader: 'x-signature',
        statusMap: { delivered: 'RC' } }),
      jobs: new InMemoryJobStore(), store: new InMemorySdiStore(), documents: null, sink: null, clock, env: () => ({}),
    };
    const raw = JSON.stringify({ id: 'inv_1', status: 'delivered' });
    const sig = createHmac('sha256', 'w').update(raw).digest('hex');
    const hook = () => createSdiRoutes(deps).request('/webhook/http', { method: 'POST', headers: { 'x-signature': sig }, body: raw });
    expect((await hook()).status).toBe(202);
    await new Promise((r) => setTimeout(r, 5)); // Date.now() diverso: prima l'evento aveva un `at` diverso => chiave diversa
    expect((await hook()).status).toBe(202);
    expect((await deps.jobs.list()).filter((j) => j.kind === 'sdi.apply_event')).toHaveLength(1);
  });
});

describe('voce: quota minuti', () => {
  const makeDeps = (stt: SttProvider, clock: Clock): VoiceDeps => ({
    stt: () => stt, llm: () => new MockIntentLlm(), getPlan: async () => 'free', clock, env: () => ({ VOICE_MINUTES_FREE: '1' }), metric: () => {},
    transcribeLimiter: createRateLimiter({ limit: 100, windowMs: 60_000, clock }), interpretLimiter: createRateLimiter({ limit: 100, windowMs: 60_000, clock }),
    usage: inMemoryVoiceUsage(),
  });
  const upload = (deps: VoiceDeps) => {
    const fd = new FormData();
    fd.append('audio', new File([new Uint8Array(1000)], 'a.webm', { type: 'audio/webm' }));
    fd.append('durationMs', '30000');
    return createVoiceRoutes(deps).request('/transcribe', { method: 'POST', headers: AUTH, body: fd });
  };

  it('richieste PARALLELE non superano la quota (addebito prenotato prima della trascrizione)', async () => {
    authHolder.requireAuth = fakeAuth;
    const clock = fakeClock();
    const slow: SttProvider = { id: 'slow', transcribe: async () => { await new Promise((r) => setTimeout(r, 30)); return { text: 'ok' }; } };
    const deps = makeDeps(slow, clock);
    const res = await Promise.all([1, 2, 3, 4, 5, 6].map(() => upload(deps)));
    const codes = res.map((r) => r.status).sort();
    expect(codes).toEqual([200, 200, 429, 429, 429, 429]); // 60 s di quota = 2 file da 30 s
  });

  it('trascrizione fallita: la prenotazione è restituita', async () => {
    authHolder.requireAuth = fakeAuth;
    const clock = fakeClock();
    const deps = makeDeps({ id: 'bad', transcribe: async () => { throw new Error('boom'); } }, clock);
    for (let i = 0; i < 5; i++) expect((await upload(deps)).status).toBe(502); // se non restituita, dal terzo in poi sarebbe 429
    expect(deps.usage.getMs('t1', clock.now())).toBe(0);
  });
});

describe('avvio: coerenza tra chiavi e dati cifrati', () => {
  it('rileva chiave mancante o non configurata, accetta la configurazione corretta', async () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1', { notes: 'segreto' }))]);
    const db = getDb();
    expect(encryptionConfigProblem(db)).toBeNull();
    delete process.env.APP_ENCRYPTION_KEY;
    expect(getKeyRing()).toBeNull();
    expect(encryptionConfigProblem(db)).toMatch(/APP_ENCRYPTION_KEY non è impostata/);
    process.env.APP_ENCRYPTION_KEY = KEY2; process.env.APP_ENCRYPTION_KEY_ID = 'k2';
    expect(encryptionConfigProblem(db)).toMatch(/k1/);
    process.env.APP_ENCRYPTION_OLD_KEYS = `k1:${KEY}`;
    expect(encryptionConfigProblem(db)).toBeNull();
  });
  it('senza dati cifrati nessun problema, con o senza chiave', async () => {
    const db = getDb();
    expect(encryptionConfigProblem(db)).toBeNull();
  });
});

describe('trigger SQL di immutabilità: tentativi di aggiramento diretto (guardia, già verdi)', () => {
  it('INSERT OR REPLACE, ON CONFLICT, DELETE, UPDATE su colonne indicizzate o su JSON, REPLACE con stesso seq: tutti bloccati', async () => {
    const { token } = await login('a@x.it'); const tid = tenantOf('a@x.it'); pro(tid);
    await push(token, [docOp(invoice('i1', 1)), docOp(invoice('i2', 2))]);
    const row = (id: string, seq: number, lockedAt: string) => `('${tid}','${id}','fattura','emessa','${seq}/2026',2026,'FT',${seq},${lockedAt},1000,1000,'{"x":1}')`;
    const cols = 'tenant_id,id,type,status,number,inv_year,inv_sectional,inv_seq,locked_at,created_at,updated_at,data';
    const blocked = [
      `INSERT OR REPLACE INTO documents(${cols}) VALUES ${row('i1', 1, '5000')}`,
      `INSERT OR REPLACE INTO documents(${cols}) VALUES ${row('zz', 1, '5000')}`, // altro id, stesso (sezionale, anno, seq): REPLACE cancellerebbe la emessa
      `INSERT INTO documents(${cols}) VALUES ${row('i1', 1, '5000')} ON CONFLICT(tenant_id,id) DO UPDATE SET data=excluded.data`,
      `INSERT OR REPLACE INTO documents(${cols}) VALUES ${row('i1', 1, 'NULL')}`,
      "DELETE FROM documents WHERE id='i1'",
      "UPDATE documents SET inv_seq=99 WHERE id='i1'",
      "UPDATE documents SET data=json_set(data,'$.invoice.seq',99) WHERE id='i1'",
      "UPDATE documents SET status='bozza' WHERE id='i1'",
      "UPDATE documents SET locked_at=NULL WHERE id='i1'",
      "UPDATE documents SET data=json_set(data,'$.lines[0].unitPrice',1) WHERE id='i1'",
      "UPDATE documents SET data=json_set(data,'$.customer.name','Z') WHERE id='i1'",
      "UPDATE documents SET data=json_set(data,'$.date','2020-01-01') WHERE id='i1'",
      "UPDATE documents SET deleted_at=5 WHERE id='i1'",
      "UPDATE OR REPLACE documents SET id='i2' WHERE id='i1'",
      "UPDATE documents SET id='i3' WHERE id='i1'",
      'DELETE FROM audit_log',
      "INSERT OR REPLACE INTO audit_log(id,tenant_id,at,action) VALUES (1,'x',1,'y')",
    ];
    for (const sql of blocked) expect(() => run(sql), sql).toThrow();
    // ammessi (per contratto): pagamenti ed esiti SDI
    expect(() => run("UPDATE documents SET data=json_set(data,'$.invoice.payments',json('[]')) WHERE id='i1'")).not.toThrow();
  });
});

describe('OTP: un login riuscito chiude tutti i codici attivi', () => {
  it('dopo il login i codici precedenti della stessa email non sono più spendibili', async () => {
    const { sent: mails } = await import('../core/helpers');
    await call('POST', '/v1/auth/request', { body: { email: 'o@x.it' } });
    await call('POST', '/v1/auth/request', { body: { email: 'o@x.it' } });
    const [first, second] = mails.filter((m) => m.email === 'o@x.it').map((m) => m.code);
    const ver = (code: string, deviceId: string) => call('POST', '/v1/auth/verify', { body: { email: 'o@x.it', code, deviceId } });
    expect((await ver(second!, 'd1')).status).toBe(200);
    if (first !== second) expect((await ver(first!, 'd2')).status).toBe(401); // prima: ancora valido per 10 minuti
  });
});

describe('GDPR: cancellazione e impronte di email', () => {
  it('l\'invito usato non conserva più l\'impronta dell\'email dopo la cancellazione dell\'account', async () => {
    const { createInvite, redeemInvite } = await import('../../src/auth/invites');
    const { code } = createInvite({ email: 'g@x.it' });
    const { token, tenantId } = await login('g@x.it');
    expect(redeemInvite(code, 'g@x.it', tenantId)).toBe(true);
    expect(one<{ email_hash: string | null }>('SELECT email_hash FROM invite_codes WHERE used_by_tenant=?', tenantId)!.email_hash).not.toBeNull();
    const r = await call('DELETE', '/v1/me', { token, body: { confirmEmail: 'g@x.it' } });
    expect(r.status).toBe(200);
    expect(one<{ email_hash: string | null; used_at: number | null }>('SELECT email_hash, used_at FROM invite_codes WHERE used_by_tenant=?', tenantId)).toMatchObject({ email_hash: null });
  });
});
