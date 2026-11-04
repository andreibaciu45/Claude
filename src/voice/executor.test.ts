import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem, DocLine, InvoiceFiscal, QuoteDocument } from '../types';

type DocOpts = Omit<Partial<QuoteDocument>, 'invoice'> & { invoice?: Partial<InvoiceFiscal> };

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
  listCatalog: async () => CATALOG,
  getProfile: async () => ({ regimeForfettario: true, defaultVat: 22 }),
  issueInvoice: h.issueInvoice,
  createCreditNote: h.createCreditNote,
  createInvoiceFromQuote: h.createInvoiceFromQuote,
  recordPayment: h.recordPayment,
  recordSdiEvent: h.recordSdiEvent,
  appendAudit: h.appendAudit,
}));
vi.mock('../pdf', () => ({ generateDocumentPdf: async () => new Blob(['%PDF'], { type: 'application/pdf' }) }));

import { executeCommand, planCommand, VoiceExecError } from './executor';
import { __resetConsumedForTests, confirmByHold, createConfirmation, ConfirmationRequiredError } from './policy';
import type { Command } from './types';

const CATALOG: CatalogItem[] = [
  { id: 'c1', name: 'Manodopera', aliases: ['ora di lavoro', 'manodopera'], unit: 'h', price: 35, vat: 22, kind: 'manodopera', createdAt: 1, updatedAt: 1 },
  { id: 'c2', name: 'Tubo rame 16 mm', aliases: ['tubo di rame', 'rame sedici'], unit: 'm', price: 8, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1 },
];

