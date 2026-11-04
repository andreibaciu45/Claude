/** Codice invito nel form di accesso + schermata conflitti sulle bozze. */
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui';
import { createApiClient } from '../../sync/api';
import { __resetSyncDbForTests } from '../../sync/outbox';
import { createSyncEngine, type ConflictItem, type SyncEngine } from '../../sync/engine';
import { makeStorageHooks, unavailableStorageHooks } from '../../sync/storageHooks';
import { MemStore } from '../../sync/testing/fakes';
import { LoginForm, inviteFromUrl } from './LoginForm';
import { ConflictList } from './ConflictList';
import { MigrationCard } from './MigrationCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Req = { method: string; path: string; body: Record<string, unknown> | undefined };
const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (status: number, code: string, message = 'm', headers = {}) => json(status, { error: { code, message } }, headers);

let token: string | null; let account: { email: string; tenantId: string } | null;
let engine: SyncEngine; let calls: Req[]; let handler: (r: Req) => Response;
let root: Root; let host: HTMLElement;

const base = (r: Req): Response => {
  if (r.path === '/auth/request') return json(204);
  if (r.path === '/auth/verify') return json(200, { token: 'T', expiresAt: 1, tenantId: 't1' });
  if (r.path === '/me') return json(200, { email: 'm@e.it', tenantId: 't1', plan: 'free', quota: { docsThisMonth: 0, docsLimit: 3 } });
  if (r.path.startsWith('/sync/push')) return json(200, { accepted: [], conflicts: [], cursor: '0' });
  if (r.path.startsWith('/sync/pull')) return json(200, { cursor: '0', ops: [], hasMore: false });
  return err(404, 'not_found');
};

beforeEach(async () => {
  await __resetSyncDbForTests(); localStorage.clear();
  calls = []; handler = base; token = null; account = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const req: Req = { method: init?.method ?? 'GET', path: String(url).replace(/^\/v1/, ''), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(req);
    return handler(req);
  }) as unknown as typeof fetch;
  const client = createApiClient({ baseUrl: '/v1', fetchImpl, getToken: () => token, sleep: async () => undefined, maxAttempts: 1 });
  engine = createSyncEngine({
    api: client, store: new MemStore(), isOnline: () => true, now: () => Date.now(),
    tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
    accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
    hooks: unavailableStorageHooks,
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, '', '/'); });

