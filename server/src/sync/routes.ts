// POST /v1/sync/push · GET /v1/sync/pull?cursor=&limit=
import { Hono } from 'hono';
import { z } from 'zod';
import type { SyncPullResponse, SyncOp } from '../../../shared/api';
import { apiError, parseJson } from '../auth/http';
import { requireAuth, type AuthEnv } from '../auth/middleware';
import { pullChanges } from '../db/changes';
import { one, run } from '../db';
import { now } from '../db/clock';
import { pushOps } from './service';

const id = z.string().min(1).max(100);
const pushSchema = z.object({
  deviceId: id,
  ops: z.array(z.looseObject({
    opId: id, entity: z.enum(['profile', 'catalog', 'document', 'audit']), entityId: id,
    op: z.enum(['upsert', 'delete']), baseUpdatedAt: z.number().optional(), clientTs: z.number().finite(), payload: z.unknown().optional(),
  })).max(100),
});

export const syncRoutes = new Hono<AuthEnv>();
syncRoutes.use('*', requireAuth);

syncRoutes.post('/push', async (c) => {
  const p = await parseJson(c, pushSchema);
  if (p.res) return p.res;
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (one('SELECT 1 AS x FROM devices WHERE tenant_id=? AND id=?', tenantId, p.data.deviceId)) {
    run('UPDATE devices SET last_seen_at=? WHERE tenant_id=? AND id=?', now(), tenantId, p.data.deviceId);
  }
  return c.json(pushOps({ tenantId, userId, deviceId: p.data.deviceId }, p.data.ops as unknown as SyncOp[]));
});

syncRoutes.get('/pull', (c) => {
  const raw = c.req.query('cursor') ?? '0';
  if (!/^\d{1,15}$/.test(raw)) return apiError(c, 400, 'invalid_cursor', 'Cursore non valido');
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 500);
  const cursor = Number(raw);
  const rows = pullChanges(c.get('tenantId'), cursor, limit + 1);
  const page = rows.slice(0, limit);
  const body: SyncPullResponse = {
    cursor: String(page.length ? page[page.length - 1].seq : cursor),
    hasMore: rows.length > limit,
    ops: page.map((r) => ({
      opId: r.op_id, entity: r.entity as SyncOp['entity'], entityId: r.entity_id, op: r.op as 'upsert' | 'delete',
      ...(r.payload ? { payload: JSON.parse(r.payload) } : {}),
    })),
  };
  return c.json(body);
});
