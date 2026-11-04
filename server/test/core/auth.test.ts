import { beforeEach, describe, expect, it } from 'vitest';
import { app, call, captureMailer, freshEnv, login, sent } from './helpers';
import { one } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { sha256Hex } from '../../src/auth/crypto';
import { OTP_MAX_ATTEMPTS, verifyOtp } from '../../src/auth/service';

beforeEach(freshEnv);
const verify = (email: string, code: string, deviceId = 'd1') => call('POST', '/v1/auth/verify', { body: { email, code, deviceId } });

describe('auth OTP', () => {
  it('flusso completo: request -> verify -> me -> logout', async () => {
    const r = await call('POST', '/v1/auth/request', { body: { email: 'Mario@Example.com' } });
    expect(r.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toMatch(/^\d{6}$/);
    const v = await verify('mario@example.com', sent[0].code);
    expect(v.status).toBe(200);
    expect(v.json.token.length).toBeGreaterThanOrEqual(43); // 256 bit base64url
    const me = await call('GET', '/v1/me', { token: v.json.token });
    expect(me.json).toEqual({ email: 'mario@example.com', tenantId: v.json.tenantId, plan: 'free', quota: { docsThisMonth: 0, docsLimit: 3, periodKey: new Date().toISOString().slice(0, 7) },
      billingStatus: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, graceUntil: null });
    expect((await call('POST', '/v1/auth/logout', { token: v.json.token })).status).toBe(204);
    expect((await call('GET', '/v1/me', { token: v.json.token })).status).toBe(401);
  });

  it('il token è salvato solo come hash SHA-256', async () => {
    const { token } = await login('a@x.it');
    const rows = one<{ token_hash: string }>('SELECT token_hash FROM sessions')!;
    expect(rows.token_hash).toBe(sha256Hex(token));
    expect(rows.token_hash).not.toContain(token);
    expect(one('SELECT 1 AS x FROM otp_codes WHERE code_hash = ?', sent[0].code)).toBeUndefined(); // codice mai in chiaro
  });

  it('stesso utente = stesso tenant; email diversa = tenant diverso', async () => {
    const a1 = await login('a@x.it', 'd1');
    const a2 = await login('a@x.it', 'd2');
    const b = await login('b@x.it');
    expect(a1.tenantId).toBe(a2.tenantId);
    expect(b.tenantId).not.toBe(a1.tenantId);
  });

  it('codice errato, poi corretto; il codice è monouso', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    const code = sent[0].code;
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await verify('a@x.it', wrong)).status).toBe(401);
    expect((await verify('a@x.it', code)).status).toBe(200);
    expect((await verify('a@x.it', code)).status).toBe(401);
  });

  it('un codice ha un tetto di tentativi (somma di tutti i dispositivi): oltre, anche il codice giusto è bruciato', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    const code = sent[0].code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(verifyOtp('a@x.it', wrong).ok).toBe(false);
    expect(verifyOtp('a@x.it', code).ok).toBe(false);
  });

  it('scadenza OTP a 10 minuti', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    t += 10 * 60_000 + 1;
    expect((await verify('a@x.it', sent[0].code)).status).toBe(401);
  });

  it('una nuova richiesta NON invalida subito il codice precedente (anti-DoS), ma ne restano al massimo 3 validi', async () => {
    for (let i = 0; i < 4; i++) await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' }, ip: `9.9.9.${i}`, peer: '10.0.0.1' });
    expect(sent).toHaveLength(4);
    expect(verifyOtp('a@x.it', sent[0].code).ok).toBe(false); // il quarto codice ha espulso il primo
    expect((await verify('a@x.it', sent[1].code)).status).toBe(200); // il secondo è ancora valido
  });

  it('rate-limit per email sulle richieste (429 + Retry-After) e reset dopo la finestra', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } })).status).toBe(204);
    const r = await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('POST', '/v1/auth/request', { body: { email: 'altra@x.it' } })).status).toBe(204);
    t += 3600_001;
    expect((await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } })).status).toBe(204);
  });

  it('rate-limit sulle verifiche per email', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await verify('a@x.it', '999999')).status;
    expect(last).toBe(429);
  });

  it('input non valido -> 400; nessun enumerazione utenti (stessa risposta)', async () => {
    expect((await call('POST', '/v1/auth/request', { body: { email: 'non-una-email' } })).status).toBe(400);
    expect((await call('POST', '/v1/auth/verify', { body: { email: 'a@x.it', code: '12', deviceId: 'd' } })).status).toBe(400);
    const r1 = await call('POST', '/v1/auth/request', { body: { email: 'nuovo@x.it' } });
    await login('esistente@x.it');
    const r2 = await call('POST', '/v1/auth/request', { body: { email: 'esistente@x.it' } });
    expect(r1.status).toBe(r2.status);
  });

  it('sessione: scadenza, revoca, token errato/mancante', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    const { token } = await login('a@x.it');
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token })).status).toBe(200);
    t += 91 * 24 * 3600_000;
    expect((await call('GET', '/v1/me', { token })).status).toBe(401);
  });

  it('sessione sliding: l\'uso la prolunga', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    const { token } = await login('a@x.it');
    for (let i = 0; i < 4; i++) { t += 60 * 24 * 3600_000; expect((await call('GET', '/v1/me', { token })).status).toBe(200); }
  });

  it('un nuovo login sullo stesso dispositivo revoca la sessione precedente', async () => {
    const a = await login('a@x.it', 'd1');
    const b = await login('a@x.it', 'd1');
    expect((await call('GET', '/v1/me', { token: a.token })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: b.token })).status).toBe(200);
  });

  it('AUTH_DEV_RETURN_CODE restituisce il codice solo se abilitato', async () => {
    process.env.AUTH_DEV_RETURN_CODE = '1';
    try {
      const r = await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
      expect(r.status).toBe(200);
      expect(r.json.devCode).toBe(sent[0].code);
    } finally { delete process.env.AUTH_DEV_RETURN_CODE; }
    expect((await call('POST', '/v1/auth/request', { body: { email: 'b@x.it' } })).status).toBe(204);
  });

  it('un mailer che fallisce non rompe la richiesta né rivela nulla', async () => {
    const { setMailer } = await import('../../src/auth/mailer');
    setMailer({ async sendOtp() { throw new Error('smtp giù'); } });
    expect((await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } })).status).toBe(204);
    setMailer(captureMailer);
  });
});

describe('hardening HTTP', () => {
  it('header di sicurezza e request id', async () => {
    const r = await app.request('/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toBeTruthy();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });
  it('CORS solo per le origini configurate', async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com';
    try {
      const { createApp } = await import('../../src/app');
      const a = createApp();
      const ok = await a.request('/health', { headers: { origin: 'https://app.example.com' } });
      const ko = await a.request('/health', { headers: { origin: 'https://evil.example.com' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
      expect(ko.headers.get('access-control-allow-origin')).toBeNull();
    } finally { delete process.env.CORS_ORIGINS; }
  });
  it('limite dimensione body -> 413', async () => {
    process.env.MAX_BODY_BYTES = '1000';
    try {
      const { createApp } = await import('../../src/app');
      const r = await createApp().request('/v1/auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@x.it', pad: 'x'.repeat(2000) }) });
      expect(r.status).toBe(413);
    } finally { delete process.env.MAX_BODY_BYTES; }
  });
  it('404 e JSON malformato in formato ApiError', async () => {
    expect((await call('GET', '/v1/nulla')).json.error.code).toBe('not_found');
    const r = await app.request('/v1/auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rotto' });
    expect(r.status).toBe(400);
  });
});
