/**
 * CONTRATTO API v2 — client (src/sync) e server (server/src) importano SOLO questi tipi.
 * Base path: /v1. Auth: header `Authorization: Bearer <token>` (tranne /auth/*). JSON ovunque.
 * Errori: HTTP 4xx/5xx con corpo ApiError.
 */
import type { CatalogItem, Profile, QuoteDocument, AuditEntry } from './types';

export interface ApiError { error: { code: string; message: string } }

// ---- Auth: email + codice a 6 cifre ----
export interface AuthRequestBody { email: string }                 // POST /v1/auth/request  -> 204
export interface AuthVerifyBody { email: string; code: string; deviceId: string; deviceName?: string }
export interface AuthVerifyResponse { token: string; expiresAt: number; tenantId: string }  // POST /v1/auth/verify
export interface MeResponse { email: string; tenantId: string; plan: 'free' | 'pro'; quota: { docsThisMonth: number; docsLimit: number | null } } // GET /v1/me

// ---- Sync: coda di operazioni idempotenti (opId) ----
export type SyncEntity = 'profile' | 'catalog' | 'document' | 'audit';
export interface SyncOp {
  opId: string;            // uuid, idempotente
  entity: SyncEntity;
  entityId: string;        // 'profile' per il profilo
  op: 'upsert' | 'delete';
  baseUpdatedAt?: number;  // updatedAt visto dal client prima della modifica (per rilevare conflitti)
  payload?: Profile | CatalogItem | QuoteDocument | AuditEntry;
  clientTs: number;
}
export interface SyncPushBody { deviceId: string; ops: SyncOp[] }      // POST /v1/sync/push
export interface SyncConflict {
  opId: string;
  reason: 'locked_document' | 'duplicate_invoice_number' | 'quota_exceeded' | 'invalid' | 'stale';
  message: string;
  serverVersion?: unknown;
}
export interface SyncPushResponse { accepted: string[]; conflicts: SyncConflict[]; cursor: string }
export interface SyncPullResponse {                                     // GET /v1/sync/pull?cursor=...
  cursor: string;
  ops: Omit<SyncOp, 'clientTs'>[];
  hasMore: boolean;
}

// ---- Billing ----
export interface CheckoutResponse { url: string }                       // POST /v1/billing/checkout  {plan:'month'|'year'}
export interface PortalResponse { url: string }                         // POST /v1/billing/portal

// ---- SDI (adapter dietro interfaccia; v1 = mock/manuale) ----
export interface SdiSubmitBody { docId: string }                        // POST /v1/sdi/submit  (richiede fattura emessa sul server)
export interface SdiSubmitResponse { status: 'queued' | 'unsupported'; message?: string }

// ---- Voce ----
export interface TranscribeResponse { text: string }                    // POST /v1/voice/transcribe (multipart: audio)  — iOS PWA
export interface InterpretBody { transcript: string; context?: Record<string, unknown> } // POST /v1/voice/interpret (fallback LLM)
export interface InterpretResponse { intent: string; args: Record<string, unknown>; confidence: number }
