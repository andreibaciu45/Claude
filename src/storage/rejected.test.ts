import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import {
  ImmutableDocumentError, InvalidSdiTransitionError, ResubmitWindowExpiredError, __resetStorageForTests, appendAudit, createCreditNote,
  createResubmissionDraft, deleteDocument, getDocument, getProfile, issueInvoice, listAudit, listDocuments, recordSdiEvent, reopenRejectedInvoice,
  saveDocument, sha256Hex,
} from './index';
import type { InvoiceFiscalExt } from './invoices';
import type { QuoteDocument, SdiEvent } from '../types';
import { customerData, draftData, lineData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const DAY = 86_400_000;
const ev = (type: SdiEvent['type'], at = Date.now(), extra: Partial<SdiEvent> = {}): SdiEvent => ({ at, type, channel: 'portale_ade', ...extra });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ext = (d: QuoteDocument) => d.invoice as InvoiceFiscalExt;

/** Fattura emessa, inviata e scartata (NS) `agoMs` fa. */
async function rejected(id: string, agoMs = 0, codes = ['00305']): Promise<QuoteDocument> {
  await saveDocument(draftData(id, today()));
  await issueInvoice(id);
  await recordSdiEvent(id, ev('INVIO', Date.now() - agoMs - 1000));
  return recordSdiEvent(id, ev('NS', Date.now() - agoMs, { errorCodes: codes }));
}

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
});

describe('appendAudit', () => {
  it('scrive una voce append-only con id, at, actor e trascrizione vocale', async () => {
    const e = await appendAudit({ docId: 'x1', action: 'voice_command', detail: 'download_xml', voiceTranscript: 'scarica l\'xml della fattura 12' });
    expect(e).toMatchObject({ docId: 'x1', action: 'voice_command', actor: 'user', voiceTranscript: 'scarica l\'xml della fattura 12' });
    expect(e.id).toBeTruthy();
    const list = await listAudit('x1');
    expect(list).toHaveLength(1);
    expect(list[0].voiceTranscript).toContain('xml');
  });
  it('registra download_xml con hash e mantiene l\'ordine cronologico', async () => {
    await appendAudit({ docId: 'd', action: 'download_xml', detail: 'a', xmlSha256: 'abc', at: 2000 });
    await appendAudit({ docId: 'd', action: 'mark_sent', detail: 'b', at: 1000 });
    await appendAudit({ docId: 'd', action: 'voice_command', detail: 'c', at: 3000 });
    expect((await listAudit('d')).map((e) => e.action)).toEqual(['mark_sent', 'download_xml', 'voice_command']);
  });
  it('rifiuta docId vuoto o azione sconosciuta; non si può sovrascrivere', async () => {
    await expect(appendAudit({ docId: '', action: 'edit' })).rejects.toThrow();
    await expect(appendAudit({ docId: 'd', action: 'boh' as never })).rejects.toThrow(/sconosciuta/);
    const a = await appendAudit({ docId: 'd', action: 'edit', detail: '1' });
    const b = await appendAudit({ docId: 'd', action: 'edit', detail: '2' });
    expect(a.id).not.toBe(b.id);
  });
  it('scritture concorrenti: nessuna voce persa', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => appendAudit({ docId: 'c', action: 'edit', detail: String(i) })));
    expect(await listAudit('c')).toHaveLength(25);
  });
});

