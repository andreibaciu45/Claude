import { useState } from 'react';
import { Badge, Button, Card, Segmented, Spinner, useToast } from '../../ui';
import { describeError } from '../../sync/api';
import { hasClockSkew, type SyncEngine } from '../../sync/engine';
import { hasAcceptedCurrent } from '../../sync/legal';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { ConflictList } from './ConflictList';
import { DataPrivacyCard } from './DataPrivacyCard';
import { LoginForm } from './LoginForm';
import { a, PRIVACY_NOTICE } from './styles';
import { badgeView, relativeTime } from './format';
import { UsageCounter } from '../../billing/UsageCounter';
import { useDocumentAllowance } from '../../billing/useAllowance';
import { useCheckoutReturn } from '../../billing/useCheckoutReturn';
import { usePlan } from '../../billing/usePlan';
import { isNativeApp } from '../../billing/platform';
import { openPaymentUrl } from '../../billing/safeUrl';
import { MassDeleteCard } from './MassDeleteCard';
import { PRO_PRICE_MONTH, PRO_PRICE_YEAR, PRO_YEARLY_SAVING, formatEur } from '../../billing/pricing';

const openUrl = (url: string): void => openPaymentUrl(url);

export function AccountView({ engine, api }: { engine: SyncEngine; api: { checkout(p: 'month' | 'year'): Promise<{ url: string }>; portal(): Promise<{ url: string }>; exportData(): Promise<Blob> } }) {
  const st = useSyncStatus(engine);
  const toast = useToast();
  const [plan, setPlan] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const me = st.me;
  const planInfo = usePlan();
  const { allowance } = useDocumentAllowance();
  const checkout = useCheckoutReturn(engine, st.signedIn);
  const native = isNativeApp();
  const isPro = planInfo.plan === 'pro';

  const go = async (kind: 'checkout' | 'portal') => {
    setBusy(kind); setError('');
    try { openUrl((kind === 'checkout' ? await api.checkout(plan) : await api.portal()).url); } catch (e) { setError(describeError(e)); setBusy(''); }
  };
  const view = badgeView(st);
  const [termsOk, setTermsOk] = useState(hasAcceptedCurrent);
  const skew = st.clockSkewMs;

  return (
    <>
      {!termsOk && st.signedIn && <LoginForm engine={engine} reacceptEmail={st.email ?? me?.email ?? ''} onDone={() => setTermsOk(true)} />}

      {st.massDelete && <MassDeleteCard alert={st.massDelete} engine={engine} />}

      <Card>
        <div style={a.stack}>
          <div style={a.between}>
            <div>
              <h2 style={a.h2}>{st.email ?? me?.email ?? 'Account'}</h2>
              <p style={a.muted}>Ultimo aggiornamento: {relativeTime(st.lastSyncAt)}</p>
            </div>
            <Badge tone={isPro ? 'success' : 'neutral'}>{isPro ? 'Piano Pro' : 'Piano Free'}</Badge>
          </div>
          {checkout === 'verifying' && <p style={a.muted} role="status"><Spinner /> Pagamento ricevuto, sto attivando il Pro…</p>}
          {checkout === 'active' && <p style={a.notice} role="status">Il piano Pro è attivo. Grazie! Ora i documenti sono illimitati.</p>}
          {checkout === 'pending' && <p style={a.notice} role="status">Il pagamento risulta completato, ma l’attivazione non è ancora arrivata. Di solito basta qualche minuto: riapri questa pagina più tardi. Se il Pro non compare, scrivici.</p>}
          {checkout === 'cancelled' && <p style={a.muted} role="status">Pagamento annullato: non ti è stato addebitato nulla.</p>}
          {isPro
            ? <p style={a.muted}>Documenti questo mese: {me?.quota?.docsThisMonth ?? allowance?.used ?? 0} (illimitati)</p>
            : <><UsageCounter allowance={allowance} />{allowance?.remaining === 0 && <p style={a.muted}>Hai usato i documenti gratuiti di questo mese: consultare, modificare e scaricare resta sempre possibile.</p>}</>}
          {allowance && allowance.limit !== null && (
            <div style={a.bar} role="progressbar" aria-label="Documenti usati questo mese" aria-valuemin={0} aria-valuemax={allowance.limit} aria-valuenow={Math.min(allowance.used, allowance.limit)}>
              <div style={a.barFill((allowance.used / allowance.limit) * 100, allowance.used >= allowance.limit)} />
            </div>
          )}
          {planInfo.reason === 'cache-pro' && planInfo.proValidUntil && (
            <p style={a.muted}>Non riesco a verificare l’abbonamento da un po’: il Pro resta attivo fino al {new Date(planInfo.proValidUntil).toLocaleDateString('it-IT')}. Connettiti a internet per rinnovare la verifica.</p>
          )}
          {planInfo.reason === 'expired' && (
            <p style={a.error} role="alert">Non riesco a verificare l’abbonamento da oltre 14 giorni: per ora usi il piano Free. Connettiti a internet per ripristinare il Pro. I tuoi dati sono intatti.</p>
          )}
          {planInfo.reason === 'unverified' && <p style={a.muted}>Dati del piano non disponibili (sei offline?).</p>}
          {native ? (
            <p style={a.muted}>Gestisci il tuo abbonamento dal sito.</p>
          ) : !isPro && planInfo.reason !== 'unverified' ? (
            <div style={a.stack}>
              <p style={a.muted}>
                Pro: documenti illimitati e sincronizzazione su più dispositivi. {formatEur(PRO_PRICE_MONTH)} al mese oppure {formatEur(PRO_PRICE_YEAR)} all’anno (risparmi {formatEur(PRO_YEARLY_SAVING)}). Disdici quando vuoi.
              </p>
              <Segmented ariaLabel="Durata del piano Pro" value={plan} onChange={setPlan} options={[{ value: 'month', label: `Mensile · ${formatEur(PRO_PRICE_MONTH)}` }, { value: 'year', label: `Annuale · ${formatEur(PRO_PRICE_YEAR)}` }]} />
              <Button disabled={!!busy} onClick={() => void go('checkout')}>{busy === 'checkout' ? 'Apro…' : 'Passa a Pro'}</Button>
            </div>
          ) : isPro ? <Button variant="secondary" disabled={!!busy} onClick={() => void go('portal')}>{busy === 'portal' ? 'Apro…' : 'Gestisci abbonamento'}</Button> : null}
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
          {hasClockSkew(skew) && (
            <p style={a.notice} role="status" data-testid="clock-warning">
              L’ora del telefono sembra sbagliata (circa {Math.max(1, Math.round(Math.abs(skew ?? 0) / 60_000))} minuti {(skew ?? 0) > 0 ? 'indietro' : 'avanti'} rispetto al server): può causare problemi di sincronizzazione. Controlla data e ora nelle impostazioni del telefono e attiva l’impostazione automatica.
            </p>
          )}
          {st.remoteIgnored > 0 && <p style={a.muted}>{st.remoteIgnored} modifiche arrivate dal server sono state ignorate perché riguardano documenti già emessi su questo dispositivo.</p>}
          <div style={a.row}>
            <Button variant="secondary" size="sm" disabled={st.phase === 'syncing'} onClick={() => { void engine.syncNow().then(() => engine.refreshMe()); }}>Sincronizza ora</Button>
          </div>
        </div>
      </Card>

      <ConflictList conflicts={st.conflicts} engine={engine} onUpgrade={() => void go('checkout')} />

      <DataPrivacyCard engine={engine} api={api} />

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
