import { useState } from 'react';
import { Button, Card } from '../../ui';
import type { SyncEngine } from '../../sync/engine';
import type { MigrationPreview } from '../../sync/snapshot';
import { a, PRIVACY_NOTICE } from './styles';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeMigration(p: MigrationPreview): string {
  const parts = [plural(p.documents, 'documento', 'documenti'), plural(p.catalog, 'voce a catalogo', 'voci a catalogo')];
  if (p.profile) parts.push('i dati della tua azienda');
  return parts.join(', ');
}

export function MigrationCard({ preview, engine }: { preview: MigrationPreview; engine: SyncEngine }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>Prima sincronizzazione</h2>
        <p>Caricheremo sul tuo account: <strong>{describeMigration(preview)}</strong>.</p>
        <p style={a.notice} role="note">{PRIVACY_NOTICE}</p>
        <div style={a.row}>
          <Button disabled={busy} onClick={() => { setBusy(true); void engine.confirmMigration().finally(() => setBusy(false)); }}>{busy ? 'Carico…' : 'Carica e sincronizza'}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => engine.signOut()}>Annulla ed esci</Button>
        </div>
      </div>
    </Card>
  );
}
