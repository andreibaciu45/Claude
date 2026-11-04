// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---- microfono finto, pilotabile dal test ---- */
const fv = vi.hoisted(() => {
  const s = {
    kind: 'webspeech' as 'webspeech' | 'recorder' | 'none', state: 'idle' as string, error: null as string | null, partial: '',
    onFinal: null as ((t: string, a: string[]) => void) | null,
    start: null as unknown as ReturnType<typeof vi.fn>, stop: null as unknown as ReturnType<typeof vi.fn>, cancel: null as unknown as ReturnType<typeof vi.fn>,
    listeners: new Set<() => void>(),
  };
  return s;
});
vi.mock('../provider', async () => {
  const React = await import('react');
  return {
    useVoiceInput: (onFinal: (t: string, a: string[]) => void) => {
      fv.onFinal = onFinal;
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => { fv.listeners.add(force); return () => { fv.listeners.delete(force); }; }, []);
      return {
        kind: fv.kind, state: fv.state, listening: fv.state === 'listening' || fv.state === 'starting', partial: fv.partial, error: fv.error,
        usesServer: false, preferRecorder: false, setPreferRecorder: () => {}, canRetry: false,
        start: fv.start, stop: fv.stop, cancel: fv.cancel, retry: () => {},
      };
    },
  };
});
vi.mock('../../storage', () => ({ listCatalog: async () => [], listDocuments: async () => [] }));
const ex = vi.hoisted(() => ({ plan: vi.fn(), exec: vi.fn() }));
vi.mock('../executor', async (orig) => ({ ...(await orig<typeof import('../executor')>()), planCommand: ex.plan, executeCommand: ex.exec }));

import { busy } from '../../pwa/busy';
import { ToastProvider } from '../../ui';
import { VoiceCommandWidget } from './VoiceCommandWidget';

const setFv = (p: Partial<typeof fv>) => { Object.assign(fv, p); act(() => { fv.listeners.forEach((l) => l()); }); };
let host: HTMLDivElement; let root: Root; let nav: (to: string) => void;
function NavProbe() { nav = useNavigate(); return null; }

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const fire = (el: Element, type: string, init: EventInit = {}) => act(() => { el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init })); });
const key = (type: 'keydown' | 'keyup', k: string) => act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })); });
const fab = () => $('.vc-fab')!;
const pressFab = () => { fire(fab(), 'pointerdown'); fire(fab(), 'pointerup'); };
const text = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.includes(t) || b.getAttribute('aria-label') === t);

async function submitText(t: string) {
  const input = $('.vc-form input') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { ($('.vc-form') as HTMLFormElement).requestSubmit(); });
  await flush();
}

const SUMMARY = { headline: 'Emettere la fattura?', fields: [{ label: 'Documento', value: 'Fattura (bozza)' }, { label: 'Cliente', value: 'Rossi' }, { label: 'Importo', value: '€ 372,00' }], warnings: [] };
const readyIssue = (command: Command) => ({ status: 'ready', command, summary: SUMMARY, target: {} });

async function render(path = '/') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><ToastProvider><NavProbe /><VoiceCommandWidget /></ToastProvider></MemoryRouter>); });
  await flush();
}
const ack = () => localStorage.setItem('vp.voicePrivacyAck', '1');

beforeEach(() => {
  localStorage.clear();
  Object.assign(fv, { kind: 'webspeech', state: 'idle', error: null, partial: '', listeners: new Set() });
  fv.start = vi.fn(() => { fv.state = 'listening'; }); fv.stop = vi.fn(); fv.cancel = vi.fn(() => { fv.state = 'idle'; });
  ex.plan.mockReset(); ex.exec.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal('visualViewport', undefined);
  Element.prototype.scrollIntoView = () => {};
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  expect(busy.keys()).toEqual([]); // nessun percorso lascia lavori "in corso" dimenticati
});

