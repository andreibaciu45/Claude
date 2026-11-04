import { useEffect, useMemo, useState } from 'react';
import type { Customer, DocLine, Profile, QuoteDocument } from '../../types';
import { validateInvoiceForIssue } from '../../../shared/fatturapa';
import { fmtDate } from '../../pdf';
import { Button, Field, Input, Sheet, Textarea } from '../../ui';
import { NumInput } from '../quote/NumInput';
import { CustomerFiscalFields } from './CustomerFiscalFields';
import { isCreditNote, resubmitUntil } from './model';

export interface RejectedPatch { customer?: Customer; lines?: DocLine[]; notes?: string }

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('it-IT');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface CorrectProps {
  open: boolean;
  onClose: () => void;
  doc: QuoteDocument;
  profile: Profile;
  busy: boolean;
  onSubmit: (patch: RejectedPatch) => void;
}

/** "Correggi e rinvia": numero, data e sezionale restano quelli della fattura scartata; si correggono i dati e si rigenera l'XML. */
export function CorrectRejectedSheet({ open, onClose, doc, profile, busy, onSubmit }: CorrectProps) {
  const [customer, setCustomer] = useState<Customer>(doc.customer);
  const [lines, setLines] = useState<DocLine[]>(doc.lines);
  const [notes, setNotes] = useState(doc.notes ?? '');
  useEffect(() => { if (open) { setCustomer(doc.customer); setLines(doc.lines); setNotes(doc.notes ?? ''); } }, [open, doc]);
  const nc = isCreditNote(doc);
  const until = resubmitUntil(doc);
  const inv = doc.invoice!;
  const issues = useMemo(() => {
    try { return validateInvoiceForIssue({ ...doc, customer, lines, notes }, profile).filter((i) => i.severity === 'error'); } catch { return []; }
  }, [doc, customer, lines, notes, profile]);
  const lastNs = [...inv.sdiEvents].reverse().find((e) => e.type === 'NS');

  const submit = () => {
    const patch: RejectedPatch = {};
    if (!same(customer, doc.customer)) patch.customer = customer;
    if (!nc && !same(lines, doc.lines)) patch.lines = lines;
    if (notes !== (doc.notes ?? '')) patch.notes = notes;
    onSubmit(patch);
  };
  const setLine = (i: number, ch: Partial<DocLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...ch } : l)));

  return (
    <Sheet open={open} onClose={onClose} title="Correggi e rinvia">
      <div className="stack">
        <p className="iv-note" data-tone="info" role="note">
          La fattura n. {inv.number} del {fmtDate(inv.operationDate)} è stata scartata dallo SDI{lastNs?.errorCodes?.length ? ` (${lastNs.errorCodes.join(', ')})` : ''}: si considera non emessa.
          Il numero e la data restano <strong>gli stessi</strong>; correggi i dati e l’app prepara un nuovo file XML con un nuovo progressivo di invio.
          {until ? ` Puoi rinviarla con lo stesso numero entro il ${fmtDay(until)}.` : ''} Il file scartato resta conservato nello storico.
        </p>
        <Field label="Cliente (nome o denominazione)">
          <Input id="f-customer.name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="off" />
        </Field>
        <CustomerFiscalFields customer={customer} onChange={setCustomer} />
        {!nc && (
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Righe</legend>
            {lines.map((l, i) => (
              <div key={l.id} className="stack-sm" style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 'var(--sp-2)' }}>
                <Field label={`Descrizione riga ${i + 1}`}><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                <div className="grid-2">
                  <NumInput label={`Quantità riga ${i + 1}`} value={l.qty} onChange={(n) => setLine(i, { qty: n })} />
                  <NumInput label={`Prezzo riga ${i + 1}`} value={l.unitPrice} onChange={(n) => setLine(i, { unitPrice: n })} />
                </div>
              </div>
            ))}
          </fieldset>
        )}
        <Field label="Note"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {issues.length > 0 && (
          <ul className="iv-issues" aria-label="Controlli prima di rigenerare">
            {issues.map((i, k) => <li key={`${i.field}-${k}`} className="iv-issue" data-sev="error"><strong>Da correggere</strong><span>{i.message}</span></li>)}
          </ul>
        )}
        <Button size="lg" className="btn-block" onClick={submit} disabled={busy || issues.length > 0}>{busy ? 'Rigenero…' : 'Rigenera il file XML'}</Button>
        <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>Dopo aver rigenerato, scarica il nuovo XML, caricalo sul portale e usa “Segna come rinviata”. Verifica con il tuo commercialista [DA VERIFICARE].</p>
      </div>
    </Sheet>
  );
}

interface NewProps { open: boolean; onClose: () => void; doc: QuoteDocument; expired: boolean; busy: boolean; onConfirm: () => void }

/** Oltre i 5 giorni (o per scelta): nuova bozza collegata, con numero e data nuovi. */
export function ResubmitNewSheet({ open, onClose, doc, expired, busy, onConfirm }: NewProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Rifai come nuova fattura">
      <div className="dv-confirm">
        <p>
          {expired
            ? 'Sono passati più di 5 giorni dallo scarto: non si può più rinviare con lo stesso numero e la stessa data.'
            : 'Stai scegliendo di non rinviare con lo stesso numero.'}{' '}
          Creo una <strong>nuova bozza</strong> con le stesse righe e lo stesso cliente, collegata alla fattura scartata n. {doc.invoice?.number}. Avrà un numero nuovo e la data di oggi, assegnati quando la emetti. La fattura scartata resta nello storico come non emessa.
        </p>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>[DA VERIFICARE col commercialista] il trattamento oltre i 5 giorni.</p>
        <Button onClick={onConfirm} disabled={busy}>{busy ? 'Creo la bozza…' : 'Crea la bozza collegata'}</Button>
        <Button variant="secondary" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
