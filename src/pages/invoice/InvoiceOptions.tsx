import { Card, Field, Input } from '../../ui';
import { todayIso } from '../quote/shared';

interface Props {
  operationDate: string;
  onOperationDate: (d: string) => void;
  stampCharged: boolean;
  onStampCharged: (v: boolean) => void;
  stampDue: number;
  forfettario: boolean;
}

/** Opzioni fiscali di una bozza di fattura: data operazione e bollo. */
export function InvoiceOptions({ operationDate, onOperationDate, stampCharged, onStampCharged, stampDue, forfettario }: Props) {
  return (
    <Card>
      <div className="stack-sm">
        <h2 style={{ fontSize: 'var(--fs-lg)', margin: 0 }}>Dati della fattura</h2>
        <Field label="Data dell’operazione" hint="È la data che comparirà in fattura (di solito oggi). Il numero verrà assegnato solo all’emissione.">
          <Input id="f-operationDate" type="date" value={operationDate} max={todayIso()} onChange={(e) => onOperationDate(e.target.value)} />
        </Field>
        {forfettario && (
          stampDue > 0 ? (
            <label className="iv-check">
              <input type="checkbox" checked={stampCharged} onChange={(e) => onStampCharged(e.target.checked)} />
              <span>Addebita al cliente il bollo da {stampDue.toLocaleString('it-IT', { minimumFractionDigits: 2 })} € (riga “Rimborso imposta di bollo”)</span>
            </label>
          ) : <p className="muted qe-note">Sotto 77,47 € non è dovuto il bollo.</p>
        )}
      </div>
    </Card>
  );
}
