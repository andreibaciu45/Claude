import type { SdiEvent } from '../../../shared/types';

export type { SdiEvent };

export interface SdiSubmitMeta { docId: string; tenantId: string; fileName?: string }
export interface SdiCapabilities {
  submit: boolean;
  webhook: boolean;
  /** true solo per il mock: nessun invio reale allo SDI */
  simulated: boolean;
}
/** Notifica normalizzata: l'evento + l'identificativo del provider per risalire al documento. */
export interface SdiNotification { providerId: string; event: SdiEvent }

export interface SdiProvider {
  readonly id: string;
  readonly capabilities: SdiCapabilities;
  submit(xml: string, meta: SdiSubmitMeta): Promise<{ providerId: string }>;
  /** Lancia SdiParseError se il payload non è riconoscibile. */
  parseNotification(payload: unknown): SdiNotification;
  /** Verifica firma webhook sul corpo RAW. Assente => nessuna verifica possibile (rifiutato in produzione dalle route). */
  verifyWebhook?(rawBody: string, headers: (name: string) => string | undefined): boolean;
}

export class SdiParseError extends Error {}

/** Il documento fattura emessa sul server (fornito da CORE). */
export interface IssuedInvoice { docId: string; tenantId: string; xml: string; fileName?: string; status: string }
export interface DocumentSource { getIssuedInvoice(tenantId: string, docId: string): Promise<IssuedInvoice | null> }
/** Aggiorna lo stato del documento dopo un evento SDI (CORE: documents). */
export interface DocumentStatusSink { applyEvent(tenantId: string, docId: string, event: SdiEvent): Promise<void> }

export interface SubmissionRef { tenantId: string; docId: string; providerId: string }
export interface SdiStore {
  saveSubmission(ref: SubmissionRef): Promise<void>;
  findByProviderId(providerId: string): Promise<SubmissionRef | null>;
}
export class InMemorySdiStore implements SdiStore {
  private m = new Map<string, SubmissionRef>();
  async saveSubmission(r: SubmissionRef) { this.m.set(r.providerId, r); }
  async findByProviderId(p: string) { return this.m.get(p) ?? null; }
}
