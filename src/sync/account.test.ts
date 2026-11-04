import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientError } from './api';
import { __resetSyncDbForTests, getMeta, setMeta } from './outbox';
import { createSyncEngine, hasClockSkew, type SyncEngine } from './engine';
import { DPA_VERSION, TERMS_VERSION, currentAcceptance, hasAcceptedCurrent, termsAcceptanceStore } from './legal';
import { FakeServer, MemStore, mkDoc } from './testing/fakes';

let token: string | null;
let account: { email: string; tenantId: string } | null;
let server: FakeServer;
let store: MemStore;
let engine: SyncEngine;
let nowMs: number;

beforeEach(async () => {
  await __resetSyncDbForTests();
  localStorage.clear();
  nowMs = 1_000_000;
  token = 'tok'; account = { email: 'a@b.it', tenantId: 't' };
  server = new FakeServer(); store = new MemStore();
  engine = createSyncEngine({
    api: server, store, isOnline: () => true, now: () => nowMs,
    tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
    accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
  });
});

describe('termini al login', () => {
  it('verifyCode invia acceptedTerms e ricorda la versione accettata', async () => {
    token = null; account = null;
    expect(hasAcceptedCurrent()).toBe(false);
    await engine.verifyCode('A@B.it ', '123456', currentAcceptance(42));
    expect(server.verifyBodies[0]).toMatchObject({ email: 'a@b.it', acceptedTerms: { termsVersion: TERMS_VERSION, dpaVersion: DPA_VERSION, acceptedAt: 42 } });
    expect(hasAcceptedCurrent()).toBe(true);
  });
  it('una versione diversa dei termini richiede nuova accettazione', () => {
    termsAcceptanceStore.set({ termsVersion: 'vecchia', dpaVersion: DPA_VERSION });
    expect(hasAcceptedCurrent()).toBe(false);
  });
  it('terms_required dal server: nulla viene memorizzato né si entra', async () => {
    token = null; account = null;
    server.authVerify = async () => { throw new ApiClientError(400, 'terms_required', 'x'); };
    await expect(engine.verifyCode('a@b.it', '123456', currentAcceptance())).rejects.toMatchObject({ code: 'terms_required' });
    expect(token).toBeNull();
    expect(hasAcceptedCurrent()).toBe(false);
  });
});

describe('orologio', () => {
  it('rileva uno sfasamento > 5 minuti dal serverTime del push', async () => {
    store.docs.set('d1', mkDoc('d1'));
    await setMeta('migrated', true);
    server.serverTime = nowMs + 6 * 60_000;
    await engine.syncNow();
    expect(engine.getStatus().clockSkewMs).toBe(6 * 60_000);
    expect(hasClockSkew(engine.getStatus().clockSkewMs)).toBe(true);
    expect(engine.getStatus().phase).toBe('idle'); // non blocca
  });
  it('sfasamento piccolo: nessun avviso; senza serverTime: invariato', async () => {
    await setMeta('migrated', true);
    store.docs.set('d1', mkDoc('d1'));
    server.serverTime = nowMs - 2 * 60_000;
    await engine.syncNow();
    expect(hasClockSkew(engine.getStatus().clockSkewMs)).toBe(false);
    expect(hasClockSkew(null)).toBe(false);
    expect(hasClockSkew(-5 * 60_000 - 1)).toBe(true);
  });
});

describe('cancellazione account', () => {
  it('esce, azzera lo stato di sync ma lascia i dati locali', async () => {
    store.docs.set('d1', mkDoc('d1'));
    await setMeta('migrated', true);
    await engine.syncNow();
    await setMeta('cursor', '7');
    termsAcceptanceStore.set(currentAcceptance());
    const res = await engine.deleteAccount(' a@b.it ');
    expect(res.deleted).toBe(true);
    expect(server.deleteBodies).toEqual([{ confirmEmail: 'a@b.it' }]);
    expect(token).toBeNull();
    expect(account).toBeNull();
    expect(engine.getStatus()).toMatchObject({ signedIn: false, pendingOps: 0, lastSyncAt: null });
    expect(await getMeta('cursor')).toBeUndefined();
    expect(await getMeta('migrated')).toBeUndefined();
    expect(store.docs.has('d1')).toBe(true);
    expect(hasAcceptedCurrent()).toBe(false);
  });
  it('active_subscription: nessuna modifica; con conferma invia acknowledgeSubscription', async () => {
    server.deleteError = new ApiClientError(409, 'active_subscription', 'x');
    await expect(engine.deleteAccount('a@b.it')).rejects.toMatchObject({ status: 409, code: 'active_subscription' });
    expect(token).toBe('tok');
    expect(engine.getStatus().signedIn).toBe(true);
    server.deleteError = null;
    await engine.deleteAccount('a@b.it', true);
    expect(server.deleteBodies[1]).toEqual({ confirmEmail: 'a@b.it', acknowledgeSubscription: true });
    expect(token).toBeNull();
  });
  it('confirmation_mismatch: resta connesso', async () => {
    server.deleteError = new ApiClientError(400, 'confirmation_mismatch', 'x');
    await expect(engine.deleteAccount('altra@b.it')).rejects.toMatchObject({ code: 'confirmation_mismatch' });
    expect(token).toBe('tok');
  });
});
