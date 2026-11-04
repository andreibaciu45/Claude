// Regressioni di sicurezza dei moduli extra: billing (ordine eventi, doppio checkout, timeout), voce (addebito quota, limiti persistenti), SDI, URL dei provider.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHolder } from '../../src/billing/common';
import { computeEntitlement, InMemoryBillingStore } from '../../src/billing/entitlements';
import { createBillingRoutes, type BillingDeps } from '../../src/billing/routes';
import { signStripePayload, stripePost } from '../../src/billing/stripe';
import { dbLimiter, estimateMinDurationMs, createVoiceRoutes, inMemoryVoiceUsage, type VoiceDeps } from '../../src/voice/routes';
import { MockSttProvider, sttFromEnv, HttpSttProvider } from '../../src/voice/stt';
import { HttpIntentLlm, llmFromEnv, MockIntentLlm } from '../../src/voice/interpret';
import { httpConfigFromEnv, HttpSdiProvider } from '../../src/sdi/http-provider';
import { safeBaseUrl } from '../../src/net/safe-url';
import { InMemoryJobStore } from '../../src/sdi/jobs';
import { InMemorySdiStore } from '../../src/sdi/types';
import { MockProvider } from '../../src/sdi/mock';
import { createSdiRoutes, type SdiDeps } from '../../src/sdi/routes';
import { resetDb } from '../../src/db';
import { AUTH, fakeAuth, fakeClock } from './helpers';

const SECRET = 'whsec_test_placeholder';

