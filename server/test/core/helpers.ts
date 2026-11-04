import { createApp } from '../../src/app';
import { resetDb } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { setMailer, type Mailer } from '../../src/auth/mailer';
import type { QuoteDocument, CatalogItem } from '../../../shared/types';
import type { SyncOp } from '../../../shared/api';

export const sent: { email: string; code: string }[] = [];
export const captureMailer: Mailer = { async sendOtp(email, code) { sent.push({ email, code }); } };

export const app = createApp();
export function freshEnv() {
  resetDb();
  setClock(null);
  sent.length = 0;
  setMailer(captureMailer);
}

export async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* non json */ }
  return { status: res.status, json, headers: res.headers };
}

export async function login(email: string, deviceId = 'dev-1') {
  await call('POST', '/v1/auth/request', { body: { email } });
  const code = [...sent].reverse().find((m) => m.email === email.toLowerCase())!.code;
  const r = await call('POST', '/v1/auth/verify', { body: { email, code, deviceId } });
  if (r.status !== 200) throw new Error('login fallito ' + r.status);
  return r.json as { token: string; tenantId: string; expiresAt: number };
}

let n = 0;
export const opId = () => `op-${++n}-${Math.random().toString(16).slice(2)}`;

export function quote(id: string, over: Partial<QuoteDocument> = {}): QuoteDocument {
  return { id, type: 'preventivo', number: 'PRev-0001', date: '2026-11-04', customer: { id: 'c-1', name: 'Mario Rossi' },
    lines: [{ id: 'l1', description: 'Posa', qty: 1, unit: 'h', unitPrice: 50, vat: 22 }], status: 'bozza', createdAt: 1000, updatedAt: 1000, ...over };
}
export function invoice(id: string, seq: number, over: Partial<QuoteDocument> = {}, lock = true): QuoteDocument {
  return quote(id, { type: 'fattura', number: `${seq}/2026`, status: lock ? 'emessa' : 'bozza',
    invoice: { tipoDocumento: 'TD01', year: 2026, sectional: 'FT', ...(lock ? { seq, number: `${seq}/2026`, lockedAt: 5000 } : {}),
      operationDate: '2026-11-04', stampDuty: false, stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice',
      sdiEvents: [], paymentStatus: 'non_pagata', payments: [] } as any, ...over });
}
export const docOp = (d: QuoteDocument, extra: Partial<SyncOp> = {}): SyncOp => ({ opId: opId(), entity: 'document', entityId: d.id, op: 'upsert', payload: d, clientTs: d.updatedAt, ...extra });
export const catalogItem = (id: string, over: Partial<CatalogItem> = {}): CatalogItem => ({ id, name: 'Tubo rame', aliases: [], unit: 'm', price: 5, vat: 22, kind: 'materiale', createdAt: 1000, updatedAt: 1000, ...over });
export const push = (token: string, ops: SyncOp[], deviceId = 'dev-1') => call('POST', '/v1/sync/push', { token, body: { deviceId, ops } });
