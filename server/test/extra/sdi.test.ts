import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { authHolder } from '../../src/billing/common';
import { HttpSdiProvider, httpConfigFromEnv } from '../../src/sdi/http-provider';
import { backoffDelay, createJobRunner, InMemoryJobStore, PermanentJobError } from '../../src/sdi/jobs';
import { MockProvider } from '../../src/sdi/mock';
import { createSdiRoutes, createSdiRunner, providerFromEnv, UNSUPPORTED_MESSAGE, type SdiDeps } from '../../src/sdi/routes';
import { InMemorySdiStore, SdiParseError, type SdiEvent } from '../../src/sdi/types';
import { AUTH, fakeAuth, fakeClock } from './helpers';

describe('coda job: retry/backoff/dead-letter', () => {
  it('backoff esponenziale con tetto', () => {
    const o = { baseMs: 1000, maxMs: 5000 };
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, o))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
  it('ciclo di vita: fallisce, ritenta dopo il backoff, poi riesce', async () => {
    const clock = fakeClock(); const store = new InMemoryJobStore();
    let n = 0;
    const runner = createJobRunner(store, { x: async () => { if (++n < 3) throw new Error('rete'); } }, clock, { baseMs: 1000, maxMs: 60_000 });
    const j = await store.enqueue({ kind: 'x', payload: {}, maxAttempts: 5 }, clock.now());
    expect(await runner.runOnce()).toEqual({ done: 0, retried: 1, dead: 0 });
    expect(await runner.runOnce()).toEqual({ done: 0, retried: 0, dead: 0 }); // non ancora scaduto
    clock.advance(1000);
    expect((await runner.runOnce()).retried).toBe(1);
    clock.advance(1999); expect(await runner.runOnce()).toEqual({ done: 0, retried: 0, dead: 0 });
    clock.advance(1);
    expect((await runner.runOnce()).done).toBe(1);
    expect((await store.get(j.id))).toMatchObject({ status: 'done', attempts: 3, lastError: 'rete' });
  });
  it('dead-letter dopo maxAttempts; errore permanente subito', async () => {
    const clock = fakeClock(); const store = new InMemoryJobStore();
    const runner = createJobRunner(store, { x: async () => { throw new Error('giù'); }, p: async () => { throw new PermanentJobError('no'); } }, clock, { baseMs: 10, maxMs: 10 });
    const a = await store.enqueue({ kind: 'x', payload: 1, maxAttempts: 2 }, clock.now());
    const b = await store.enqueue({ kind: 'p', payload: 1 }, clock.now());
    const c = await store.enqueue({ kind: 'sconosciuto', payload: 1 }, clock.now());
    await runner.runOnce(); clock.advance(10); await runner.runOnce();
    expect((await store.get(a.id))!.status).toBe('dead');
    expect((await store.get(b.id))!.status).toBe('dead');
    expect((await store.get(c.id))!.status).toBe('dead');
    expect((await store.list('dead')).length).toBe(3);
  });
  it('dedupeKey idempotente', async () => {
    const s = new InMemoryJobStore();
    const a = await s.enqueue({ kind: 'x', payload: 1, dedupeKey: 'k' }, 0);
    const b = await s.enqueue({ kind: 'x', payload: 2, dedupeKey: 'k' }, 0);
    expect(b.id).toBe(a.id);
    expect((await s.list()).length).toBe(1);
  });
});