describe('fattura scartata: correggi e rinvia (stesso numero e data, nuovo progressivo)', () => {
  it('rigenera l\'XML con stesso numero/data/sezionale e nuovo progressivoInvio; conserva XML scartato ed esito', async () => {
    const before = await rejected('a', 0, ['00305', '00400']);
    expect(before.status).toBe('scartata');
    const oldInv = ext(before);
    const after = await reopenRejectedInvoice('a', { customer: customerData({ address: 'Via Torino 99' }) });
    const inv = ext(after);
    // identità fiscale invariata
    expect(after.number).toBe(before.number);
    expect(after.date).toBe(before.date);
    expect(inv).toMatchObject({ number: oldInv.number, seq: oldInv.seq, year: oldInv.year, sectional: 'FT', operationDate: oldInv.operationDate, issuedAt: oldInv.issuedAt, lockedAt: oldInv.lockedAt });
    expect(after.status).toBe('scartata'); // non emessa finché non dichiari il rinvio
    // nuovo file
    expect(inv.progressivoInvio).not.toBe(oldInv.progressivoInvio);
    expect(inv.fileName).not.toBe(oldInv.fileName);
    expect(inv.xml).toContain('Via Torino 99');
    expect(inv.xml).toContain(`<Numero>${oldInv.number}</Numero>`);
    expect(inv.xml).toContain(`<ProgressivoInvio>${inv.progressivoInvio}</ProgressivoInvio>`);
    expect(inv.xmlSha256).toBe(await sha256Hex(inv.xml!));
    // XML scartato conservato per intero, con l'esito
    expect(inv.xmlHistory).toHaveLength(1);
    expect(inv.xmlHistory![0]).toMatchObject({ xml: oldInv.xml, xmlSha256: oldInv.xmlSha256, fileName: oldInv.fileName, progressivoInvio: oldInv.progressivoInvio, reason: 'scartata' });
    expect(inv.xmlHistory![0].sdiEvent).toMatchObject({ type: 'NS', errorCodes: ['00305', '00400'] });
    expect(inv.sdiEvents.map((e) => e.type)).toEqual(['INVIO', 'NS']);
    // contatori: progressivo avanzato di 1, numerazione fiscale intatta
    const p = await getProfile();
    expect(p.nextProgressivoInvio).toBe(3);
    expect(p.invoiceYearCounters).toEqual({ [`FT-${oldInv.year}`]: 1 });
    // audit: voce con hash vecchio e nuovo
    const audit = await listAudit('a');
    const last = audit[audit.length - 1];
    expect(last.action).toBe('edit');
    expect(last.xmlSha256).toBe(inv.xmlSha256);
    expect(last.detail).toContain(oldInv.xmlSha256!);
    expect(last.detail).toContain('stesso numero e stessa data');
    expect(last.detail).toContain('00305');
  });

  it('dopo il rinvio dichiarato la fattura torna "inviata"; un nuovo NS riapre il ciclo e accumula lo storico', async () => {
    await rejected('a');
    await reopenRejectedInvoice('a', { notes: 'v2' });
    expect((await recordSdiEvent('a', ev('INVIO'))).status).toBe('inviata');
    await recordSdiEvent('a', ev('NS', Date.now() + 1000));
    const again = await reopenRejectedInvoice('a', { notes: 'v3' });
    expect(ext(again).xmlHistory!.map((h) => h.reason)).toEqual(['scartata', 'scartata']);
    expect(ext(again).xmlHistory![0].xml).not.toBe(ext(again).xmlHistory![1].xml);
  });

  it('corretta due volte prima del rinvio: la versione intermedia è "sostituita"', async () => {
    await rejected('a');
    await reopenRejectedInvoice('a', { notes: 'v2' });
    const r = await reopenRejectedInvoice('a', { notes: 'v3' });
    expect(ext(r).xmlHistory!.map((h) => h.reason)).toEqual(['scartata', 'sostituita']);
    expect(r.notes).toBe('v3');
  });

  it('correzione delle righe: totali, bollo e XML coerenti; numero e data invariati', async () => {
    await rejected('a');
    const r = await reopenRejectedInvoice('a', { lines: [lineData('l1', 200, 1)] });
    expect(r.lines).toHaveLength(1);
    expect(ext(r).stampDuty).toBe(true); // 200 > 77,47
    expect(ext(r).xml).toContain('<ImportoBollo>2.00</ImportoBollo>');
    expect(ext(r).xml).toContain('<ImponibileImporto>200.00</ImponibileImporto>');
  });

  it('dati ancora invalidi: nessuna scrittura, contatori e XML intatti', async () => {
    const before = await rejected('a');
    await expect(reopenRejectedInvoice('a', { customer: customerData({ vatNumber: '12345678901' }) })).rejects.toMatchObject({ name: 'InvoiceValidationError' });
    const after = await getDocument('a');
    expect(ext(after!).xml).toBe(ext(before).xml);
    expect(ext(after!).xmlHistory).toBeUndefined();
    expect((await getProfile()).nextProgressivoInvio).toBe(2);
  });

  it('oltre 5 giorni dallo scarto: ResubmitWindowExpiredError, nulla cambia', async () => {
    await rejected('a', 6 * DAY);
    await expect(reopenRejectedInvoice('a', {})).rejects.toBeInstanceOf(ResubmitWindowExpiredError);
    expect(ext((await getDocument('a'))!).xmlHistory).toBeUndefined();
  });

  it('entro 5 giorni (4 giorni e 23 ore) ancora ammesso', async () => {
    await rejected('a', 4 * DAY + 23 * 3600_000);
    await expect(reopenRejectedInvoice('a', {})).resolves.toBeTruthy();
  });

  it('solo le fatture scartate: emessa/inviata/consegnata sono immutabili, la bozza non ha nulla da correggere', async () => {
    await saveDocument(draftData('b', today()));
    await expect(reopenRejectedInvoice('b', {})).rejects.toThrow();
    await issueInvoice('b');
    await expect(reopenRejectedInvoice('b', {})).rejects.toBeInstanceOf(ImmutableDocumentError);
    await recordSdiEvent('b', ev('INVIO'));
    await recordSdiEvent('b', ev('RC'));
    await expect(reopenRejectedInvoice('b', {})).rejects.toBeInstanceOf(ImmutableDocumentError);
  });

  it('immutabilità: saveDocument non può modificare una scartata (nemmeno dopo la correzione); le transizioni consentite sì', async () => {
    await rejected('a');
    const doc = (await getDocument('a'))!;
    await expect(saveDocument({ ...doc, customer: { ...doc.customer, name: 'Altro' } })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...doc, date: '2020-01-01' })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(saveDocument({ ...doc, invoice: { ...doc.invoice!, number: '99/2026' } })).rejects.toBeInstanceOf(ImmutableDocumentError);
    await expect(deleteDocument('a')).rejects.toBeInstanceOf(ImmutableDocumentError);
    const fixed = await reopenRejectedInvoice('a', { notes: 'ok' });
    await expect(saveDocument({ ...fixed, notes: 'manomesso' })).rejects.toBeInstanceOf(ImmutableDocumentError);
    // una copia "vecchia" del documento (senza storico) non fa fallire una transizione di stato valida
    const stale = { ...fixed, invoice: { ...fixed.invoice! } } as QuoteDocument;
    delete (stale.invoice as Partial<InvoiceFiscalExt>).xmlHistory;
    await expect(saveDocument({ ...stale, status: 'inviata' })).resolves.toBeUndefined();
  });

  it('la fattura scartata mantiene il suo numero: la successiva ha il numero seguente (nessun buco, nessun riuso)', async () => {
    await rejected('a');
    await saveDocument(draftData('b', today()));
    expect((await issueInvoice('b')).number).toMatch(/^2\//);
  });

  describe('concorrenza', () => {
    it('correzioni simultanee di fatture diverse e della stessa: progressivi tutti distinti e consecutivi, storico completo', async () => {
      await rejected('a');
      await rejected('b');
      const base = (await getProfile()).nextProgressivoInvio!;
      const res = await Promise.all([
        reopenRejectedInvoice('a', { notes: 'a1' }), reopenRejectedInvoice('b', { notes: 'b1' }), reopenRejectedInvoice('a', { notes: 'a2' }),
      ]);
      const progs = res.map((r) => ext(r).progressivoInvio!);
      expect(new Set(progs).size).toBe(3);
      expect((await getProfile()).nextProgressivoInvio).toBe(base + 3);
      const a = ext((await getDocument('a'))!);
      expect(a.xmlHistory).toHaveLength(2);
      expect(a.number).toBe('1/' + new Date().getFullYear());
      expect(ext((await getDocument('b'))!).xmlHistory).toHaveLength(1);
    });

    it('correzione in parallelo a nuove emissioni: nessun progressivo duplicato, numeri senza buchi', async () => {
      await rejected('a');
      for (let i = 0; i < 4; i++) await saveDocument(draftData(`n${i}`, today()));
      const out = await Promise.all([
        issueInvoice('n0'), reopenRejectedInvoice('a', { notes: 'x' }), issueInvoice('n1'), issueInvoice('n2'), reopenRejectedInvoice('a', { notes: 'y' }), issueInvoice('n3'),
      ]);
      const progs = out.map((d) => ext(d).progressivoInvio);
      expect(new Set(progs).size).toBe(progs.length);
      const seqs = (await listDocuments()).map((d) => d.invoice!.seq!).sort((x, y) => x - y);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
      const files = (await listDocuments()).map((d) => d.invoice!.fileName);
      expect(new Set(files).size).toBe(files.length);
    });
  });
});

