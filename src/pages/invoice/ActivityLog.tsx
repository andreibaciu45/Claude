import { useMemo, useState } from 'react';
import type { AuditEntry, QuoteDocument } from '../../types';
import { Button, Input, Select } from '../../ui';
import { downloadBlob } from '../quote/shared';
import { ACTIVITY_CATEGORIES, activityCsv, categoryOf, filterActivity, fmtDateTime, subjectOf, titleOf, type ActivityCategory } from './activity';

interface Props {
  /** null = in caricamento */
  entries: AuditEntry[] | null;
  error?: boolean;
  docs: Pick<QuoteDocument, 'id' | 'type' | 'invoice' | 'number' | 'status' | 'customer'>[];
  /** mostra a quale documento si riferisce ogni voce (registro globale) */
  showSubject?: boolean;
  /** nome del file CSV senza estensione */
  fileName: string;
  onToast?: (msg: string) => void;
}

/**
 * Registro delle attività, leggibile da un non tecnico: cosa è successo, quando, su quale documento.
 * Le voci sono di sola lettura (il registro non si modifica né si cancella). Filtri per tipo, date e testo; esportazione CSV.
 */
export function ActivityLog({ entries, error, docs, showSubject, fileName, onToast }: Props) {
  const [category, setCategory] = useState<ActivityCategory>('tutto');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const shown = useMemo(() => filterActivity(entries ?? [], docs, { category, text, from: from || undefined, to: to || undefined }), [entries, docs, category, text, from, to]);
  const filtered = category !== 'tutto' || !!text.trim() || !!from || !!to;

  if (error) return <p className="iv-note" data-tone="warning" role="alert">Il registro non è disponibile in questo momento. Riprova più tardi.</p>;
  if (!entries) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;

  const exportCsv = () => {
    if (!shown.length) { onToast?.('Nessuna attività da esportare con questi filtri.'); return; }
    downloadBlob(new Blob(['﻿', activityCsv(shown, docs)], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
    onToast?.('Registro attività esportato (CSV).');
  };

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
        Qui trovi tutto ciò che è stato fatto, dal più recente. Il registro è di sola lettura: nessuna voce si può modificare o cancellare.
      </p>
      <div className="act-filters">
        <Select aria-label="Tipo di attività" value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)}>
          {ACTIVITY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        <Input type="search" aria-label="Cerca nel registro" placeholder="Cerca (cliente, numero, parola)…" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <div className="act-dates">
          <label>
            <span className="field-label">Dal</span>
            <Input type="date" aria-label="Dal giorno" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="field-label">Al</span>
            <Input type="date" aria-label="Al giorno" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => { setCategory('tutto'); setText(''); setFrom(''); setTo(''); }}>Azzera filtri</Button>}
      </div>

      {shown.length === 0 ? (
        <p className="muted">{entries.length === 0 ? 'Ancora nessuna attività registrata.' : 'Nessuna attività con questi filtri.'}</p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }} aria-live="polite">{shown.length} {shown.length === 1 ? 'attività' : 'attività'}{filtered ? ` su ${entries.length}` : ''}</p>
          <ol className="act-list" aria-label="Registro attività">
            {shown.map((e) => (
              <li key={e.id} data-cat={categoryOf(e)}>
                <strong>{titleOf(e)}</strong>
                <time dateTime={new Date(e.at).toISOString()}>{fmtDateTime(e.at)}</time>
                {showSubject && <span className="act-subject">{subjectOf(e, docs)}</span>}
                {e.detail && <span>{e.detail}</span>}
                {e.voiceTranscript && <span className="muted">Detto a voce: “{e.voiceTranscript}”</span>}
                {e.xmlSha256 && <details><summary className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Impronta del file XML</summary><span className="act-hash">{e.xmlSha256}</span></details>}
              </li>
            ))}
          </ol>
        </>
      )}
      <Button variant="secondary" onClick={exportCsv} disabled={shown.length === 0}>Esporta registro attività (CSV)</Button>
    </div>
  );
}
