import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../ui';
import { createApiClient } from '../../sync/api';
import { __resetSyncDbForTests, setMeta } from '../../sync/outbox';
import { createSyncEngine, type SyncEngine } from '../../sync/engine';
import { DPA_VERSION, TERMS_VERSION, termsAcceptanceStore } from '../../sync/legal';
import { MemStore, mkDoc } from '../../sync/testing/fakes';
import { LoginForm } from './LoginForm';
import { DataPrivacyCard, exportFileName } from './DataPrivacyCard';
import { AccountView } from './AccountView';

const saved = vi.hoisted(() => ({ calls: [] as { blob: Blob; name: string }[] }));
vi.mock('../quote/shared', () => ({ downloadBlob: (blob: Blob, name: string) => { saved.calls.push({ blob, name }); } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (req: { method: string; path: string; body: unknown }) => Response | Promise<Response>;
const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (status: number, code: string, message = 'm', headers = {}) => json(status, { error: { code, message } }, headers);

let token: string | null;
let account: { email: string; tenantId: string } | null;
let engine: SyncEngine;
let store: MemStore;
let calls: { method: string; path: string; body: unknown }[];
let handler: Handler;
let root: Root;
let host: HTMLElement;

const me = (extra = {}) => ({ email: 'mario@example.it', tenantId: 't', plan: 'free', quota: { docsThisMonth: 0, docsLimit: 3 }, ...extra });

function defaultHandler(req: { method: string; path: string; body: unknown }): Response {
  if (req.path === '/auth/request') return json(204);
  if (req.path === '/auth/verify') return json(200, { token: 'T', expiresAt: 1, tenantId: 't1' });
  if (req.path === '/me' && req.method === 'GET') return json(200, me());
  if (req.path.startsWith('/sync/push')) return json(200, { accepted: [], conflicts: [], cursor: '0' });
  if (req.path.startsWith('/sync/pull')) return json(200, { cursor: '0', ops: [], hasMore: false });
  return err(404, 'not_found');
}

beforeEach(async () => {
  await __resetSyncDbForTests();
  localStorage.clear();
  saved.calls = []; calls = [];
  handler = defaultHandler;
  token = null; account = null;
  store = new MemStore();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^\/v1/, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const req = { method: init?.method ?? 'GET', path, body };
    calls.push(req);
    return handler(req);
  }) as unknown as typeof fetch;
  const api = createApiClient({ baseUrl: '/v1', fetchImpl, getToken: () => token, sleep: async () => undefined, maxAttempts: 1 });
  engine = createSyncEngine({
    api, store, isOnline: () => true, now: () => Date.now(),
    tokenStore: { get: () => token, set: (t) => { token = t; }, clear: () => { token = null; } },
    accountStore: { get: () => account, set: (a) => { account = a; }, clear: () => { account = null; } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const $ = <T extends Element>(sel: string) => host.querySelector(sel) as T | null;
const byText = (tag: string, text: string | RegExp) =>
  [...host.querySelectorAll(tag)].find((n) => (typeof text === 'string' ? n.textContent === text : text.test(n.textContent ?? ''))) as HTMLElement | undefined;
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const submit = async (form: Element | null) => { await act(async () => { form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };

describe('login con accettazione dei termini', () => {
  it('checkbox non preselezionata, con link ai tre documenti; senza spunta non invia il codice', async () => {
    await act(async () => { root.render(<LoginForm engine={engine} />); });
    const cb = $<HTMLInputElement>('input[type=checkbox]')!;
    expect(cb.checked).toBe(false);
    const hrefs = [...host.querySelectorAll('label a')].map((x) => x.getAttribute('href'));
    expect(hrefs).toEqual(['/legal/termini.html', '/legal/privacy.html', '/legal/dpa.html']);
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await submit($('form'));
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain('devi confermare di aver letto Termini e Privacy');
  });

  it('flusso completo: email, codice, acceptedTerms in /auth/verify', async () => {
    await act(async () => { root.render(<LoginForm engine={engine} />); });
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await click($<HTMLInputElement>('input[type=checkbox]'));
    await submit($('form'));
    expect(calls[0]).toMatchObject({ path: '/auth/request', body: { email: 'mario@example.it' } });
    await type($<HTMLInputElement>('input[inputmode=numeric]')!, '123456');
    await submit($('form'));
    const verify = calls.find((c) => c.path === '/auth/verify')!;
    expect(verify.body).toMatchObject({ email: 'mario@example.it', code: '123456', acceptedTerms: { termsVersion: TERMS_VERSION, dpaVersion: DPA_VERSION } });
    expect(typeof (verify.body as { acceptedTerms: { acceptedAt: number } }).acceptedTerms.acceptedAt).toBe('number');
    expect(token).toBe('T');
    expect(termsAcceptanceStore.get()?.termsVersion).toBe(TERMS_VERSION);
  });

  it.each([
    ['terms_required', /devi accettare i Termini/],
    ['terms_version_mismatch', /Termini sono stati aggiornati/],
  ])('errore %s: messaggio italiano e nessun accesso', async (code, re) => {
    handler = (r) => (r.path === '/auth/verify' ? err(400, code) : defaultHandler(r));
    await act(async () => { root.render(<LoginForm engine={engine} />); });
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await click($<HTMLInputElement>('input[type=checkbox]'));
    await submit($('form'));
    await type($<HTMLInputElement>('input[inputmode=numeric]')!, '123456');
    await submit($('form'));
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(re);
    expect(token).toBeNull();
    if (code === 'terms_required') expect($<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  });

  it('429 sul codice: "riprova tra N secondi"', async () => {
    handler = (r) => (r.path === '/auth/request' ? err(429, 'rate_limited', 'x', { 'Retry-After': '42' }) : defaultHandler(r));
    await act(async () => { root.render(<LoginForm engine={engine} />); });
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await click($<HTMLInputElement>('input[type=checkbox]'));
    await submit($('form'));
    expect(host.textContent).toContain('Riprova tra 42 secondi');
  });
});

const signIn = () => { token = 'T'; account = { email: 'mario@example.it', tenantId: 't1' }; };
const renderCard = async (extra: Partial<ReturnType<typeof me>> = {}) => {
  signIn();
  handler = (r) => (r.path === '/me' && r.method === 'GET' ? json(200, me(extra)) : defaultHandler(r));
  await engine.refreshMe();
  await act(async () => { root.render(<ToastProvider><DataPrivacyCard engine={engine} api={{ exportData: () => createApiClient({ baseUrl: '/v1', fetchImpl: ((u: string, i: RequestInit) => handler({ method: i?.method ?? 'GET', path: String(u).replace(/^\/v1/, ''), body: undefined })) as unknown as typeof fetch, getToken: () => token }).exportData(), portal: async () => ({ url: 'https://pay.example.test/portal' }) }} /></ToastProvider>); });
};

describe('export dei dati', () => {
  it('scarica il JSON con nome datato', async () => {
    await renderCard();
    handler = (r) => (r.path === '/me/export' ? new Response('{"account":{"email":"mario@example.it"}}', { status: 200 }) : defaultHandler(r));
    await click(byText('button', 'Scarica tutti i miei dati'));
    await flush();
    expect(saved.calls).toHaveLength(1);
    expect(saved.calls[0].name).toMatch(/^vocepreventivo-miei-dati-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await saved.calls[0].blob.text()).toContain('mario@example.it');
    expect(exportFileName(new Date(2026, 0, 5))).toBe('vocepreventivo-miei-dati-2026-01-05.json');
  });
  it('429 con Retry-After e errore di rete: messaggi leggibili', async () => {
    await renderCard();
    handler = (r) => (r.path === '/me/export' ? err(429, 'rate_limited', 'x', { 'Retry-After': '3600' }) : defaultHandler(r));
    await click(byText('button', 'Scarica tutti i miei dati'));
    await flush();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Troppe richieste. Riprova tra 60 minuti.');
    handler = () => { throw new TypeError('offline'); };
    await click(byText('button', 'Scarica tutti i miei dati'));
    await flush();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Controlla la connessione');
    expect(saved.calls).toHaveLength(0);
  });
});

describe('cancellazione account a due passi', () => {
  const toConfirm = async () => {
    await click(byText('button', /Cancella il mio account/));
    expect(host.textContent).toContain('Viene cancellato dai nostri server');
    expect(host.textContent).toContain('Resta per obbligo di legge');
    expect(host.textContent).toContain('Resta sul tuo dispositivo');
    await click(byText('button', 'Continua'));
  };

  it('passo 2: il pulsante resta disattivo finché non digiti l\'email esatta; poi DELETE, logout, dati locali intatti', async () => {
    await renderCard();
    store.docs.set('d1', mkDoc('d1'));
    await setMeta('migrated', true);
    handler = (r) => (r.method === 'DELETE' ? json(200, { deleted: true, mode: 'anonymized', retainedInvoices: 2 }) : defaultHandler(r));
    await toConfirm();
    const del = byText('button', 'Cancella definitivamente') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    const inp = $<HTMLInputElement>('input[type=email]')!;
    await type(inp, 'altra@example.it');
    expect((byText('button', 'Cancella definitivamente') as HTMLButtonElement).disabled).toBe(true);
    await type(inp, 'Mario@Example.it');
    expect((byText('button', 'Cancella definitivamente') as HTMLButtonElement).disabled).toBe(false);
    await submit($('form'));
    const d = calls.find((c) => c.method === 'DELETE')!;
    expect(d).toMatchObject({ path: '/me', body: { confirmEmail: 'Mario@Example.it' } });
    expect(d.body).not.toHaveProperty('acknowledgeSubscription');
    expect(token).toBeNull();
    expect(engine.getStatus().signedIn).toBe(false);
    expect(store.docs.has('d1')).toBe(true);
    expect(host.textContent).toContain('restano su questo dispositivo');
    expect(host.textContent).toContain('2 fatture emesse restano');
  });

  it('409 active_subscription: link al portale e conferma esplicita per cancellare comunque', async () => {
    await renderCard({ plan: 'pro', billingStatus: 'active' });
    await click(byText('button', /Cancella il mio account/));
    expect(host.textContent).toContain('Hai un abbonamento attivo');
    await click(byText('button', 'Continua'));
    handler = (r) => (r.method === 'DELETE' ? (((r as { body: { acknowledgeSubscription?: boolean } }).body?.acknowledgeSubscription) ? json(200, { deleted: true, mode: 'purged', retainedInvoices: 0 }) : err(409, 'active_subscription')) : defaultHandler(r));
    // il corpo non arriva al handler di renderCard: usiamo le chiamate registrate
    handler = (r) => r.method === 'DELETE'
      ? ((r.body as { acknowledgeSubscription?: boolean }).acknowledgeSubscription ? json(200, { deleted: true }) : err(409, 'active_subscription'))
      : defaultHandler(r);
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await submit($('form'));
    expect(byText('button', 'Apri il portale di fatturazione')).toBeTruthy();
    expect(token).toBe('T');
    const force = $<HTMLInputElement>('input[type=checkbox]')!;
    expect((byText('button', 'Cancella definitivamente') as HTMLButtonElement).disabled).toBe(true);
    await click(force);
    await submit($('form'));
    expect(calls.filter((c) => c.method === 'DELETE').pop()?.body).toMatchObject({ acknowledgeSubscription: true });
    expect(token).toBeNull();
  });

  it('confirmation_mismatch dal server: messaggio italiano, resta connesso', async () => {
    await renderCard();
    handler = (r) => (r.method === 'DELETE' ? err(400, 'confirmation_mismatch') : defaultHandler(r));
    await toConfirm();
    await type($<HTMLInputElement>('input[type=email]')!, 'mario@example.it');
    await submit($('form'));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('non coincide');
    expect(token).toBe('T');
  });

  it('Annulla torna allo stato iniziale senza chiamare il server', async () => {
    await renderCard();
    await toConfirm();
    await click(byText('button', 'Annulla'));
    expect(byText('button', /Cancella il mio account/)).toBeTruthy();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
});

describe('AccountView: orologio e termini aggiornati', () => {
  const view = () => root.render(
    <MemoryRouter><ToastProvider><AccountView engine={engine} api={{ checkout: async () => ({ url: '' }), portal: async () => ({ url: '' }), exportData: async () => new Blob([]) }} /></ToastProvider></MemoryRouter>,
  );

  it('avviso gentile se l\'orologio è sfasato > 5 minuti, assente altrimenti', async () => {
    signIn();
    await setMeta('migrated', true);
    store.docs.set('d1', mkDoc('d1'));
    termsAcceptanceStore.set({ termsVersion: TERMS_VERSION, dpaVersion: DPA_VERSION });
    handler = (r) => r.path === '/sync/push' ? json(200, { accepted: [(r.body as { ops: { opId: string }[] }).ops[0].opId], conflicts: [], cursor: '1', serverTime: Date.now() + 10 * 60_000 }) : defaultHandler(r);
    await act(async () => { view(); });
    expect($('[data-testid=clock-warning]')).toBeNull();
    await act(async () => { await engine.scan(); await engine.syncNow(); });
    const w = $('[data-testid=clock-warning]');
    expect(w?.textContent).toContain('L’ora del telefono sembra sbagliata');
    expect(w?.textContent).toContain('problemi di sincronizzazione');
    expect(engine.getStatus().phase).toBe('idle');
    // non blocca: il pulsante di sincronizzazione resta attivo
    expect((byText('button', 'Sincronizza ora') as HTMLButtonElement).disabled).toBe(false);
  });

  it('se i termini cambiano versione chiede una nuova accettazione e la invia al login successivo', async () => {
    signIn();
    await setMeta('migrated', true);
    termsAcceptanceStore.set({ termsVersion: 'versione-vecchia', dpaVersion: 'versione-vecchia' });
    await act(async () => { view(); });
    expect(host.textContent).toContain('Accetta i Termini aggiornati');
    expect($<HTMLInputElement>('input[type=email]')!.value).toBe('mario@example.it');
    await click($<HTMLInputElement>('input[type=checkbox]'));
    await submit($('form'));
    await type($<HTMLInputElement>('input[inputmode=numeric]')!, '123456');
    await submit($('form'));
    expect(calls.find((c) => c.path === '/auth/verify')?.body).toMatchObject({ acceptedTerms: { termsVersion: TERMS_VERSION } });
    expect(host.textContent).not.toContain('Accetta i Termini aggiornati');
  });
});
