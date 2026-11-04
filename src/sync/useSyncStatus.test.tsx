import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetSyncDbForTests } from './outbox';
import { createSyncEngine, type SyncEngine } from './engine';
import { useSyncStatus } from './useSyncStatus';
import { FakeServer, MemStore, mkItem } from './testing/fakes';
import { SyncBadge } from '../pages/account/SyncBadge';
import { badgeView, relativeTime } from '../pages/account/format';
import { describeMigration } from '../pages/account/MigrationCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let token: string | null;
let online = true;
let server: FakeServer;
let store: MemStore;
let engine: SyncEngine;
let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  await __resetSyncDbForTests();
  token = 'tok'; online = true; server = new FakeServer(); store = new MemStore();
  engine = createSyncEngine({
    api: server, store, isOnline: () => online, now: () => 5,
    tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
    accountStore: { get: () => ({ email: 'a@b.it', tenantId: 't' }), set: () => undefined, clear: () => undefined },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Probe() {
  const s = useSyncStatus(engine);
  return <p data-testid="p">{s.signedIn ? `${s.phase}|${s.pendingOps}|${s.lastSyncAt ?? '-'}` : 'out'}</p>;
}

describe('useSyncStatus', () => {
  it('riflette le transizioni di stato', async () => {
    await act(async () => { root.render(<Probe />); });
    expect(host.textContent).toBe('idle|0|-');
    await act(async () => { await engine.syncNow(); });
    expect(host.textContent).toBe('idle|0|5');
    store.catalog.set('c', mkItem('c'));
    online = false;
    await act(async () => { await engine.scan(); await engine.syncNow(); });
    expect(host.textContent).toBe('offline|1|5');
    online = true;
    await act(async () => { await engine.syncNow(); });
    expect(host.textContent).toBe('idle|0|5');
    await act(async () => { engine.signOut(); });
    expect(host.textContent).toBe('out');
  });
});

describe('SyncBadge e formattazioni', () => {
  it('badgeView è null senza account', () => {
    expect(badgeView({ signedIn: false, phase: 'idle', pendingOps: 0, conflicts: [], migration: null })).toBeNull();
  });
  it('badgeView per ogni fase', () => {
    const base = { signedIn: true, pendingOps: 0, conflicts: [], migration: null } as const;
    expect(badgeView({ ...base, phase: 'idle' })).toEqual({ label: 'Sincronizzato', tone: 'success' });
    expect(badgeView({ ...base, phase: 'idle', pendingOps: 2 })?.label).toBe('2 da inviare');
    expect(badgeView({ ...base, phase: 'offline', pendingOps: 3 })).toEqual({ label: 'Offline · 3 in coda', tone: 'warning' });
    expect(badgeView({ ...base, phase: 'error' })?.tone).toBe('danger');
    expect(badgeView({ ...base, phase: 'syncing' })?.label).toBe('Sincronizzo…');
    expect(badgeView({ ...base, phase: 'conflict', conflicts: [{}, {}] as never })?.label).toBe('2 conflitti');
  });
  it('relativeTime e anteprima migrazione in italiano', () => {
    expect(relativeTime(null)).toBe('mai');
    expect(relativeTime(1000, 1000 + 5 * 60_000)).toBe('5 min fa');
    expect(describeMigration({ documents: 1, catalog: 3, profile: false })).toBe('1 documento, 3 voci a catalogo');
  });
  it('SyncBadge non rende nulla senza account (app usabile senza)', async () => {
    await act(async () => { root.render(<MemoryRouter><SyncBadge /></MemoryRouter>); });
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
