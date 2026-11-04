// Adattatore HTTP GENERICO (scheletro, es. API stile Openapi/A-Cube). DISATTIVATO di default:
// nessun provider SDI è stato scelto e non esistono credenziali. Endpoint/campi configurabili da env.
import { createHmac } from 'node:crypto';
import { safeEqual, type Env } from '../billing/common';
import { SdiParseError, type SdiEvent, type SdiNotification, type SdiProvider, type SdiSubmitMeta } from './types';

export interface HttpProviderConfig {
  baseUrl: string;
  apiKey: string;
  submitPath: string; // default /invoices
  idField: string; // campo della risposta con l'id provider (default 'id')
  webhookSecret?: string;
  signatureHeader: string; // default x-signature (HMAC-SHA256 hex del corpo)
  /** mappa stato-provider -> esito SDI. Default sotto, sovrascrivibile da SDI_HTTP_STATUS_MAP (JSON). */
  statusMap: Record<string, 'RC' | 'NS' | 'MC' | 'INVIO'>;
}
const DEFAULT_STATUS_MAP: HttpProviderConfig['statusMap'] = {
  sent: 'INVIO', submitted: 'INVIO', delivered: 'RC', rejected: 'NS', failed_delivery: 'MC',
  RC: 'RC', NS: 'NS', MC: 'MC',
};

export function httpConfigFromEnv(env: Env): HttpProviderConfig | null {
  if (env.SDI_PROVIDER !== 'http') return null;
  if (!env.SDI_HTTP_BASE_URL || !env.SDI_HTTP_API_KEY) return null;
  let map = DEFAULT_STATUS_MAP;
  if (env.SDI_HTTP_STATUS_MAP) {
    try { map = { ...DEFAULT_STATUS_MAP, ...(JSON.parse(env.SDI_HTTP_STATUS_MAP) as HttpProviderConfig['statusMap']) }; } catch { return null; }
  }
  return {
    baseUrl: env.SDI_HTTP_BASE_URL.replace(/\/+$/, ''),
    apiKey: env.SDI_HTTP_API_KEY,
    submitPath: env.SDI_HTTP_SUBMIT_PATH ?? '/invoices',
    idField: env.SDI_HTTP_ID_FIELD ?? 'id',
    webhookSecret: env.SDI_WEBHOOK_SECRET,
    signatureHeader: (env.SDI_WEBHOOK_SIGNATURE_HEADER ?? 'x-signature').toLowerCase(),
    statusMap: map,
  };
}

export class HttpSdiProvider implements SdiProvider {
  readonly id = 'http';
  readonly capabilities = { submit: true, webhook: true, simulated: false };
  constructor(private cfg: HttpProviderConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  async submit(xml: string, meta: SdiSubmitMeta) {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${this.cfg.submitPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/xml',
        'Idempotency-Key': `${meta.tenantId}:${meta.docId}`,
        ...(meta.fileName ? { 'X-File-Name': meta.fileName } : {}),
      },
      body: xml,
    });
    if (!res.ok) throw new Error(`provider SDI HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const id = json?.[this.cfg.idField];
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('risposta provider senza id');
    return { providerId: String(id) };
  }

  /** Atteso: { id, status, at?(ISO|epoch), sdi_id?, errors?: string[] | {code}[] , message? } — adattare al provider scelto. */
  parseNotification(payload: unknown): SdiNotification {
    const p = payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') throw new SdiParseError('payload non valido');
    const id = p[this.cfg.idField];
    const status = p.status;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof status !== 'string') throw new SdiParseError('id/status mancanti');
    const type = this.cfg.statusMap[status];
    if (!type) throw new SdiParseError(`stato sconosciuto: ${status.slice(0, 40)}`);
    const atRaw = p.at;
    const at = typeof atRaw === 'number' ? atRaw : typeof atRaw === 'string' && !Number.isNaN(Date.parse(atRaw)) ? Date.parse(atRaw) : Date.now();
    const event: SdiEvent = { at, type, channel: 'provider' };
    if (typeof p.sdi_id === 'string') event.sdiIdentifier = p.sdi_id;
    if (Array.isArray(p.errors)) {
      const codes = p.errors.map((e) => (typeof e === 'string' ? e : typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '')).filter(Boolean);
      if (codes.length) event.errorCodes = codes;
    }
    if (typeof p.message === 'string') event.note = p.message.slice(0, 500);
    return { providerId: String(id), event };
  }

  verifyWebhook(raw: string, h: (n: string) => string | undefined): boolean {
    if (!this.cfg.webhookSecret) return false; // senza segreto non accettiamo webhook
    const got = h(this.cfg.signatureHeader);
    if (!got) return false;
    return safeEqual(got.replace(/^sha256=/, ''), createHmac('sha256', this.cfg.webhookSecret).update(raw).digest('hex'));
  }
}
