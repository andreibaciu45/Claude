// Header di sicurezza, CORS da CORS_ORIGINS, limite body, request-id e log JSON senza dati sensibili.
import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import { apiError } from './http';
import { ipRateLimit } from './limits';
import type { AuthEnv } from './middleware';
import { inc } from '../ops/metrics';
import { routeLabel } from '../ops/routes';
import { recordError } from '../ops/stats';

export function applySecurity(app: Hono<AuthEnv>): void {
  app.use('*', async (c, next) => {
    const id = randomUUID();
    c.set('requestId', id);
    const t0 = Date.now();
    await next();
    c.header('X-Request-Id', id);
    c.header('Cache-Control', 'no-store');
    if (process.env.LOG_LEVEL !== 'silent' && process.env.NODE_ENV !== 'test') {
      // Solo metadati: mai body, token, email, codici o contenuto documenti.
      console.log(JSON.stringify({ t: new Date().toISOString(), request_id: id, tenant_id: c.get('tenantId') ?? null,
        method: c.req.method, route: routeLabel(c), path: c.req.path, status: c.res.status, ms: Date.now() - t0 }));
    }
  });
  app.use('*', secureHeaders());
  app.use('*', ipRateLimit); // limite generale per IP (a); i limiti di login sono più severi e stanno nelle rotte
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) {
    app.use('*', cors({
      origin: (o) => (origins.includes('*') ? o : origins.includes(o) ? o : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Client-Version'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }));
  }
  // Limite sul flusso reale (non solo su Content-Length). L'upload audio ha il suo tetto (VOICE_MAX_AUDIO_BYTES + overhead multipart).
  app.use('*', (c, next) => {
    const max = Number(process.env.MAX_BODY_BYTES) || 2_000_000;
    const size = c.req.path === '/v1/voice/transcribe' ? Math.max(max, (Number(process.env.VOICE_MAX_AUDIO_BYTES) || 2 * 1024 * 1024) + 8192) : max;
    return bodyLimit({ maxSize: size, onError: (cc) => apiError(cc, 413, 'payload_too_large', 'Richiesta troppo grande') })(c, next);
  });
  app.notFound((c) => apiError(c, 404, 'not_found', 'Risorsa non trovata'));
  app.onError((err, c) => {
    if (process.env.NODE_ENV !== 'test') console.error(JSON.stringify({ request_id: c.get('requestId'), error: err.name }));
    inc('vp_errors_total', { kind: 'http_500' });
    recordError('http_500', routeLabel(c), err.name); // solo rotta + nome dell'errore (mai messaggio ne' dati)
    return apiError(c, 500, 'internal', 'Errore interno');
  });
}
