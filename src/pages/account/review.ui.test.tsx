/** Regressioni della revisione indipendente: scheda "cancellazione di massa" e badge. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '../../ui';
import type { SyncEngine } from '../../sync/engine';
import { MassDeleteCard, describeMassDelete } from './MassDeleteCard';
import { badgeView } from './format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const btn = (re: RegExp) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement;

describe('MassDeleteCard', () => {
  it('descrive cosa è sparito e offre prima la scelta sicura (ripristina)', async () => {
    const engine = { restoreFromServer: vi.fn(async () => undefined), confirmMassDelete: vi.fn(async () => undefined) } as unknown as SyncEngine;
    await act(async () => { root.render(<ToastProvider><MassDeleteCard alert={{ documents: 6, catalog: 1 }} engine={engine} /></ToastProvider>); });
    expect(host.textContent).toContain('6 documenti e 1 voce a catalogo');
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons[0].textContent).toMatch(/Ripristina/);
    await act(async () => { btn(/Ripristina/).click(); });
    expect(engine.restoreFromServer).toHaveBeenCalledTimes(1);
  });
  it('la cancellazione definitiva chiede una seconda conferma', async () => {
    const engine = { restoreFromServer: vi.fn(), confirmMassDelete: vi.fn(async () => undefined) } as unknown as SyncEngine;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => { root.render(<ToastProvider><MassDeleteCard alert={{ documents: 2, catalog: 0 }} engine={engine} /></ToastProvider>); });
    await act(async () => { btn(/Conferma/).click(); });
    expect(confirm).toHaveBeenCalled();
    expect(engine.confirmMassDelete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => { btn(/Conferma/).click(); });
    expect(engine.confirmMassDelete).toHaveBeenCalledTimes(1);
  });
  it('testi e badge', () => {
    expect(describeMassDelete({ documents: 1, catalog: 0 })).toBe('1 documento');
    expect(badgeView({ signedIn: true, phase: 'idle', pendingOps: 0, conflicts: [], migration: null, massDelete: { documents: 3, catalog: 0 } })?.label).toBe('Da confermare');
  });
});