const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const submit = async () => { await act(async () => { $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };
const inviteInput = () => $<HTMLInputElement>('input[placeholder="VP-XXXX-XXXX-XXXX"]');
const btn = (re: RegExp) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

async function toCodeStep() {
  await act(async () => { root.render(<LoginForm engine={engine} />); });
  await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
  await click($<HTMLInputElement>('input[type=checkbox]'));
  await submit();
  await type($<HTMLInputElement>('input[inputmode=numeric]')!, '123456');
}

describe('codice invito', () => {
  it('di norma il campo non c’è e /auth/verify non porta inviteCode', async () => {
    await toCodeStep();
    expect(inviteInput()).toBeNull();
    await submit();
    const v = calls.find((c) => c.path === '/auth/verify')!;
    expect('inviteCode' in (v.body ?? {})).toBe(false);
    expect(token).toBe('T');
  });

  it('invite_required: compare il campo con messaggio italiano; reinviando col codice si entra', async () => {
    handler = (r) => (r.path === '/auth/verify' && !r.body?.inviteCode ? err(403, 'invite_required', 'x') : base(r));
    await toCodeStep();
    await submit();
    expect(token).toBeNull();
    expect(inviteInput()).not.toBeNull();
    expect($('[role=alert]')?.textContent).toMatch(/serve un codice invito/);
    await type(inviteInput()!, 'vp-ab12-cd34');
    expect(inviteInput()!.value).toBe('VP-AB12-CD34');
    await submit();
    const verifies = calls.filter((c) => c.path === '/auth/verify');
    expect(verifies).toHaveLength(2);
    expect(verifies[1].body).toMatchObject({ code: '123456', inviteCode: 'VP-AB12-CD34' });
    expect(token).toBe('T');
  });

  it('invite_invalid: messaggio italiano sotto il campo, nessun accesso', async () => {
    handler = (r) => (r.path === '/auth/verify' ? err(403, 'invite_invalid', 'x') : base(r));
    await toCodeStep();
    await submit();
    await type(inviteInput()!, 'VP-SBAGLIATO');
    await submit();
    expect(host.textContent).toMatch(/non è valido, è già stato usato o è scaduto/);
    expect(token).toBeNull();
  });

  it('429 sul verify: "troppi tentativi errati" con attesa', async () => {
    handler = (r) => (r.path === '/auth/verify' ? err(429, 'rate_limited', 'x', { 'Retry-After': '120' }) : base(r));
    await toCodeStep();
    await submit();
    expect(host.textContent).toMatch(/Troppi tentativi errati.*2 minuti/);
    expect(token).toBeNull();
  });

  it('link con ?invito=CODICE: campo già visibile e precompilato, inviato al verify', async () => {
    window.history.replaceState(null, '', '/?invito=vp-aaaa-bbbb-cccc#/account');
    await toCodeStep();
    expect(inviteInput()!.value).toBe('VP-AAAA-BBBB-CCCC');
    await submit();
    expect(calls.find((c) => c.path === '/auth/verify')!.body).toMatchObject({ inviteCode: 'VP-AAAA-BBBB-CCCC' });
  });

  it('inviteFromUrl: query prima o dopo il #, valori strani ignorati', () => {
    expect(inviteFromUrl('https://x.it/?invito=ab-12')).toBe('AB-12');
    expect(inviteFromUrl('https://x.it/#/account?invito=vp-1234')).toBe('VP-1234');
    expect(inviteFromUrl('https://x.it/?invito=<script>')).toBe('');
    expect(inviteFromUrl('https://x.it/')).toBe('');
  });
});

describe('schermata conflitti sulle bozze', () => {
  const item: ConflictItem = {
    opId: 'o1', entity: 'document', entityId: 'd', reason: 'stale', message: 'x', label: 'Preventivo PRev-1 - Mario Rossi',
    canUseServer: true, canKeepBoth: true,
    draft: { localDeleted: false, localUpdatedAt: 60, serverUpdatedAt: 100, rows: [
      { field: 'Cliente', local: 'Mario Rossi', server: 'Anna Verdi' },
      { field: 'Righe', local: 'Tubo · 3 pz × 10,00 €', server: 'Tubo · 1 pz × 10,00 €\nRaccordo · 2 pz × 5,00 €' },
      { field: 'Totale', local: '36,60 €', server: '24,40 €' },
      { field: 'Note', local: 'mia', server: 'loro' },
    ] },
  };
  it('mostra il confronto e le tre scelte; i pulsanti chiamano il motore', async () => {
    const resolve = vi.fn(async () => undefined);
    const fake = { resolveConflict: resolve } as unknown as SyncEngine;
    await act(async () => { root.render(<ToastProvider><ConflictList conflicts={[item]} engine={fake} onUpgrade={() => undefined} /></ToastProvider>); });
    const t = $('[data-testid=draft-compare]')!;
    expect(t.textContent).toContain('modificata sia qui sia su un altro dispositivo');
    for (const w of ['Cliente', 'Righe', 'Totale', 'Note', 'Anna Verdi', '36,60 €', 'Raccordo']) expect(t.textContent).toContain(w);
    expect(btn(/Usa quella del server/)).toBeDefined();
    await click(btn(/^Tieni la mia$/));
    await click(btn(/Tieni entrambe/));
    await click(btn(/Usa quella del server/));
    expect(resolve.mock.calls.map((c: unknown[]) => c[1])).toEqual(['keep-local', 'keep-both', 'use-server']);
    expect(btn(/non inviare/)).toBeUndefined();
  });
  it('bozza eliminata qui: "Elimina comunque", niente "Tieni entrambe"', async () => {
    const fake = { resolveConflict: vi.fn() } as unknown as SyncEngine;
    const del: ConflictItem = { ...item, canKeepBoth: false, draft: { rows: [], localDeleted: true, serverUpdatedAt: 100 } };
    await act(async () => { root.render(<ToastProvider><ConflictList conflicts={[del]} engine={fake} onUpgrade={() => undefined} /></ToastProvider>); });
    expect(host.textContent).toContain('Hai eliminato questa bozza');
    expect(btn(/Elimina comunque/)).toBeDefined();
    expect(btn(/Tieni entrambe/)).toBeUndefined();
  });
});

describe('prima sincronizzazione dopo cambio account', () => {
  const preview = { documents: 2, catalog: 0, profile: false };
  it('avviso "altro account" e pulsante Svuota solo se lo storage lo permette', async () => {
    const withHook = createSyncEngine({
      api: createApiClient({ baseUrl: '/v1', fetchImpl: (async () => json(204)) as unknown as typeof fetch }), store: new MemStore(), isOnline: () => false, now: () => 1,
      tokenStore: { get: () => 'x', set: () => undefined, clear: () => undefined }, accountStore: { get: () => null, set: () => undefined, clear: () => undefined },
      hooks: makeStorageHooks({ clearLocalData: async () => undefined }),
    });
    await act(async () => { root.render(<MigrationCard preview={preview} engine={withHook} foreignData />); });
    expect(host.textContent).toContain('appartengono a un altro account');
    expect(btn(/Svuota i dati locali/)).toBeDefined();
    await act(async () => { root.render(<MigrationCard preview={preview} engine={engine} foreignData />); });
    expect(host.textContent).toContain('appartengono a un altro account');
    expect(btn(/Svuota i dati locali/)).toBeUndefined();
    await act(async () => { root.render(<MigrationCard preview={preview} engine={engine} />); });
    expect(host.textContent).not.toContain('altro account');
  });
});
