// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetStorageForTests, issueInvoice, listDocuments, saveDocument, StorageUnavailableError } from '../storage';
import { draftData, seedProfile } from '../storage/testkit';
import { StorageBanner } from './StorageBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const proto = () => (globalThis as unknown as { IDBDatabase: { prototype: { transaction: (...a: unknown[]) => unknown } } }).IDBDatabase.prototype;
const btn = (t: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(t));

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await seedProfile();
  await saveDocument(draftData('f1', '2026-03-10'));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('StorageBanner', () => {
  it('non compare se l\'archivio funziona', async () => {
    await act(async () => { root.render(<StorageBanner />); });
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('compare con role="alert" quando la connessione cade, l\'emissione è bloccata, "Riprova" lo toglie', async () => {
    await act(async () => { root.render(<StorageBanner />); });
    await flush();
    vi.spyOn(proto(), 'transaction').mockImplementation(() => { throw Object.assign(new Error('closed'), { name: 'InvalidStateError' }); });
    await act(async () => { await expect(issueInvoice('f1')).rejects.toBeInstanceOf(StorageUnavailableError); });
    await flush();
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('I dati non vengono salvati');
    expect(alert.textContent).toContain('Navigazione privata');
    expect(alert.textContent).toContain('Spazio pieno');
    expect(alert.textContent).toContain('Altre schede');
    expect(btn('Riprova')).toBeDefined();
    expect(btn('Scarica backup di emergenza')).toBeDefined();
    vi.restoreAllMocks();
    await act(async () => { btn('Riprova')!.click(); });
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect((await listDocuments())[0].status).toBe('bozza');
  });

  it('senza IndexedDB: avviso "non verranno salvati"', async () => {
    await __resetStorageForTests();
    const real = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    try {
      await act(async () => { root.render(<StorageBanner />); });
      await flush();
      const alert = host.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain('non verranno salvati');
      expect(alert.textContent).toContain('bloccata');
    } finally { vi.stubGlobal('indexedDB', real); }
  });
});
