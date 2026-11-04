import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, describeError, getDeviceId, parseRetryAfter, tokenStore } from './api';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mk = (fetchImpl: typeof fetch, extra = {}) => createApiClient({ baseUrl: '/v1', fetchImpl, getToken: () => 'T', sleep: async () => undefined, ...extra });

describe('api client', () => {
  it('invia Bearer e corpo JSON; /auth/* senza token', async () => {
    const f = vi.fn<typeof fetch>(async () => json(200, { cursor: '1', ops: [], hasMore: false }));
    await mk(f).syncPull('abc 1');
    expect(f.mock.calls[0][0]).toBe('/v1/sync/pull?cursor=abc%201');
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer T');
    const g = vi.fn<typeof fetch>(async () => json(204));
    await mk(g).authRequest('a@b.it');
    expect((g.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(g.mock.calls[0][1]?.body).toBe('{"email":"a@b.it"}');
  });
  it('ritenta con backoff SOLO per errori di rete', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = vi.fn<typeof fetch>(async () => { if (++n < 3) throw new TypeError('fail'); return json(200, { url: 'https://x' }); });
    const r = await mk(f, { sleep: async (ms: number) => { sleeps.push(ms); }, backoffMs: 100 }).portal();
    expect(r.url).toBe('https://x');
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });
  it('errore di rete dopo i tentativi => ApiClientError status 0', async () => {
    const f = vi.fn<typeof fetch>(async () => { throw new TypeError('fail'); });
    await expect(mk(f).me()).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('NON ritenta le risposte HTTP di errore e legge il corpo ApiError', async () => {
    const f = vi.fn<typeof fetch>(async () => json(500, { error: { code: 'boom', message: 'Rotto' } }));
    const e = await mk(f).me().catch((x) => x);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e).toMatchObject({ status: 500, code: 'boom', message: 'Rotto' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('401 su chiamata autenticata: cancella il token e avvisa; su /auth no', async () => {
    tokenStore.set('x');
    const on = vi.fn();
    const f = vi.fn<typeof fetch>(async () => json(401, { error: { code: 'unauthorized', message: 'no' } }));
    await expect(mk(f, { onUnauthorized: on }).me()).rejects.toMatchObject({ status: 401 });
    expect(on).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
    on.mockClear();
    await expect(mk(f, { onUnauthorized: on }).authVerify({ email: 'a@b.it', code: '1', deviceId: 'd' })).rejects.toMatchObject({ status: 401 });
    expect(on).not.toHaveBeenCalled();
  });
  it('timeout => errore di rete con codice timeout', async () => {
    const f = vi.fn<typeof fetch>((_u, init) => new Promise((_r, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))); }));
    await expect(mk(f, { timeoutMs: 5, maxAttempts: 1 }).me()).rejects.toMatchObject({ status: 0, code: 'timeout' });
  });
  it('deviceId generato una volta e persistente', () => {
    const a = getDeviceId();
    expect(a).toBeTruthy();
    expect(getDeviceId()).toBe(a);
    expect(localStorage.getItem('vp:sync:deviceId')).toBe(a);
  });
});

describe('nuovi endpoint e messaggi di errore', () => {
  it('exportData scarica un Blob con Bearer', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const b = await mk(f).exportData();
    expect(f.mock.calls[0][0]).toBe('/v1/me/export');
    expect(f.mock.calls[0][1]?.method).toBe('GET');
    expect(await b.text()).toBe('{"a":1}');
  });
  it('deleteAccount: DELETE /me con confirmEmail', async () => {
    const f = vi.fn<typeof fetch>(async () => json(200, { deleted: true, mode: 'purged', retainedInvoices: 0 }));
    await mk(f).deleteAccount({ confirmEmail: 'a@b.it', acknowledgeSubscription: true });
    expect(f.mock.calls[0][1]?.method).toBe('DELETE');
    expect(f.mock.calls[0][1]?.body).toBe('{"confirmEmail":"a@b.it","acknowledgeSubscription":true}');
  });
  it('authVerify invia acceptedTerms', async () => {
    const f = vi.fn<typeof fetch>(async () => json(200, { token: 't', expiresAt: 1, tenantId: 'x' }));
    await mk(f).authVerify({ email: 'a@b.it', code: '123456', deviceId: 'd', acceptedTerms: { termsVersion: 'v1', dpaVersion: 'v1' } });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).acceptedTerms).toEqual({ termsVersion: 'v1', dpaVersion: 'v1' });
  });
  it('429 legge Retry-After (secondi e data) e lo mostra', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'x' } }), { status: 429, headers: { 'Retry-After': '30' } }));
    const e = await mk(f).me().catch((x) => x);
    expect(e.retryAfterSec).toBe(30);
    expect(describeError(e)).toBe('Troppe richieste. Riprova tra 30 secondi.');
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(new Date(Date.now() + 61_000).toUTCString())).toBeGreaterThan(55);
    expect(parseRetryAfter('boh')).toBeUndefined();
    expect(describeError(new ApiClientError(429, 'rate_limited', 'x', 300))).toBe('Troppe richieste. Riprova tra 5 minuti.');
    expect(describeError(new ApiClientError(429, 'rate_limited', 'x'))).toContain('Attendi qualche minuto');
  });
  it('messaggi italiani per rete, timeout, 5xx e codici noti', () => {
    expect(describeError(new ApiClientError(0, 'network', 'x'))).toContain('Controlla la connessione');
    expect(describeError(new ApiClientError(0, 'timeout', 'x'))).toContain('non risponde');
    expect(describeError(new ApiClientError(503, 'boom', 'x'))).toContain('problema temporaneo');
    expect(describeError(new ApiClientError(400, 'terms_required', 'x'))).toContain('Termini');
    expect(describeError(new ApiClientError(400, 'terms_version_mismatch', 'x'))).toContain('aggiornati');
    expect(describeError(new ApiClientError(400, 'confirmation_mismatch', 'x'))).toContain('non coincide');
    expect(describeError(new ApiClientError(409, 'active_subscription', 'x'))).toContain('abbonamento');
    expect(describeError(new ApiClientError(400, 'altro', 'Messaggio del server'))).toBe('Messaggio del server');
  });
});
