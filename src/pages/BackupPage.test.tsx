// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui';
import {
  __resetStorageForTests, exportBackup, issueInvoice, listCustomers, listDocuments, saveCatalogItem, saveCustomer, saveDocument,
} from '../storage';
import { draftData, seedProfile } from '../storage/testkit';
import { getBackend } from '../storage/db';
import BackupPage from './BackupPage';
import { settleUi } from '../__tests__/settle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let host: HTMLDivElement;
let root: Root;
const flush = settleUi; // attende che il DOM si stabilizzi (niente attese fisse): vedi src/__tests__/settle.ts
/** Attende (con act) che la condizione diventi vera: niente attese fisse, regge i picchi di carico della macchina. */
const until = async <T,>(fn: () => T | null | undefined | false, ms = 8000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('until: condizione non raggiunta entro ' + ms + ' ms');
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
};
const btn = (t: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(t));
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const dialog = () => document.body.querySelector('[role="dialog"]');
const mount = async () => { await act(async () => { root.render(<ToastProvider><BackupPage /></ToastProvider>); }); await flush(); };
const pickFile = async (json: string) => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([json], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};
const tick = async () => { const box = dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await click(box); };

const populate = async () => {
  await seedProfile();
  await saveCatalogItem({ id: 'k1', name: 'Tubo', aliases: [], unit: 'm', price: 5, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1 });
  await saveCustomer({ id: 'c1', name: 'Rossi Srl', vatNumber: '02345678904' });
  await saveCustomer({ id: 'c2', name: 'Verdi Spa', vatNumber: '01234567897' });
  await saveDocument(draftData('f1', '2026-03-10'));
  await issueInvoice('f1');
  await saveDocument(draftData('f2', '2026-03-11'));
};

beforeEach(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  try { localStorage.clear(); } catch { /* */ }
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Backup: ripristino con anteprima', () => {
  it('l\'anteprima conta anche i clienti (backup v3) e le fatture emesse', async () => {
    await populate();
    const json = await exportBackup();
    await mount();
    await pickFile(json);
    const t = dialog()!.textContent!;
    expect(t).toContain('1 voce di listino');
    expect(t).toContain('2 documenti');
    expect(t).toContain('1 fattura/nota emessa');
    expect(t).toContain('2 clienti');
    expect(t).toContain('Bianchi Mario Impianti');
  });

  it('se ci sono dati esistenti serve la conferma esplicita; senza spunta il pulsante è disabilitato e non importa', async () => {
    await populate();
    const json = await exportBackup();
    await mount();
    await pickFile(json);
    const go = btn('Sì, sostituisci i dati')!;
    expect(go.disabled).toBe(true);
    expect(dialog()!.textContent).toContain('Cosa verrà sostituito');
    expect(dialog()!.textContent).toContain('2 clienti');
    await click(go);
    expect(dialog()).not.toBeNull();
    await tick();
    expect(btn('Sì, sostituisci i dati')!.disabled).toBe(false);
    await click(btn('Sì, sostituisci i dati')!);
    await flush();
    expect(dialog()).toBeNull();
    expect((await listDocuments()).length).toBe(2);
    expect((await listCustomers()).length).toBe(2);
  });

  it('annullando non cambia nulla', async () => {
    await populate();
    const json = await exportBackup();
    await getBackend().transact('readwrite', (t) => t.del('catalog', 'k1'));
    await mount();
    await pickFile(json);
    await click(btn('Annulla')!);
    expect(dialog()).toBeNull();
    expect(await getBackend().transact('readonly', (t) => t.all('catalog'))).toHaveLength(0);
  });

  it('archivio vuoto: nessuna spunta richiesta e nessun avviso di sostituzione', async () => {
    await populate();
    const json = await exportBackup();
    await __resetStorageForTests();
    await deleteDB('vocepreventivo');
    await mount();
    await pickFile(json);
    expect(dialog()!.textContent).toContain('non ci sono dati');
    expect(dialog()!.querySelector('input[type="checkbox"]')).toBeNull();
    const go = btn('Ripristina i dati')!;
    expect(go.disabled).toBe(false);
    await click(go);
    await flush();
    expect((await listDocuments()).length).toBe(2);
  });

  it('avvisi di versione: backup v2 senza rubrica e senza data', async () => {
    await populate();
    const b = JSON.parse(await exportBackup());
    b.version = 2; delete b.customers; delete b.exportedAt;
    await mount();
    await pickFile(JSON.stringify(b));
    const t = dialog()!.textContent!;
    expect(t).toContain('formato più vecchio (v2');
    expect(t).toContain('non contiene la rubrica clienti');
    expect(t).toContain('non c\'è la data di creazione');
  });

  it('backup più vecchio dei dati attuali: avviso su fatture e modifiche più recenti', async () => {
    await populate();
    const b = JSON.parse(await exportBackup());
    b.documents = b.documents.filter((d: { invoice?: { lockedAt?: number } }) => !d.invoice?.lockedAt);
    b.exportedAt = '2020-01-01T00:00:00.000Z';
    await mount();
    await pickFile(JSON.stringify(b));
    const t = dialog()!.textContent!;
    expect(t).toContain('Su questo dispositivo ci sono 1 fattura/nota emessa, il backup ne contiene 0');
    expect(t).toContain('modifiche più recenti');
  });

  it('file di una versione più recente o non valido: errore leggibile, nessuna scheda', async () => {
    await mount();
    await pickFile(JSON.stringify({ version: 99, profile: {}, catalog: [], documents: [] }));
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain('più recente');
    await pickFile('non è json');
    expect(host.textContent).toContain('JSON');
  });
});

describe('Backup: sezione "Controllo dati"', () => {
  it('archivio sano: messaggio "Tutto in ordine"', async () => {
    await populate();
    await mount();
    expect(host.textContent).toContain('Controllo dati');
    await click(btn('Controlla i dati')!);
    const r = await until(() => host.querySelector('[aria-label="Esito del controllo dati"]'));
    expect(r.textContent).toContain('Tutto in ordine');
    expect(r.textContent).toContain('Controllati 2 documenti');
  });

  it('numerazione con buco: problema spiegato in italiano', async () => {
    await seedProfile();
    for (const id of ['a', 'b', 'c']) { await saveDocument(draftData(id, '2026-03-10')); await issueInvoice(id); }
    await getBackend().transact('readwrite', (t) => t.del('documents', 'b'));
    await mount();
    await click(btn('Controlla i dati')!);
    const r = (await until(() => host.querySelector('[aria-label="Esito del controllo dati"]'))).textContent!;
    expect(r).toContain('Problemi trovati');
    expect(r).toContain('mancano i numeri 2/');
    expect(r).toContain('commercialista');
  });
});
