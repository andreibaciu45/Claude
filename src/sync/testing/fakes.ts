/** Doppioni di test: server finto in memoria (implementa ApiClient con i tipi di shared/api.ts) e storage locale in memoria. */
import type {
  AuthVerifyBody, AuthVerifyResponse, CheckoutResponse, MeResponse, PortalResponse, SyncConflict, SyncEntity, SyncOp,
  SyncPullResponse, SyncPushBody, SyncPushResponse,
} from '../../../shared/api';
import type { AuditEntry, CatalogItem, Profile, QuoteDocument } from '../../types';
import { ApiClientError, type ApiClient, type DeleteAccountRequest, type DeleteAccountResult } from '../api';
import type { LocalStore } from '../snapshot';
import { defaultProfile } from '../../storage';
import { ImmutableDocumentError } from '../../storage/invoices';

type Payload = NonNullable<SyncOp['payload']>;
interface Stored { payload?: Payload; deleted: boolean; updatedAt?: number }
interface LogEntry { seq: number; op: Omit<SyncOp, 'clientTs'> }

export class FakeServer implements ApiClient {
  entities = new Map<string, Stored>();
  log: LogEntry[] = [];
  processed = new Map<string, 'ok' | SyncConflict>();
  seq = 0;
  pushCalls = 0;
  pullCalls = 0;
  plan: 'free' | 'pro' = 'free';
  docLimit: number | null = null;
  pageSize = 100;
  down = false;       // simula rete assente
  unauthorized = false;
  receivedOps: SyncOp[] = [];
  /** se impostato, viene restituito come serverTime nel push */
  serverTime: number | undefined;
  verifyBodies: AuthVerifyBody[] = [];
  deleteBodies: DeleteAccountRequest[] = [];
  deleteError: ApiClientError | null = null;
  exportBlob = new Blob(['{"account":{}}'], { type: 'application/json' });

  private guard() {
    if (this.down) throw new ApiClientError(0, 'network', 'Nessuna connessione al server.');
    if (this.unauthorized) throw new ApiClientError(401, 'unauthorized', 'Sessione scaduta.');
  }
  private key = (e: SyncEntity, id: string) => `${e}:${id}`;

  /** Scrive come se l'avesse fatto un altro dispositivo. */
  put(entity: SyncEntity, entityId: string, payload: Payload): void {
    const updatedAt = (payload as { updatedAt?: number }).updatedAt;
    this.entities.set(this.key(entity, entityId), { payload, deleted: false, updatedAt });
    this.log.push({ seq: ++this.seq, op: { opId: `srv-${this.seq}`, entity, entityId, op: 'upsert', payload } });
  }
  remove(entity: SyncEntity, entityId: string): void {
    this.entities.set(this.key(entity, entityId), { deleted: true });
    this.log.push({ seq: ++this.seq, op: { opId: `srv-${this.seq}`, entity, entityId, op: 'delete' } });
  }
  get(entity: SyncEntity, id: string): Payload | undefined {
    const s = this.entities.get(this.key(entity, id));
    return s && !s.deleted ? s.payload : undefined;
  }
  count(entity: SyncEntity): number {
    return [...this.entities].filter(([k, v]) => k.startsWith(`${entity}:`) && !v.deleted).length;
  }

  private evaluate(op: SyncOp): SyncConflict | null {
    const k = this.key(op.entity, op.entityId);
    const cur = this.entities.get(k);
    const fail = (reason: SyncConflict['reason'], message: string, serverVersion?: unknown): SyncConflict => ({ opId: op.opId, reason, message, serverVersion });
    if (op.entity === 'document') {
      const existing = cur && !cur.deleted ? (cur.payload as QuoteDocument) : undefined;
      if (existing?.invoice?.lockedAt) return fail('locked_document', 'Documento emesso: immutabile.', existing);
      if (op.op === 'upsert') {
        const d = op.payload as QuoteDocument;
        if (d.invoice?.number) {
          for (const [kk, v] of this.entities) {
            if (!kk.startsWith('document:') || v.deleted || kk === k) continue;
            const o = v.payload as QuoteDocument;
            if (o.invoice?.number === d.invoice.number && o.invoice.year === d.invoice.year && o.invoice.sectional === d.invoice.sectional) {
              return fail('duplicate_invoice_number', `Numero ${d.invoice.number} già usato.`, o);
            }
          }
        }
        if (!existing && this.docLimit !== null && this.count('document') >= this.docLimit) return fail('quota_exceeded', 'Limite del piano Free raggiunto.');
      }
    }
    if (op.entity !== 'audit' && cur && !cur.deleted && op.baseUpdatedAt !== undefined && cur.updatedAt !== undefined && cur.updatedAt > op.baseUpdatedAt) {
      return fail('stale', 'Versione più recente sul server.', cur.payload);
    }
    return null;
  }

