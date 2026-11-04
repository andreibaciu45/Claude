// Stripe senza SDK: verifica firma webhook + chiamate REST via fetch (form-encoded).
import { createHmac } from 'node:crypto';
import { safeEqual } from './common';

export const STRIPE_TOLERANCE_SEC = 300;

export type SigResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

/** Header: `t=<unix>,v1=<hex>[,v1=<hex>...]`. Firma = HMAC-SHA256(secret, `${t}.${rawBody}`). */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined | null,
  secret: string,
  nowMs: number,
  toleranceSec = STRIPE_TOLERANCE_SEC,
): SigResult {
  if (!header) return { ok: false, reason: 'missing' };
  let t: string | undefined;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  // Confronto sempre su tutte le firme (nessun early-exit dipendente dal contenuto).
  let match = false;
  for (const s of sigs) if (safeEqual(s, expected)) match = true;
  if (!match) return { ok: false, reason: 'mismatch' };
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** Utility per test/strumenti: costruisce l'header Stripe-Signature. */
export function signStripePayload(rawBody: string, secret: string, tSec: number): string {
  const sig = createHmac('sha256', secret).update(`${tSec}.${rawBody}`).digest('hex');
  return `t=${tSec},v1=${sig}`;
}

/** Codifica form di Stripe (chiavi annidate `a[b][c]`). */
export function stripeForm(params: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(`${prefix}[${k}]`, x);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join('&');
}

export class StripeApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function stripePost(
  fetchImpl: typeof fetch,
  secretKey: string,
  path: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetchImpl(`https://api.stripe.com/v1${path}`, { method: 'POST', headers, body: stripeForm(params) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* corpo non JSON */ }
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? `Stripe HTTP ${res.status}`;
    throw new StripeApiError(res.status, msg);
  }
  return json;
}
