import { useState } from 'react';
import { Button, Card } from '../../ui';
import type { ConflictChoice, ConflictItem, SyncEngine } from '../../sync/engine';
import { describeError } from '../../sync/api';
import { a } from './styles';
import { isNativeApp } from '../../billing/platform';
import { FREE_DOCS_PER_MONTH } from '../../billing/pricing';

const REASONS: Record<ConflictItem['reason'], string> = {
  locked_document: 'Il documento è già emesso sul server e non si può modificare.',
  duplicate_invoice_number: 'Esiste già un documento con lo stesso numero (forse emesso da un altro dispositivo).',
  quota_exceeded: `Hai raggiunto il limite di ${FREE_DOCS_PER_MONTH} documenti al mese del piano Free: il documento non è stato sincronizzato, ma resta intero sul tuo dispositivo.`,
  invalid: 'Il server non ha accettato questa modifica.',
  stale: 'La versione sul server è più recente.',
};

export function ConflictList({ conflicts, engine, onUpgrade }: { conflicts: ConflictItem[]; engine: SyncEngine; onUpgrade: () => void }) {
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const native = isNativeApp();
  if (!conflicts.length) return null;

  const run = async (c: ConflictItem, choice: ConflictChoice) => {
    setBusy(c.opId); setError('');
    try { await engine.resolveConflict(c.opId, choice); } catch (e) { setError(describeError(e)); } finally { setBusy(''); }
  };

  return (
    <Card>
      <div style={a.stack}>
        <h2 style={a.h2}>Da controllare ({conflicts.length})</h2>
        <p style={a.muted}>Nessun dato locale è stato perso: queste modifiche restano sul tuo dispositivo finché non scegli cosa fare.</p>
        {error && <p style={a.error} role="alert">{error}</p>}
        <ul style={a.list}>
          {conflicts.map((c) => (
            <li key={c.opId} style={{ ...a.stack, borderTop: '1px solid var(--c-border, #d0d5dd)', paddingTop: 12 }}>
              <strong>{c.label}</strong>
              <p style={a.muted}>{REASONS[c.reason] ?? c.message}</p>
              {c.reason !== 'quota_exceeded' && c.message && REASONS[c.reason] !== c.message && <p style={a.muted}>{c.message}</p>}
              <div style={a.row}>
                {c.reason === 'quota_exceeded' && !native && <Button size="sm" onClick={onUpgrade}>Passa a Pro</Button>}
                {c.reason === 'quota_exceeded' && native && <span style={a.muted}>Gestisci il tuo abbonamento dal sito.</span>}
                {c.reason === 'quota_exceeded' && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'retry')}>Riprova</Button>}
                {c.canUseServer && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'use-server')}>Usa la versione del server</Button>}
                {c.canKeepBoth && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'keep-both')}>Tieni entrambe</Button>}
                {c.reason !== 'quota_exceeded' && <Button size="sm" variant="ghost" disabled={busy === c.opId} onClick={() => void run(c, 'keep-local')}>Tieni solo la mia, non inviare</Button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
