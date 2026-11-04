import { useState } from 'react';
import { Button, Card, Field, Input, useToast } from '../../ui';
import { ApiClientError, describeError, type DeleteAccountResult } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { downloadBlob } from '../quote/shared';
import { a } from './styles';

export interface DataApi {
  exportData(): Promise<Blob>;
  portal(): Promise<{ url: string }>;
}

/** Nome file datato per l'export (data locale AAAA-MM-GG). */
export function exportFileName(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `vocepreventivo-miei-dati-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** Apre solo URL https (portale di fatturazione). */
function openUrl(url: string): void {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('URL non sicuro');
    window.location.assign(u.toString());
  } catch { throw new Error('Indirizzo del portale non valido.'); }
}

type Step = 'idle' | 'info' | 'confirm';

/**
 * Diritti GDPR: portabilità (scarica tutti i dati) e cancellazione account in due passi.
 * TODO(server): elenco/revoca dei dispositivi collegati non esiste ancora lato server (SECURITY-REVIEW, rischio 8):
 * quando ci saranno GET /v1/me/devices e DELETE /v1/me/devices/:id mostrare qui l'elenco con "Disconnetti".
 */
export function DataPrivacyCard({ engine, api, onDeleted }: { engine: SyncEngine; api: DataApi; onDeleted?: (r: DeleteAccountResult) => void }) {
  const st = useSyncStatus(engine);
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsPortal, setNeedsPortal] = useState(false);
  const [force, setForce] = useState(false);

  const accountEmail = (st.email ?? st.me?.email ?? '').trim();
  const bs = st.me?.billingStatus;
  const hasSubscription = st.me?.plan === 'pro' || bs === 'active' || bs === 'trialing' || bs === 'past_due';

  const doExport = async () => {
    setExporting(true); setExportError('');
    try {
      const blob = await api.exportData();
      downloadBlob(blob, exportFileName());
      toast('Dati scaricati: controlla la cartella Download (o il foglio di condivisione).');
    } catch (e) { setExportError(describeError(e)); } finally { setExporting(false); }
  };

  const reset = () => { setStep('idle'); setTyped(''); setError(''); setNeedsPortal(false); setForce(false); };

  const emailOk = accountEmail !== '' && typed.trim().toLowerCase() === accountEmail.toLowerCase();

  const doDelete = async () => {
    setBusy(true); setError('');
    try {
      const res = await engine.deleteAccount(typed, force);
      const kept = res.retainedInvoices ? ` ${res.retainedInvoices === 1 ? 'Una fattura emessa resta' : `${res.retainedInvoices} fatture emesse restano`} sui nostri server per obbligo di conservazione.` : '';
      toast(`Account cancellato. I tuoi dati restano su questo dispositivo.${kept}`);
      onDeleted?.(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'active_subscription') { setNeedsPortal(true); setError(describeError(e)); }
      else setError(describeError(e));
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try { openUrl((await api.portal()).url); } catch (e) { setError(describeError(e)); setBusy(false); }
  };

  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>I tuoi dati</h2>
        <p style={a.muted}>Puoi scaricare una copia di tutto ciò che abbiamo salvato sul tuo account (file JSON), oppure cancellare l’account.</p>
        <div style={a.row}>
          <Button variant="secondary" disabled={exporting} onClick={() => void doExport()}>{exporting ? 'Preparo il file…' : 'Scarica tutti i miei dati'}</Button>
        </div>
        {exportError && <p style={a.error} role="alert">{exportError}</p>}

        <hr style={a.hr} />

        {step === 'idle' && (
          <div style={a.stack}>
            <h3 style={a.h3}>Cancella account</h3>
            <p style={a.muted}>Elimina l’account e i dati salvati online. I dati sul tuo dispositivo non vengono toccati.</p>
            <div style={a.row}><Button variant="danger" size="sm" onClick={() => setStep('info')}>Cancella il mio account…</Button></div>
          </div>
        )}

        {step === 'info' && (
          <div style={a.stack} role="group" aria-label="Cancellazione account, passo 1 di 2">
            <h3 style={a.h3}>Passo 1 di 2 · Cosa succede</h3>
            <p style={a.notice}><strong>Viene cancellato dai nostri server:</strong> sessioni e dispositivi collegati, dati azienda, catalogo, preventivi e bozze, coda di sincronizzazione e il tuo accesso. I backup tecnici si svuotano da soli entro 14 giorni.</p>
            <p style={a.notice}><strong>Resta per obbligo di legge:</strong> le fatture già emesse restano conservate (obbligo di conservazione fiscale), così come il registro di accettazione dei Termini e le registrazioni di sicurezza. Non potrai più accedere all’account.</p>
            <p style={a.notice}><strong>Resta sul tuo dispositivo:</strong> tutti i documenti, il catalogo e i dati azienda che hai in questa app. Potrai continuare a usarla senza account.</p>
            {hasSubscription && <p style={{ ...a.notice, borderColor: 'var(--c-danger, #b42318)' }} role="alert"><strong>Hai un abbonamento attivo.</strong> Cancellare l’account non lo disdice: annullalo prima dal portale di fatturazione, altrimenti i pagamenti potrebbero continuare.</p>}
            <div style={a.row}>
              <Button variant="ghost" onClick={reset}>Annulla</Button>
              <Button variant="danger" onClick={() => setStep('confirm')}>Continua</Button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <form style={a.stack} role="group" aria-label="Cancellazione account, passo 2 di 2" onSubmit={(e) => { e.preventDefault(); if (emailOk && !busy) void doDelete(); }}>
            <h3 style={a.h3}>Passo 2 di 2 · Conferma</h3>
            <Field label={`Scrivi la tua email (${accountEmail}) per confermare`} error={error && !needsPortal ? error : undefined}>
              <Input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={!!error && !needsPortal} data-autofocus />
            </Field>
            {needsPortal && (
              <div style={a.stack}>
                <p style={a.error} role="alert">Hai un abbonamento attivo: annullalo dal portale di fatturazione e poi riprova.</p>
                <div style={a.row}><Button variant="secondary" disabled={busy} onClick={() => void openPortal()}>Apri il portale di fatturazione</Button></div>
                <label style={a.checkRow}>
                  <input type="checkbox" style={a.checkBox} checked={force} onChange={(e) => setForce(e.target.checked)} />
                  <span>Cancella comunque: annullerò io l’abbonamento dal portale del provider di pagamento.</span>
                </label>
              </div>
            )}
            <div style={a.row}>
              <Button variant="ghost" disabled={busy} onClick={reset}>Annulla</Button>
              <Button type="submit" variant="danger" disabled={!emailOk || busy || (needsPortal && !force)}>{busy ? 'Cancello…' : 'Cancella definitivamente'}</Button>
            </div>
            <p style={a.muted}>L’operazione non si può annullare. Dopo la cancellazione uscirai dall’account; i dati sul dispositivo restano.</p>
          </form>
        )}
      </div>
    </Card>
  );
}