const line = (o: Partial<DocLine> = {}): DocLine => ({ id: Math.random().toString(36).slice(2), description: 'Manodopera', qty: 2, unit: 'h', unitPrice: 50, vat: 22, ...o });
let n = 0;
function doc(o: DocOpts = {}): QuoteDocument {
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
const stored = (id: string) => h.state.docs.get(id) as QuoteDocument | undefined;
const emitted = (o: DocOpts = {}) => doc({ type: 'fattura', number: '12/2026', status: 'emessa', invoice: { seq: 12, lockedAt: 5, issuedAt: 5, xml: '<xml/>', fileName: 'IT123_00001.xml' }, ...o });
const token = (cmd: Command, plan: Extract<Awaited<ReturnType<typeof planCommand>>, { status: 'ready' }>) => {
  const p = createConfirmation(cmd, plan.summary);
  const t = confirmByHold(p, 1500);
  if (!t) throw new Error('no token');
  return t;
};

beforeEach(() => {
  h.state.docs.clear(); h.state.counter = 0; n = 0;
  Object.values(h).forEach((v) => { if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.appendAudit.mockResolvedValue(undefined);
  __resetConsumedForTests();
});

describe('creazione', () => {
  it('nuovo preventivo per cliente con voci (parseDictation) + audit con trascrizione + undo', async () => {
    const cmd: Command = { type: 'new_document', docType: 'preventivo', dictation: 'preventivo per Mario Rossi due ore di manodopera' };
    const r = await executeCommand(cmd, { transcript: 'nuovo preventivo per Mario Rossi due ore di manodopera', now: new Date(2026, 10, 4) });
    expect(r.navigateTo).toMatch(/^\/documenti\//);
    const id = r.navigateTo!.split('/').pop()!;
    const d = stored(id)!;
    expect(d).toMatchObject({ type: 'preventivo', number: 'PRev-0001', status: 'bozza', date: '2026-11-04' });
    expect(d.customer.name.toLowerCase()).toContain('rossi');
    expect(d.lines[0]).toMatchObject({ qty: 2, unit: 'h' });
    expect(h.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ docId: id, action: 'voice_command', voiceTranscript: expect.stringContaining('Mario Rossi') }));
    await r.undo!();
    expect(stored(id)).toBeUndefined();
  });
  it('nuova fattura = bozza senza numero e con dati fiscali di base', async () => {
    const r = await executeCommand({ type: 'new_document', docType: 'fattura', dictation: 'fattura per Bianchi due ore di manodopera' });
    const d = stored(r.navigateTo!.split('/').pop()!)!;
    expect(d.type).toBe('fattura');
    expect(d.number).toBe('');
    expect(d.status).toBe('bozza');
    expect(d.invoice).toMatchObject({ tipoDocumento: 'TD01', sectional: 'FT', paymentStatus: 'non_pagata', payments: [] });
    expect(d.invoice?.lockedAt).toBeUndefined();
  });
  it('riusa i dati del cliente già noto (P.IVA)', async () => {
    put(doc({ customer: { id: 'k9', name: 'Mario Rossi', vatNumber: '01234567897' } }));
    const r = await executeCommand({ type: 'new_document', docType: 'fattura', dictation: 'fattura per Rossi due ore di manodopera' });
    expect(stored(r.navigateTo!.split('/').pop()!)!.customer).toMatchObject({ id: 'k9', vatNumber: '01234567897' });
  });
  it('"nuovo preventivo" senza cliente apre la dettatura; senza cliente ma con voci è bloccato', async () => {
    expect((await executeCommand({ type: 'new_document', docType: 'preventivo', dictation: 'preventivo' })).navigateTo).toBe('/');
    const p = await planCommand({ type: 'new_document', docType: 'preventivo', dictation: 'preventivo due ore di manodopera' });
    expect(p.status).toBe('blocked');
  });
});

describe('emissione (irreversibile)', () => {
  const issue = (ref: Command extends infer C ? C : never): Command => ref;
  void issue;
  it('il piano mostra documento, cliente, importo e conseguenze', async () => {
    const d = doc({ type: 'fattura', number: '', lines: [line({ qty: 2, unitPrice: 100, vat: 0 })] });
    put(d);
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: d.id } });
    expect(p.status).toBe('ready');
    if (p.status !== 'ready') return;
    const labels = p.summary.fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['Documento', 'Cliente', 'Importo']));
    expect(p.summary.fields.find((f) => f.label === 'Cliente')?.value).toBe('Mario Rossi');
    expect(p.summary.fields.find((f) => f.label === 'Importo')?.value).toMatch(/^200,00/); // bollo 2 a carico dell'emittente: NON nel totale
    expect(p.summary.warnings.join(' ')).toMatch(/a tuo carico/);
    expect(p.summary.consequence).toMatch(/non si può più modificare/);
  });
  it('senza gettone di conferma NON emette (lancia e non chiama issueInvoice)', async () => {
    const d = doc({ type: 'fattura', number: '' });
    put(d);
    const cmd: Command = { type: 'issue_invoice', ref: { kind: 'id', id: d.id } };
    await expect(executeCommand(cmd, {})).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(h.issueInvoice).not.toHaveBeenCalled();
  });
  it('con conferma esplicita emette una sola volta (idempotenza)', async () => {
    const d = doc({ type: 'fattura', number: '' });
    put(d);
    h.issueInvoice.mockImplementation(async (id: string) => ({ ...stored(id)!, number: '1/2026', status: 'emessa' }));
    const cmd: Command = { type: 'issue_invoice', ref: { kind: 'id', id: d.id } };
    const plan = await planCommand(cmd);
    if (plan.status !== 'ready') throw new Error('plan');
    const t = token(plan.command, plan);
    const r = await executeCommand(plan.command, { transcript: 'emetti la fattura' }, t);
    expect(r.message).toMatch(/1\/2026/);
    expect(h.issueInvoice).toHaveBeenCalledTimes(1);
    await expect(executeCommand(plan.command, {}, t)).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(h.issueInvoice).toHaveBeenCalledTimes(1);
  });
  it('un gettone per un altro comando non vale', async () => {
    const a = doc({ type: 'fattura', number: '' }); const b = doc({ type: 'fattura', number: '' });
    put(a, b);
    const pa = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: a.id } });
    if (pa.status !== 'ready') throw new Error('plan');
    const t = token(pa.command, pa);
    await expect(executeCommand({ type: 'issue_invoice', ref: { kind: 'id', id: b.id } }, {}, t)).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(h.issueInvoice).not.toHaveBeenCalled();
  });
  it('bloccata con elenco errori se ci sono righe da verificare o cliente mancante', async () => {
    const d = doc({ type: 'fattura', number: '', customer: { id: 'x', name: ' ' }, lines: [line({ needsReview: true, unitPrice: 0 })] });
    put(d);
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: d.id } });
    expect(p.status).toBe('blocked');
    if (p.status === 'blocked') expect(p.issues!.join(' ')).toMatch(/cliente.*da verificare|da verificare/is);
  });
  it('preventivo o fattura già emessa: bloccata con spiegazione', async () => {
    const q = doc(); const f = emitted();
    put(q, f);
    expect((await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: q.id } })).status).toBe('blocked');
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: f.id } });
    expect(p).toMatchObject({ status: 'blocked' });
    if (p.status === 'blocked') expect(p.hint).toMatch(/nota di credito/);
  });
  it('gli errori di validazione dello storage diventano un messaggio con elenco', async () => {
    const d = doc({ type: 'fattura', number: '' });
    put(d);
    h.issueInvoice.mockRejectedValue(Object.assign(new Error('x'), { issues: [{ message: 'Partita IVA del cliente non valida', severity: 'error' }, { message: 'avviso', severity: 'warning' }] }));
    const cmd: Command = { type: 'issue_invoice', ref: { kind: 'id', id: d.id } };
    const plan = await planCommand(cmd);
    if (plan.status !== 'ready') throw new Error('plan');
    const err = await executeCommand(plan.command, {}, token(plan.command, plan)).catch((e) => e);
    expect(err).toBeInstanceOf(VoiceExecError);
    expect(err.issues).toEqual(['Partita IVA del cliente non valida']);
  });
  it('risoluzione per cliente: sceglie la bozza tra più fatture di Rossi', async () => {
    const old = emitted({ customer: { id: 'k', name: 'Rossi Srl' } });
    const draft = doc({ type: 'fattura', number: '', customer: { id: 'k', name: 'Rossi Srl' } });
    put(old, draft);
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'customer', name: 'Rossi', docType: 'fattura' } });
    expect(p.status).toBe('ready');
    if (p.status === 'ready') expect(p.command).toMatchObject({ ref: { kind: 'id', id: draft.id } });
  });
});

