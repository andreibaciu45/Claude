// @vitest-environment jsdom
// REV-IMP1 nell'interfaccia: un backup manomesso viene segnalato e il ripristino resta bloccato finché non lo si accetta esplicitamente.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui';
import { __resetStorageForTests, exportBackup, getDocument, issueInvoice, saveDocument } from '../storage';
import { draftData, seedProfile } from '../storage/testkit';
import BackupPage from './BackupPage';
import { settleUi } from '../__tests__/settle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let host: HTMLDivElement;
let root: Root;
const flush = settleUi; // attende che il DOM si stabilizzi (niente attese fisse): vedi src/__tests__/settle.ts
const btn = (t: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(t));
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const dialog = () => document.body.querySelector('[role="dialog"]');
const checkbox = (text: string) => [...dialog()!.querySelectorAll('label')].find((l) => l.textContent!.includes(text))!.querySelector('input')!;
const pickFile = async (json: string) => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([json], 'backup.json')], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};

beforeEach(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await seedProfile();
  await saveDocument(draftData('f1', '2026-03-10'));
  await issueInvoice('f1');
  await act(async () => { root.render(<ToastProvider><BackupPage /></ToastProvider>); });
  await flush();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const tampered = async () => {
  const j = JSON.parse(await exportBackup());
  j.documents[0].invoice.xml += ' ';
  return JSON.stringify(j);
};

describe('Backup manomesso', () => {
  it('mostra l\'esito dei controlli e blocca il ripristino finché non si accetta esplicitamente', async () => {
    await pickFile(await tampered());
    const d = dialog()!;
    expect(d.textContent).toContain('non supera i controlli di integrità');
    expect(d.textContent).toContain('1/2026');
    const go = btn('Sì, sostituisci i dati')!;
    await click(checkbox('Ho capito'));
    expect(go.disabled).toBe(true); // manca l'accettazione esplicita dei documenti non validi
    await click(checkbox('salta i documenti non validi'));
    expect(go.disabled).toBe(false);
  });

  it('accettando, il documento manomesso NON viene ripristinato e gli avvisi lo dicono', async () => {
    const before = (await getDocument('f1'))!.invoice!.xml;
    await pickFile(await tampered());
    await click(checkbox('Ho capito'));
    await click(checkbox('salta i documenti non validi'));
    await click(btn('Sì, sostituisci i dati')!);
    await flush();
    expect(document.body.textContent).toContain('NON ripristinat');
    expect((await getDocument('f1'))!.invoice!.xml).toBe(before);
  });
});
