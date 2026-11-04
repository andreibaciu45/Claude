// Monta i router dei moduli. I nomi billingRoutes/sdiRoutes/voiceRoutes sono di SERVER-EXTRA.
import { Hono } from 'hono';
import { authRoutes, meRoutes } from './auth/routes';
import { applySecurity } from './auth/security';
import type { AuthEnv } from './auth/middleware';
import { documentRoutes } from './documents/routes';
import { syncRoutes } from './sync/routes';
import { billingRoutes } from './billing/routes';
import { sdiRoutes } from './sdi/routes';
import { voiceRoutes } from './voice/routes';
import { accountRoutes } from './account/routes';
import { drainGuard, instrument, opsRoutes } from './ops/routes';

export const createApp = () => {
  const app = new Hono<AuthEnv>();
  app.use('*', instrument);  // metriche (SERVER-OPS): conteggio e latenza per rotta
  app.use('*', drainGuard);  // 503 durante l'arresto ordinato
  applySecurity(app);
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/healthz', (c) => c.text('ok'));
  app.route('/', opsRoutes);  // /metrics (token) e /health/deep
  app.route('/v1/auth', authRoutes);
  app.route('/v1/me', meRoutes);
  app.route('/v1/me', accountRoutes); // export dei dati (GET /export) e cancellazione account (DELETE /)
  app.route('/v1/sync', syncRoutes);
  app.route('/v1/documents', documentRoutes);
  app.route('/v1/billing', billingRoutes);
  app.route('/v1/sdi', sdiRoutes);
  app.route('/v1/voice', voiceRoutes);
  return app;
};
