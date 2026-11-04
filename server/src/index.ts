import { serve } from '@hono/node-server';
import { createApp } from './app';
import { closeDb, getDb } from './db';
import { getAuthSecret } from './auth/crypto';
import { getMailer } from './auth/mailer';
import { startSdiWorker } from './sdi/routes';

getDb();          // apre il DB e applica le migrazioni
getAuthSecret();  // in produzione fallisce subito se manca AUTH_SECRET
getMailer();      // in produzione fallisce subito se manca SMTP_URL
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: createApp().fetch, port, hostname: process.env.HOST ?? '127.0.0.1' });
console.log(`server in ascolto su :${port}`);
const stopSdiWorker = startSdiWorker();
const stop = () => { stopSdiWorker(); server.close(); closeDb(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