describe('billing: ordine degli eventi e doppio checkout', () => {
  let store: InMemoryBillingStore; let clock: ReturnType<typeof fakeClock>; let app: ReturnType<typeof createBillingRoutes>; let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    authHolder.requireAuth = fakeAuth;
    store = new InMemoryBillingStore(); clock = fakeClock();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.example/s' }), { status: 200 }));
    const env = { STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_PRICE_MONTH: 'p', STRIPE_PRICE_YEAR: 'y', STRIPE_SUCCESS_URL: 'https://a/ok', STRIPE_CANCEL_URL: 'https://a/no', STRIPE_WEBHOOK_SECRET: SECRET };
    app = createBillingRoutes({ store, clock, fetch: fetchMock as unknown as typeof fetch, env: () => env } satisfies BillingDeps);
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const hook = (event: object) => { const raw = JSON.stringify(event); return post('/webhook', raw, { 'stripe-signature': signStripePayload(raw, SECRET, clock.now() / 1000) }); };
  const T = fakeClock().now() / 1000;

  it('un evento più vecchio dell\'ultimo applicato non fa risorgere un abbonamento (Stripe non garantisce l\'ordine)', async () => {
    await hook({ id: 'e1', type: 'checkout.session.completed', created: T, data: { object: { client_reference_id: 't1', customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'month' } } } });
    await hook({ id: 'e3', type: 'customer.subscription.deleted', created: T + 100, data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { tenantId: 't1' } } } });
    expect((await store.getSubscription('t1'))!.status).toBe('canceled');
    // arriva in ritardo un "updated: active" generato PRIMA della cancellazione
    await hook({ id: 'e2', type: 'customer.subscription.updated', created: T + 50, data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { tenantId: 't1' } } } });
    expect((await store.getSubscription('t1'))!.status).toBe('canceled');
    // un evento più recente invece si applica
    await hook({ id: 'e4', type: 'customer.subscription.updated', created: T + 200, data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { tenantId: 't1' } } } });
    expect((await store.getSubscription('t1'))!.status).toBe('active');
  });

  it('cancel_at_period_end viene registrato (disdetto ma attivo fino a fine periodo)', async () => {
    await hook({ id: 'c1', type: 'customer.subscription.updated', created: T, data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, current_period_end: T + 86_400, metadata: { tenantId: 't1' } } } });
    expect(await store.getSubscription('t1')).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: (T + 86_400) * 1000 });
  });

  it('checkout con abbonamento già attivo -> 409 (niente doppio addebito); disdetto -> consentito', async () => {
    await store.saveSubscription({ tenantId: 't1', status: 'active', customerId: 'cus_1', updatedAt: clock.now() });
    expect((await post('/checkout', { plan: 'month' }, AUTH)).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    await store.saveSubscription({ tenantId: 't1', status: 'canceled', customerId: 'cus_1', updatedAt: clock.now() });
    expect((await post('/checkout', { plan: 'month' }, AUTH)).status).toBe(200);
  });

  it('computeEntitlement: active con periodo scaduto oltre la tolleranza => free (coerente con getPlan di CORE)', () => {
    const now = Date.UTC(2026, 5, 15);
    const sub = (end: number) => ({ tenantId: 't', status: 'active' as const, currentPeriodEnd: end, updatedAt: now });
    expect(computeEntitlement(sub(now - 2 * 86_400_000), now).plan).toBe('pro');
    expect(computeEntitlement(sub(now - 4 * 86_400_000), now).plan).toBe('free');
    expect(computeEntitlement({ tenantId: 't', status: 'active', updatedAt: now }, now).plan).toBe('pro'); // periodo non noto
  });

  it('errore di firma: nessun dettaglio sul motivo', async () => {
    const r = await post('/webhook', '{"id":"x","type":"t","data":{"object":{}}}', { 'stripe-signature': 't=1,v1=00' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toMatch(/mismatch|expired|malformed/);
  });

  it('chiamate a Stripe: timeout e nessun redirect (la chiave non segue un 3xx)', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    await stripePost(f as unknown as typeof fetch, 'sk', '/x', { a: 1 });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('voce: quota non aggirabile e limiti persistenti', () => {
  beforeEach(() => { resetDb(); authHolder.requireAuth = fakeAuth; });
  it('estimateMinDurationMs: bitrate massimo plausibile per formato', () => {
    expect(estimateMinDurationMs(40_000, 'audio/webm')).toBe(1000);
    expect(estimateMinDurationMs(192_000, 'audio/wav')).toBe(1000);
    expect(estimateMinDurationMs(0, 'audio/webm')).toBe(0);
  });
  it('un client che dichiara 1 ms per un file lungo paga comunque la durata stimata', async () => {
    const clock = fakeClock(); const usage = inMemoryVoiceUsage();
    const deps: VoiceDeps = { stt: () => new MockSttProvider('x'), llm: () => new MockIntentLlm(), getPlan: async () => 'free', clock, env: () => ({}), metric: () => {},
      transcribeLimiter: dbLimiter('t', { limit: 100, windowMs: 60_000 }), interpretLimiter: dbLimiter('i', { limit: 100, windowMs: 60_000 }), usage };
    const fd = new FormData();
    fd.append('audio', new File([new Uint8Array(400_000)], 'a.webm', { type: 'audio/webm' })); // >= 10 s a 320 kbit/s
    fd.append('durationMs', '1');
    const r = await createVoiceRoutes(deps).request('/transcribe', { method: 'POST', headers: AUTH, body: fd });
    expect(r.status).toBe(200);
    expect(usage.getMs('t1', clock.now())).toBeGreaterThanOrEqual(10_000);
  });
  it('dbLimiter: contatori su DB (sopravvivono al riavvio del processo), per chiave, con finestra', () => {
    const l = dbLimiter('p', { limit: 2, windowMs: 1000 });
    expect(l.hit('a').allowed).toBe(true); expect(l.hit('a').allowed).toBe(true);
    const d = l.hit('a');
    expect(d.allowed).toBe(false); expect(d.remaining).toBe(0);
    expect(l.hit('b').allowed).toBe(true);
    // un'altra istanza (come dopo un riavvio) vede lo stesso stato perché è nella tabella rate_limits
    expect(dbLimiter('p', { limit: 2, windowMs: 1000 }).hit('a').allowed).toBe(false);
  });
});

describe('URL dei provider esterni (SSRF per configurazione)', () => {
  const prod = { NODE_ENV: 'production' };
  it('safeBaseUrl: https obbligatorio in produzione, niente host interni/credenziali/query', () => {
    expect(safeBaseUrl('https://api.example.com/v1/', 't', prod)).toBe('https://api.example.com/v1');
    for (const bad of ['http://api.example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://db.internal', 'https://u:p@api.example.com', 'https://api.example.com/?x=1', 'ftp://x', 'non-un-url', 'https://192.168.1.1']) {
      expect(safeBaseUrl(bad, 't', prod), bad).toBeNull();
    }
    expect(safeBaseUrl('http://localhost:9000', 't', { NODE_ENV: 'test' })).toBe('http://localhost:9000'); // sviluppo/test: ok
    expect(safeBaseUrl(undefined, 't', prod)).toBeNull();
  });
  it('i provider ignorano configurazioni non sicure in produzione', () => {
    expect(sttFromEnv({ ...prod, STT_PROVIDER: 'http', STT_BASE_URL: 'https://169.254.169.254', STT_API_KEY: 'k' })).toBeNull();
    expect(llmFromEnv({ ...prod, LLM_PROVIDER: 'http', LLM_BASE_URL: 'http://llm.example', LLM_API_KEY: 'k', LLM_MODEL: 'm' })).toBeNull();
    expect(httpConfigFromEnv({ ...prod, SDI_PROVIDER: 'http', SDI_HTTP_BASE_URL: 'https://10.1.1.1', SDI_HTTP_API_KEY: 'k' })).toBeNull();
    expect(sttFromEnv({ ...prod, STT_PROVIDER: 'http', STT_BASE_URL: 'https://stt.example.com', STT_API_KEY: 'k' })).not.toBeNull();
  });
  it('gli adattatori HTTP non seguono redirect e hanno un timeout', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'x', text: 't', choices: [{ message: { content: '{}' } }] }), { status: 200 }));
    await new HttpSdiProvider({ baseUrl: 'https://s.example', apiKey: 'k', submitPath: '/i', idField: 'id', signatureHeader: 'x', statusMap: {} }, f as unknown as typeof fetch).submit('<x/>', { docId: 'd', tenantId: 't' });
    await new HttpSttProvider({ baseUrl: 'https://s.example', apiKey: 'k', model: 'm' }, f as unknown as typeof fetch).transcribe({ audio: new Uint8Array(3), mime: 'audio/webm' });
    await new HttpIntentLlm({ baseUrl: 'https://s.example', apiKey: 'k', model: 'm' }, f as unknown as typeof fetch).complete({ system: 's', user: 'u' });
    for (const c of f.mock.calls as unknown as [string, RequestInit][]) {
      expect(c[1].redirect).toBe('error');
      expect(c[1].signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('SDI: niente flood di job dal rinvio delle scartate', () => {
  it('il rinvio di una fattura scartata accoda al massimo un job al minuto', async () => {
    authHolder.requireAuth = fakeAuth;
    const clock = fakeClock();
    const deps: SdiDeps = {
      provider: () => new MockProvider({ clock }), jobs: new InMemoryJobStore(), store: new InMemorySdiStore(), clock, env: () => ({}),
      documents: { getIssuedInvoice: async (t, d) => (t === 't1' ? { docId: d, tenantId: t, xml: '<x/>', status: 'scartata' } : null) },
      sink: { applyEvent: async () => {} },
    };
    const submit = () => createSdiRoutes(deps).request('/submit', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify({ docId: 'd1' }) });
    for (let i = 0; i < 20; i++) { await submit(); clock.advance(1000); }
    expect((await deps.jobs.list()).length).toBeLessThanOrEqual(1 + 1); // 20 s ≈ al più 2 finestre di un minuto
    clock.advance(61_000);
    await submit();
    expect((await deps.jobs.list()).length).toBeGreaterThanOrEqual(2);
  });
});
