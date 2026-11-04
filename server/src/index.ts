import { serve } from '@hono/node-server';
import { createApp } from './app';
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port, hostname: process.env.HOST ?? '127.0.0.1' });
console.log(`server in ascolto su :${port}`);
