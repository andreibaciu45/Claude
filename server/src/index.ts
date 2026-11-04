import { serve } from '@hono/node-server';
import { createApp } from './app';
import { closeDb, getDb } from './db';
import { getAuthSecret } from './auth/crypto';
import { getMailer } from './auth/mailer';
import { getKeyRing } from './db/seal';
import { encryptionConfigProblem } from './db/seal-check';
import { startMaintenance } from './ops/maintenance';
import { createShutdown } from './ops/shutdown';
import { logEvent } from './log';
import { startSdiWorker } from './sdi/routes';

getDb();          // apre il DB e applica le migrazioni
getAuthSecret();  // in produzione fallisce subito se manca AUTH_SECRET
getMailer();      // in produzione fallisce subito se manca SMTP_URL
getKeyRing();     // fallisce subito se APP_ENCRYPTION_KEY / OLD_KEYS non sono valide
{ const p = encryptionConfigProblem(getDb()); if (p) throw new Error(p); } // ...o non coprono i dati cifrati già presenti nel DB

if (!process.env.NODE_ENV) logEvent('warn', 'node_env_unset', { hint: 'NODE_ENV non impostato: i controlli di produzione (AUTH_SECRET, SMTP_URL, mock vietati) NON sono attivi. In produzione imposta NODE_ENV=production.' });
if (process.env.NODE_ENV === 'production') {
  if (process.env.AUTH_DEV_RETURN_CODE === '1') logEvent('warn', 'auth_dev_return_code_ignored');
  if ((process.env.CORS_ORIGINS ?? '').split(',').map((x) => x.trim()).includes('*')) logEvent('warn', 'cors_wildcard', { hint: 'CORS_ORIGINS=* riflette qualsiasi origine' });
  if (!process.env.APP_ENCRYPTION_KEY) logEvent('warn', 'app_encryption_disabled', { hint: 'APP_ENCRYPTION_KEY non impostata: campi sensibili in chiaro nel DB' });
  if (process.env.METRICS_TOKEN && process.env.METRICS_TOKEN.length < 16) logEvent('warn', 'metrics_token_too_short', { hint: 'METRICS_TOKEN < 16 caratteri: /metrics resta DISABILITATO' });
}
if (process.env.INVITE_ONLY === '1') logEvent('info', 'invite_only_enabled', { hint: 'registrazioni solo con codice invito (admin.ts create-invite-code)' });

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
const stopMaintenance = startMaintenance();
// Arresto ordinato entro 10 s (SHUTDOWN_TIMEOUT_MS): drena le richieste, ferma i worker, chiude il DB. Systemd: TimeoutStopSec >= 15.
const shutdown = createShutdown({
  server: server as unknown as Parameters<typeof createShutdown>[0]['server'],
  workers: [stopSdiWorker, stopMaintenance],
  closeDb,
  exit: (code) => process.exit(code),
});
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
// Errori non gestiti: si registra il NOME (mai il messaggio) e ci si ferma in modo ordinato; systemd riavvia il servizio.
process.on('uncaughtException', (e) => { logEvent('error', 'uncaught_exception', { name: e?.name ?? 'Error' }); void shutdown('uncaughtException', true); });
process.on('unhandledRejection', (e) => { logEvent('error', 'unhandled_rejection', { name: e instanceof Error ? e.name : 'Error' }); });
