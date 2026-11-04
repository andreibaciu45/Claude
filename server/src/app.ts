// SCHELETO (proprietà: agente SERVER-CORE). Monta i router dei vari moduli con i nomi fissi sotto.
import { Hono } from 'hono';
import { authRoutes } from './auth/routes';
import { syncRoutes } from './sync/routes';
import { billingRoutes } from './billing/routes';
import { sdiRoutes } from './sdi/routes';
import { voiceRoutes } from './voice/routes';

export const createApp = () => {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/v1/auth', authRoutes);
  app.route('/v1/sync', syncRoutes);
  app.route('/v1/billing', billingRoutes);
  app.route('/v1/sdi', sdiRoutes);
  app.route('/v1/voice', voiceRoutes);
  return app;
};
