import { useEffect, useState } from 'react';
import type { QuoteDocument, SdiEvent, SdiOutcome } from '../../types';
import { Button, Field, Input, Select, Sheet, Textarea } from '../../ui';
import { NumInput } from '../quote/NumInput';
import { todayIso } from '../quote/shared';

export const SDI_DEADLINE_WARNING =
  'L’invio allo SDI entro 12 giorni dalla data dell’operazione è una tua responsabilità: l’app non trasmette nulla per conto tuo. (Testo da far verificare dal commercialista.)';

export function SdiGuideSheet({ open, onClose, fileName }: { open: boolean; onClose: () => void; fileName?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title="Come inviarla allo SDI">
      <div className="stack">
        <ol className="iv-steps">
          <li><strong>Scarica l’XML</strong>{fileName ? <> (<code>{fileName}</code>)</> : null} con il pulsante “Scarica XML”. Non modificarlo.</li>
          <li><strong>Caricalo</strong> sul portale “Fatture e Corrispettivi” dell’Agenzia delle Entrate (accesso con SPID, CIE o CNS), sezione “Fatturazione elettronica”, oppure invialo via PEC allo SDI se hai già l’accreditamento.</li>
          <li><strong>Aspetta l’esito</strong>: lo SDI risponde con una ricevuta di consegna, di mancata consegna o di scarto.</li>
          <li><strong>Registralo qui</strong> con “Segna come inviata” e poi “Registra esito”, così lo stato della fattura resta corretto.</li>
        </ol>
        <p className="iv-note" data-tone="warning" role="note">{SDI_DEADLINE_WARNING}</p>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Una fattura non trasmessa allo SDI non risulta emessa. Il PDF è solo una copia di cortesia.</p>
        <Button onClick={onClose}>Ho capito</Button>
      </div>
    </Sheet>
  );
}

interface EvProps { open: boolean; onClose: () => void; mode: 'send' | 'outcome'; busy: boolean; onSave: (ev: SdiEvent) => void }

/** Segna come inviata (INVIO) oppure registra l'esito (RC / MC / NS con codici di scarto opzionali). */
export function SdiEventSheet({ open, onClose, mode, busy, onSave }: EvProps) {
  const [outcome, setOutcome] = useState<SdiOutcome>('RC');
  const [channel, setChannel] = useState<'portale_ade' | 'pec'>('portale_ade');
  const [codes, setCodes] = useState('');
  const [ident, setIdent] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (!open) { setOutcome('RC'); setChannel('portale_ade'); setCodes(''); setIdent(''); setNote(''); } }, [open]);

  const save = () => {
    const ev: SdiEvent = { at: Date.now(), type: mode === 'send' ? 'INVIO' : outcome, channel };
    if (ident.trim()) ev.sdiIdentifier = ident.trim();
    if (mode === 'outcome' && outcome === 'NS') {
      const list = codes.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      if (list.length) ev.errorCodes = list;
    }
    if (note.trim()) ev.note = note.trim();
    onSave(ev);
  };

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'send' ? 'Segna come inviata' : 'Registra l’esito dello SDI'}>
      <div className="stack">
        {mode === 'outcome' && (
          <Field label="Esito ricevuto">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as SdiOutcome)} data-autofocus>
              <option value="RC">Consegnata al cliente (RC)</option>
              <option value="MC">Mancata consegna (MC)</option>
              <option value="NS">Scartata dallo SDI (NS)</option>
            </Select>
          </Field>
        )}
        <Field label="Canale usato">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as 'portale_ade' | 'pec')}>
            <option value="portale_ade">Portale Fatture e Corrispettivi</option>
            <option value="pec">PEC</option>
          </Select>
        </Field>
        {mode === 'outcome' && outcome === 'NS' && (
          <Field label="Codici di scarto (facoltativi)" hint="Separati da virgola, es. 00200, 00311">
            <Input value={codes} onChange={(e) => setCodes(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <Field label="Identificativo SDI (facoltativo)"><Input value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="off" /></Field>
        <Field label="Nota (facoltativa)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {mode === 'send' && <p className="iv-note" data-tone="info">Stai dichiarando di aver già caricato o inviato il file allo SDI.</p>}
        <Button onClick={save} disabled={busy}>{busy ? 'Salvo…' : mode === 'send' ? 'Conferma: l’ho inviata' : 'Registra esito'}</Button>
      </div>
    </Sheet>
  );
}

export function PaymentSheet({ open, onClose, doc, residual, busy, onSave }: {
  open: boolean; onClose: () => void; doc: QuoteDocument; residual: number; busy: boolean; onSave: (p: { date: string; amount: number; method?: string }) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(residual);
  const [method, setMethod] = useState('Bonifico');
  useEffect(() => { if (open) { setDate(todayIso()); setAmount(residual); setMethod('Bonifico'); } }, [open, residual]);
  const bad = !(amount > 0) || !date;
  return (
    <Sheet open={open} onClose={onClose} title="Registra incasso">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>L’incasso è separato dallo stato fiscale: non cambia ciò che risulta allo SDI. Fattura n. {doc.invoice?.number ?? doc.number}.</p>
        <Field label="Data incasso"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-autofocus /></Field>
        <Field label="Importo incassato (€)" error={!(amount > 0) ? 'Inserisci un importo maggiore di zero.' : undefined}>
          <NumInput label="Importo incassato" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Metodo">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['Bonifico', 'Contanti', 'Carta', 'Assegno', 'Altro'].map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
        <Button disabled={bad || busy} onClick={() => onSave({ date, amount, method })}>{busy ? 'Salvo…' : 'Registra incasso'}</Button>
      </div>
    </Sheet>
  );
}
