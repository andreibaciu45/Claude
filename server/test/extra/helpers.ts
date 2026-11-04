import type { MiddlewareHandler } from 'hono';
import type { Clock } from '../../src/billing/common';

export const fakeClock = (start = Date.UTC(2026, 5, 15, 12, 0, 0)) => {
  let t = start;
  return { now: () => t, set: (n: number) => { t = n; }, advance: (ms: number) => { t += ms; } } satisfies Clock & { set(n: number): void; advance(ms: number): void };
};
/** Auth finta: tenant/user dagli header di test. */
export const fakeAuth: MiddlewareHandler = async (c, next) => {
  const t = c.req.header('x-test-tenant');
  if (!t) return c.json({ error: { code: 'unauthorized', message: 'no' } }, 401);
  c.set('tenantId', t);
  c.set('userId', 'u_' + t);
  await next();
};
export const AUTH = { 'x-test-tenant': 't1' };