describe('MockProvider', () => {
  it('RC con ritardo configurabile', async () => {
    const clock = fakeClock();
    const p = new MockProvider({ delayMs: 5000, clock });
    const { providerId } = await p.submit('<xml/>', { docId: 'd1', tenantId: 't1' });
    expect(p.drainDue()).toEqual([]);
    clock.advance(5000);
    const [wire] = p.drainDue();
    const n = p.parseNotification(wire);
    expect(n.providerId).toBe(providerId);
    expect(n.event).toMatchObject({ type: 'RC', channel: 'provider' });
    expect(p.drainDue()).toEqual([]);
  });
  it('NS con codici di scarto; esito deciso dal contenuto', async () => {
    const p = new MockProvider({ outcome: (xml) => (xml.includes('BAD') ? 'NS' : 'MC'), rejectCodes: ['00300', '00305'] });
    await p.submit('BAD', { docId: 'a', tenantId: 't' });
    await p.submit('ok', { docId: 'b', tenantId: 't' });
    const [a, b] = p.drainDue().map((w) => p.parseNotification(w).event);
    expect(a).toMatchObject({ type: 'NS', errorCodes: ['00300', '00305'] });
    expect(b!.type).toBe('MC');
    await expect(p.submit('  ', { docId: 'c', tenantId: 't' })).rejects.toThrow();
  });
  it('parseNotification rifiuta payload non validi', () => {
    const p = new MockProvider();
    for (const bad of [null, 'x', {}, { providerId: 'a', at: 1, type: 'ZZ' }, { providerId: 'a', at: 1, type: 'RC', errorCodes: [1] }]) {
      expect(() => p.parseNotification(bad)).toThrow(SdiParseError);
    }
  });
  it('verifica firma webhook con segreto', () => {
    const p = new MockProvider({ webhookSecret: 's3' });
    const sig = createHmac('sha256', 's3').update('body').digest('hex');
    expect(p.verifyWebhook('body', (n) => (n === 'x-sdi-signature' ? sig : undefined))).toBe(true);
    expect(p.verifyWebhook('body2', (n) => (n === 'x-sdi-signature' ? sig : undefined))).toBe(false);
    expect(p.verifyWebhook('body', () => undefined)).toBe(false);
  });
});

