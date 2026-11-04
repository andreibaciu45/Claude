// MockProvider: simula RC/NS/MC con ritardo configurabile. Nessuna rete. Solo sviluppo/test.
import { createHmac } from 'node:crypto';
import { safeEqual, systemClock, type Clock } from '../billing/common';
import { SdiParseError, type SdiEvent, type SdiNotification, type SdiProvider, type SdiSubmitMeta } from './types';

export type MockOutcome = 'RC' | 'NS' | 'MC';
export interface MockOptions {
  delayMs?: number; // ritardo tra invio e esito (default 0)
  outcome?: MockOutcome | ((xml: string, meta: SdiSubmitMeta) => MockOutcome);
  /** Codici di scarto usati per NS. Valori di ESEMPIO, non il catalogo SDI ufficiale (DA VERIFICARE). */
  rejectCodes?: string[];
  webhookSecret?: string;
  clock?: Clock;
}
/** Formato "wire" del mock (come se arrivasse da un provider). */
export interface MockWirePayload { providerId: string; type: 'INVIO' | MockOutcome; at: number; sdiIdentifier?: string; errorCodes?: string[]; note?: string }

export class MockProvider implements SdiProvider {
  readonly id = 'mock';
  readonly capabilities = { submit: true, webhook: true, simulated: true };
  private pending: { dueAt: number; payload: MockWirePayload }[] = [];
  private seq = 0;
  private clock: Clock;
  constructor(private opts: MockOptions = {}) { this.clock = opts.clock ?? systemClock; }

  async submit(xml: string, meta: SdiSubmitMeta) {
    if (!xml.trim()) throw new Error('XML vuoto');
    const providerId = `mock-${++this.seq}-${meta.docId}`;
    const now = this.clock.now();
    const o = this.opts.outcome ?? 'RC';
    const outcome = typeof o === 'function' ? o(xml, meta) : o;
    this.pending.push({
      dueAt: now + (this.opts.delayMs ?? 0),
      payload: {
        providerId, type: outcome, at: now + (this.opts.delayMs ?? 0),
        sdiIdentifier: `MOCK${String(this.seq).padStart(6, '0')}`,
        errorCodes: outcome === 'NS' ? (this.opts.rejectCodes ?? ['00300']) : undefined,
        note: 'Esito SIMULATO (mock): nessun invio reale allo SDI',
      },
    });
    return { providerId };
  }

  /** Estrae i payload il cui ritardo è trascorso (simula i webhook in arrivo). */
  drainDue(): MockWirePayload[] {
    const now = this.clock.now();
    const due = this.pending.filter((p) => p.dueAt <= now);
    this.pending = this.pending.filter((p) => p.dueAt > now);
    return due.map((d) => d.payload);
  }

  parseNotification(payload: unknown): SdiNotification {
    const p = payload as Partial<MockWirePayload> | null;
    if (!p || typeof p !== 'object' || typeof p.providerId !== 'string' || typeof p.at !== 'number'
      || !(p.type === 'INVIO' || p.type === 'RC' || p.type === 'NS' || p.type === 'MC')) {
      throw new SdiParseError('payload mock non valido');
    }
    if (p.errorCodes !== undefined && !(Array.isArray(p.errorCodes) && p.errorCodes.every((x) => typeof x === 'string'))) {
      throw new SdiParseError('errorCodes non valido');
    }
    const event: SdiEvent = { at: p.at, type: p.type, channel: 'provider' };
    if (p.sdiIdentifier) event.sdiIdentifier = String(p.sdiIdentifier);
    if (p.errorCodes?.length) event.errorCodes = p.errorCodes;
    if (p.note) event.note = String(p.note).slice(0, 500);
    return { providerId: p.providerId, event };
  }

  verifyWebhook(raw: string, h: (n: string) => string | undefined): boolean {
    const secret = this.opts.webhookSecret;
    if (!secret) return true; // mock senza segreto: accetta (solo dev)
    const got = h('x-sdi-signature');
    if (!got) return false;
    return safeEqual(got, createHmac('sha256', secret).update(raw).digest('hex'));
  }
}