describe('fattura scartata oltre i 5 giorni: nuova fattura collegata', () => {
  it('crea una bozza con resubmissionOf; la scartata resta non emessa; la nuova prende il numero successivo', async () => {
    await rejected('a', 7 * DAY);
    const draft = await createResubmissionDraft('a');
    expect(draft).toMatchObject({ status: 'bozza', number: '' });
    expect(draft.invoice).toMatchObject({ resubmissionOf: 'a', tipoDocumento: 'TD01', operationDate: today() });
    expect(draft.invoice!.seq).toBeUndefined();
    expect(draft.lines.map((l) => l.id)).not.toEqual((await getDocument('a'))!.lines.map((l) => l.id));
    const issued = await issueInvoice(draft.id);
    expect(issued.invoice!.number).toMatch(/^2\//);
    expect(issued.invoice!.resubmissionOf).toBe('a');
    expect((await getDocument('a'))!.status).toBe('scartata');
    expect((await getDocument('a'))!.invoice!.number).toMatch(/^1\//);
  });
  it('una sola bozza collegata alla volta; eliminata la bozza se ne può creare un\'altra; non su fatture non scartate', async () => {
    await rejected('a', 7 * DAY);
    const d1 = await createResubmissionDraft('a');
    await expect(createResubmissionDraft('a')).rejects.toThrow(/già/);
    await deleteDocument(d1.id);
    await expect(createResubmissionDraft('a')).resolves.toBeTruthy();
    await saveDocument(draftData('b', today()));
    await issueInvoice('b');
    await expect(createResubmissionDraft('b')).rejects.toBeInstanceOf(ImmutableDocumentError);
  });
  it('richieste simultanee: una sola bozza', async () => {
    await rejected('a', 7 * DAY);
    const r = await Promise.allSettled([createResubmissionDraft('a'), createResubmissionDraft('a'), createResubmissionDraft('a')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await listDocuments()).filter((d) => d.invoice?.resubmissionOf === 'a')).toHaveLength(1);
  });
  it('il rinvio "segna come rinviata" oltre i 5 giorni resta vietato', async () => {
    await rejected('a', 6 * DAY);
    await expect(recordSdiEvent('a', ev('INVIO'))).rejects.toBeInstanceOf(InvalidSdiTransitionError);
  });
});

describe('nota di credito scartata', () => {
  it('l\'originale smette di essere "stornata" finché la nota è scartata e ritorna stornata al rinvio', async () => {
    await saveDocument(draftData('a', today()));
    await issueInvoice('a');
    await recordSdiEvent('a', ev('INVIO', Date.now() - 5000));
    const nc = await createCreditNote('a', { reason: 'errore' });
    expect((await getDocument('a'))!.status).toBe('stornata');
    await recordSdiEvent(nc.id, ev('INVIO', Date.now() - 2000));
    await recordSdiEvent(nc.id, ev('NS', Date.now() - 1000));
    expect((await getDocument(nc.id))!.status).toBe('scartata');
    expect((await getDocument('a'))!.status).toBe('inviata'); // di nuovo stornabile
    await recordSdiEvent(nc.id, ev('INVIO'));
    expect((await getDocument('a'))!.status).toBe('stornata');
  });
  it('una nota scartata si corregge con lo stesso numero (solo dati anagrafici)', async () => {
    await saveDocument(draftData('a', today()));
    await issueInvoice('a');
    const nc = await createCreditNote('a', { reason: 'errore' });
    await recordSdiEvent(nc.id, ev('INVIO', Date.now() - 2000));
    await recordSdiEvent(nc.id, ev('NS', Date.now() - 1000));
    await expect(reopenRejectedInvoice(nc.id, { lines: [lineData('z', 1)] })).rejects.toMatchObject({ name: 'InvoiceValidationError' });
    const r = await reopenRejectedInvoice(nc.id, { customer: customerData({ address: 'Via Nuova 5' }) });
    expect(r.invoice!.number).toBe(nc.invoice!.number);
    expect(ext(r).xml).toContain('Via Nuova 5');
  });
});