describe('HttpSdiProvider (fetch mock, disattivato di default)', () => {
  it('config assente => nessun provider', () => {
    expect(httpConfigFromEnv({})).toBeNull();
    expect(httpConfigFromEnv({ SDI_PROVIDER: 'http' })).toBeNull();
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ SDI_PROVIDER: 'mock', NODE_ENV: 'production' })).toBeNull();
  });
  const cfg = () => httpConfigFromEnv({ SDI_PROVIDER: 'http', SDI_HTTP_BASE_URL: 'https://sdi.example/', SDI_HTTP_API_KEY: 'k_placeholder', SDI_WEBHOOK_SECRET: 'w' })!;
  it('submit e mapping stato', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'inv_9' }), { status: 201 }));
    const p = new HttpSdiProvider(cfg(), f as unknown as typeof fetch);
    expect(await p.submit('<xml/>', { docId: 'd', tenantId: 't' })).toEqual({ providerId: 'inv_9' });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://sdi.example/invoices');
    const n = p.parseNotification({ id: 'inv_9', status: 'rejected', errors: [{ code: '00300' }, 'X'], at: '2026-01-02T00:00:00Z' });
    expect(n.event).toMatchObject({ type: 'NS', errorCodes: ['00300', 'X'] });
    expect(() => p.parseNotification({ id: 'a', status: '???' })).toThrow(SdiParseError);
  });
  it('errore HTTP e risposta senza id', async () => {
    const bad = new HttpSdiProvider(cfg(), (async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(bad.submit('x', { docId: 'd', tenantId: 't' })).rejects.toThrow('500');
    const noid = new HttpSdiProvider(cfg(), (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch);
    await expect(noid.submit('x', { docId: 'd', tenantId: 't' })).rejects.toThrow();
  });
  it('firma webhook: senza segreto sempre rifiutata', () => {
    const c = cfg();
    const sig = createHmac('sha256', 'w').update('b').digest('hex');
    expect(new HttpSdiProvider(c).verifyWebhook('b', (n) => (n === 'x-signature' ? 'sha256=' + sig : undefined))).toBe(true);
    expect(new HttpSdiProvider({ ...c, webhookSecret: undefined }).verifyWebhook('b', () => sig)).toBe(false);
  });
});

describe('route SDI', () => {
  let deps: SdiDeps; let provider: MockProvider | null; let applied: { t: string; d: string; e: SdiEvent }[];
  let docs: Record<string, { status: string }>; let clock: ReturnType<typeof fakeClock>;
  beforeEach(() => {
    authHolder.requireAuth = fakeAuth;
    clock = fakeClock(); provider = new MockProvider({ clock, webhookSecret: 'sec' }); applied = [];
    docs = { d1: { status: 'emessa' }, d0: { status: 'bozza' } };
    deps = {
      provider: () => provider, jobs: new InMemoryJobStore(), store: new InMemorySdiStore(), clock, env: () => ({}),
      documents: { getIssuedInvoice: async (t, d) => (t === 't1' && docs[d] ? { docId: d, tenantId: t, xml: '<xml/>', status: docs[d]!.status } : null) },
      sink: { applyEvent: async (t, d, e) => { applied.push({ t, d, e }); } },
    };
  });
  const app = () => createSdiRoutes(deps);
  const submit = (body: unknown, h: Record<string, string> = AUTH) =>
    app().request('/submit', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });

  it('submit: auth, validazione, unsupported senza provider, 404, 409', async () => {
    expect((await submit({ docId: 'd1' }, {})).status).toBe(401);
    expect((await submit({})).status).toBe(400);
    expect((await submit({ docId: 'nope' })).status).toBe(404);
    expect((await submit({ docId: 'd0' })).status).toBe(409); // bozza
    provider = null;
    const r = await submit({ docId: 'd1' });
    expect(await r.json()).toEqual({ status: 'unsupported', message: UNSUPPORTED_MESSAGE });
    expect(UNSUPPORTED_MESSAGE).toMatch(/scarica l'XML/i);
  });
  it('submit non-emessa => 409; tenant diverso => 404', async () => {
    docs.d2 = { status: 'bozza' };
    expect((await submit({ docId: 'd2' })).status).toBe(409);
    expect((await submit({ docId: 'd1' }, { 'x-test-tenant': 't2' })).status).toBe(404);
  });
  it('flusso completo: submit -> job -> webhook firmato -> sink; replay deduplicato', async () => {
    expect(await (await submit({ docId: 'd1' })).json()).toEqual({ status: 'queued' });
    expect(await (await submit({ docId: 'd1' })).json()).toEqual({ status: 'queued' });
    expect((await deps.jobs.list()).length).toBe(1); // doppio click = un solo job
    const runner = createSdiRunner(deps);
    expect((await runner.runOnce()).done).toBe(1);
    expect(applied[0]).toMatchObject({ t: 't1', d: 'd1', e: { type: 'INVIO' } });

    const wire = (await (async () => { clock.advance(1); return provider!.drainDue(); })())[0]!;
    const raw = JSON.stringify(wire);
    const sig = createHmac('sha256', 'sec').update(raw).digest('hex');
    const hook = (s: string) => app().request('/webhook/mock', { method: 'POST', headers: { 'x-sdi-signature': s }, body: raw });
    expect((await hook('00')).status).toBe(401);
    expect((await hook(sig)).status).toBe(202);
    expect((await hook(sig)).status).toBe(202);
    expect((await deps.jobs.list()).filter((j) => j.kind === 'sdi.apply_event').length).toBe(1);
    await runner.runOnce();
    expect(applied[1]).toMatchObject({ d: 'd1', e: { type: 'RC' } });
  });
  it('webhook: provider sconosciuto 404, payload invalido 400', async () => {
    expect((await app().request('/webhook/altro', { method: 'POST', body: '{}' })).status).toBe(404);
    const raw = '{"x":1}';
    const sig = createHmac('sha256', 'sec').update(raw).digest('hex');
    expect((await app().request('/webhook/mock', { method: 'POST', headers: { 'x-sdi-signature': sig }, body: raw })).status).toBe(400);
    provider = null;
    expect((await app().request('/webhook/mock', { method: 'POST', body: raw })).status).toBe(404);
  });
  it('apply_event prima della submission => retry', async () => {
    await deps.jobs.enqueue({ kind: 'sdi.apply_event', payload: { providerId: 'ignoto', event: { at: 1, type: 'RC', channel: 'provider' } } }, clock.now());
    expect((await createSdiRunner(deps).runOnce()).retried).toBe(1);
  });
});
