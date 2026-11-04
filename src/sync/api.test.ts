import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient, getDeviceId, tokenStore } from './api';

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
