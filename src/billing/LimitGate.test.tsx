// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LimitGate } from './LimitGate';
import { UsageCounter } from './UsageCounter';
import { computeAllowance } from './allowance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (el: React.ReactElement): Promise<string> => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { createRoot(host).render(<MemoryRouter>{el}</MemoryRouter>); });
  return (host.textContent ?? '').replace(/\u00a0/g, ' ');
};
afterEach(() => { delete (window as { Capacitor?: unknown }).Capacitor; document.body.innerHTML = ''; });

describe('LimitGate', () => {
  it('web: mostra i prezzi e il pulsante di accesso se non c’è account; resta possibile consultare', async () => {
    const t = await mount(<LimitGate signedIn={false} />);
    expect(t).toContain('15 €');
    expect(t).toContain('Accedi o registrati');
    expect(t).toContain('Continua a consultare');
  });
  it('app nativa: nessun prezzo né acquisto', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const t = await mount(<LimitGate signedIn />);
    expect(t).not.toMatch(/€|Passa a Pro|Accedi o registrati/);
    expect(t).toContain('Gestisci il tuo abbonamento dal sito');
    expect(t).toContain('Continua a consultare');
  });
});

describe('UsageCounter', () => {
  it('mostra 2/3 e l’avviso a 1 documento rimanente', async () => {
    const t = await mount(<UsageCounter allowance={computeAllowance('free', 2)} />);
    expect(t).toContain('Documenti questo mese: 2/3');
    expect(t).toContain('Ti resta 1 documento gratuito');
  });
  it('Pro: niente contatore', async () => {
    expect(await mount(<UsageCounter allowance={computeAllowance('pro', 9)} />)).toBe('');
  });
});
