import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Input, Segmented, Sheet, useToast } from '../../ui';
import { CounterStartError, getInvoiceCounterInfo, getProfile, listInvoiceCounters, setInvoiceCounterStart, type InvoiceCounterInfo } from '../../storage';
import { evaluateCounterInput, numberText, sectionalLabel, type NumberingSectional } from './numbering';
import { s } from '../catalog/styles';
import '../invoice/invoice.css';

interface Props {
  /** chiamata dopo ogni modifica riuscita, con i contatori aggiornati (il profilo in modifica non deve riportarli indietro) */
  onCountersChanged?: (counters: Record<string, number>) => void;
}

/**
 * Numero di partenza delle fatture elettroniche. Per chi ha già emesso fatture nell'anno con un altro programma:
 * si indica l'ULTIMO numero usato, la prossima emissione continua da lì. Non si scende mai sotto l'emesso con questa app;
 * abbassare il valore rispetto a quello attuale richiede una seconda conferma esplicita (rischio di numeri duplicati).
 */
export default function NumberingCard({ onCountersChanged }: Props) {
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [sectional, setSectional] = useState<NumberingSectional>('FT');
  const [year, setYear] = useState(String(thisYear));
  const [info, setInfo] = useState<InvoiceCounterInfo | null>(null);
  const [all, setAll] = useState<InvoiceCounterInfo[]>([]);
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [okChecked, setOkChecked] = useState(false);
  const [lowerChecked, setLowerChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const yearNum = /^\d{4}$/.test(year) ? Number(year) : NaN;
  const yearOk = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100;

  const reload = useCallback(async () => {
    try { setAll(await listInvoiceCounters()); } catch { /* elenco non essenziale */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // quando cambiano sezionale o anno si rilegge lo stato e si propone il valore attuale
  useEffect(() => {
    if (!yearOk) { setInfo(null); return; }
    let alive = true;
    getInvoiceCounterInfo(sectional, yearNum)
      .then((i) => { if (alive) { setInfo(i); setInput(String(i.lastUsed)); setTouched(false); setProblem(null); } })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [sectional, yearNum, yearOk]);

  const ev = useMemo(
    () => (info ? evaluateCounterInput({ input, sectional, year: yearNum, maxIssued: info.maxIssued, current: info.lastUsed }) : null),
    [input, sectional, yearNum, info],
  );
  const err = !yearOk ? 'Scrivi un anno di 4 cifre (es. ' + thisYear + ').' : touched ? ev?.error : undefined;
  const canAsk = !!ev && yearOk && !ev.error && !ev.unchanged && ev.value !== undefined;
  const label = sectionalLabel(sectional);

  const open = () => {
    setTouched(true);
    if (!canAsk) return;
    setOkChecked(false); setLowerChecked(false); setProblem(null); setConfirm(true);
  };

  const apply = async () => {
    if (!ev || ev.value === undefined || busy) return;
    setBusy(true); setProblem(null);
    try {
      const r = await setInvoiceCounterStart(sectional, yearNum, ev.value, { confirmLowering: ev.lowering && lowerChecked });
      setConfirm(false);
      toast(`Numero di partenza impostato: la prossima ${sectionalLabel(sectional, false)} sarà la n. ${r.nextNumber}`, 'success');
      setInfo(r); setInput(String(r.lastUsed)); setTouched(false);
      await reload();
      const p = await getProfile();
      onCountersChanged?.(p.invoiceYearCounters ?? {});
    } catch (e) {
      setProblem(e instanceof CounterStartError || e instanceof Error ? e.message : 'Non sono riuscito a impostare il numero.');
      if (e instanceof CounterStartError && e.code === 'below_issued') {
        // un'emissione è avvenuta nel frattempo: si rilegge lo stato per mostrare il nuovo minimo
        void getInvoiceCounterInfo(sectional, yearNum).then(setInfo).catch(() => undefined);
      }
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <div style={{ ...s.col, padding: 12 }} data-testid="numbering-card">
        <h2 style={{ margin: 0, fontSize: 18 }}>Numerazione fatture elettroniche</h2>
        <p style={{ ...s.muted, margin: 0 }}>
          Hai già emesso fatture quest’anno con un altro programma? Scrivi qui l’<strong>ultimo numero che hai usato</strong>: la prossima
          fattura emessa con VocePreventivo continuerà da lì. Esempio: ultima fattura 14/{thisYear} → scrivi 14 → la prossima sarà 15/{thisYear}.
          Se è la tua prima fattura dell’anno lascia 0.
        </p>
        <p className="iv-note" data-tone="warning" role="note" style={{ margin: 0 }}>
          Attenzione: se scrivi un numero più basso di quello che hai già emesso (anche altrove) avrai due fatture con lo stesso numero. È un errore fiscale
          grave. Nel dubbio controlla l’ultimo numero emesso sull’altro programma o chiedi al tuo commercialista. Qui non puoi comunque scendere sotto l’ultimo
          numero già emesso con questa app.
        </p>

        <div>
          <div className="field-label">Che numerazione?</div>
          <Segmented<NumberingSectional> ariaLabel="Tipo di documento" value={sectional} onChange={setSectional}
            options={[{ value: 'FT', label: 'Fatture' }, { value: 'NC', label: 'Note di credito' }]} />
        </div>
        <div style={s.grid2}>
          <Field label="Anno" error={!yearOk ? err : undefined}>
            <Input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" aria-label="Anno della numerazione" />
          </Field>
          <Field label={`Ultimo numero già usato (${label})`} error={yearOk ? err : undefined}>
            <Input value={input} onChange={(e) => { setInput(e.target.value); setTouched(true); }} inputMode="numeric" aria-label={`Ultimo numero già usato per ${label}`}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } }} aria-invalid={err ? true : undefined} />
          </Field>
        </div>

        {info && yearOk && (
          <p style={{ ...s.muted, margin: 0 }} aria-live="polite">
            {info.maxIssued > 0
              ? <>Con questa app hai emesso fino al n. <strong>{numberText(sectional, info.maxIssued, yearNum)}</strong>. </>
              : <>Con questa app non hai ancora emesso {label} {yearNum}. </>}
            Prossima {sectionalLabel(sectional, false)}: <strong>{info.nextNumber}</strong>.
            {ev?.value !== undefined && !ev.error && !ev.unchanged && <> Dopo la modifica: <strong>{ev.nextNumber}</strong>.</>}
          </p>
        )}

        <Button variant="secondary" onClick={open} disabled={!yearOk || !info || (touched && !!ev?.error) || ev?.unchanged}>Imposta numero di partenza</Button>

        {all.length > 0 && (
          <div>
            <div className="field-label">Numerazioni attuali</div>
            <ul style={{ ...s.list, ...s.muted }} aria-label="Numerazioni attuali">
              {all.map((c) => (
                <li key={`${c.sectional}-${c.year}`}>
                  {c.sectional === 'NC' ? 'Note di credito' : 'Fatture'} {c.year}: ultimo n. {c.lastUsed} → prossima {c.nextNumber}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Sheet open={confirm} onClose={() => !busy && setConfirm(false)} title="Conferma il numero di partenza">
        {ev && ev.value !== undefined && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              Imposti l’ultimo numero usato per le {label} {yearNum} a <strong>{ev.value}</strong>. La prossima {sectionalLabel(sectional, false)} emessa avrà il numero{' '}
              <strong>{ev.nextNumber}</strong>.
            </p>
            {ev.lowering && info && (
              <p className="iv-note" data-tone="danger" role="alert" style={{ margin: 0 }}>
                Stai ABBASSANDO il numero (adesso è {info.lastUsed}). Se hai già emesso altrove fatture con numeri tra {ev.value + 1} e {info.lastUsed}, la prossima
                avrà un numero duplicato: è un errore fiscale grave. Procedi solo se sei sicuro di aver sbagliato il valore precedente.
              </p>
            )}
            <label className="iv-check">
              <input type="checkbox" checked={okChecked} onChange={(e) => setOkChecked(e.target.checked)} disabled={busy} />
              <span>Ho controllato sull’altro programma (o con il commercialista): l’ultima {sectionalLabel(sectional, false)} emessa nel {yearNum} è la n. {numberText(sectional, ev.value, yearNum)}{ev.value === 0 ? ' (nessuna ancora)' : ''}.</span>
            </label>
            {ev.lowering && (
              <label className="iv-check">
                <input type="checkbox" checked={lowerChecked} onChange={(e) => setLowerChecked(e.target.checked)} disabled={busy} />
                <span>Capisco il rischio di numeri duplicati e voglio abbassare il numero.</span>
              </label>
            )}
            {problem && <p className="iv-note" data-tone="danger" role="alert" style={{ margin: 0 }}>{problem}</p>}
            <Button onClick={() => void apply()} disabled={busy || !okChecked || (ev.lowering && !lowerChecked)}>{busy ? 'Salvo…' : 'Conferma e imposta'}</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Annulla</Button>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>
              La modifica resta nel registro attività. Strumento di supporto: la responsabilità fiscale resta tua [DA VERIFICARE con il commercialista].
            </p>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
