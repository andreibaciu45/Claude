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

const when = (ts?: number): string => (ts ? new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'data sconosciuta');
const cell = { verticalAlign: 'top', padding: '6px 8px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' } as const;

/** Confronto fra la bozza di questo dispositivo e quella del server: solo i campi che differiscono. */
export function DraftCompare({ draft }: { draft: NonNullable<ConflictItem['draft']> }) {
  return (
    <div style={a.stack} data-testid="draft-compare">
      <p style={a.muted}>
        {draft.localDeleted
          ? 'Hai eliminato questa bozza su questo dispositivo, ma un altro dispositivo l’ha modificata.'
          : 'Questa bozza è stata modificata sia qui sia su un altro dispositivo.'}
      </p>
      {draft.rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={cell} scope="col">Campo</th>
                <th style={cell} scope="col">Questo dispositivo<br /><small style={a.muted}>{when(draft.localUpdatedAt)}</small></th>
                <th style={cell} scope="col">Server (altro dispositivo)<br /><small style={a.muted}>{when(draft.serverUpdatedAt)}</small></th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r) => (
                <tr key={r.field} style={{ borderTop: '1px solid var(--c-border, #d0d5dd)' }}>
                  <th style={cell} scope="row">{r.field}</th>
                  <td style={cell}>{r.local}</td>
                  <td style={cell}>{r.server}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !draft.localDeleted && <p style={a.muted}>I campi principali (cliente, righe, totale, note) sono uguali: cambia solo l’orario di modifica.</p>}
    </div>
  );
}

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
              {c.draft ? <DraftCompare draft={c.draft} /> : <p style={a.muted}>{REASONS[c.reason] ?? c.message}</p>}
              {!c.draft && c.reason !== 'quota_exceeded' && c.message && REASONS[c.reason] !== c.message && <p style={a.muted}>{c.message}</p>}
              <div style={a.row}>
                {c.reason === 'quota_exceeded' && !native && <Button size="sm" onClick={onUpgrade}>Passa a Pro</Button>}
                {c.reason === 'quota_exceeded' && native && <span style={a.muted}>Gestisci il tuo abbonamento dal sito.</span>}
                {c.reason === 'quota_exceeded' && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'retry')}>Riprova</Button>}
                {c.canUseServer && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'use-server')}>{c.draft ? 'Usa quella del server' : 'Usa la versione del server'}</Button>}
                {c.draft && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'keep-local')}>{c.draft.localDeleted ? 'Elimina comunque' : 'Tieni la mia'}</Button>}
                {c.canKeepBoth && <Button size="sm" variant="secondary" disabled={busy === c.opId} onClick={() => void run(c, 'keep-both')}>Tieni entrambe</Button>}
                {c.draft && c.canKeepBoth && <span style={a.muted}>«Tieni entrambe»: la tua versione diventa una nuova bozza «copia in conflitto», senza numero fiscale; l’originale prende quella del server.</span>}
                {!c.draft && c.reason !== 'quota_exceeded' && <Button size="sm" variant="ghost" disabled={busy === c.opId} onClick={() => void run(c, 'keep-local')}>Tieni solo la mia, non inviare</Button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
