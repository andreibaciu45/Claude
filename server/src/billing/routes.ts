// Router billing (montato da app.ts su /v1/billing). Stripe via fetch, senza SDK.
import { Hono } from 'hono';
import { z } from 'zod';
import {
  apiError, authGate, systemClock, type AppEnv, type Clock, type Env,
} from './common';
import {
  computeEntitlement, createBillingService, type BillingService, type BillingStore,
} from './entitlements';
import { SqliteBillingStore } from './sqlite-store';
import { StripeApiError, stripePost, verifyStripeSignature } from './stripe';
import { parseStripeEvent, processStripeEvent } from './webhook';

export interface BillingDeps {
  store: BillingStore;
  clock: Clock;
  fetch: typeof fetch;
  env: () => Env;
}

/** Dipendenze di default (SQLite di CORE). Mutabili; i test passano deps proprie (InMemoryBillingStore). */
export const defaultBillingDeps: BillingDeps = {
  store: new SqliteBillingStore(),
  clock: systemClock,
  fetch: (...a) => fetch(...a),
  env: () => process.env,
};

/** Servizio entitlements/quote per CORE (es. /v1/me e sync push). Legge sempre le deps correnti. */
export const billingService: BillingService = {
  getEntitlement: (t) => createBillingService(defaultBillingDeps.store, defaultBillingDeps.clock).getEntitlement(t),
  consumeQuota: (t, n) => createBillingService(defaultBillingDeps.store, defaultBillingDeps.clock).consumeQuota(t, n),
  quotaSnapshot: (t) => createBillingService(defaultBillingDeps.store, defaultBillingDeps.clock).quotaSnapshot(t),
};

const CheckoutBody = z.object({ plan: z.enum(['month', 'year']) });

export function createBillingRoutes(deps: BillingDeps = defaultBillingDeps) {
  const r = new Hono<AppEnv>();

  r.post('/checkout', authGate, async (c) => {
    const parsed = CheckoutBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(apiError('invalid_body', "Piano non valido: usa 'month' o 'year'"), 400);
    const env = deps.env();
    const secret = env.STRIPE_SECRET_KEY;
    const price = parsed.data.plan === 'month' ? env.STRIPE_PRICE_MONTH : env.STRIPE_PRICE_YEAR;
    const success = env.STRIPE_SUCCESS_URL;
    const cancel = env.STRIPE_CANCEL_URL;
    if (!secret || !price || !success || !cancel) {
      return c.json(apiError('billing_unconfigured', 'Pagamenti non configurati'), 503);
    }
    const tenantId = c.get('tenantId');
    const sub = await deps.store.getSubscription(tenantId);
    // Un abbonamento già attivo/in grazia si gestisce dal portale: un secondo checkout creerebbe un doppio addebito.
    if (computeEntitlement(sub, deps.clock.now()).plan === 'pro') {
      return c.json(apiError('already_subscribed', 'Abbonamento già attivo: usa il portale di fatturazione'), 409);
    }
    try {
      const session = await stripePost(deps.fetch, secret, '/checkout/sessions', {
        mode: 'subscription',
        'line_items': { 0: { price, quantity: 1 } },
        success_url: success,
        cancel_url: cancel,
        client_reference_id: tenantId,
        customer: sub?.customerId,
        subscription_data: { metadata: { tenantId } },
        metadata: { tenantId, plan: parsed.data.plan },
      });
      const url = typeof session.url === 'string' ? session.url : null;
      if (!url) return c.json(apiError('billing_error', 'Risposta Stripe senza URL'), 502);
      return c.json({ url });
    } catch (e) {
      return c.json(apiError('billing_error', e instanceof StripeApiError ? 'Errore dal provider di pagamento' : 'Errore di rete verso il provider'), 502);
    }
  });

  r.post('/portal', authGate, async (c) => {
    const env = deps.env();
    const secret = env.STRIPE_SECRET_KEY;
    const ret = env.STRIPE_PORTAL_RETURN_URL ?? env.STRIPE_SUCCESS_URL;
    if (!secret || !ret) return c.json(apiError('billing_unconfigured', 'Pagamenti non configurati'), 503);
    const sub = await deps.store.getSubscription(c.get('tenantId'));
    if (!sub?.customerId) return c.json(apiError('no_customer', 'Nessun abbonamento da gestire'), 409);
    try {
      const s = await stripePost(deps.fetch, secret, '/billing_portal/sessions', { customer: sub.customerId, return_url: ret });
      const url = typeof s.url === 'string' ? s.url : null;
      if (!url) return c.json(apiError('billing_error', 'Risposta Stripe senza URL'), 502);
      return c.json({ url });
    } catch {
      return c.json(apiError('billing_error', 'Errore dal provider di pagamento'), 502);
    }
  });

  // Nessuna auth Bearer: l'autenticità è la firma Stripe sul corpo RAW.
  r.post('/webhook', async (c) => {
    const secret = deps.env().STRIPE_WEBHOOK_SECRET;
    if (!secret) return c.json(apiError('billing_unconfigured', 'Webhook non configurato'), 503);
    const raw = await c.req.text();
    const sig = verifyStripeSignature(raw, c.req.header('stripe-signature'), secret, deps.clock.now());
    if (!sig.ok) return c.json(apiError('bad_signature', 'Firma non valida'), 400);
    const ev = parseStripeEvent(raw);
    if (!ev) return c.json(apiError('invalid_event', 'Evento non valido'), 400);
    const graceDays = Number(deps.env().BILLING_GRACE_DAYS ?? '') || undefined;
    try {
      const res = await processStripeEvent(ev, deps.store, deps.clock.now(), graceDays);
      return c.json({ received: true, duplicate: res.duplicate === true });
    } catch {
      return c.json(apiError('processing_failed', 'Elaborazione fallita, riprovare'), 500);
    }
  });

  return r;
}

export const billingRoutes = createBillingRoutes();
