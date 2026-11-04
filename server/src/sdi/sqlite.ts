// Adattatori SQLite (DB di CORE) per coda job SDI, mappa submission, sorgente documenti e sink di stato.
// Migrazione 101 registrata all'import (PRIMA della prima apertura del DB).
import { all, one, registerMigration, run, transaction } from '../db';
import { appendChange } from '../db/changes';
import { audit } from '../db/audit';
import { openDocument } from '../db/seal';
import type { Job, JobStatus, JobStore, NewJob } from './jobs';
import type { DocumentSource, DocumentStatusSink, IssuedInvoice, SdiEvent, SdiStore, SubmissionRef } from './types';

registerMigration(101, 'extra_sdi', `
CREATE TABLE sdi_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, dedupe_key TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', last_error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_sdi_jobs_due ON sdi_jobs(status, run_at);
CREATE TABLE sdi_submissions (
  provider_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
`);

interface JRow { id: number; kind: string; payload: string; dedupe_key: string | null; attempts: number; max_attempts: number; run_at: number; status: string; last_error: string | null; created_at: number }
const toJob = (r: JRow): Job => ({
  id: String(r.id), kind: r.kind, payload: JSON.parse(r.payload), dedupeKey: r.dedupe_key ?? undefined, attempts: r.attempts,
  maxAttempts: r.max_attempts, runAt: r.run_at, status: r.status as JobStatus, lastError: r.last_error ?? undefined, createdAt: r.created_at,
});

export class SqliteJobStore implements JobStore {
  async enqueue(j: NewJob, now: number) {
    const r = run(`INSERT OR IGNORE INTO sdi_jobs(kind, payload, dedupe_key, max_attempts, run_at, created_at) VALUES (?,?,?,?,?,?)`,
      j.kind, JSON.stringify(j.payload), j.dedupeKey ?? null, j.maxAttempts ?? 5, j.runAt ?? now, now);
    const row = Number(r.changes) === 1
      ? one<JRow>('SELECT * FROM sdi_jobs WHERE id=?', Number(r.lastInsertRowid))!
      : one<JRow>('SELECT * FROM sdi_jobs WHERE dedupe_key=?', j.dedupeKey ?? '')!;
    return toJob(row);
  }
  async claimDue(now: number, limit: number) {
    return transaction(() => {
      const rows = all<JRow>(`SELECT * FROM sdi_jobs WHERE status='queued' AND run_at<=? ORDER BY run_at LIMIT ?`, now, limit);
      for (const r of rows) run(`UPDATE sdi_jobs SET status='running', attempts=attempts+1 WHERE id=?`, r.id);
      return rows.map((r) => toJob({ ...r, status: 'running', attempts: r.attempts + 1 }));
    });
  }
  async markDone(id: string) { run(`UPDATE sdi_jobs SET status='done' WHERE id=?`, Number(id)); }
  async markFailed(id: string, error: string, next: number | null) {
    if (next === null) run(`UPDATE sdi_jobs SET status='dead', last_error=? WHERE id=?`, error, Number(id));
    else run(`UPDATE sdi_jobs SET status='queued', last_error=?, run_at=? WHERE id=?`, error, next, Number(id));
  }
  async get(id: string) { const r = one<JRow>('SELECT * FROM sdi_jobs WHERE id=?', Number(id)); return r ? toJob(r) : null; }
  async list(status?: JobStatus) {
    return (status ? all<JRow>('SELECT * FROM sdi_jobs WHERE status=?', status) : all<JRow>('SELECT * FROM sdi_jobs')).map(toJob);
  }
}

export class SqliteSdiStore implements SdiStore {
  async saveSubmission(r: SubmissionRef) {
    run('INSERT OR REPLACE INTO sdi_submissions(provider_id, tenant_id, doc_id, created_at) VALUES (?,?,?,?)', r.providerId, r.tenantId, r.docId, Date.now());
  }
  async findByProviderId(p: string) {
    const r = one<{ tenant_id: string; doc_id: string }>('SELECT tenant_id, doc_id FROM sdi_submissions WHERE provider_id=?', p);
    return r ? { tenantId: r.tenant_id, docId: r.doc_id, providerId: p } : null;
  }
}

export class SqliteDocumentSource implements DocumentSource {
  async getIssuedInvoice(tenantId: string, docId: string): Promise<IssuedInvoice | null> {
    const r = one<{ status: string; data: string }>(
      `SELECT status, data FROM documents WHERE tenant_id=? AND id=? AND type='fattura' AND deleted_at IS NULL AND locked_at IS NOT NULL`, tenantId, docId);
    if (!r) return null;
    const d = openDocument(tenantId, JSON.parse(r.data)) as { invoice?: { xml?: string; fileName?: string } };
    if (!d.invoice?.xml) return null;
    return { docId, tenantId, xml: d.invoice.xml, fileName: d.invoice.fileName, status: r.status };
  }
}

const STATUS_BY_EVENT: Record<SdiEvent['type'], string> = {
  INVIO: 'inviata', RC: 'consegnata', NS: 'scartata', MC: 'mancata_consegna',
};
// Il trigger DB consente di modificare solo status/updatedAt/invoice.sdiEvents/payments/paymentStatus su fatture bloccate.
export class SqliteDocumentSink implements DocumentStatusSink {
  async applyEvent(tenantId: string, docId: string, event: SdiEvent) {
    transaction(() => {
      const r = one<{ data: string; status: string }>('SELECT data, status FROM documents WHERE tenant_id=? AND id=?', tenantId, docId);
      if (!r) throw new Error('documento non trovato');
      const doc = JSON.parse(r.data) as { status?: string; updatedAt?: number; invoice?: { sdiEvents?: SdiEvent[] } };
      const events = doc.invoice?.sdiEvents ?? [];
      // idempotenza: stesso tipo+istante già registrato
      if (events.some((e) => e.type === event.type && e.at === event.at)) return;
      // Una fattura già 'stornata' non regredisce; 'INVIO' non sovrascrive un esito già ricevuto.
      const terminal = new Set(['consegnata', 'mancata_consegna', 'scartata', 'stornata']);
      const status = r.status === 'stornata' || (event.type === 'INVIO' && terminal.has(r.status)) ? r.status : STATUS_BY_EVENT[event.type];
      const now = Math.max(Date.now(), (doc.updatedAt ?? 0) + 1); // mai all'indietro rispetto alla versione che il client ha già visto
      doc.invoice = { ...(doc.invoice ?? {}), sdiEvents: [...events, event] };
      doc.status = status;
      doc.updatedAt = now;
      run('UPDATE documents SET status=?, updated_at=?, data=? WHERE tenant_id=? AND id=?', status, now, JSON.stringify(doc), tenantId, docId);
      // Il DB conserva la forma "raw" (campi sensibili ancora cifrati, invariati); il log di sync riceve il documento in chiaro.
      appendChange(tenantId, `sdi:${docId}:${event.type}:${event.at}`, 'document', docId, 'upsert', openDocument(tenantId, doc as Record<string, any>));
      audit(tenantId, null, 'sdi_event', 'document', docId, { type: event.type, codes: event.errorCodes }, `sdi:${docId}:${event.type}:${event.at}`);
    });
  }
}
