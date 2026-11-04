// Applicazione delle operazioni di sync. Regole (ARCHITECTURE-V2 §2.3-2.4, CONTRACT-V2):
//  - idempotenza per (tenant, opId): un'op già accettata è riconfermata senza riapplicarla;
//  - last-write-wins per bozze/profilo/catalogo confrontando updatedAt del payload (clientTs per il profilo) con quello del server:
//    se l'op è PIÙ VECCHIA di quanto il server ha → conflitto `stale` (non applicata, serverVersion restituita);
//  - fatture bloccate (invoice.lockedAt): mai sovrascritte; ammessi solo status/updatedAt/sdiEvents/payments/paymentStatus;
//  - numero fattura unico per (tenant, sezionale, anno, seq) → `duplicate_invoice_number`;
//  - Free: 3 documenti NUOVI/mese → `quota_exceeded`.
import type { SyncConflict, SyncOp, SyncPushResponse } from '../../../shared/api';
import type { QuoteDocument } from '../../../shared/types';
import { one, run, transaction } from '../db';
import { now } from '../db/clock';
import { audit } from '../db/audit';
import { appendChange, currentCursor } from '../db/changes';
import { FREE_DOCS_PER_MONTH, getDocsThisMonth, getPlan, incrementDocsCreated } from '../db/entitlements';
import { auditSchema, catalogSchema, documentSchema, profileSchema } from '../documents/schema';
import { findInvoiceNumberOwner, getDocumentRecord, softDeleteDocument, upsertDocument } from '../documents/repo';

export interface PushContext { tenantId: string; userId: string; deviceId: string }
type Raw = Omit<SyncOp, 'payload'> & { payload?: unknown };
type Reason = SyncConflict['reason'];
type Result = { ok: true } | { ok: false; reason: Reason; message: string; serverVersion?: unknown };
const bad = (reason: Reason, message: string, serverVersion?: unknown): Result => ({ ok: false, reason, message, serverVersion });

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 5).map((i) => `${i.path.map(String).join('.') || '(radice)'}: ${i.message}`).join('; ');

// ---- confronto documenti bloccati ----
const strip = (d: any) => {
  const c = JSON.parse(JSON.stringify(d));
  delete c.status; delete c.updatedAt;
  if (c.invoice) { delete c.invoice.sdiEvents; delete c.invoice.payments; delete c.invoice.paymentStatus; }
  return c;
};
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x);

function applyDocument(ctx: PushContext, op: Raw): Result {
  const { tenantId } = ctx;
  const existing = getDocumentRecord(tenantId, op.entityId);

  if (op.op === 'delete') {
    if (!existing || existing.deletedAt !== null && existing.lockedAt === null) return { ok: true }; // già assente: idempotente
    if (existing.lockedAt !== null) return bad('locked_document', 'Documento emesso: non eliminabile', existing.data);
    if (existing.updatedAt > op.clientTs) return bad('stale', 'Il server ha una versione più recente', existing.data);
    softDeleteDocument(tenantId, op.entityId, op.clientTs);
    appendChange(tenantId, op.opId, 'document', op.entityId, 'delete', null);
    return { ok: true };
  }

  const parsed = documentSchema.safeParse(op.payload);
  if (!parsed.success) return bad('invalid', issues(parsed.error));
  const doc = parsed.data as unknown as QuoteDocument;
  if (doc.id !== op.entityId) return bad('invalid', 'entityId e payload.id non coincidono');
  if (existing && existing.type !== doc.type) return bad('invalid', 'Il tipo di documento non può cambiare');

  // --- documento già bloccato ---
  if (existing && existing.lockedAt !== null) {
    const cur = existing.data as any;
    if (doc.status === 'bozza' || !doc.invoice?.lockedAt || canon(strip(cur)) !== canon(strip(doc))) {
      return bad('locked_document', 'Documento emesso: immutabile', existing.data);
    }
    if (doc.updatedAt < existing.updatedAt || (doc.invoice.sdiEvents ?? []).length < (cur.invoice?.sdiEvents ?? []).length) {
      return bad('stale', 'Il server ha una versione più recente', existing.data);
    }
    const next = JSON.parse(JSON.stringify(cur));
    next.status = doc.status; next.updatedAt = doc.updatedAt;
    for (const k of ['sdiEvents', 'payments', 'paymentStatus'] as const) if (doc.invoice[k] !== undefined) next.invoice[k] = doc.invoice[k];
    if (canon(next) === canon(cur)) return { ok: true }; // nessuna novità
    run('UPDATE documents SET status=?, updated_at=?, data=? WHERE tenant_id=? AND id=?', next.status, next.updatedAt, JSON.stringify(next), tenantId, doc.id);
    appendChange(tenantId, op.opId, 'document', doc.id, 'upsert', next);
    return { ok: true };
  }

  // --- bozza / preventivo / nuovo ---
  if (existing && existing.updatedAt > doc.updatedAt) return bad('stale', 'Il server ha una versione più recente', existing.data);

  const inv = doc.invoice;
  if (inv?.lockedAt !== undefined) {
    if (doc.type !== 'fattura' || inv.seq === undefined || !inv.number || doc.status === 'bozza') {
      return bad('invalid', 'Fattura emessa incompleta (seq, number e stato)');
    }
    const owner = findInvoiceNumberOwner(tenantId, inv.sectional, inv.year, inv.seq);
    if (owner && owner !== doc.id) return bad('duplicate_invoice_number', `Numero ${inv.sectional} ${inv.year}/${inv.seq} già utilizzato`);
  }

  if (!existing && getPlan(tenantId) === 'free' && getDocsThisMonth(tenantId) >= FREE_DOCS_PER_MONTH) {
    return bad('quota_exceeded', `Piano Free: massimo ${FREE_DOCS_PER_MONTH} documenti al mese`);
  }
  upsertDocument(tenantId, doc, doc.updatedAt);
  if (!existing) incrementDocsCreated(tenantId);
  appendChange(tenantId, op.opId, 'document', doc.id, 'upsert', doc);
  return { ok: true };
}

