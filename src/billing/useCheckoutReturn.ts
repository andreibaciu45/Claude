import { useEffect, useRef, useState } from 'react';
import type { SyncEngine } from '../sync/engine';
import { parseCheckoutReturn, stripCheckoutParam, type CheckoutReturn } from './checkoutReturn';

export type CheckoutOutcome = 'idle' | 'verifying' | 'active' | 'pending' | 'cancelled';

const POLL_MS = 2500;
const POLL_TRIES = 6;

/**
 * Al ritorno da Stripe (`?checkout=success|cancel`) aggiorna /me finché il webhook non ha attivato il Pro
 * (può arrivare con qualche secondo di ritardo). Il Pro NON si attiva mai dal solo parametro nell'URL:
 * vale solo ciò che risponde il server.
 */
export function useCheckoutReturn(engine: SyncEngine, signedIn: boolean): CheckoutOutcome {
  const [outcome, setOutcome] = useState<CheckoutOutcome>('idle');
  // il parametro si legge e si toglie dall'URL UNA volta; l'effetto può rieseguirsi (StrictMode) senza perderlo
  const ret = useRef<CheckoutReturn | undefined>(undefined);

  useEffect(() => {
    if (!signedIn) return;
    if (ret.current === undefined) {
      ret.current = parseCheckoutReturn(window.location.search, window.location.hash);
      if (ret.current) { try { window.history.replaceState(null, '', stripCheckoutParam(window.location.href)); } catch { /* ignora */ } }
    }
    if (!ret.current) return;
    if (ret.current === 'cancel') { setOutcome('cancelled'); return; }

    let alive = true;
    let timer: number | undefined;
    setOutcome('verifying');
    const attempt = async (n: number): Promise<void> => {
      const me = await engine.refreshMe();
      if (!alive) return;
      if (me?.plan === 'pro') { setOutcome('active'); return; }
      if (n + 1 >= POLL_TRIES) { setOutcome('pending'); return; }
      timer = window.setTimeout(() => { void attempt(n + 1); }, POLL_MS);
    };
    void attempt(0);
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [engine, signedIn]);

  return outcome;
}