describe('storno (irreversibile)', () => {
  it('richiede il gettone, poi chiama createCreditNote con il motivo', async () => {
    const f = emitted();
    put(f);
    h.createCreditNote.mockResolvedValue({ ...doc({ type: 'fattura' }), id: 'nc', number: 'NC1/2026' });
    const cmd: Command = { type: 'credit_note', ref: { kind: 'number', number: 12, docType: 'fattura' }, reason: 'Reso merce' };
    await expect(executeCommand(cmd, {})).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(h.createCreditNote).not.toHaveBeenCalled();
    const plan = await planCommand(cmd);
    if (plan.status !== 'ready') throw new Error('plan');
    expect(plan.summary.fields.map((x) => x.label)).toEqual(expect.arrayContaining(['Documento', 'Cliente', 'Importo', 'Motivo']));
    const r = await executeCommand(plan.command, { transcript: 'storna la fattura dodici' }, token(plan.command, plan));
    expect(h.createCreditNote).toHaveBeenCalledWith(f.id, { reason: 'Reso merce' });
    expect(r.message).toMatch(/NC1\/2026/);
    expect(h.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ voiceTranscript: 'storna la fattura dodici' }));
  });
  it('bozza, scartata, già stornata, preventivo: non si storna', async () => {
    const bozza = doc({ type: 'fattura', number: '' });
    const scartata = emitted({ status: 'scartata' });
    const stornata = emitted({ status: 'stornata' });
    const q = doc();
    put(bozza, scartata, stornata, q);
    for (const d of [bozza, scartata, stornata, q]) {
      const p = await planCommand({ type: 'credit_note', ref: { kind: 'id', id: d.id } });
      expect(p.status, d.status).toBe('blocked');
    }
    const p = await planCommand({ type: 'credit_note', ref: { kind: 'id', id: scartata.id } });
    if (p.status === 'blocked') expect(p.hint).toMatch(/reinvia/);
  });
  it('riferimento per numero ambiguo -> scelta tra documenti, mai fuzzy', async () => {
    put(emitted({ number: '12/2026', invoice: { seq: 12, year: 2025, lockedAt: 1 } }), emitted({ number: '12/2026' }), doc({ number: 'PRev-0012' }));
    const p = await planCommand({ type: 'open', ref: { kind: 'number', number: 12 } });
    expect(p.status).toBe('choose');
    const none = await planCommand({ type: 'credit_note', ref: { kind: 'number', number: 99, docType: 'fattura' } });
    expect(none.status).toBe('blocked');
  });
});

describe('emissione con bollo a carico del cliente', () => {
  it('il riepilogo include il bollo nel totale e lo dice', async () => {
    const d = doc({ type: 'fattura', number: '', lines: [line({ qty: 2, unitPrice: 100, vat: 0 })], invoice: { stampDutyChargedToCustomer: true, stampDuty: true, stampAmount: 2 } });
    put(d);
    const p = await planCommand({ type: 'issue_invoice', ref: { kind: 'id', id: d.id } });
    if (p.status !== 'ready') throw new Error('plan');
    expect(p.summary.fields.find((f) => f.label === 'Importo')?.value).toMatch(/^202,00/);
    expect(p.summary.warnings.join(' ')).toMatch(/a carico del cliente/);
  });
});