function applyCatalog(ctx: PushContext, op: Raw): Result {
  const { tenantId } = ctx;
  const row = one<{ data: string; updated_at: number; deleted_at: number | null }>('SELECT data, updated_at, deleted_at FROM catalog_items WHERE tenant_id=? AND id=?', tenantId, op.entityId);
  if (op.op === 'delete') {
    if (!row || row.deleted_at !== null) return { ok: true };
    if (row.updated_at > op.clientTs) return bad('stale', 'Il server ha una versione più recente', JSON.parse(row.data));
    run('UPDATE catalog_items SET deleted_at=?, updated_at=? WHERE tenant_id=? AND id=?', op.clientTs, op.clientTs, tenantId, op.entityId);
    appendChange(tenantId, op.opId, 'catalog', op.entityId, 'delete', null);
    return { ok: true };
  }
  const p = catalogSchema.safeParse(op.payload);
  if (!p.success) return bad('invalid', issues(p.error));
  if (p.data.id !== op.entityId) return bad('invalid', 'entityId e payload.id non coincidono');
  if (row && row.updated_at > p.data.updatedAt) return bad('stale', 'Il server ha una versione più recente', JSON.parse(row.data));
  run(`INSERT INTO catalog_items(tenant_id, id, data, updated_at, deleted_at) VALUES (?,?,?,?,NULL)
       ON CONFLICT(tenant_id, id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, deleted_at=NULL`,
    tenantId, op.entityId, JSON.stringify(p.data), p.data.updatedAt);
  appendChange(tenantId, op.opId, 'catalog', op.entityId, 'upsert', p.data);
  return { ok: true };
}

function applyProfile(ctx: PushContext, op: Raw): Result {
  const { tenantId } = ctx;
  if (op.entityId !== 'profile') return bad('invalid', "entityId del profilo deve essere 'profile'");
  if (op.op === 'delete') return bad('invalid', 'Il profilo non si elimina');
  const p = profileSchema.safeParse(op.payload);
  if (!p.success) return bad('invalid', issues(p.error));
  const row = one<{ data: string; updated_at: number }>('SELECT data, updated_at FROM profiles WHERE tenant_id=?', tenantId);
  if (row && row.updated_at > op.clientTs) return bad('stale', 'Il server ha una versione più recente', JSON.parse(row.data));
  run('INSERT INTO profiles(tenant_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    tenantId, JSON.stringify(p.data), op.clientTs);
  appendChange(tenantId, op.opId, 'profile', 'profile', 'upsert', p.data);
  return { ok: true };
}

function applyAudit(ctx: PushContext, op: Raw): Result {
  if (op.op !== 'upsert') return bad('invalid', 'Il registro audit è append-only');
  const p = auditSchema.safeParse(op.payload);
  if (!p.success) return bad('invalid', issues(p.error));
  if (p.data.id !== op.entityId) return bad('invalid', 'entityId e payload.id non coincidono');
  const r = run(
    'INSERT OR IGNORE INTO audit_log(tenant_id, user_id, at, action, entity, entity_id, ref_id, payload) VALUES (?,?,?,?,?,?,?,?)',
    ctx.tenantId, ctx.userId, p.data.at, `client.${p.data.action}`, 'audit', p.data.docId, p.data.id, JSON.stringify(p.data));
  if (Number(r.changes) > 0) appendChange(ctx.tenantId, op.opId, 'audit', p.data.id, 'upsert', p.data);
  return { ok: true };
}

function applyOp(ctx: PushContext, op: Raw): Result {
  switch (op.entity) {
    case 'document': return applyDocument(ctx, op);
    case 'catalog': return applyCatalog(ctx, op);
    case 'profile': return applyProfile(ctx, op);
    case 'audit': return applyAudit(ctx, op);
    default: return bad('invalid', 'entità sconosciuta');
  }
}

export function pushOps(ctx: PushContext, ops: Raw[]): SyncPushResponse {
  const accepted: string[] = [];
  const conflicts: SyncConflict[] = [];
  for (const op of ops) {
    const seen = one('SELECT 1 AS x FROM sync_ops WHERE tenant_id=? AND op_id=?', ctx.tenantId, op.opId);
    if (seen) { accepted.push(op.opId); continue; }
    let res: Result;
    try {
      res = transaction(() => {
        const r = applyOp(ctx, op);
        if (r.ok) {
          run('INSERT INTO sync_ops(tenant_id, op_id, device_id, applied_at) VALUES (?,?,?,?)', ctx.tenantId, op.opId, ctx.deviceId, now());
          audit(ctx.tenantId, ctx.userId, `sync.${op.entity}.${op.op}`, op.entity, op.entityId, { opId: op.opId, deviceId: ctx.deviceId });
        }
        return r;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('documento_bloccato')) res = bad('locked_document', 'Documento emesso: immutabile');
      else if (msg.includes('UNIQUE') && msg.includes('inv_seq')) res = bad('duplicate_invoice_number', 'Numero fattura già utilizzato');
      else throw e;
    }
    if (res.ok) accepted.push(op.opId);
    else conflicts.push({ opId: op.opId, reason: res.reason, message: res.message, ...(res.serverVersion !== undefined ? { serverVersion: res.serverVersion } : {}) });
  }
  return { accepted, conflicts, cursor: String(currentCursor(ctx.tenantId)) };
}
