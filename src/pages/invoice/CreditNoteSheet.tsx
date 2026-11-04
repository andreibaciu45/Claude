import { useEffect, useMemo, useState } from 'react';
import type { DocLine, QuoteDocument } from '../../types';
import { uid } from '../../types';
import { fmtDate, fmtNum, fmtQty } from '../../pdf';
import { CREDIT_NOTE_STAMP_NOTE, invoiceTotalsCents } from '../../storage/invoiceTotals';
import { creditResidual, effectiveCreditNotes } from '../../storage/creditResidual';
import { Field, Segmented, Sheet, Textarea } from '../../ui';
import { NumInput } from '../quote/NumInput';
import { HoldButton } from './HoldButton';
import { displayNumber } from './model';

interface Props {
  open: boolean;
  onClose: () => void;
  doc: QuoteDocument;
  busy: boolean;
  /** Note di credito già collegate alla fattura (anche scartate: quelle non contano nel residuo). */
  creditNotes?: QuoteDocument[];
  forfettario?: boolean;
  onCreate: (o: { reason: string; lines?: DocLine[] }) => void;
}

/** Scheda "Annulla con nota di credito": motivo obbligatorio, storno totale (default) o parziale. */
export function CreditNoteSheet({ open, onClose, doc, busy, creditNotes = [], forfettario = true, onCreate }: Props) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'totale' | 'parziale'>('totale');
  const [sel, setSel] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!open) { setReason(''); setMode('totale'); setSel({}); setTouched(false); } }, [open]);

  // residuo stornabile: l'imponibile della fattura meno le note di credito già efficaci (emesse e non scartate)
  const res = useMemo(
    () => creditResidual(doc, effectiveCreditNotes([doc, ...creditNotes], doc.id)),
    [doc, creditNotes],
  );
  const remaining = useMemo(() => new Map(res.lines.map((l) => [l.id, l.qty])), [res]);
  const hasPrior = res.creditedCents > 0;
  const exhausted = res.residualCents <= 0;
  const picked = useMemo(
    () => doc.lines.filter((l) => (sel[l.id] ?? 0) > 0).map((l) => ({ ...l, id: uid(), qty: Math.min(remaining.get(l.id) ?? 0, sel[l.id]) })).filter((l) => l.qty > 0),
    [doc.lines, sel, remaining],
  );
  const target = mode === 'totale' ? res.lines : picked;
  const tot = useMemo(() => invoiceTotalsCents(target, { forfettario, stampChargedToCustomer: false }), [target, forfettario]);
  const partialTotal = tot.netCents / 100;
  const reasonOk = reason.trim().length > 0;
  const linesOk = mode === 'totale' || picked.length > 0;
  const canGo = reasonOk && linesOk && !exhausted;

  return (
    <Sheet open={open} onClose={onClose} title="Annulla con nota di credito">
      <div className="stack">
        <p className="iv-note" data-tone="warning">
          La fattura n. {displayNumber(doc)} del {fmtDate(doc.invoice?.operationDate ?? doc.date)} non si cancella: si annulla emettendo una nota di credito collegata, che avrà un suo numero e non si può più modificare.
        </p>
        <Field label="Motivo dell’annullamento (obbligatorio)" error={touched && !reasonOk ? 'Scrivi il motivo.' : undefined}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} placeholder="Es. Importo errato / lavoro non eseguito" aria-invalid={touched && !reasonOk ? true : undefined} data-autofocus />
        </Field>
        {hasPrior && <p className="iv-note" data-tone="info">Hai già stornato {fmtNum(res.creditedCents / 100)} € con altre note di credito. Ancora stornabile: <strong>{fmtNum(res.residualCents / 100)} €</strong>.</p>}
        {exhausted && <p className="iv-note" data-tone="danger" role="alert">La fattura è già stata stornata per intero.</p>}
        <Segmented ariaLabel="Tipo di storno" value={mode} onChange={setMode} options={[{ value: 'totale', label: hasPrior ? 'Storna il residuo' : 'Storno totale' }, { value: 'parziale', label: 'Storno parziale' }]} />
        {mode === 'parziale' && (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Scegli le righe e le quantità da stornare</legend>
            {doc.lines.map((l, i) => {
              const on = (sel[l.id] ?? 0) > 0;
              const left = remaining.get(l.id) ?? 0;
              return (
                <div key={l.id} className="iv-credit-line">
                  <input type="checkbox" aria-label={`Storna riga ${i + 1}: ${l.description}`} checked={on} disabled={left <= 0} onChange={(e) => setSel((s) => ({ ...s, [l.id]: e.target.checked ? left : 0 }))} />
                  <div>
                    <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{l.description}</div>
                    <small className="muted">Fatturato: {fmtQty(l.qty)} {l.unit} × {fmtNum(l.unitPrice)} € · stornabile: {fmtQty(left)}</small>
                  </div>
                  <NumInput label={`Quantità da stornare riga ${i + 1}`} value={sel[l.id] ?? 0} max={left} onChange={(n) => setSel((s) => ({ ...s, [l.id]: n }))} />
                </div>
              );
            })}
            <p className="muted" style={{ margin: 0 }}>Importo stornato (senza bollo): {fmtNum(partialTotal)} €</p>
            {touched && picked.length === 0 && <p className="field-error" role="alert">Seleziona almeno una riga.</p>}
          </fieldset>
        )}
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }} data-testid="nc-stamp">
          {tot.stampDueCents > 0 ? `Questa nota supera 77,47 €: avrà un proprio bollo di 2,00 € a tuo carico. ` : 'Importo non oltre 77,47 €: la nota non ha bollo. '}{CREDIT_NOTE_STAMP_NOTE}
        </p>
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
