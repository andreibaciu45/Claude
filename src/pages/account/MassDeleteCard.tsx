import { useState } from 'react';
import { Button, Card } from '../../ui';
import { describeError } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import { a } from './styles';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeMassDelete(p: { catalog: number; documents: number }): string {
  const parts: string[] = [];
  if (p.documents) parts.push(plural(p.documents, 'documento', 'documenti'));
  if (p.catalog) parts.push(plural(p.catalog, 'voce a catalogo', 'voci a catalogo'));
  return parts.join(' e ');
}

/**
 * Circuit breaker: sul dispositivo sono spariti molti elementi già sincronizzati (dati del browser cancellati? archivio non letto?).
 * Non vengono cancellati dall'account finché l'utente non lo conferma; la scelta sicura (ripristinare) è quella evidenziata.
 */
export function MassDeleteCard({ alert, engine }: { alert: { catalog: number; documents: number }; engine: SyncEngine }) {
  const [busy, setBusy] = useState<'' | 'restore' | 'confirm'>('');
  const [error, setError] = useState('');
  const run = async (kind: 'restore' | 'confirm') => {
    if (kind === 'confirm' && !window.confirm(`Cancellare definitivamente dall’account ${describeMassDelete(alert)}? L’operazione non si può annullare.`)) return;
    setBusy(kind); setError('');
    try { await (kind === 'restore' ? engine.restoreFromServer() : engine.confirmMassDelete()); } catch (e) { setError(describeError(e)); } finally { setBusy(''); }
  };
  return (
    <Card>
      <div style={a.stack} role="alert">
        <h2 style={a.h2}>Controlla prima di continuare</h2>
        <p>Su questo dispositivo non risultano più <strong>{describeMassDelete(alert)}</strong> che erano sincronizzati con il tuo account.</p>
        <p style={a.muted}>Per sicurezza non li ho cancellati dall’account. Se li hai eliminati tu apposta, conferma; se non te lo aspettavi (dati del browser cancellati, cambio telefono), ripristinali dall’account.</p>
        {error && <p style={a.error}>{error}</p>}
        <div style={a.row}>
          <Button disabled={!!busy} onClick={() => void run('restore')}>{busy === 'restore' ? 'Ripristino…' : 'Ripristina dall’account'}</Button>
          <Button variant="danger" disabled={!!busy} onClick={() => void run('confirm')}>{busy === 'confirm' ? 'Cancello…' : 'Conferma: cancella anche dall’account'}</Button>
        </div>
      </div>
    </Card>
  );
}
