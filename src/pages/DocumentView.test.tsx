// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteDocument, ValidationIssue } from '../types';
import { fakeCreditNote, fakeDoc, fakeInvoice, fakeProfile } from '../pdf/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => ({
  getDocument: vi.fn(), getProfile: vi.fn(), listDocuments: vi.fn(), listAudit: vi.fn(), saveDocument: vi.fn(), deleteDocument: vi.fn(),
  nextDocumentNumber: vi.fn(), issueInvoice: vi.fn(), createCreditNote: vi.fn(), createInvoiceFromQuote: vi.fn(), recordPayment: vi.fn(), recordSdiEvent: vi.fn(),
}));
vi.mock('../storage', () => store);
const validate = vi.hoisted(() => vi.fn<() => ValidationIssue[]>(() => []));
vi.mock('../../shared/fatturapa', () => ({ validateInvoiceForIssue: validate }));

import DocumentView from './DocumentView';

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

const render = async (doc: QuoteDocument | undefined, all: QuoteDocument[] = []) => {
  store.getDocument.mockResolvedValue(doc);
  store.getProfile.mockResolvedValue(fakeProfile({ regimeForfettario: true }));
  store.listDocuments.mockResolvedValue(all);
  store.listAudit.mockResolvedValue([]);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/documenti/d1']}>
        <Routes><Route path="/documenti/:id" element={<DocumentView />} /><Route path="*" element={<div>altrove</div>} /></Routes>
      </MemoryRouter>,
    );
  });
  await flush();
};
const buttons = () => [...host.querySelectorAll('button, a.btn')].map((b) => b.textContent!.trim());
const has = (t: string) => buttons().some((b) => b.includes(t));
const click = (t: string) => {
  const el = [...host.querySelectorAll<HTMLElement>('button, a.btn')].find((b) => b.textContent!.includes(t));
  if (!el) throw new Error(`pulsante non trovato: ${t}`);
  act(() => { el.click(); });
};
const hold = (ms: number) => {
  const b = host.querySelector('button.hold-btn')!;
  act(() => { b.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { button: 0 })); });
  act(() => { vi.advanceTimersByTime(ms); });
};
const draft = () => fakeInvoice({ status: 'bozza', invoice: { ...fakeInvoice().invoice!, number: undefined, lockedAt: undefined } });

