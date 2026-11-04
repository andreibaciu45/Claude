import { useEffect, useMemo, useState } from 'react';
import type { DocLine, QuoteDocument } from '../../types';
import { roundMoney, uid } from '../../types';
import { fmtDate, fmtNum, fmtQty, lineAmount } from '../../pdf';
import { Field, Segmented, Sheet, Textarea } from '../../ui';
import { NumInput } from '../quote/NumInput';
import { HoldButton } from './HoldButton';
import { displayNumber } from './model';

interface Props {
  open: boolean;
  onClose: () => void;
  doc: QuoteDocument;
  busy: boolean;
  onCreate: (o: { reason: string; lines?: DocLine[] }) => void;
}

/** Scheda "Annulla con nota di credito": motivo obbligatorio, storno totale (default) o parziale. */
export function CreditNoteSheet({ open, onClose, doc, busy, onCreate }: Props) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'totale' | 'parziale'>('totale');
  const [sel, setSel] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!open) { setReason(''); setMode('totale'); setSel({}); setTouched(false); } }, [open]);

  const picked = useMemo(
    () => doc.lines.filter((l) => (sel[l.id] ?? 0) > 0).map((l) => ({ ...l, id: uid(), qty: Math.min(l.qty, sel[l.id]) })),
    [doc.lines, sel],
  );
  const partialTotal = roundMoney(picked.reduce((s, l) => s + lineAmount(l), 0));
  const reasonOk = reason.trim().length > 0;
  const linesOk = mode === 'totale' || picked.length > 0;
  const canGo = reasonOk && linesOk;

  return (
    <Sheet open={open} onClose={onClose} title="Annulla con nota di credito">
      <div className="stack">
        <p className="iv-note" data-tone="warning">
          La fattura n. {displayNumber(doc)} del {fmtDate(doc.invoice?.operationDate ?? doc.date)} non si cancella: si annulla emettendo una nota di credito collegata, che avrà un suo numero e non si può più modificare.
        </p>
        <Field label="Motivo dell’annullamento (obbligatorio)" error={touched && !reasonOk ? 'Scrivi il motivo.' : undefined}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} placeholder="Es. Importo errato / lavoro non eseguito" aria-invalid={touched && !reasonOk ? true : undefined} data-autofocus />
        </Field>
        <Segmented ariaLabel="Tipo di storno" value={mode} onChange={setMode} options={[{ value: 'totale', label: 'Storno totale' }, { value: 'parziale', label: 'Storno parziale' }]} />
        {mode === 'parziale' && (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Scegli le righe e le quantità da stornare</legend>
            {doc.lines.map((l, i) => {
              const on = (sel[l.id] ?? 0) > 0;
              return (
                <div key={l.id} className="iv-credit-line">
                  <input type="checkbox" aria-label={`Storna riga ${i + 1}: ${l.description}`} checked={on} onChange={(e) => setSel((s) => ({ ...s, [l.id]: e.target.checked ? l.qty : 0 }))} />
                  <div>
                    <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{l.description}</div>
                    <small className="muted">Fatturato: {fmtQty(l.qty)} {l.unit} × {fmtNum(l.unitPrice)} €</small>
                  </div>
                  <NumInput label={`Quantità da stornare riga ${i + 1}`} value={sel[l.id] ?? 0} max={l.qty} onChange={(n) => setSel((s) => ({ ...s, [l.id]: n }))} />
                </div>
              );
            })}
            <p className="muted" style={{ margin: 0 }}>Importo stornato (senza bollo): {fmtNum(partialTotal)} €</p>
            {touched && picked.length === 0 && <p className="field-error" role="alert">Seleziona almeno una riga.</p>}
          </fieldset>
        )}
        <HoldButton
          label="Tieni premuto per emettere la nota di credito"
          disabled={!canGo}
          busy={busy}
          onConfirm={() => onCreate({ reason: reason.trim(), lines: mode === 'parziale' ? picked : undefined })}
        />
        {!canGo && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>{!reasonOk ? 'Scrivi il motivo per continuare.' : 'Seleziona almeno una riga da stornare.'}</p>}
      </div>
    </Sheet>
  );
}
