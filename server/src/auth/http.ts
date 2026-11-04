import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { ApiError } from '../../../shared/api';

type Status = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500;
export const apiError = (c: Context, status: Status, code: string, message: string, headers?: Record<string, string>) =>
  c.json({ error: { code, message } } satisfies ApiError, status, headers);

/** Legge e valida il body JSON; ritorna null (e risposta già pronta in `res`) se non valido. Non riporta mai il contenuto ricevuto. */
export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<{ data: T; res?: undefined } | { data?: undefined; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { res: apiError(c, 400, 'bad_json', 'Corpo JSON non valido') };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(radice)'}: ${i.message}`).join('; ');
    return { res: apiError(c, 400, 'invalid_body', msg) };
  }
  return { data: r.data };
}
