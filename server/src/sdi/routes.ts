// Router SDI (montato da app.ts su /v1/sdi). Provider assente => 'unsupported' + ripiego manuale.
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, authGate, systemClock, type AppEnv, type Clock, type Env } from '../billing/common';
import { HttpSdiProvider, httpConfigFromEnv } from './http-provider';
import { createJobRunner, InMemoryJobStore, PermanentJobError, type JobStore } from './jobs';
import { MockProvider } from './mock';
import {
  InMemorySdiStore, SdiParseError, type DocumentSource, type DocumentStatusSink, type SdiEvent, type SdiProvider, type SdiStore,
} from './types';

export const UNSUPPORTED_MESSAGE =
  "Invio automatico allo SDI non disponibile. Scarica l'XML della fattura e caricalo sul portale gratuito «Fatture e Corrispettivi» dell'Agenzia delle Entrate (oppure invialo via PEC), poi registra l'esito nell'app.";

export interface SdiDeps {
  provider: () => SdiProvider | null;
  jobs: JobStore;
  store: SdiStore;
  documents: DocumentSource | null; // CORE
  sink: DocumentStatusSink | null; // CORE
  clock: Clock;
  env: () => Env;
}

export function providerFromEnv(env: Env, fetchImpl?: typeof fetch): SdiProvider | null {
  if (env.SDI_PROVIDER === 'mock') {
    if (env.NODE_ENV === 'production') return null; // il mock non parte mai in produzione
    return new MockProvider({ webhookSecret: env.SDI_WEBHOOK_SECRET, delayMs: Number(env.SDI_MOCK_DELAY_MS ?? 0) || 0 });
  }
  const cfg = httpConfigFromEnv(env);
  return cfg ? new HttpSdiProvider(cfg, fetchImpl) : null;
}

let envProvider: SdiProvider | null | undefined;
/** Dipendenze di default MUTABILI: CORE imposta `documents`, `sink`, `jobs` (SQLite). */
export const defaultSdiDeps: SdiDeps = {
  provider: () => (envProvider ??= providerFromEnv(process.env)),
  jobs: new InMemoryJobStore(),
  store: new InMemorySdiStore(),
  documents: null,
  sink: null,
  clock: systemClock,
  env: () => process.env,
};

const SubmitBody = z.object({ docId: z.string().min(1).max(100) });
const SUBMITTABLE = new Set(['emessa', 'inviata', 'scartata']); // scartata: rinvio consentito

/** Handler dei job: invio al provider e applicazione eventi al documento. */
export function createSdiRunner(deps: SdiDeps) {
  return createJobRunner(deps.jobs, {
    'sdi.submit': async (job) => {
      const { tenantId, docId } = job.payload as { tenantId: string; docId: string };
      const provider = deps.provider();
      if (!provider) throw new PermanentJobError('provider SDI non configurato');
      if (!deps.documents) throw new PermanentJobError('DocumentSource non cablato');
      const doc = await deps.documents.getIssuedInvoice(tenantId, docId);
      if (!doc) throw new PermanentJobError('documento non trovato');
      const { providerId } = await provider.submit(doc.xml, { docId, tenantId, fileName: doc.fileName });
      await deps.store.saveSubmission({ tenantId, docId, providerId });
      const ev: SdiEvent = { at: deps.clock.now(), type: 'INVIO', channel: 'provider', sdiIdentifier: providerId };
      await deps.sink?.applyEvent(tenantId, docId, ev);
    },
    'sdi.apply_event': async (job) => {
      const { providerId, event } = job.payload as { providerId: string; event: SdiEvent };
      const ref = await deps.store.findByProviderId(providerId);
      if (!ref) throw new Error('submission sconosciuta (riprova: potrebbe non essere ancora registrata)');
      if (!deps.sink) throw new PermanentJobError('DocumentStatusSink non cablato');
      await deps.sink.applyEvent(ref.tenantId, ref.docId, event);
    },
  }, deps.clock);
}

/** Avvia l'elaborazione periodica (da chiamare in index.ts di CORE). Ritorna la funzione di stop. */
export function startSdiWorker(deps: SdiDeps = defaultSdiDeps, intervalMs = 5000): () => void {
  const runner = createSdiRunner(deps);
  const t = setInterval(() => { void runner.runOnce().catch(() => undefined); }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}

export function createSdiRoutes(deps: SdiDeps = defaultSdiDeps) {
  const r = new Hono<AppEnv>();

  r.post('/submit', authGate, async (c) => {
    const parsed = SubmitBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(apiError('invalid_body', 'docId mancante o non valido'), 400);
    const provider = deps.provider();
    if (!provider || !provider.capabilities.submit) return c.json({ status: 'unsupported', message: UNSUPPORTED_MESSAGE });
    if (!deps.documents) return c.json(apiError('not_wired', 'Accesso ai documenti non configurato'), 503);
    const tenantId = c.get('tenantId');
    const doc = await deps.documents.getIssuedInvoice(tenantId, parsed.data.docId);
    if (!doc) return c.json(apiError('not_found', 'Fattura non trovata sul server'), 404);
    if (!SUBMITTABLE.has(doc.status)) return c.json(apiError('not_issued', 'La fattura deve essere emessa prima dell\'invio'), 409);
    const now = deps.clock.now();
    await deps.jobs.enqueue({
      kind: 'sdi.submit', payload: { tenantId, docId: doc.docId },
      dedupeKey: doc.status === 'scartata' ? `submit:${tenantId}:${doc.docId}:${now}` : `submit:${tenantId}:${doc.docId}`,
    }, now);
    return c.json({ status: 'queued' });
  });

  r.post('/webhook/:provider', async (c) => {
    const provider = deps.provider();
    if (!provider || provider.id !== c.req.param('provider')) return c.json(apiError('not_found', 'Provider sconosciuto'), 404);
    const raw = await c.req.text();
    const verify = provider.verifyWebhook;
    if (!verify) return c.json(apiError('bad_signature', 'Verifica firma non disponibile'), 401);
    if (!verify.call(provider, raw, (n) => c.req.header(n))) return c.json(apiError('bad_signature', 'Firma non valida'), 401);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return c.json(apiError('invalid_payload', 'JSON non valido'), 400); }
    let n;
    try { n = provider.parseNotification(payload); } catch (e) {
      if (e instanceof SdiParseError) return c.json(apiError('invalid_payload', e.message), 400);
      throw e;
    }
    const now = deps.clock.now();
    await deps.jobs.enqueue({
      kind: 'sdi.apply_event', payload: n,
      dedupeKey: `evt:${provider.id}:${n.providerId}:${n.event.type}:${n.event.at}`, maxAttempts: 8,
    }, now);
    return c.json({ accepted: true }, 202);
  });

  return r;
}

export const sdiRoutes = createSdiRoutes();