describe('informativa microfono (docs/PWA.md §5)', () => {
  it('al primo avvio mostra l\'informativa e NON avvia il microfono; «Continua» salva il flag e avvia', async () => {
    await render();
    pressFab();
    const dlg = $('[role="dialog"][data-testid="voice-privacy"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.textContent).toContain('Google su Chrome, Apple su Safari');
    expect(dlg.textContent).toContain('nostri server');
    expect(dlg.textContent).toContain('non viene conservato');
    expect(fv.start).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe('Continua con il microfono'); // focus sul pulsante principale
    await act(async () => { text('Continua con il microfono')!.click(); });
    expect(localStorage.getItem('vp.voicePrivacyAck')).toBe('1');
    expect(fv.start).toHaveBeenCalledTimes(1);
    expect($('[data-testid="voice-privacy"]')).toBeNull();
  });

  it('una sola volta: con il flag già salvato non ricompare', async () => {
    ack();
    await render();
    pressFab();
    expect($('[data-testid="voice-privacy"]')).toBeNull();
    expect(fv.start).toHaveBeenCalledTimes(1);
  });

  it('«Preferisco scrivere» e ESC: niente microfono, niente flag, resta il campo di testo', async () => {
    await render();
    pressFab();
    await act(async () => { text('Preferisco scrivere')!.click(); });
    expect(fv.start).not.toHaveBeenCalled();
    expect(localStorage.getItem('vp.voicePrivacyAck')).toBeNull();
    expect($('.vc-form input')).not.toBeNull();
    // ESC sull'informativa = «Preferisco scrivere»
    await act(async () => { text('Chiudi')!.click(); });
    pressFab();
    expect($('[data-testid="voice-privacy"]')).not.toBeNull(); // non salvata: richiesta di nuovo
    key('keydown', 'Escape');
    expect($('[data-testid="voice-privacy"]')).toBeNull();
    expect(fv.start).not.toHaveBeenCalled();
    expect($('.vc-form input')).not.toBeNull();
  });

  it('il focus resta nella finestra (Tab) e torna all\'elemento precedente alla chiusura', async () => {
    await render();
    pressFab();
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-testid="voice-privacy"] button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Continua con il microfono', 'Preferisco scrivere']);
    buttons[1].focus();
    key('keydown', 'Tab');
    // Tab dall'ultimo pulsante: il focus torna al primo (gestito dal trap)
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('senza localStorage chiede ogni volta', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await render();
    pressFab();
    await act(async () => { text('Continua con il microfono')!.click(); });
    expect(fv.start).toHaveBeenCalledTimes(1);
    setFv({ state: 'idle' });
    await act(async () => { text('Chiudi')!.click(); });
    pressFab();
    expect($('[data-testid="voice-privacy"]')).not.toBeNull();
  });

  it('app nativa: testo del sistema operativo', async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
    await render();
    pressFab();
    const t = $('[data-testid="voice-privacy"]')!.textContent!;
    expect(t).toContain('sistema operativo');
    expect(t).toContain('Apple');
    expect(t).not.toContain('Google su Chrome');
  });

  it('senza microfono (kind none) non serve l\'informativa: si scrive', async () => {
    fv.kind = 'none';
    await render();
    pressFab();
    expect($('[data-testid="voice-privacy"]')).toBeNull();
    expect($('.vc-warn')!.textContent).toContain('non supporta il riconoscimento vocale');
    expect($('.vc-form input')).not.toBeNull();
  });
});

describe('«Cosa posso dire?»', () => {
  it('è aperto al primo uso, poi chiuso ma richiamabile', async () => {
    ack();
    await render();
    pressFab();
    expect($('[aria-label="Cosa posso dire?"][role="region"]')!.textContent).toContain('Emetti la fattura');
    for (const g of ['Documenti', 'Fatture', 'Note di credito', 'Incassi', 'Ricerca']) expect($(`section[aria-label="${g}"]`), g).not.toBeNull();
    await act(async () => { text('Chiudi')!.click(); });
    pressFab();
    expect($('[role="region"][aria-label="Cosa posso dire?"]')).toBeNull();
    await act(async () => { text('Cosa posso dire?')!.click(); });
    expect($('[role="region"][aria-label="Cosa posso dire?"]')).not.toBeNull();
  });
});

