import { serve } from '@hono/node-server';
import { createApp } from './app';
import { closeDb, getDb } from './db';
import { getAuthSecret } from './auth/crypto';
import { getMailer } from './auth/mailer';
import { getKeyRing } from './db/seal';
import { startHousekeeping } from './db/housekeeping';
import { logEvent } from './log';
import { startSdiWorker } from './sdi/routes';

getDb();          // apre il DB e applica le migrazioni
getAuthSecret();  // in produzione fallisce subito se manca AUTH_SECRET
getMailer();      // in produzione fallisce subito se manca SMTP_URL
getKeyRing();     // fallisce subito se APP_ENCRYPTION_KEY / OLD_KEYS non sono valide

if (!process.env.NODE_ENV) logEvent('warn', 'node_env_unset', { hint: 'NODE_ENV non impostato: i controlli di produzione (AUTH_SECRET, SMTP_URL, mock vietati) NON sono attivi. In produzione imposta NODE_ENV=production.' });
if (process.env.NODE_ENV === 'production') {
  if (process.env.AUTH_DEV_RETURN_CODE === '1') logEvent('warn', 'auth_dev_return_code_ignored');
  if ((process.env.CORS_ORIGINS ?? '').split(',').map((x) => x.trim()).includes('*')) logEvent('warn', 'cors_wildcard', { hint: 'CORS_ORIGINS=* riflette qualsiasi origine' });
  if (!process.env.APP_ENCRYPTION_KEY) logEvent('warn', 'app_encryption_disabled', { hint: 'APP_ENCRYPTION_KEY non impostata: campi sensibili in chiaro nel DB' });
}

const port = Number(process.env.PORT ?? 8787);
const server = serve({
  fetch: createApp().fetch, port, hostname: process.env.HOST ?? '127.0.0.1',
  serverOptions: { maxHeaderSize: 16 * 1024 },
});
// Timeout anti-slowloris: intestazioni entro 15 s, richiesta completa (incluso audio) entro 60 s, keep-alive breve.
const srv = server as unknown as { headersTimeout: number; requestTimeout: number; keepAliveTimeout: number; maxRequestsPerSocket: number };
srv.headersTimeout = 15_000;
srv.requestTimeout = 60_000;
srv.keepAliveTimeout = 5_000;
srv.maxRequestsPerSocket = 1000;
console.log(`server in ascolto su :${port}`);
const stopSdiWorker = startSdiWorker();
const stopHousekeeping = startHousekeeping();
const stop = () => { stopSdiWorker(); stopHousekeeping(); server.close(); closeDb(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
