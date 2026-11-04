import { useState } from 'react';
import { Button, Card } from '../../ui';
import { describeError } from '../../sync/api';
import type { SyncEngine } from '../../sync/engine';
import type { MigrationPreview } from '../../sync/snapshot';
import { downloadBlob } from '../quote/shared';
import { a, PRIVACY_NOTICE } from './styles';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeMigration(p: MigrationPreview): string {
  const parts = [plural(p.documents, 'documento', 'documenti'), plural(p.catalog, 'voce a catalogo', 'voci a catalogo')];
  if (p.profile) parts.push('i dati della tua azienda');
  return parts.join(', ');
}

export function MigrationCard({ preview, engine, foreignData }: { preview: MigrationPreview; engine: SyncEngine; foreignData?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canWipe = !!foreignData && engine.canDiscardLocalData();
  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>Prima sincronizzazione</h2>
        {foreignData && (
          <p style={a.error} role="alert">
            Attenzione: questi dati appartengono a un altro account che usava questo dispositivo. Se non sono tuoi, non caricarli sul tuo account.
          </p>
        )}
        <p>{foreignData ? 'Sul dispositivo ci sono' : 'Caricheremo sul tuo account'}: <strong>{describeMigration(preview)}</strong>.</p>
        {error && <p style={a.error} role="alert">{error}</p>}
        <p style={a.notice} role="note">{PRIVACY_NOTICE}</p>
        <div style={a.row}>
          {canWipe && (
            <Button variant="secondary" disabled={busy} onClick={() => {
              if (!window.confirm('Svuotare i dati locali di questo dispositivo? Documenti, catalogo e dati azienda dell’altro account verranno cancellati da qui (non dal suo account); ti verrà scaricata una copia di sicurezza.')) return;
              setBusy(true); setError('');
              void engine.discardLocalData()
                .then((r) => { if (r.backupJson) downloadBlob(new Blob([r.backupJson], { type: 'application/json' }), 'copia-di-sicurezza-dati-cancellati.json'); })
                .catch((e) => setError(describeError(e)))
                .finally(() => setBusy(false));
            }}>Svuota i dati locali</Button>
          )}
          <Button disabled={busy} onClick={() => { setBusy(true); void engine.confirmMigration().finally(() => setBusy(false)); }}>{busy ? 'Attendi…' : foreignData ? 'Carica comunque sul mio account' : 'Carica e sincronizza'}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => engine.signOut()}>Annulla ed esci</Button>
        </div>
      </div>
    </Card>
  );
}