  async syncPush(body: SyncPushBody): Promise<SyncPushResponse> {
    this.guard();
    this.pushCalls++;
    const accepted: string[] = [];
    const conflicts: SyncConflict[] = [];
    for (const op of body.ops) {
      this.receivedOps.push(op);
      const done = this.processed.get(op.opId);
      if (done === 'ok') { accepted.push(op.opId); continue; }
      const c = this.evaluate(op);
      if (c) { this.processed.set(op.opId, c); conflicts.push(c); continue; }
      const k = this.key(op.entity, op.entityId);
      if (op.op === 'delete') this.entities.set(k, { deleted: true });
      else this.entities.set(k, { payload: op.payload, deleted: false, updatedAt: (op.payload as { updatedAt?: number })?.updatedAt });
      const { clientTs: _t, ...rest } = op;
      this.log.push({ seq: ++this.seq, op: rest });
      this.processed.set(op.opId, 'ok');
      accepted.push(op.opId);
    }
    return { accepted, conflicts, cursor: String(this.seq), ...(this.serverTime !== undefined ? { serverTime: this.serverTime } : {}) };
  }

  async syncPull(cursor: string): Promise<SyncPullResponse> {
    this.guard();
    this.pullCalls++;
    const after = Number(cursor) || 0;
    const rest = this.log.filter((e) => e.seq > after);
    const page = rest.slice(0, this.pageSize);
    return { ops: page.map((e) => e.op), cursor: String(page.length ? page[page.length - 1].seq : after), hasMore: rest.length > page.length };
  }

  async authRequest(_email: string): Promise<void> { this.guard(); }
  async authVerify(body: AuthVerifyBody): Promise<AuthVerifyResponse> {
    this.verifyBodies.push(body);
    if (body.code !== '123456') throw new ApiClientError(400, 'invalid_code', 'Codice non valido.');
    return { token: `tok-${body.email}`, expiresAt: Date.now() + 1e9, tenantId: `t-${body.email}` };
  }
  async me(): Promise<MeResponse> {
    this.guard();
    return { email: 'a@b.it', tenantId: 't', plan: this.plan, quota: { docsThisMonth: this.count('document'), docsLimit: this.plan === 'pro' ? null : 3 } };
  }
  async checkout(): Promise<CheckoutResponse> { this.guard(); return { url: 'https://pay.example.test/checkout' }; }
  async portal(): Promise<PortalResponse> { this.guard(); return { url: 'https://pay.example.test/portal' }; }
  async exportData(): Promise<Blob> { this.guard(); return this.exportBlob; }
  async deleteAccount(body: DeleteAccountRequest): Promise<DeleteAccountResult> {
    this.guard();
    this.deleteBodies.push(body);
    if (this.deleteError) throw this.deleteError;
    return { deleted: true, mode: 'purged', retainedInvoices: 0 };
  }
}

/** Storage locale in memoria con la stessa semantica di immutabilità. */
export class MemStore implements LocalStore {
  profile: Profile = defaultProfile();
  catalog = new Map<string, CatalogItem>();
  docs = new Map<string, QuoteDocument>();
  audit = new Map<string, AuditEntry>();
  async getProfile() { return structuredClone(this.profile); }
  async saveProfile(p: Profile) { this.profile = structuredClone(p); }
  async listCatalog() { return [...this.catalog.values()].map((x) => structuredClone(x)); }
  async saveCatalogItem(i: CatalogItem) { this.catalog.set(i.id, structuredClone(i)); }
  async deleteCatalogItem(id: string) { this.catalog.delete(id); }
  async listDocuments() { return [...this.docs.values()].map((x) => structuredClone(x)); }
  async saveDocument(d: QuoteDocument) {
    if (this.docs.get(d.id)?.invoice?.lockedAt) throw new ImmutableDocumentError('immutabile');
    this.docs.set(d.id, structuredClone(d));
  }
  async deleteDocument(id: string) {
    if (this.docs.get(id)?.invoice?.lockedAt) throw new ImmutableDocumentError('immutabile');
    this.docs.delete(id);
  }
  async listAudit() { return [...this.audit.values()]; }
  async saveAudit(e: AuditEntry) { this.audit.set(e.id, e); }
}

export const mkItem = (id: string, name = 'Tubo', updatedAt = 10): CatalogItem => ({
  id, name, aliases: [], unit: 'm', price: 5, vat: 22, kind: 'materiale', createdAt: 1, updatedAt,
});
export const mkDoc = (id: string, over: Partial<QuoteDocument> = {}): QuoteDocument => ({
  id, type: 'preventivo', number: `PRev-${id}`, date: '2026-01-01', customer: { id: 'c1', name: 'Mario Rossi' }, lines: [],
  status: 'bozza', createdAt: 1, updatedAt: 10, ...over,
});
