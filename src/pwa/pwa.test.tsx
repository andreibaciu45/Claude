// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBusyRegistry } from './busy';
import { createUpdater, type RegistrationLike, type SwContainerLike } from './updater';
import { UpdatePrompt } from './UpdatePrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Emitter {
  private l = new Map<string, Array<() => void>>();
  addEventListener(t: string, f: () => void) { this.l.set(t, [...(this.l.get(t) ?? []), f]); }
  emit(t: string) { for (const f of this.l.get(t) ?? []) f(); }
}
function fake(opts: { controller?: boolean; waiting?: boolean; registerFails?: boolean } = {}) {
  const posted: unknown[] = [];
  const reg = Object.assign(new Emitter(), {
    waiting: opts.waiting ? { postMessage: (m: unknown) => { posted.push(m); } } : null as RegistrationLike['waiting'],
    installing: null as RegistrationLike['installing'],
    update: vi.fn(async () => undefined),
  });
  const container = Object.assign(new Emitter(), {
    controller: opts.controller === false ? null : {},
    register: vi.fn(async () => { if (opts.registerFails) throw new Error('no'); return reg as unknown as RegistrationLike; }),
  });
  return { reg, container, posted };
}
function make(opts?: Parameters<typeof fake>[0]) {
  const f = fake(opts);
  const busy = createBusyRegistry();
  const reload = vi.fn();
  const timers: Array<() => void> = [];
  const fg: Array<() => void> = [];
  const up = createUpdater({
    container: f.container as unknown as SwContainerLike, busy, reload,
    setInterval: (fn) => { timers.push(fn); return 1; }, onForeground: (fn) => { fg.push(fn); }, log: () => {},
  });
  return { ...f, busy, reload, timers, fg, up };
}

describe('busy registry', () => {
  it('conteggia le registrazioni e notifica', () => {
    const b = createBusyRegistry(); const l = vi.fn(); b.subscribe(l);
    b.register('a'); b.register('a'); expect(b.isBusy()).toBe(true);
    b.unregister('a'); expect(b.isBusy()).toBe(true);
    b.unregister('a'); expect(b.isBusy()).toBe(false);
    b.unregister('zz'); expect(b.isBusy()).toBe(false);
    expect(l).toHaveBeenCalled();
  });
});

describe('updater', () => {
  it('la registrazione fallita non lancia e non segnala aggiornamenti', async () => {
    const t = make({ registerFails: true });
    await expect(t.up.register('sw.js')).resolves.toBeUndefined();
    expect(t.up.getState().available).toBe(false);
  });

  it('prima installazione (nessun controller): nessun avviso', async () => {
    const t = make({ controller: false, waiting: true });
    await t.up.register('sw.js');
    t.container.emit('controllerchange');
    expect(t.up.getState().available).toBe(false);
  });

  it('versione in attesa: avviso, poi SKIP_WAITING e ricarica solo dopo controllerchange', async () => {
    const t = make({ waiting: true });
    await t.up.register('sw.js');
    expect(t.up.getState().available).toBe(true);
    t.up.apply();
    expect(t.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(t.reload).not.toHaveBeenCalled();
    t.container.emit('controllerchange');
    expect(t.reload).toHaveBeenCalledTimes(1);
    t.container.emit('controllerchange');
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('updatefound -> installed con controller: avviso', async () => {
    const t = make();
    await t.up.register('sw.js');
    const w = Object.assign(new Emitter(), { state: 'installing' });
    t.reg.installing = w as unknown as RegistrationLike['installing'];
    t.reg.emit('updatefound');
    expect(t.up.getState().available).toBe(false);
    w.state = 'installed'; w.emit('statechange');
    expect(t.up.getState().available).toBe(true);
  });

  it('controllerchange spontaneo (sw v3 con skipWaiting): avviso ma nessun ricaricamento automatico', async () => {
    const t = make();
    await t.up.register('sw.js');
    t.container.emit('controllerchange');
    expect(t.up.getState().available).toBe(true);
    expect(t.reload).not.toHaveBeenCalled();
    t.up.apply();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('non ricarica con lavori in corso e parte appena sono finiti', async () => {
    const t = make();
    await t.up.register('sw.js');
    t.container.emit('controllerchange');
    t.busy.register('invoice-issue');
    t.up.apply();
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.up.getState().waitingForIdle).toBe(true);
    t.busy.register('doc-dirty:1'); t.busy.unregister('invoice-issue');
    expect(t.reload).not.toHaveBeenCalled();
    t.busy.unregister('doc-dirty:1');
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('"Più tardi" annulla l\'attesa e non ricarica', async () => {
    const t = make();
    await t.up.register('sw.js');
    t.container.emit('controllerchange');
    t.busy.register('x'); t.up.apply(); t.up.dismiss(); t.busy.unregister('x');
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.up.getState().dismissed).toBe(true);
  });

  it('controllo periodico e al ritorno in primo piano; errori di update assorbiti', async () => {
    const t = make();
    await t.up.register('sw.js');
    expect(t.timers).toHaveLength(1); expect(t.fg).toHaveLength(1);
    t.timers[0]!(); t.fg[0]!();
    await Promise.resolve();
    expect(t.reg.update).toHaveBeenCalledTimes(2);
    t.reg.update.mockRejectedValueOnce(new Error('offline'));
    await expect(t.up.checkNow()).resolves.toBeUndefined();
  });
});

describe('UpdatePrompt', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('mostra role=status con i due pulsanti e reagisce ai clic', async () => {
    const t = make();
    await t.up.register('sw.js');
    await act(async () => { root.render(<UpdatePrompt updater={t.up} />); });
    expect(host.querySelector('[role=status]')).toBeNull();
    await act(async () => { t.container.emit('controllerchange'); });
    const box = host.querySelector('[role=status]')!;
    expect(box.textContent).toContain('È disponibile una nuova versione');
    const btn = (s: string) => [...host.querySelectorAll('button')].find((b) => b.textContent!.includes(s))!;
    await act(async () => { btn('Più tardi').click(); });
    expect(host.querySelector('[role=status]')).toBeNull();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('"Aggiorna ora" ricarica quando libero', async () => {
    const t = make();
    await t.up.register('sw.js');
    await act(async () => { root.render(<UpdatePrompt updater={t.up} />); t.container.emit('controllerchange'); });
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Aggiorna ora')!.click(); });
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('senza service worker non rende nulla', async () => {
    await act(async () => { root.render(<UpdatePrompt updater={null} />); });
    expect(host.innerHTML).toBe('');
  });
});
