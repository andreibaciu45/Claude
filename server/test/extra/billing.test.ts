import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authHolder } from '../../src/billing/common';
import {
  computeEntitlement, createBillingService, evaluateQuota, FREE_DOCS_PER_MONTH, InMemoryBillingStore, periodKey,
} from '../../src/billing/entitlements';
import { createBillingRoutes, type BillingDeps } from '../../src/billing/routes';
import { signStripePayload, stripeForm, verifyStripeSignature } from '../../src/billing/stripe';
import { AUTH, fakeAuth, fakeClock } from './helpers';

const SECRET = 'whsec_test_placeholder';
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const sec = NOW / 1000;

describe('verifica firma Stripe', () => {
  const body = '{"id":"evt_1"}';
  it('valida', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, sec), SECRET, NOW)).toEqual({ ok: true });
  });
  it('errata (segreto diverso / corpo alterato)', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, 'altro', sec), SECRET, NOW)).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyStripeSignature(body + ' ', signStripePayload(body, SECRET, sec), SECRET, NOW)).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('scaduta oltre la tolleranza, ok entro', () => {
    const h = signStripePayload(body, SECRET, sec);
    expect(verifyStripeSignature(body, h, SECRET, NOW + 301_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyStripeSignature(body, h, SECRET, NOW + 299_000).ok).toBe(true);
  });
  it('header mancante o malformato', () => {
    expect(verifyStripeSignature(body, undefined, SECRET, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyStripeSignature(body, 'garbage', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyStripeSignature(body, 't=abc,v1=00', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('più v1: basta una valida', () => {
    const good = signStripePayload(body, SECRET, sec);
    expect(verifyStripeSignature(body, `${good},v1=deadbeef`, SECRET, NOW).ok).toBe(true);
  });
  it('v1 di lunghezza diversa non solleva eccezioni', () => {
    expect(verifyStripeSignature(body, `t=${sec},v1=ab`, SECRET, NOW).ok).toBe(false);
  });
});

describe('entitlements e quote (pure)', () => {
  it('free: 3 documenti al mese', () => {
    const ent = computeEntitlement(null, NOW);
    expect(ent).toMatchObject({ plan: 'free', docsLimit: FREE_DOCS_PER_MONTH });
    expect(evaluateQuota(ent, 2).allowed).toBe(true);
    expect(evaluateQuota(ent, 3).allowed).toBe(false);
    expect(evaluateQuota(ent, 2, 2).allowed).toBe(false);
  });
  it('pro illimitato; past_due in grazia è pro, scaduta grazia è free', () => {
    const base = { tenantId: 't', updatedAt: NOW };
    expect(computeEntitlement({ ...base, status: 'active' }, NOW)).toMatchObject({ plan: 'pro', docsLimit: null });
    expect(evaluateQuota(computeEntitlement({ ...base, status: 'active' }, NOW), 9999).allowed).toBe(true);
    const pd = { ...base, status: 'past_due' as const, graceUntil: NOW + 1000 };
    expect(computeEntitlement(pd, NOW)).toMatchObject({ plan: 'pro', state: 'grace' });
    expect(computeEntitlement(pd, NOW + 1000).plan).toBe('free');
    expect(computeEntitlement({ ...base, status: 'canceled' }, NOW).plan).toBe('free');
  });
  it('consumeQuota con store: si ferma a 3, riparte il mese dopo', async () => {
    const clock = fakeClock();
    const svc = createBillingService(new InMemoryBillingStore(), clock);
    for (let i = 0; i < 3; i++) expect((await svc.consumeQuota('t1')).allowed).toBe(true);
    expect((await svc.consumeQuota('t1')).allowed).toBe(false);
    expect((await svc.quotaSnapshot('t1')).quota).toEqual({ docsThisMonth: 3, docsLimit: 3 });
    expect((await svc.consumeQuota('t2')).allowed).toBe(true); // tenant isolati
    clock.set(Date.UTC(2026, 6, 1));
    expect(periodKey(clock.now())).toBe('2026-07');
    expect((await svc.consumeQuota('t1')).allowed).toBe(true);
  });
});

describe('route billing', () => {
  let store: InMemoryBillingStore;
  let clock: ReturnType<typeof fakeClock>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let env: Record<string, string>;
  let app: ReturnType<typeof createBillingRoutes>;
  beforeEach(() => {
    authHolder.requireAuth = fakeAuth;
    store = new InMemoryBillingStore();
    clock = fakeClock();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.example/s' }), { status: 200 }));
    env = {
      STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_PRICE_MONTH: 'price_m', STRIPE_PRICE_YEAR: 'price_y',
      STRIPE_SUCCESS_URL: 'https://app.example/ok', STRIPE_CANCEL_URL: 'https://app.example/no', STRIPE_WEBHOOK_SECRET: SECRET,
    };
    const deps: BillingDeps = { store, clock, fetch: fetchMock as unknown as typeof fetch, env: () => env };
    app = createBillingRoutes(deps);
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const hook = (event: object, opts: { secret?: string; t?: number } = {}) => {
    const raw = JSON.stringify(event);
    return post('/webhook', raw, { 'stripe-signature': signStripePayload(raw, opts.secret ?? SECRET, opts.t ?? clock.now() / 1000) });
  };

  it('checkout: richiede auth, valida piano, usa price da env', async () => {
    expect((await post('/checkout', { plan: 'month' })).status).toBe(401);
    expect((await post('/checkout', { plan: 'week' }, AUTH)).status).toBe(400);
    const r = await post('/checkout', { plan: 'year' }, AUTH);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: 'https://checkout.example/s' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('line_items[0][price]')).toBe('price_y');
    expect(body.get('client_reference_id')).toBe('t1');
    expect(body.get('mode')).toBe('subscription');
  });
  it('checkout senza configurazione => 503; errore Stripe => 502 senza dettagli', async () => {
    env.STRIPE_PRICE_MONTH = '';
    expect((await post('/checkout', { plan: 'month' }, AUTH)).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"boom"}}', { status: 402 }));
    expect((await post('/checkout', { plan: 'year' }, AUTH)).status).toBe(502);
  });
  it('portal: 409 senza customer, poi ok', async () => {
    expect((await post('/portal', {}, AUTH)).status).toBe(409);
    await store.saveSubscription({ tenantId: 't1', customerId: 'cus_1', status: 'active', updatedAt: 1 });
    const r = await post('/portal', {}, AUTH);
    expect(r.status).toBe(200);
    expect(new URLSearchParams((fetchMock.mock.calls[0]![1] as RequestInit).body as string).get('customer')).toBe('cus_1');
  });

  it('webhook: firma errata => 400 e nessun effetto', async () => {
    const ev = { id: 'evt_x', type: 'checkout.session.completed', data: { object: { client_reference_id: 't1', customer: 'cus_1' } } };
    expect((await hook(ev, { secret: 'sbagliato' })).status).toBe(400);
    expect((await post('/webhook', JSON.stringify(ev))).status).toBe(400);
    expect(await store.getSubscription('t1')).toBeNull();
  });
  it('webhook: firma scaduta => 400', async () => {
    const ev = { id: 'evt_old', type: 'invoice.paid', data: { object: {} } };
    expect((await hook(ev, { t: clock.now() / 1000 - 3600 })).status).toBe(400);
  });
  it('webhook: checkout.completed attiva Pro; replay stesso event id è no-op', async () => {
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: 't1', customer: 'cus_1', subscription: 'sub_1', payment_status: 'paid', metadata: { plan: 'month' } } } };
    const r1 = await hook(ev);
    expect(await r1.json()).toEqual({ received: true, duplicate: false });
    expect((await store.getSubscription('t1'))).toMatchObject({ status: 'active', customerId: 'cus_1', interval: 'month' });
    // modifica manuale poi replay: non deve essere sovrascritta
    await store.saveSubscription({ ...(await store.getSubscription('t1'))!, status: 'canceled' });
    const r2 = await hook(ev);
    expect(await r2.json()).toEqual({ received: true, duplicate: true });
    expect((await store.getSubscription('t1'))!.status).toBe('canceled');
  });
  it('webhook: payment_failed => grazia 7 giorni (retry non la prolunga), invoice.paid ripristina', async () => {
    await hook({ id: 'e1', type: 'checkout.session.completed', data: { object: { client_reference_id: 't1', customer: 'cus_1' } } });
    await hook({ id: 'e2', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
    const g = (await store.getSubscription('t1'))!;
    expect(g.status).toBe('past_due');
    expect(g.graceUntil).toBe(clock.now() + 7 * 86_400_000);
    expect(computeEntitlement(g, clock.now()).plan).toBe('pro');
    clock.advance(86_400_000);
    await hook({ id: 'e3', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
    expect((await store.getSubscription('t1'))!.graceUntil).toBe(g.graceUntil);
    clock.advance(7 * 86_400_000);
    expect(computeEntitlement((await store.getSubscription('t1'))!, clock.now()).plan).toBe('free');
    await hook({ id: 'e4', type: 'invoice.paid', data: { object: { customer: 'cus_1' } } });
    expect((await store.getSubscription('t1'))!.status).toBe('active');
  });
  it('webhook: subscription.updated / deleted', async () => {
    await hook({ id: 'e1', type: 'checkout.session.completed', data: { object: { client_reference_id: 't1', customer: 'cus_1' } } });
    await hook({ id: 'e2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1800000000, items: { data: [{ price: { recurring: { interval: 'year' } } }] } } } });
    expect(await store.getSubscription('t1')).toMatchObject({ status: 'active', interval: 'year', currentPeriodEnd: 1800000000_000 });
    await hook({ id: 'e3', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    expect((await store.getSubscription('t1'))!.status).toBe('canceled');
  });
  it('webhook: tenant sconosciuto => 200 ma ignorato; evento malformato => 400', async () => {
    expect((await hook({ id: 'e9', type: 'invoice.payment_failed', data: { object: { customer: 'cus_zzz' } } })).status).toBe(200);
    const raw = '{"nope":1}';
    expect((await post('/webhook', raw, { 'stripe-signature': signStripePayload(raw, SECRET, clock.now() / 1000) })).status).toBe(400);
  });
  it('webhook senza segreto configurato => 503', async () => {
    delete env.STRIPE_WEBHOOK_SECRET;
    expect((await hook({ id: 'x', type: 't', data: { object: {} } })).status).toBe(503);
  });
});

describe('stripeForm', () => {
  it('annida e salta undefined', () => {
    expect(stripeForm({ a: 1, b: { c: 'x y' }, d: undefined })).toBe('a=1&b%5Bc%5D=x%20y');
  });
});
