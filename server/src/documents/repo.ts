// Repository documenti. Tutte le funzioni richiedono tenantId come PRIMO argomento.
// Esportato per SERVER-EXTRA (sdi): getDocument, patchLockedDocument.
import { randomUUID } from 'node:crypto';
import type { QuoteDocument } from '../../../shared/types';
import { all, one, run } from '../db';
import { now } from '../db/clock';
import { appendChange } from '../db/changes';

interface Row { id: string; type: string; status: string; number: string | null; inv_year: number | null; inv_sectional: string | null;
  inv_seq: number | null; locked_at: number | null; created_at: number; updated_at: number; deleted_at: number | null; data: string }

export interface DocRecord {
  id: string; type: string; status: string; lockedAt: number | null; updatedAt: number; deletedAt: number | null; data: QuoteDocument;
}
const toRecord = (r: Row): DocRecord => ({ id: r.id, type: r.type, status: r.status, lockedAt: r.locked_at, updatedAt: r.updated_at, deletedAt: r.deleted_at, data: JSON.parse(r.data) as QuoteDocument });

/** Include i soft-deleted (tombstone). */
export function getDocumentRecord(tenantId: string, id: string): DocRecord | undefined {
  const r = one<Row>('SELECT * FROM documents WHERE tenant_id=? AND id=?', tenantId, id);
  return r ? toRecord(r) : undefined;
}
/** Documento attivo del tenant o undefined (anche se appartiene a un altro tenant). */
export function getDocument(tenantId: string, id: string): QuoteDocument | undefined {
  const r = getDocumentRecord(tenantId, id);
  return r && r.deletedAt === null ? r.data : undefined;
}

export function listDocuments(tenantId: string, limit = 100, offset = 0) {
  return all<{ id: string; type: string; status: string; number: string | null; updated_at: number; locked_at: number | null }>(
    'SELECT id, type, status, number, updated_at, locked_at FROM documents WHERE tenant_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id LIMIT ? OFFSET ?',
    tenantId, limit, offset).map((r) => ({ id: r.id, type: r.type, status: r.status, number: r.number, updatedAt: r.updated_at, locked: r.locked_at !== null }));
}

export function findInvoiceNumberOwner(tenantId: string, sectional: string, year: number, seq: number): string | undefined {
  return one<{ id: string }>('SELECT id FROM documents WHERE tenant_id=? AND inv_sectional=? AND inv_year=? AND inv_seq=?', tenantId, sectional, year, seq)?.id;
}

function indexed(doc: QuoteDocument) {
  const inv = doc.invoice;
  const locked = inv?.lockedAt ?? null;
  return {
    number: doc.number ?? null,
    year: inv?.year ?? null, sectional: inv?.sectional ?? null,
    seq: locked !== null && inv?.seq !== undefined ? inv.seq : null, // seq indicizzato (UNIQUE) solo per le emesse
    lockedAt: locked,
  };
}

export function upsertDocument(tenantId: string, doc: QuoteDocument, updatedAt: number): void {
  const x = indexed(doc);
  const json = JSON.stringify(doc);
  run(`INSERT INTO documents(tenant_id, id, type, status, number, inv_year, inv_sectional, inv_seq, locked_at, created_at, updated_at, deleted_at, data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?)
       ON CONFLICT(tenant_id, id) DO UPDATE SET status=excluded.status, number=excluded.number, inv_year=excluded.inv_year,
         inv_sectional=excluded.inv_sectional, inv_seq=excluded.inv_seq, locked_at=excluded.locked_at, updated_at=excluded.updated_at,
         deleted_at=NULL, data=excluded.data`,
    tenantId, doc.id, doc.type, doc.status, x.number, x.year, x.sectional, x.seq, x.lockedAt, doc.createdAt, updatedAt, json);
}

export function softDeleteDocument(tenantId: string, id: string, at: number): void {
  run('UPDATE documents SET deleted_at=?, updated_at=? WHERE tenant_id=? AND id=? AND locked_at IS NULL', at, at, tenantId, id);
}

const ALLOWED_LOCKED = ['status', 'updatedAt'] as const;
/**
 * Per SERVER-EXTRA (esiti SDI, pagamenti): modifica SOLO i campi ammessi di una fattura bloccata
 * (status, updatedAt, invoice.sdiEvents/payments/paymentStatus) e registra la modifica nel log di sync.
 * I trigger SQL impediscono comunque qualsiasi altra modifica. Ritorna false se il documento non esiste per quel tenant.
 */
export function patchLockedDocument(tenantId: string, id: string, patch: {
  status?: QuoteDocument['status']; sdiEvents?: unknown[]; payments?: unknown[]; paymentStatus?: string;
}): boolean {
  const rec = getDocumentRecord(tenantId, id);
  if (!rec || rec.deletedAt !== null || rec.lockedAt === null) return false;
  const d = JSON.parse(JSON.stringify(rec.data)) as Record<string, any>;
  void ALLOWED_LOCKED;
  if (patch.status) d.status = patch.status;
  if (d.invoice) {
    if (patch.sdiEvents) d.invoice.sdiEvents = patch.sdiEvents;
    if (patch.payments) d.invoice.payments = patch.payments;
    if (patch.paymentStatus) d.invoice.paymentStatus = patch.paymentStatus;
  }
  const t = Math.max(now(), rec.updatedAt + 1);
  d.updatedAt = t;
  run('UPDATE documents SET status=?, updated_at=?, data=? WHERE tenant_id=? AND id=?', d.status, t, JSON.stringify(d), tenantId, id);
  appendChange(tenantId, randomUUID(), 'document', id, 'upsert', d);
  return true;
}
