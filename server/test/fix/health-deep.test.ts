// /health/deep: senza token NESSUNA scrittura; con token la sonda di scrittura e' in cache e con rate-limit. Prima: una scrittura (setState) a ogni chiamata, anche anonima.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, freshEnv } from '../core/helpers';
import { getDb, one } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { resetHealthCache } from '../../src/ops/health';
import { setDraining } from '../../src/ops/state';

const TOKEN = 'metrics-token-0123456789abcdef';
const totalChanges = (): number => Number((getDb().prepare('SELECT total_changes() AS c').get() as { c: number }).c);
const authed = { authorization: `Bearer ${TOKEN}` };
const KEYS = ['HEALTH_CACHE_MS', 'RL_HEALTH_DEEP_PER_MIN', 'RL_HEALTH_DEEP_AUTH_PER_MIN', 'METRICS_TOKEN'];
beforeEach(() => { freshEnv(); resetHealthCache(); setDraining(false); for (const k of KEYS) delete process.env[k]; process.env.RL_HEALTH_DEEP_PER_MIN = '1000000'; process.env.HEALTH_CACHE_MS = '0'; });
afterEach(() => { for (const k of KEYS) delete process.env[k]; process.env.HEALTH_CACHE_MS = '0'; process.env.RL_HEALTH_DEEP_PER_MIN = '1000000'; setClock(null); resetHealthCache(); });

describe('/health/deep senza token: sola lettura', () => {
  it('nessuna scrittura sul database, neanche per il rate-limit (che sta in memoria), a ogni chiamata', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    await call('GET', '/health/deep'); // scalda (migrazioni, prepared statements)
    const c0 = totalChanges();
    for (let i = 0; i < 50; i++) expect((await call('GET', '/health/deep')).status).toBe(200);
    expect(totalChanges()).toBe(c0);
    expect(one('SELECT 1 AS x FROM ops_state WHERE key=?', 'health_probe')).toBeUndefined();
  });

  it('riporta solo stati (nessun numero), con db_read al posto di db_write', async () => {
    const r = await call('GET', '/health/deep');
    expect(r.json.checks.db_read).toEqual({ status: 'ok' });
    expect(r.json.checks.db_write).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toMatch(/detail|freeMb|latest/);
  });

  it('un token sbagliato equivale a nessun token: nessuna scrittura', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const c0 = totalChanges();
    await call('GET', '/health/deep', { headers: { authorization: 'Bearer sbagliato-sbagliato-sbagliato' } });
    expect(totalChanges()).toBe(c0);
  });

  it('rate-limit per IP: oltre RL_HEALTH_DEEP_PER_MIN risponde 429 con Retry-After', async () => {
    process.env.RL_HEALTH_DEEP_PER_MIN = '3';
    const st: number[] = [];
    for (let i = 0; i < 5; i++) st.push((await call('GET', '/health/deep', { ip: '1.2.3.4', peer: '10.0.0.1' })).status);
    expect(st).toEqual([200, 200, 200, 429, 429]);
    expect((await call('GET', '/health/deep', { ip: '5.6.7.8', peer: '10.0.0.1' })).status).toBe(200); // un altro IP non è toccato
  });

  it('il traffico anonimo non consuma il budget di chi ha il token', async () => {
    process.env.METRICS_TOKEN = TOKEN; process.env.RL_HEALTH_DEEP_PER_MIN = '1';
    await call('GET', '/health/deep'); await call('GET', '/health/deep');
    expect((await call('GET', '/health/deep', { headers: authed })).status).toBe(200);
  });
});

describe('/health/deep con token: scrittura di prova solo qui, in cache', () => {
  it('con il token la sonda di scrittura c\'è (db_write) con i dettagli', async () => {
    process.env.METRICS_TOKEN = TOKEN;
    const r = await call('GET', '/health/deep', { headers: authed });
    expect(r.json.checks.db_write.status).toBe('ok');
    expect(r.json.checks.migrations.detail.latest).toBeGreaterThan(0);
    expect(one('SELECT 1 AS x FROM ops_state WHERE key=?', 'health_probe')).toBeTruthy();
  });

  it('cache: una raffica di 100 richieste con token = una sola scrittura; scaduta la cache, ne fa un\'altra', async () => {
    process.env.METRICS_TOKEN = TOKEN; process.env.HEALTH_CACHE_MS = '5000';
    let t = 1_800_000_000_000; setClock(() => t);
    await call('GET', '/health/deep', { headers: authed });
    const probe0 = one<{ value: string }>('SELECT value FROM ops_state WHERE key=?', 'health_probe')!.value;
    const c0 = totalChanges();
    t += 2000;
    for (let i = 0; i < 100; i++) await call('GET', '/health/deep', { headers: authed });
    expect(totalChanges()).toBe(c0);
    expect(one<{ value: string }>('SELECT value FROM ops_state WHERE key=?', 'health_probe')!.value).toBe(probe0);
    t += 4000;
    await call('GET', '/health/deep', { headers: authed });
    expect(one<{ value: string }>('SELECT value FROM ops_state WHERE key=?', 'health_probe')!.value).not.toBe(probe0);
  });

  it('la cache non maschera l\'arresto in corso (503 subito)', async () => {
    process.env.HEALTH_CACHE_MS = '60000';
    expect((await call('GET', '/health/deep')).status).toBe(200);
    setDraining(true);
    expect((await call('GET', '/health/deep')).status).toBe(503);
    setDraining(false);
  });

  it('rate-limit anche con token (limite più ampio)', async () => {
    process.env.METRICS_TOKEN = TOKEN; process.env.RL_HEALTH_DEEP_AUTH_PER_MIN = '2';
    const st: number[] = [];
    for (let i = 0; i < 4; i++) st.push((await call('GET', '/health/deep', { headers: authed })).status);
    expect(st).toEqual([200, 200, 429, 429]);
  });
});
