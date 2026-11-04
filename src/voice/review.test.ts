/** Regressioni della revisione indipendente (docs/CODE-REVIEW-CLIENT.md): comandi vocali e provider audio. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocLine, InvoiceFiscal, QuoteDocument } from '../types';

const h = vi.hoisted(() => {
  const state = { docs: new Map<string, unknown>(), counter: 0 };
  return {
    state,
    issueInvoice: vi.fn(), createCreditNote: vi.fn(), createInvoiceFromQuote: vi.fn(), recordPayment: vi.fn(), recordSdiEvent: vi.fn(),
    appendAudit: vi.fn(async () => undefined),
  };
});

vi.mock('../storage', () => ({
  listDocuments: async () => [...h.state.docs.values()],
  getDocument: async (id: string) => h.state.docs.get(id),
  saveDocument: async (d: { id: string }) => { h.state.docs.set(d.id, structuredClone(d)); },
  deleteDocument: async (id: string) => { h.state.docs.delete(id); },
  nextDocumentNumber: async () => `PRev-${String(++h.state.counter).padStart(4, '0')}`,
  listCatalog: async () => [
    { id: 'c1', name: 'Manodopera', aliases: ['ora di lavoro', 'manodopera'], unit: 'h', price: 35, vat: 22, kind: 'manodopera', createdAt: 1, updatedAt: 1 },
  ],
  getProfile: async () => ({ regimeForfettario: true, defaultVat: 22 }),
  issueInvoice: h.issueInvoice,
  createCreditNote: h.createCreditNote,
  createInvoiceFromQuote: h.createInvoiceFromQuote,
  recordPayment: h.recordPayment,
  recordSdiEvent: h.recordSdiEvent,
  appendAudit: h.appendAudit,
}));
vi.mock('../pdf', () => ({ generateDocumentPdf: async () => new Blob(['%PDF']) }));

import { cleanFreeText, executeCommand, planCommand, VoiceExecError } from './executor';
import { __resetConsumedForTests, confirmByHold, confirmByTap, createConfirmation, ConfirmationRequiredError } from './policy';
import { RecorderProvider } from './provider/recorderProvider';
import type { Command } from './types';

const line = (o: Partial<DocLine> = {}): DocLine => ({ id: Math.random().toString(36).slice(2), description: 'Manodopera', qty: 2, unit: 'h', unitPrice: 50, vat: 22, ...o });
let n = 0;
function doc(o: Omit<Partial<QuoteDocument>, 'invoice'> & { invoice?: Partial<InvoiceFiscal> } = {}): QuoteDocument {
  const { invoice, ...rest } = o;
  const base: QuoteDocument = {
    id: `d${++n}`, type: 'preventivo', number: 'PRev-0008', date: '2026-10-01', customer: { id: 'k', name: 'Mario Rossi' }, lines: [line()],
    status: 'bozza', createdAt: 1000 + n, updatedAt: 1000 + n, ...rest,
  };
  if (base.type === 'fattura') {
    base.invoice = { tipoDocumento: 'TD01', year: 2026, sectional: 'FT', operationDate: base.date, stampDuty: false, stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [], ...invoice };
  }
  return base;
}
const put = (...ds: QuoteDocument[]) => ds.forEach((d) => h.state.docs.set(d.id, structuredClone(d)));
const stored = (id: string) => h.state.docs.get(id) as QuoteDocument;
const emitted = (o: Omit<Partial<QuoteDocument>, 'invoice'> & { invoice?: Partial<InvoiceFiscal> } = {}) => doc({ type: 'fattura', number: '12/2026', status: 'emessa', invoice: { seq: 12, lockedAt: 5, issuedAt: 5, xml: '<xml/>' }, ...o });

beforeEach(() => {
  h.state.docs.clear(); h.state.counter = 0; n = 0;
  Object.values(h).forEach((v) => { if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.appendAudit.mockResolvedValue(undefined);
  __resetConsumedForTests();
});

describe('VOICE-1 undo: non ripristina uno stato vecchio sopra le modifiche fatte dopo', () => {
  it('add_line: dopo una modifica a mano l\'annulla è rifiutato e non perde nulla', async () => {
    const d = doc(); put(d);
    const r = await executeCommand({ type: 'add_line', dictation: 'aggiungi due ore di manodopera', ref: { kind: 'id', id: d.id } }, { now: new Date(2026, 10, 4, 10, 0, 0) });
    // l'utente modifica la bozza a mano nei 6 secondi dell'annulla
    const edited = { ...stored(d.id), notes: 'consegna giovedì', updatedAt: stored(d.id).updatedAt + 5 };
    put(edited);
    await expect(r.undo!()).rejects.toBeInstanceOf(VoiceExecError);
    expect(stored(d.id).notes).toBe('consegna giovedì');
    expect(stored(d.id).lines.length).toBeGreaterThan(1);
  });
  it('add_line: senza interferenze l\'annulla funziona', async () => {
    const d = doc(); put(d);
    const r = await executeCommand({ type: 'add_line', dictation: 'aggiungi due ore di manodopera', ref: { kind: 'id', id: d.id } });
    await r.undo!();
    expect(stored(d.id).lines).toHaveLength(1);
  });
  it('nuovo documento: non cancella una bozza già modificata', async () => {
    const r = await executeCommand({ type: 'new_document', docType: 'preventivo', dictation: 'preventivo per Mario Rossi due ore di manodopera' });
    const id = r.navigateTo!.split('/').pop()!;
    put({ ...stored(id), notes: 'importante', updatedAt: stored(id).updatedAt + 1 });
    await expect(r.undo!()).rejects.toBeInstanceOf(VoiceExecError);
    expect(stored(id)).toBeDefined();
  });
  it('elimina bozza: non sovrascrive un documento ricreato con lo stesso id', async () => {
    const d = doc(); put(d);
    const r = await executeCommand({ type: 'delete_draft', ref: { kind: 'id', id: d.id } });
    put({ ...d, notes: 'altro dispositivo' });
    await expect(r.undo!()).rejects.toBeInstanceOf(VoiceExecError);
    expect(stored(d.id).notes).toBe('altro dispositivo');
  });
});

describe('VOICE-2 la conferma vale per il documento che l\'utente ha visto', () => {
  it('emissione: se il documento cambia dopo il riepilogo non parte', async () => {
    const d = doc({ type: 'fattura', number: '' }); put(d);
    const cmd: Command = { type: 'issue_invoice', ref: { kind: 'id', id: d.id } };
    const p = await planCommand(cmd);
    if (p.status !== 'ready') throw new Error('piano');
    const card = createConfirmation(p.command, p.summary);
    // nel frattempo (sync / altra scheda) il documento cambia: importo diverso da quello mostrato
    put({ ...stored(d.id), lines: [line({ qty: 100, unitPrice: 999 })], updatedAt: d.updatedAt + 10 });
    const tok = confirmByHold(card, 1500)!;
    await expect(executeCommand(p.command, {}, tok)).rejects.toThrow(/cambiato dopo il riepilogo/);
    expect(h.issueInvoice).not.toHaveBeenCalled();
  });
  it('emissione: documento invariato => parte', async () => {
    const d = doc({ type: 'fattura', number: '' }); put(d);
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: d.id } });
    if (p.status !== 'ready') throw new Error('piano');
    h.issueInvoice.mockResolvedValue({ id: d.id, number: '1/2026' });
    const tok = confirmByHold(createConfirmation(p.command, p.summary), 1500)!;
    await executeCommand(p.command, {}, tok);
    expect(h.issueInvoice).toHaveBeenCalledTimes(1);
  });
});

describe('VOICE-3 doppio tocco / doppio enunciato: un solo incasso', () => {
  it('lo stesso gettone "a tocco" vale una volta sola', async () => {
    const d = emitted(); put(d);
    const p = await planCommand({ type: 'mark_paid', ref: { kind: 'id', id: d.id }, amount: 10 });
    if (p.status !== 'ready') throw new Error('piano');
    const tok = confirmByTap(createConfirmation(p.command, p.summary))!;
    h.recordPayment.mockResolvedValue(undefined);
    await executeCommand(p.command, {}, tok);
    await expect(executeCommand(p.command, {}, tok)).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(h.recordPayment).toHaveBeenCalledTimes(1);
  });
  it('due esecuzioni concorrenti dello stesso comando: la seconda è rifiutata', async () => {
    const d = emitted(); put(d);
    let release!: () => void;
    h.recordPayment.mockImplementation(() => new Promise<void>((res) => { release = res; }));
    const cmd: Command = { type: 'mark_paid', ref: { kind: 'id', id: d.id }, amount: 10 };
    const first = executeCommand(cmd);
    await new Promise((r) => setTimeout(r, 0));
    await expect(executeCommand(cmd)).rejects.toThrow(/già in esecuzione/);
    release(); await first;
    expect(h.recordPayment).toHaveBeenCalledTimes(1);
  });
  it('fattura già pagata per intero: nessun secondo incasso', async () => {
    const d = emitted({ lines: [line({ qty: 1, unitPrice: 100, vat: 0 })] });
    d.invoice!.payments = [{ date: '2026-10-02', amount: 102 }]; // 100 + bollo 2
    put(d);
    await expect(executeCommand({ type: 'mark_paid', ref: { kind: 'id', id: d.id } })).rejects.toThrow(/già pagata/);
    expect(h.recordPayment).not.toHaveBeenCalled();
  });
  it('importo infinito/NaN non valido', async () => {
    const d = emitted(); put(d);
    await expect(executeCommand({ type: 'mark_paid', ref: { kind: 'id', id: d.id }, amount: Infinity })).rejects.toThrow(/non valido/);
    expect(h.recordPayment).not.toHaveBeenCalled();
  });
});

describe('VOICE-4 testo libero dal microfono/campo di testo', () => {
  it('cleanFreeText toglie controlli, bidi e invisibili e limita la lunghezza', () => {
    expect(cleanFreeText('err‮ore\u0000 ​di\n\tprezzo', 100)).toBe('err ore di prezzo');
    expect(cleanFreeText('x'.repeat(500), 200)).toHaveLength(200);
  });
  it('il motivo della nota di credito è ripulito prima di arrivare allo storage', async () => {
    const d = emitted(); put(d);
    const cmd: Command = { type: 'credit_note', ref: { kind: 'id', id: d.id }, reason: `Errore‮ di importo ${'a'.repeat(400)}` };
    const p = await planCommand(cmd);
    if (p.status !== 'ready') throw new Error('piano');
    h.createCreditNote.mockResolvedValue({ id: 'nc1', number: 'NC1/2026' });
    await executeCommand(p.command, {}, confirmByHold(createConfirmation(p.command, p.summary), 1500)!);
    const reason = (h.createCreditNote.mock.calls[0] as unknown as [string, { reason: string }])[1].reason;
    expect(reason).not.toMatch(/‮/);
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});

describe('VOICE-5 microfono: nessuna registrazione "fantasma" né stream lasciati aperti', () => {
  const makeStream = () => {
    const track = { stop: vi.fn() };
    return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
  };
  class FakeMR {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable: unknown; onstop: unknown; onerror: unknown;
    static started = 0;
    start() { this.state = 'recording'; FakeMR.started++; }
    stop() { this.state = 'inactive'; }
  }
  it('stop() mentre si attende il permesso: al permesso lo stream viene rilasciato e non si registra', async () => {
    const { stream, track } = makeStream();
    let grant!: (s: MediaStream) => void;
    FakeMR.started = 0;
    const p = new RecorderProvider({ getUserMedia: () => new Promise<MediaStream>((r) => { grant = r; }), MediaRecorderCtor: FakeMR as unknown as typeof MediaRecorder });
    const started = p.start();
    p.stop(); // rilascio rapido del push-to-talk
    grant(stream);
    await started;
    expect(FakeMR.started).toBe(0);
    expect(track.stop).toHaveBeenCalled();
    expect(p.state).toBe('idle');
  });
  it('cancel() e subito start(): lo stream della prima richiesta non resta aperto', async () => {
    const a = makeStream(); const b = makeStream();
    const grants: Array<(s: MediaStream) => void> = [];
    const p = new RecorderProvider({ getUserMedia: () => new Promise<MediaStream>((r) => { grants.push(r); }), MediaRecorderCtor: FakeMR as unknown as typeof MediaRecorder });
    const s1 = p.start();
    p.cancel();
    const s2 = p.start();
    grants[0](a.stream);
    await s1;
    expect(a.track.stop).toHaveBeenCalled(); // la prima è scaduta: microfono chiuso
    grants[1](b.stream);
    await s2;
    expect(b.track.stop).not.toHaveBeenCalled(); // la seconda sta registrando
    p.cancel();
    expect(b.track.stop).toHaveBeenCalled();
  });
});
