// GDPR: GET /v1/me/export (portabilità) · DELETE /v1/me (cancellazione, body { confirmEmail, acknowledgeSubscription? }).
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, parseJson } from '../auth/http';
import { tooMany } from '../auth/limits';
import { requireAuth, type AuthEnv } from '../auth/middleware';
import { normalizeEmail } from '../auth/service';
import { one } from '../db';
import { audit } from '../db/audit';
import { now } from '../db/clock';
import { dbRateLimitStore } from '../db/ratelimit';
import { buildExport, deleteAccount, hasActiveSubscription } from './service';

const DAY = 24 * 3600_000;
const deleteSchema = z.object({ confirmEmail: z.string().min(3).max(254), acknowledgeSubscription: z.boolean().optional() });

export const accountRoutes = new Hono<AuthEnv>();

accountRoutes.get('/export', requireAuth, (c) => {
  const tenantId = c.get('tenantId');
  const r = dbRateLimitStore.hit(`export:${tenantId}`, Number(process.env.RL_EXPORT_PER_DAY) || 5, DAY);
  if (!r.ok) return tooMany(c, r, 'Esportazione già richiesta troppe volte oggi, riprova domani');
  const data = buildExport(tenantId, c.get('userId'));
  audit(tenantId, c.get('userId'), 'account.export', 'tenant', tenantId);
  c.header('Content-Disposition', `attachment; filename="vocepreventivo-export-${new Date(now()).toISOString().slice(0, 10)}.json"`);
  return c.json(data);
});

accountRoutes.delete('/', requireAuth, async (c) => {
  const p = await parseJson(c, deleteSchema);
  if (p.res) return p.res;
  const tenantId = c.get('tenantId'), userId = c.get('userId');
  const r = dbRateLimitStore.hit(`acctdel:${tenantId}`, 5, DAY);
  if (!r.ok) return tooMany(c, r);
  const u = one<{ email: string }>('SELECT email FROM users WHERE id=? AND tenant_id=?', userId, tenantId);
  if (!u || normalizeEmail(p.data.confirmEmail) !== u.email) {
    return apiError(c, 400, 'confirmation_mismatch', "Per cancellare l'account invia confirmEmail con l'email dell'account");
  }
  if (hasActiveSubscription(tenantId) && p.data.acknowledgeSubscription !== true) {
    return apiError(c, 409, 'active_subscription',
      "Hai un abbonamento attivo: annullalo dal portale di fatturazione (POST /v1/billing/portal) oppure invia acknowledgeSubscription:true per cancellare comunque l'account (l'abbonamento presso il provider di pagamento va poi annullato da te).");
  }
  const res = deleteAccount(tenantId, userId);
  return c.json({ deleted: true, ...res });
});