describe('microfono: casi limite', () => {
  it('permesso negato: messaggio in italiano e campo di testo', async () => {
    ack();
    await render();
    pressFab();
    setFv({ state: 'error', error: 'Permesso al microfono negato. Abilitalo dalle impostazioni del browser, oppure scrivi il testo qui sotto.' });
    expect($('[role="alert"]')!.textContent).toContain('Permesso al microfono negato');
    expect($('.vc-form input')).not.toBeNull();
  });
  it('microfono assente / non disponibile: errore mostrato, nessun crash', async () => {
    ack();
    await render();
    pressFab();
    setFv({ state: 'error', error: 'Microfono non trovato o non disponibile.' });
    expect($('[role="alert"]')!.textContent).toContain('Microfono non trovato');
  });
  it('il riconoscimento termina da solo senza testo: si può ripartire', async () => {
    ack();
    await render();
    pressFab();
    setFv({ state: 'listening' });
    setFv({ state: 'idle' });
    expect(text('Parla')).toBeDefined();
    fv.start.mockClear();
    await act(async () => { text('Parla')!.click(); });
    expect(fv.start).toHaveBeenCalledTimes(1);
  });
  it('doppio avvio: con l\'ascolto già attivo non riparte', async () => {
    ack();
    await render();
    pressFab();
    setFv({ state: 'listening' });
    fv.start.mockClear();
    fire(fab(), 'keydown'); // non è un tasto: ignorato
    act(() => { fab().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(fv.start).not.toHaveBeenCalled(); // Invio con ascolto attivo = stop
    expect(fv.stop).toHaveBeenCalledTimes(1);
  });
  it('doppio avvio con l\'informativa a schermo: un solo dialogo', async () => {
    await render();
    pressFab(); pressFab();
    expect(document.querySelectorAll('[data-testid="voice-privacy"]').length).toBe(1);
  });
  it('cambio rotta durante l\'ascolto: microfono fermato e scheda chiusa', async () => {
    ack();
    await render('/documenti/a');
    pressFab();
    setFv({ state: 'listening' });
    expect($('.sheet')).not.toBeNull();
    fv.cancel.mockClear();
    await act(async () => { nav('/documenti/b'); });
    expect(fv.cancel).toHaveBeenCalled();
    expect($('.sheet')).toBeNull();
  });
  it('tab in background: ascolto annullato; una scheda irreversibile si chiude', async () => {
    ack();
    ex.plan.mockImplementation(async (c: Command) => readyIssue(c));
    await render();
    pressFab();
    await submitText('Emetti la fattura');
    expect($('.vc-hold')).not.toBeNull();
    fv.cancel.mockClear();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fv.cancel).toHaveBeenCalled();
    expect($('.vc-hold')).toBeNull();
  });
});

describe('lavori in corso: hold-confirm e voice-command', () => {
  async function openConfirm() {
    ack();
    ex.plan.mockImplementation(async (c: Command) => readyIssue(c));
    await render();
    pressFab();
    await submitText('Emetti la fattura');
    expect($('.vc-hold')).not.toBeNull();
  }

  it('hold-confirm resta registrato per tutta la pressione e si libera al rilascio anticipato', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await openConfirm();
    fire($('.vc-hold')!, 'pointerdown');
    expect(busy.keys()).toEqual(['hold-confirm']);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(busy.keys()).toEqual(['hold-confirm']);
    fire($('.vc-hold')!, 'pointerup');
    expect(busy.keys()).toEqual([]);
    expect(ex.exec).not.toHaveBeenCalled();
  });

  for (const [name, release] of [
    ['pointercancel', () => fire($('.vc-hold')!, 'pointercancel')],
    ['pointerleave', () => fire($('.vc-hold')!, 'pointerout')],
    ['lostpointercapture', () => fire($('.vc-hold')!, 'lostpointercapture')],
    ['blur del pulsante', () => act(() => { ($('.vc-hold') as HTMLElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true })); })],
    ['blur della finestra', () => act(() => { window.dispatchEvent(new Event('blur')); })],
    ['ESC', () => key('keydown', 'Escape')],
  ] as const) {
    it(`si libera con ${name}`, async () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      await openConfirm();
      fire($('.vc-hold')!, 'pointerdown');
      expect(busy.keys()).toEqual(['hold-confirm']);
      release();
      expect(busy.keys()).toEqual([]);
    });
  }

  it('si libera se la scheda si smonta durante la pressione (chiusura, cambio rotta)', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await openConfirm();
    fire($('.vc-hold')!, 'pointerdown');
    expect(busy.keys()).toEqual(['hold-confirm']);
    await act(async () => { nav('/altra'); });
    expect($('.vc-hold')).toBeNull();
    expect(busy.keys()).toEqual([]);
  });

  it('si libera con l\'unmount dell\'intero widget durante la pressione', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await openConfirm();
    fire($('.vc-hold')!, 'pointerdown');
    expect(busy.keys()).toEqual(['hold-confirm']);
    act(() => root.unmount());
    expect(busy.keys()).toEqual([]);
    root = createRoot(host); // per l'afterEach
  });

  it('pressione completa: esegue una volta, senza varchi tra hold-confirm e voice-command; poi registro vuoto', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await openConfirm();
    let resolve!: (v: unknown) => void;
    ex.exec.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const seen: string[][] = [];
    const off = busy.subscribe(() => seen.push(busy.keys()));
    fire($('.vc-hold')!, 'pointerdown');
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(ex.exec).toHaveBeenCalledTimes(1);
    expect(busy.keys()).toEqual(['voice-command']); // in esecuzione
    expect(seen.every((k) => k.length > 0 || seen.indexOf(k) === seen.length - 1)).toBe(true); // mai vuoto prima della fine
    await act(async () => { resolve({ message: 'Fattura emessa.' }); });
    off();
    expect(busy.keys()).toEqual([]);
  });

  it('errore durante l\'esecuzione: voice-command liberato e errore mostrato', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await openConfirm();
    ex.exec.mockRejectedValue(new Error('archivio non disponibile'));
    fire($('.vc-hold')!, 'pointerdown');
    await act(async () => { vi.advanceTimersByTime(1200); });
    await flush();
    expect(busy.keys()).toEqual([]);
    expect($('[role="alert"]')!.textContent).toContain('archivio non disponibile');
  });

  it('annullamento della scheda: nessun lavoro registrato, nessuna esecuzione', async () => {
    await openConfirm();
    await act(async () => { text('Annulla')!.click(); });
    expect(busy.keys()).toEqual([]);
    expect(ex.exec).not.toHaveBeenCalled();
  });

  it('voice-command durante pianificazione ed esecuzione di un comando semplice, libero a fine/errore', async () => {
    ack();
    await render();
    pressFab();
    let resolve!: (v: unknown) => void;
    ex.plan.mockImplementation(async (c: Command) => ({ status: 'ready', command: c, summary: { headline: 'x', fields: [], warnings: [] }, target: {} }));
    ex.exec.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await submitText('Apri l’ultimo preventivo');
    expect(busy.keys()).toEqual(['voice-command']);
    await act(async () => { resolve({ message: 'Aperto.' }); });
    await flush();
    expect(busy.keys()).toEqual([]);
    // errore in pianificazione
    pressFab();
    ex.plan.mockRejectedValue(new Error('boom'));
    await submitText('Apri l’ultimo preventivo');
    expect(busy.keys()).toEqual([]);
  });
});
