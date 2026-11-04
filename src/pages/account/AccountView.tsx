import { useState } from 'react';
import { Badge, Button, Card, Segmented, Spinner, useToast } from '../../ui';
import { describeError } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { ConflictList } from './ConflictList';
import { a, PRIVACY_NOTICE } from './styles';
import { badgeView, relativeTime } from './format';

/** Apre solo URL https (checkout/portale restituiti dal server). */
function openUrl(url: string): void {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('URL non sicuro');
    window.location.assign(u.toString());
  } catch { throw new Error('Indirizzo di pagamento non valido.'); }
}

export function AccountView({ engine, api }: { engine: SyncEngine; api: { checkout(p: 'month' | 'year'): Promise<{ url: string }>; portal(): Promise<{ url: string }> } }) {
  const st = useSyncStatus(engine);
  const toast = useToast();
  const [plan, setPlan] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const me = st.me;

  const go = async (kind: 'checkout' | 'portal') => {
    setBusy(kind); setError('');
    try { openUrl((kind === 'checkout' ? await api.checkout(plan) : await api.portal()).url); } catch (e) { setError(describeError(e)); setBusy(''); }
  };
  const quota = me?.quota;
  const pct = quota?.docsLimit ? (quota.docsThisMonth / quota.docsLimit) * 100 : 0;
  const view = badgeView(st);

  return (
    <>
      <Card>
        <div style={a.stack}>
          <div style={a.between}>
            <div>
              <h2 style={a.h2}>{st.email ?? me?.email ?? 'Account'}</h2>
              <p style={a.muted}>Ultimo aggiornamento: {relativeTime(st.lastSyncAt)}</p>
            </div>
            {me && <Badge tone={me.plan === 'pro' ? 'success' : 'neutral'}>{me.plan === 'pro' ? 'Piano Pro' : 'Piano Free'}</Badge>}
          </div>
          {quota && (
            <div style={a.stack}>
              <p style={a.muted} id="quota-label">
                {quota.docsLimit === null ? `Documenti questo mese: ${quota.docsThisMonth} (illimitati)` : `Documenti questo mese: ${quota.docsThisMonth} su ${quota.docsLimit}`}
              </p>
              {quota.docsLimit !== null && (
                <div style={a.bar} role="progressbar" aria-labelledby="quota-label" aria-valuemin={0} aria-valuemax={quota.docsLimit} aria-valuenow={Math.min(quota.docsThisMonth, quota.docsLimit)}>
                  <div style={a.barFill(pct, pct >= 100)} />
                </div>
              )}
            </div>
          )}
          {!me && <p style={a.muted}>Dati del piano non disponibili (sei offline?).</p>}
          {me?.plan === 'free' && (
            <div style={a.stack}>
              <Segmented ariaLabel="Durata del piano Pro" value={plan} onChange={setPlan} options={[{ value: 'month', label: 'Mensile' }, { value: 'year', label: 'Annuale' }]} />
              <Button disabled={!!busy} onClick={() => void go('checkout')}>{busy === 'checkout' ? 'Apro…' : 'Passa a Pro'}</Button>
            </div>
          )}
          {me?.plan === 'pro' && <Button variant="secondary" disabled={!!busy} onClick={() => void go('portal')}>{busy === 'portal' ? 'Apro…' : 'Gestisci abbonamento'}</Button>}
          {error && <p style={a.error} role="alert">{error}</p>}
        </div>
      </Card>

      <Card>
        <div style={a.stack}>
          <div style={a.between}>
            <h2 style={a.h2}>Sincronizzazione</h2>
            {view && <Badge tone={view.tone}>{view.label}</Badge>}
          </div>
          <p style={a.muted} aria-live="polite">
            {st.phase === 'syncing' ? <><Spinner /> Sto sincronizzando…</>
              : st.phase === 'offline' ? 'Sei offline: le modifiche restano sul dispositivo e partiranno appena torna la rete.'
              : st.phase === 'error' ? `Qualcosa non ha funzionato: ${st.error ?? 'errore sconosciuto'}. Riproverò da solo.`
              : st.pendingOps ? `${st.pendingOps} modifiche in attesa di invio.` : 'Tutto aggiornato.'}
          </p>
          {st.remoteIgnored > 0 && <p style={a.muted}>{st.remoteIgnored} modifiche arrivate dal server sono state ignorate perché riguardano documenti già emessi su questo dispositivo.</p>}
          <div style={a.row}>
            <Button variant="secondary" size="sm" disabled={st.phase === 'syncing'} onClick={() => { void engine.syncNow().then(() => engine.refreshMe()); }}>Sincronizza ora</Button>
          </div>
        </div>
      </Card>

      <ConflictList conflicts={st.conflicts} engine={engine} onUpgrade={() => void go('checkout')} />

      <Card>
        <div style={a.stack}>
          <p style={a.notice} role="note">{PRIVACY_NOTICE}</p>
          <Button variant="ghost" onClick={() => {
            if (st.pendingOps && !window.confirm(`Ci sono ${st.pendingOps} modifiche non ancora inviate. Esci comunque? Restano sul dispositivo.`)) return;
            engine.signOut(); toast('Sei uscito dall\'account. I dati restano su questo dispositivo.');
          }}>Esci</Button>
        </div>
      </Card>
    </>
  );
}
