import { useCallback, useEffect, useState } from 'react';
import type { MeResponse } from '../../shared/api';
import { syncEngine } from '../sync/engine';
import { useSyncStatus } from '../sync/useSyncStatus';
import { BILLING_CHANGED_EVENT, notifyBillingChanged } from './usage';
import { cacheFromMe, canReplacePlanCache, clearPlanCache, readPlanCache, resolvePlan, writePlanCache, type PlanState } from './entitlement';

/** Ultima risposta di /me già registrata in cache (evita di "ringiovanire" una risposta vecchia rimasta in memoria). */
let lastRecorded: MeResponse | null = null;

export interface UsePlan extends PlanState {
  signedIn: boolean;
  email: string | null;
  /** Richiede /me al server e aggiorna la cache. Ritorna true se la verifica è riuscita. */
  refresh(): Promise<boolean>;
}

/** Piano corrente (free/pro) con cache locale e tolleranza offline. Vedi entitlement.ts. */
export function usePlan(): UsePlan {
  const st = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());
  const [, bump] = useState(0);

  // registra ogni risposta nuova di /me (qualunque parte dell'app l'abbia richiesta)
  useEffect(() => {
    if (!st.signedIn) {
      if (readPlanCache()) { clearPlanCache(); notifyBillingChanged(); }
      lastRecorded = null;
      return;
    }
    if (st.me && st.me !== lastRecorded) {
      lastRecorded = st.me;
      // la verifica vale dal momento in cui il server ha risposto, non da quando questo componente si è montato
      const at = st.meAt ?? Date.now();
      const cur = readPlanCache();
      if (canReplacePlanCache(cur, at, st.me.email)) writePlanCache(cacheFromMe(st.me, at)); // mai una verifica più vecchia sopra una più recente (altra scheda)
      notifyBillingChanged();
    }
  }, [st.signedIn, st.me]);

  // ricalcola quando cambia la cache, al ritorno sulla scheda e ogni minuto (la scadenza matura col tempo)
  useEffect(() => {
    const tick = () => { setNow(Date.now()); bump((n) => n + 1); };
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    window.addEventListener(BILLING_CHANGED_EVENT, tick);
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(tick, 60_000);
    return () => { window.removeEventListener(BILLING_CHANGED_EVENT, tick); document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, []);

  const state = resolvePlan(readPlanCache(), st.signedIn, now, st.email);

  const refresh = useCallback(async (): Promise<boolean> => {
    const before = syncEngine.getStatus().me;
    const me = await syncEngine.refreshMe();
    return !!me && me !== before;
  }, []);

  // se la copia è vecchia o manca, prova a riverificarla (no-op se offline)
  const needs = st.signedIn && state.needsRefresh;
  useEffect(() => { if (needs) void syncEngine.refreshMe(); }, [needs]);

  return { ...state, signedIn: st.signedIn, email: st.email, refresh };
}
