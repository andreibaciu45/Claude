// @vitest-environment jsdom
// "Ancora da incassare" deve sottrarre le note di credito parziali (stesso dovuto di recordPayment).
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui';
import { __resetStorageForTests, createCreditNote, issueInvoice, recordPayment, saveDocument } from '../storage';
import { draftData, lineData, seedProfile } from '../storage/testkit';
import DocumentsPage from './DocumentsPage';
import { settleUi } from '../__tests__/settle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let host: HTMLDivElement;
let root: Root;
const flush = settleUi; // attende che il DOM si stabilizzi (niente attese fisse): vedi src/__tests__/settle.ts
// Orologio fisso a metà 2026 (vedi beforeEach): le date dei fixture non dipendono dall'anno in cui gira la suite.
const year = 2026;
const stat = (label: string): string => {
  const el = [...host.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === label)!;
  return el.parentElement!.textContent!.replace(/\s/g, ' ');
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-15T12:00:00'));
  Element.prototype.scrollIntoView = vi.fn();
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await seedProfile();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const mount = async () => { await act(async () => { root.render(<ToastProvider><MemoryRouter><DocumentsPage /></MemoryRouter></ToastProvider>); }); await flush(); };

describe('Documenti: Ancora da incassare', () => {
  it('fattura 150, nota di credito parziale 100, nessun incasso => 50 (non 150)', async () => {
    await saveDocument(draftData('f1', `${year}-01-10`));
    await issueInvoice('f1');
    await createCreditNote('f1', { reason: 'reso parziale', lines: [lineData('l1', 100)] });
    await mount();
    const t = stat('Ancora da incassare');
    expect(t).toContain('50,00');
    expect(t).not.toContain('150,00');
  });
  it('dopo un incasso di 50 sul residuo => 0', async () => {
    await saveDocument(draftData('f1', `${year}-01-10`));
    await issueInvoice('f1');
    await createCreditNote('f1', { reason: 'reso parziale', lines: [lineData('l1', 100)] });
    await recordPayment('f1', { date: `${year}-01-12`, amount: 50 });
    await mount();
    expect(stat('Ancora da incassare')).toContain('0,00');
    expect(stat('Ancora da incassare')).not.toContain('50,00');
  });
});
