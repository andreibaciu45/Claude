import { useCallback, useEffect, useState } from 'react';
import { listDocuments } from '../storage';
import { STORAGE_CHANGED_EVENT, syncEngine } from '../sync/engine';
import { computeAllowance, serverUsedFor, type Allowance } from './allowance';
import { readPlanCache, resolvePlan } from './entitlement';
import { BILLING_CHANGED_EVENT, countDocsInMonth, ledgerIdsForMonth } from './usage';
import { usePlan } from './usePlan';

/** Calcola la disponibilità adesso, leggendo storage e cache (per il controllo definitivo al salvataggio). */
export async function checkAllowanceNow(now = Date.now()): Promise<Allowance> {
  const st = syncEngine.getStatus();
  const cache = readPlanCache();
  const plan = resolvePlan(cache, st.signedIn, now, st.email).plan;
  const docs = await listDocuments();
  const local = countDocsInMonth(docs, ledgerIdsForMonth(now), now);
  const serverUsed = serverUsedFor(cache, now);
  return computeAllowance(plan, local, serverUsed);
}

/** Disponibilità di documenti nuovi questo mese. `allowance` è null finché non è calcolata (non bloccare nel frattempo). */
export function useDocumentAllowance(): { allowance: Allowance | null; reload: () => void } {
  const plan = usePlan();
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(BILLING_CHANGED_EVENT, reload);
    window.addEventListener(STORAGE_CHANGED_EVENT, reload);
    return () => { window.removeEventListener(BILLING_CHANGED_EVENT, reload); window.removeEventListener(STORAGE_CHANGED_EVENT, reload); };
  }, [reload]);

  useEffect(() => {
    let alive = true;
    checkAllowanceNow().then((a) => { if (alive) setAllowance(a); }).catch(() => { /* non bloccare se la lettura fallisce */ });
    return () => { alive = false; };
  }, [plan.plan, plan.reason, plan.verifiedAt, tick]);

  return { allowance, reload };
}