describe('altri comandi', () => {
  it('pagamento: default al residuo, avviso se supera, usa recordPayment con la data di oggi', async () => {
    const f = emitted({ lines: [line({ qty: 1, unitPrice: 100, vat: 0 })], invoice: { seq: 12, lockedAt: 1, payments: [{ date: '2026-10-05', amount: 30 }] } });
    put(f);
    const ref = { kind: 'id', id: f.id } as const;
    const p1 = await planCommand({ type: 'mark_paid', ref }, { now: new Date(2026, 10, 4) });
    if (p1.status !== 'ready') throw new Error('plan');
    expect(p1.summary.fields.find((x) => x.label === 'Importo')?.value).toMatch(/70,00/); // 100 - 30 (bollo a carico dell'emittente, fuori dal totale)
    const p2 = await planCommand({ type: 'mark_paid', ref, amount: 500 });
    if (p2.status !== 'ready') throw new Error('plan');
    expect(p2.summary.warnings.join(' ')).toMatch(/supera il residuo/);
    await executeCommand({ type: 'mark_paid', ref }, { now: new Date(2026, 10, 4), transcript: 't' });
    expect(h.recordPayment).toHaveBeenCalledWith(f.id, { date: '2026-11-04', amount: 72 });
  });
  it('pagamento su bozza o preventivo: bloccato', async () => {
    const b = doc({ type: 'fattura', number: '' }); put(b, doc());
    expect((await planCommand({ type: 'mark_paid', ref: { kind: 'id', id: b.id } })).status).toBe('blocked');
  });
  it('segna inviata: fattura -> evento SDI INVIO; preventivo -> stato inviato con undo', async () => {
    const f = emitted(); const q = doc();
    put(f, q);
    await executeCommand({ type: 'mark_sent', ref: { kind: 'id', id: f.id } }, {});
    expect(h.recordSdiEvent).toHaveBeenCalledWith(f.id, expect.objectContaining({ type: 'INVIO', channel: 'portale_ade' }));
    const r = await executeCommand({ type: 'mark_sent', ref: { kind: 'id', id: q.id } }, {});
    expect(stored(q.id)!.status).toBe('inviato');
    await r.undo!();
    expect(stored(q.id)!.status).toBe('bozza');
  });
  it('conversione: usa createInvoiceFromQuote; preventivo già convertito bloccato; undo ripristina', async () => {
    const q = doc();
    const conv = doc({ status: 'convertito', number: 'PRev-0003' });
    put(q, conv);
    const inv = doc({ type: 'fattura', number: '' });
    h.createInvoiceFromQuote.mockImplementation(async () => { put(inv); h.state.docs.set(q.id, { ...q, status: 'convertito' }); return inv; });
    const r = await executeCommand({ type: 'convert_quote', ref: { kind: 'id', id: q.id } }, {});
    expect(h.createInvoiceFromQuote).toHaveBeenCalledWith(q.id);
    expect(r.navigateTo).toBe(`/documenti/${inv.id}`);
    await r.undo!();
    expect(stored(inv.id)).toBeUndefined();
    expect(stored(q.id)!.status).toBe('bozza');
    expect((await planCommand({ type: 'convert_quote', ref: { kind: 'id', id: conv.id } })).status).toBe('blocked');
  });
  it('elimina: bozza/preventivo sì (con undo), fattura emessa mai', async () => {
    const q = doc(); const f = emitted();
    put(q, f);
    const p = await planCommand({ type: 'delete_draft', ref: { kind: 'id', id: f.id } });
    expect(p).toMatchObject({ status: 'blocked' });
    await expect(executeCommand({ type: 'delete_draft', ref: { kind: 'id', id: f.id } }, {})).rejects.toBeInstanceOf(VoiceExecError);
    expect(stored(f.id)).toBeDefined();
    const plan = await planCommand({ type: 'delete_draft', ref: { kind: 'id', id: q.id } });
    expect(plan).toMatchObject({ status: 'ready', target: { hasLines: true } });
    const r = await executeCommand({ type: 'delete_draft', ref: { kind: 'id', id: q.id } }, {});
    expect(stored(q.id)).toBeUndefined();
    await r.undo!();
    expect(stored(q.id)).toBeDefined();
  });
  it('aggiungi riga al documento corrente con undo; rifiutato sulle fatture emesse', async () => {
    const q = doc({ lines: [line()] }); const f = emitted();
    put(q, f);
    const r = await executeCommand({ type: 'add_line', dictation: 'tre metri di tubo di rame', ref: { kind: 'current' } }, { currentDocumentId: q.id });
    expect(stored(q.id)!.lines).toHaveLength(2);
    expect(stored(q.id)!.lines[1]).toMatchObject({ qty: 3, unit: 'm' });
    await r.undo!();
    expect(stored(q.id)!.lines).toHaveLength(1);
    expect((await planCommand({ type: 'add_line', dictation: 'due ore di manodopera', ref: { kind: 'current' } }, { currentDocumentId: f.id })).status).toBe('blocked');
  });
  it('duplica: nuova bozza senza numero/XML/eventi SDI; undo', async () => {
    const f = emitted({ invoice: { seq: 12, lockedAt: 1, xml: '<x/>', xmlSha256: 'abc', sdiEvents: [{ at: 1, type: 'INVIO', channel: 'portale_ade' }], payments: [{ date: '2026-01-01', amount: 5 }], paymentStatus: 'parziale' } });
    put(f);
    const r = await executeCommand({ type: 'duplicate', ref: { kind: 'id', id: f.id } }, {});
    const c = stored(r.navigateTo!.split('/').pop()!)!;
    expect(c).toMatchObject({ type: 'fattura', number: '', status: 'bozza' });
    expect(c.invoice).toMatchObject({ sdiEvents: [], payments: [], paymentStatus: 'non_pagata' });
    expect(c.invoice?.xml).toBeUndefined();
    expect(c.invoice?.xmlSha256).toBeUndefined();
    expect(c.invoice?.lockedAt).toBeUndefined();
    expect(c.convertedFromQuoteId).toBeUndefined();
    await r.undo!();
    expect(stored(c.id)).toBeUndefined();
  });
  it('apri: ultimo preventivo, documento corrente, elenco per cliente', async () => {
    const a = doc({ createdAt: 10 }); const b = doc({ createdAt: 20, customer: { id: 'z', name: 'Bianchi' } });
    put(a, b, emitted({ customer: { id: 'k', name: 'Mario Rossi' } }));
    expect((await executeCommand({ type: 'open', ref: { kind: 'last', docType: 'preventivo' } }, {})).navigateTo).toBe(`/documenti/${b.id}`);
    expect((await executeCommand({ type: 'open', ref: { kind: 'current' } }, { currentDocumentId: a.id })).navigateTo).toBe(`/documenti/${a.id}`);
    const l = await executeCommand({ type: 'list', docType: 'fattura', customerName: 'Rossi' }, {});
    expect(l.items).toHaveLength(1);
    expect(l.items![0].customer).toBe('Mario Rossi');
  });
  it('scarica XML (solo emesse) e PDF', async () => {
    const f = emitted(); const q = doc();
    put(f, q);
    const download = vi.fn();
    await executeCommand({ type: 'download', format: 'xml', ref: { kind: 'id', id: f.id } }, { download, transcript: 'scarica l\'xml della fattura dodici' });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'IT123_00001.xml');
    // audit: download_xml (con hash) + voice_command, entrambi con la trascrizione
    const calls = (h.appendAudit.mock.calls as unknown as [{ action: string; voiceTranscript?: string; docId: string }][]).map((c) => c[0]);
    expect(calls.map((c) => c.action)).toEqual(expect.arrayContaining(['download_xml', 'voice_command']));
    expect(calls.every((c) => c.docId === f.id)).toBe(true);
    expect(calls.every((c) => c.voiceTranscript === 'scarica l\'xml della fattura dodici')).toBe(true);
    await executeCommand({ type: 'download', format: 'pdf', ref: { kind: 'id', id: q.id } }, { download });
    expect(download).toHaveBeenLastCalledWith(expect.any(Blob), expect.stringMatching(/\.pdf$/));
    expect((await planCommand({ type: 'download', format: 'xml', ref: { kind: 'id', id: q.id } })).status).toBe('blocked');
  });
  it('se storage non espone appendAudit l\'azione riesce lo stesso', async () => {
    h.appendAudit.mockRejectedValue(new Error('boom'));
    const q = doc(); put(q);
    await expect(executeCommand({ type: 'quote_status', ref: { kind: 'id', id: q.id }, status: 'accettato' }, { transcript: 'x' })).resolves.toBeDefined();
  });
});
