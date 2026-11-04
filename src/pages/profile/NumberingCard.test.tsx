// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui';
import { __resetStorageForTests, getProfile, issueInvoice, listAudit, saveDocument } from '../../storage';
import { draftData, seedProfile } from '../../storage/testkit';
import NumberingCard from './NumberingCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const setValue = (el: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const field = () => host.querySelector<HTMLInputElement>('input[aria-label^="Ultimo numero già usato"]')!;
const btn = (t: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(t))!;
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const dialog = () => document.body.querySelector('[role="dialog"]');
const counters = vi.fn();

const mount = async () => {
  await act(async () => { root.render(<ToastProvider><NumberingCard onCountersChanged={counters} /></ToastProvider>); });
  await flush();
};

beforeEach(async () => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom non lo ha (la scheda lo usa al focus)
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-20T12:00:00'));
  counters.mockReset();
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('Profilo: numerazione fatture elettroniche', () => {
  it('spiega a cosa serve e avverte del rischio di numeri duplicati', async () => {
    await mount();
    const t = host.textContent!;
    expect(t).toContain('Numerazione fatture elettroniche');
    expect(t).toContain('ultimo numero che hai usato');
    expect(t).toContain('errore fiscale');
    expect(t).toContain('14/2026');
    expect(field().value).toBe('0');
  });

  it('14 -> conferma esplicita -> la prossima fattura emessa è 15/2026, con audit e callback', async () => {
    await mount();
    setValue(field(), '14');
    expect(host.textContent).toContain('Dopo la modifica: 15/2026');
    click(btn('Imposta numero di partenza'));
    expect(dialog()).not.toBeNull();
    const confirm = btn('Conferma e imposta');
    expect(confirm.disabled).toBe(true); // serve la spunta di verifica
    click(dialog()!.querySelector('input[type="checkbox"]')!);
    expect(btn('Conferma e imposta').disabled).toBe(false);
    click(btn('Conferma e imposta'));
    await flush();
    expect(dialog()).toBeNull();
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 14 });
    expect(counters).toHaveBeenLastCalledWith({ 'FT-2026': 14 });
    expect((await listAudit('counter:FT-2026'))).toHaveLength(1);
    await saveDocument(draftData('a', '2026-03-10'));
    expect((await issueInvoice('a')).invoice!.number).toBe('15/2026');
    expect(host.textContent).toContain('ultimo n. 14');
  });

  it('non si può scendere sotto l\'emesso con questa app: errore sul campo, nessuna scheda di conferma', async () => {
    for (const id of ['a', 'b']) { await saveDocument(draftData(id, '2026-03-10')); await issueInvoice(id); }
    await mount();
    expect(field().value).toBe('2');
    setValue(field(), '1');
    expect(host.textContent).toContain('hai già emesso fino al n. 2/2026');
    click(btn('Imposta numero di partenza'));
    expect(dialog()).toBeNull();
  });

  it('abbassare il valore: avviso rosso e DOPPIA conferma', async () => {
    await mount();
    setValue(field(), '14');
    click(btn('Imposta numero di partenza'));
    click(dialog()!.querySelector('input[type="checkbox"]')!);
    click(btn('Conferma e imposta'));
    await flush();
    setValue(field(), '9');
    click(btn('Imposta numero di partenza'));
    expect(dialog()!.textContent).toContain('ABBASSANDO');
    const boxes = dialog()!.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    click(boxes[0]);
    expect(btn('Conferma e imposta').disabled).toBe(true); // manca la seconda
    click(boxes[1]);
    expect(btn('Conferma e imposta').disabled).toBe(false);
    click(btn('Conferma e imposta'));
    await flush();
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'FT-2026': 9 });
    expect((await listAudit('counter:FT-2026')).at(-1)!.detail).toMatch(/ABBASSATO/);
  });

  it('note di credito: numerazione separata', async () => {
    await mount();
    click([...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === 'Note di credito')!);
    await flush();
    setValue(field(), '2');
    click(btn('Imposta numero di partenza'));
    expect(dialog()!.textContent).toContain('NC3/2026');
    click(dialog()!.querySelector('input[type="checkbox"]')!);
    click(btn('Conferma e imposta'));
    await flush();
    expect((await getProfile()).invoiceYearCounters).toEqual({ 'NC-2026': 2 });
  });

  it('input non numerico: errore chiaro', async () => {
    await mount();
    setValue(field(), '14/2026');
    expect(host.textContent).toContain('solo cifre');
    expect(btn('Imposta numero di partenza').disabled).toBe(true);
  });
});
