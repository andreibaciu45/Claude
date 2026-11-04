// GET /metrics (Prometheus, token), GET /health/deep, log senza dati personali.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, docOp, freshEnv, invoice, login, push, quote, sent, useFileDb, type FileDb } from './helpers';
import { app } from '../core/helpers';
import { run } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';
import { resetMetrics } from '../../src/ops/metrics';
import { resetBackupCache } from '../../src/ops/health';
import { setDraining } from '../../src/ops/state';
import { grantPro } from '../../src/db/grants';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = 'metrics-token-0123456789abcdef';
let fdb: FileDb | null = null;
beforeEach(() => { freshEnv(); resetMetrics(); resetBackupCache(); setDraining(false); delete process.env.METRICS_TOKEN; delete process.env.BACKUP_DIR; });
afterEach(() => { fdb?.cleanup(); fdb = null; setDraining(false); delete process.env.METRICS_TOKEN; delete process.env.BACKUP_DIR; });
const metrics = (token?: string) => call('GET', '/metrics', { headers: token ? { authorization: `Bearer ${token}` } : {} });
const metricsText = async (): Promise<string> => (await app.request('/metrics', { headers: { authorization: `Bearer ${TOKEN}` } })).text();

describe('GET /metrics', () => {
  it('disabilitato (404) senza METRICS_TOKEN o con token troppo corto', async () => {
    expect((await metrics(TOKEN)).status).toBe(404);
    process.env.METRICS_TOKEN = 'corto';
    expect((await metrics('corto')).status).toBe(404);
  });

  it('401 senza token o con token errato; 200 col token giusto, formato Prometheus', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    expect((await metrics()).status).toBe(401);
    expect((await metrics('x'.repeat(30))).status).toBe(401);
    expect((await call('GET', '/metrics?token=' + TOKEN)).status).toBe(401); // il token in query string non e' accettato
    const res = await app.request('/metrics', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const t = await res.text();
    expect(t).toMatch(/^# TYPE vp_http_requests_total counter$/m);
    expect(t).toMatch(/^# TYPE vp_http_request_duration_seconds histogram$/m);
    expect(t).toMatch(/^vp_db_up 1$/m);
    // ogni riga e' un commento o "nome{etichette} valore"
    for (const l of t.trim().split('\n')) expect(l).toMatch(/^(# (HELP|TYPE) \w+ .+|\w+(\{[^}]*\})? -?[\d.e+]+)$/);
  });

  it('conta richieste per rotta (pattern) e stato, latenza, sync, conflitti, quota, utenti', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const a = await login('anna@x.it');
    for (let i = 0; i < 3; i++) await call('GET', '/v1/documents/doc-' + i, { token: a.token }); // 404 sullo stesso pattern
    await call('GET', '/v1/inesistente');
    await push(a.token, [docOp(quote('q1')), docOp(quote('q2', { number: 'P2' })), docOp(quote('q3', { number: 'P3' })), docOp(quote('q4', { number: 'P4' }))]);
    await call('GET', '/v1/sync/pull?cursor=0', { token: a.token });
    const t = await metricsText();
    expect(t).toContain('vp_http_requests_total{method="GET",route="/v1/documents/:id",status="404"} 3');
    expect(t).toContain('route="unmatched",status="404"');
    expect(t).toContain('vp_http_requests_total{method="POST",route="/v1/sync/push",status="200"} 1');
    expect(t).toMatch(/vp_http_request_duration_seconds_count\{route="\/v1\/sync\/push"\} 1/);
    expect(t).toContain('vp_sync_push_ops_total{result="accepted"} 3');
    expect(t).toContain('vp_sync_push_ops_total{result="conflict"} 1');
    expect(t).toContain('vp_sync_conflicts_total{reason="quota_exceeded"} 1');
    expect(t).toMatch(/^vp_quota_exceeded_total 1$/m);
    expect(t).toMatch(/^vp_sync_pull_requests_total 1$/m);
    expect(t).toMatch(/^vp_users 1$/m);
    expect(t).toContain('vp_active_users{window="7d"} 1');
    expect(t).toContain('vp_tenants_by_stripe_plan{plan="free"} 1');
    expect(t).toMatch(/^vp_signups_total 1$/m);
    expect(t).toMatch(/^vp_otp_requests_total 1$/m);
    expect(t).toContain('vp_http_requests_total{method="POST",route="/v1/auth/verify",status="200"} 1');
  });

  it('errori interni (500) e licenze manuali', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const a = await login('anna@x.it');
    grantPro(a.tenantId, Date.now() + 86_400_000);
    run('DROP TABLE changes'); // rompe il sync: /pull risponde 500
    const r = await call('GET', '/v1/sync/pull?cursor=0', { token: a.token });
    expect(r.status).toBe(500);
    const t = await metricsText();
    expect(t).toContain('vp_errors_total{kind="http_500"} 1');
    expect(t).toContain('vp_http_requests_total{method="GET",route="/v1/sync/pull",status="500"} 1');
    expect(t).toMatch(/^vp_manual_grants_active 1$/m);
  });

  it('NESSUN dato personale: ne\' email, ne\' token, ne\' id di tenant/documento, ne\' IP, ne\' OTP', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const email = 'segretissima.persona@example.org';
    const a = await login(email, 'device-molto-privato');
    const code = sent[sent.length - 1]!.code;
    await push(a.token, [docOp(invoice('fattura-riservata-77', 1, { customer: { id: 'c', name: 'Cliente Riservato Srl' } }))]);
    await call('GET', '/v1/documents/fattura-riservata-77', { token: a.token, ip: '203.0.113.77' });
    await call('POST', '/v1/auth/verify', { body: { email, code: '000000', deviceId: 'x' }, ip: '198.51.100.9' });
    const t = await metricsText();
    for (const secret of [email, 'segretissima', a.token, a.tenantId, 'fattura-riservata-77', 'Cliente Riservato', '203.0.113.77', '198.51.100.9', 'device-molto-privato', TOKEN]) {
      expect(t, secret).not.toContain(secret);
    }
    expect(t).not.toMatch(new RegExp(`\\b${code}\\b`));
    // le uniche etichette sono costanti note
    const labelNames = new Set([...t.matchAll(/(\w+)="/g)].map((m) => m[1]));
    for (const n of labelNames) expect(['le', 'method', 'node', 'plan', 'reason', 'result', 'route', 'status', 'window', 'kind']).toContain(n);
  });
});

describe('GET /health/deep', () => {
  it('ok: DB scrivibile, migrazioni applicate; senza token solo gli stati', async () => {
    const r = await call('GET', '/health/deep');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(Object.keys(r.json.checks).sort()).toEqual(['backup', 'db_read', 'disk', 'maintenance', 'migrations']); // senza token: sola lettura
    expect(r.json.checks.migrations).toEqual({ status: 'ok' }); // niente dettagli senza token
    process.env.METRICS_TOKEN = TOKEN;
    const d = await call('GET', '/health/deep', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(d.json.checks.migrations.detail.latest).toBeGreaterThanOrEqual(201);
    expect(Object.keys(d.json.checks).sort()).toEqual(['backup', 'db_write', 'disk', 'maintenance', 'migrations']); // con token: anche la sonda di scrittura
  });

  it('503 se manca una migrazione o il DB non e\' scrivibile', async () => {
    run('DELETE FROM schema_migrations WHERE version = 201');
    let r = await call('GET', '/health/deep');
    expect(r.status).toBe(503);
    expect(r.json.checks.migrations.status).toBe('fail');
    freshEnv();
    run('DROP TABLE ops_state');
    r = await call('GET', '/health/deep');
    expect(r.status).toBe(503);
    expect(r.json.checks.db_read.status).toBe('fail');
    process.env.METRICS_TOKEN = TOKEN;
    r = await call('GET', '/health/deep', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(503);
    expect(r.json.checks.db_write.status).toBe('fail');
  });

  it('disco quasi pieno -> fail; poco spazio -> degraded; backup vecchio -> degraded; backup recente -> ok', async () => {
    fdb = useFileDb();
    process.env.DISK_CRIT_FREE_MB = '1000000000';
    expect((await call('GET', '/health/deep')).json.checks.disk.status).toBe('fail');
    delete process.env.DISK_CRIT_FREE_MB;
    process.env.DISK_WARN_FREE_MB = '1000000000';
    let r = await call('GET', '/health/deep');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('degraded');
    delete process.env.DISK_WARN_FREE_MB;

    const dir = join(fdb.dir, 'bk'); mkdirSync(dir);
    process.env.BACKUP_DIR = dir;
    r = await call('GET', '/health/deep');
    expect(r.json.checks.backup.status).toBe('warn'); // cartella vuota
    const f = join(dir, 'vocepreventivo-1.sqlite.gz'); writeFileSync(f, 'x');
    const old = new Date(Date.now() - 72 * 3_600_000); utimesSync(f, old, old); resetBackupCache();
    expect((await call('GET', '/health/deep')).json.checks.backup.status).toBe('warn');
    const fresh = new Date(); utimesSync(f, fresh, fresh); resetBackupCache();
    process.env.METRICS_TOKEN = TOKEN;
    const ok = await call('GET', '/health/deep', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.json.checks.backup).toMatchObject({ status: 'ok', detail: { maxHours: 36 } });
    expect(ok.json.status).toBe('ok');
    expect(await metricsText()).toMatch(/^vp_last_backup_age_seconds \d+$/m);
  });

  it('durante l\'arresto risponde 503 (anche /health)', async () => {
    setDraining(true);
    expect((await call('GET', '/health/deep')).status).toBe(503);
    const h = await call('GET', '/health');
    expect(h.status).toBe(503);
    expect(h.json.error.code).toBe('shutting_down');
  });
});

describe('log JSON senza dati personali', () => {
  it('richieste, errori, rate-limit, invio mail fallito: mai email, token, OTP, IP', async () => {
    const lines: string[] = [];
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn')]
      .map((s) => s.mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    const prevEnv = { NODE_ENV: process.env.NODE_ENV, LOG_LEVEL: process.env.LOG_LEVEL };
    process.env.NODE_ENV = 'development'; process.env.LOG_LEVEL = 'info'; // i log sono spenti in test: li accendiamo
    try {
      const email = 'pii.test@example.org';
      const ip = '203.0.113.200';
      const a = await login(email, 'dev-pii');
      const code = sent[sent.length - 1]!.code;
      await call('POST', '/v1/auth/request', { body: { email }, ip });
      await call('POST', '/v1/auth/verify', { body: { email, code: '123456', deviceId: 'dev-pii' }, ip });
      await call('GET', '/v1/me', { token: a.token, ip });
      await call('GET', '/v1/documents/non-esiste', { token: a.token, ip });
      await call('GET', '/v1/me/export', { token: a.token, ip });
      await call('GET', '/v1/me', { token: 'x'.repeat(40), ip });
      await push(a.token, [docOp(quote('q1', { customer: { id: 'c', name: 'Mario Privatissimo' }, notes: 'nota riservata' }))]);
      run('DROP TABLE changes');
      await call('GET', '/v1/sync/pull', { token: a.token, ip }); // 500 -> log dell'errore
      const { setMailer } = await import('../../src/auth/mailer');
      setMailer({ async sendOtp() { throw new Error(`SMTP rifiutato per ${email}`); } });
      await call('POST', '/v1/auth/request', { body: { email: 'altra.persona@example.org' }, ip });
      const log = lines.join('\n');
      expect(log.length).toBeGreaterThan(200);
      for (const s of [email, 'pii.test', 'altra.persona', a.token, a.tenantId.replace(/-.*/, '') + '-', code, '123456', ip, '203.0.113', 'Mario Privatissimo', 'nota riservata', 'dev-pii', 'SMTP rifiutato']) {
        expect(log, s).not.toContain(s.endsWith('-') ? s + 'zzz' : s);
      }
      expect(log).not.toContain(a.token);
      // ogni riga e' JSON valido con soli campi attesi
      for (const l of lines) { const o = JSON.parse(l); expect(Object.keys(o).every((k) => /^(t|level|event|request_id|tenant_id|method|route|path|status|ms|error)$/.test(k))).toBe(true); }
      // tenant_id compare nei log di richiesta (pseudonimo interno, richiesto per il supporto) ma mai l'email
      expect(log).toContain(a.tenantId);
    } finally {
      process.env.NODE_ENV = prevEnv.NODE_ENV; process.env.LOG_LEVEL = prevEnv.LOG_LEVEL;
      spies.forEach((s) => s.mockRestore());
    }
  });
});