beforeEach(() => {
  Object.values(store).forEach((f) => f.mockReset());
  validate.mockReset(); validate.mockReturnValue([]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('DocumentView: pulsanti per stato', () => {
  it('bozza di fattura: Emetti fattura, Modifica, Elimina bozza; BOZZA ben visibile; niente XML/nota di credito', async () => {
    await render(draft());
    expect(has('Emetti fattura')).toBe(true);
    expect(has('Modifica')).toBe(true);
    expect(has('Elimina bozza')).toBe(true);
    expect(has('Scarica XML')).toBe(false);
    expect(has('Annulla con nota di credito')).toBe(false);
    expect(host.textContent).toContain('BOZZA');
    expect(host.textContent).toContain('bozza, senza numero');
    expect(host.querySelector('.dv-paper')!.getAttribute('data-draft')).toBe('true');
  });
  it('fattura emessa: nessuna modifica/eliminazione, azioni SDI, incasso e storno', async () => {
    await render(fakeInvoice());
    for (const t of ['Scarica XML', 'Come inviarla allo SDI', 'Segna come inviata', 'Registra esito SDI', 'Registra incasso', 'Annulla con nota di credito', 'Scarica PDF']) expect(has(t)).toBe(true);
    for (const t of ['Modifica', 'Elimina', 'Emetti fattura']) expect(has(t)).toBe(false);
    expect(host.textContent).toContain('n. 12/2026');
  });
  it('fattura consegnata: niente "Segna come inviata" ma sì nota di credito', async () => {
    await render(fakeInvoice({ status: 'consegnata' }));
    expect(has('Segna come inviata')).toBe(false);
    expect(has('Annulla con nota di credito')).toBe(true);
  });
  it('fattura stornata: nessuna nota di credito e collegamento alla nota', async () => {
    const nc = fakeCreditNote();
    await render(fakeInvoice({ status: 'stornata' }), [nc]);
    expect(has('Annulla con nota di credito')).toBe(false);
    expect(host.textContent).toContain('Stornata dalla nota di credito n. NC1/2026');
  });
  it('nota di credito: riferimento alla fattura originale, nessuno storno', async () => {
    await render(fakeCreditNote({ id: 'd1' }));
    expect(host.textContent).toContain('Nota di credito');
    expect(host.textContent).toContain('Rettifica la fattura n. 12/2026');
    expect(has('Annulla con nota di credito')).toBe(false);
    expect(has('Elimina')).toBe(false);
  });
  it('preventivo: converti, elimina, stato; conferma se non accettato', async () => {
    await render(fakeDoc({ id: 'd1', status: 'inviato' }));
    expect(has('Converti in fattura')).toBe(true);
    expect(has('Elimina')).toBe(true);
    expect(host.querySelector('#dv-qstatus')).not.toBeNull();
    click('Converti in fattura');
    expect(store.createInvoiceFromQuote).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Convertire in fattura?');
  });
  it('preventivo accettato: conversione diretta alla bozza', async () => {
    store.createInvoiceFromQuote.mockResolvedValue({ ...draft(), id: 'new1' });
    await render(fakeDoc({ id: 'd1', status: 'accettato' }));
    click('Converti in fattura');
    await flush();
    expect(store.createInvoiceFromQuote).toHaveBeenCalledWith('d1');
    expect(store.getDocument).toHaveBeenLastCalledWith('new1');
  });
  it('documento inesistente / errore di caricamento', async () => {
    await render(undefined);
    expect(host.textContent).toContain('Documento non trovato');
  });
});

describe('DocumentView: emissione con conferma a pressione prolungata', () => {
  const open = async () => { await render(draft()); click('Emetti fattura'); };
  const check = () => { const c = host.querySelector<HTMLInputElement>('.iv-check input')!; act(() => { c.click(); }); };

  it('riepilogo con anteprima del numero e dicitura forfettario', async () => {
    await open();
    expect(host.textContent).toContain('Numero previsto');
    expect(host.textContent).toContain('anteprima non vincolante');
    expect(host.textContent).toContain('regime forfettario');
  });
  it('senza la spunta il pulsante è disattivo e issueInvoice non parte', async () => {
    vi.useFakeTimers();
    await open();
    expect(host.querySelector<HTMLButtonElement>('button.hold-btn')!.disabled).toBe(true);
    hold(2000);
    expect(store.issueInvoice).not.toHaveBeenCalled();
  });
  it('spunta + pressione di 1,2 s chiama issueInvoice una volta; una pressione breve no', async () => {
    store.issueInvoice.mockResolvedValue(fakeInvoice());
    vi.useFakeTimers();
    await open();
    check();
    const b = host.querySelector('button.hold-btn')!;
    hold(500);
    act(() => { b.dispatchEvent(new Event('pointerup', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(store.issueInvoice).not.toHaveBeenCalled();
    hold(1300);
    expect(store.issueInvoice).toHaveBeenCalledTimes(1);
    expect(store.issueInvoice).toHaveBeenCalledWith('d1');
    vi.useRealTimers();
    await flush();
    expect(host.textContent).toContain('Scarica XML');
  });
  it('errori bloccanti: link ai campi, nessuna emissione possibile; i warning non bloccano', async () => {
    validate.mockReturnValue([
      { field: 'customer.vatNumber', code: 'required', message: 'Partita IVA del cliente mancante', severity: 'error' },
      { field: 'profile.iban', code: 'missing', message: 'IBAN non indicato', severity: 'warning' },
    ]);
    vi.useFakeTimers();
    await open();
    const items = [...host.querySelectorAll('.iv-issue')];
    expect(items.map((i) => i.getAttribute('data-sev'))).toEqual(['error', 'warning']);
    expect(host.querySelector('a[href*="focus=customer.vatNumber"]')).not.toBeNull();
    expect(host.querySelector('a[href="/profilo"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('.iv-check input')!.disabled).toBe(true);
    hold(2000);
    expect(store.issueInvoice).not.toHaveBeenCalled();
  });
  it('gestisce InvoiceValidationError mostrando i problemi restituiti dall’emissione', async () => {
    store.issueInvoice.mockRejectedValue(Object.assign(new Error('non valida'), { issues: [{ field: 'customer.pec', code: 'invalid', message: 'PEC non valida', severity: 'error' }] }));
    vi.useFakeTimers();
    await open();
    check();
    hold(1300);
    vi.useRealTimers();
    await flush();
    expect(host.textContent).toContain('PEC non valida');
    expect(host.textContent).toContain('Correggi gli errori');
  });
});

describe('DocumentView: nota di credito', () => {
  it('motivo obbligatorio: senza motivo la pressione non emette; con motivo chiama createCreditNote (storno totale)', async () => {
    store.createCreditNote.mockResolvedValue(fakeCreditNote({ id: 'nc9' }));
    vi.useFakeTimers();
    await render(fakeInvoice({ id: 'd1' }));
    click('Annulla con nota di credito');
    expect(host.querySelector<HTMLButtonElement>('button.hold-btn')!.disabled).toBe(true);
    const ta = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'Importo errato');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    hold(1300);
    expect(store.createCreditNote).toHaveBeenCalledWith('d1', { reason: 'Importo errato', lines: undefined });
  });
});
