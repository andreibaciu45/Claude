import { useMemo, useRef, useState } from 'react';
import { Badge, Button, Field, Select, Sheet, Textarea } from '../../ui';
import type { CatalogItem } from '../../types';
import { buildItems, CSV_FIELDS, guessMapping, parseCsv } from './csv';
import type { CsvField } from './csv';
import { s } from './styles';

interface Props {
  open: boolean;
  defaultVat: number;
  onClose: () => void;
  onImport: (items: CatalogItem[]) => void | Promise<void>;
}

export default function ImportSheet({ open, defaultVat, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Partial<Record<CsvField, number>>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);

  const load = (t: string) => {
    setText(t);
    const r = t.trim() ? parseCsv(t) : [];
    const g = r.length ? guessMapping(r[0]) : {};
    if (r.length && Object.keys(g).length >= 2) { setHasHeader(true); setMapping(g); }
    else { setHasHeader(false); setMapping({ name: 0, price: 1, unit: 2, vat: 3, category: 4, kind: 5, stock: 6 }); }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    load(await f.text());
  };

  const results = useMemo(
    () => (rows.length && mapping.name !== undefined && mapping.price !== undefined ? buildItems(rows, mapping, defaultVat, hasHeader ? 1 : 0) : []),
    [rows, mapping, hasHeader, defaultVat],
  );
  const valid = results.filter((r) => r.item).map((r) => r.item!);
  const bad = results.filter((r) => r.errors.length);
  const warns = results.filter((r) => r.item && r.warnings.length);

  const setCol = (f: CsvField, v: string) => setMapping((m) => ({ ...m, [f]: v === '' ? undefined : Number(v) }));
  const colLabel = (i: number) => (hasHeader && rows[0]?.[i] ? `${i + 1} · ${rows[0][i]}` : `Colonna ${i + 1}`);

  const close = () => { setText(''); setMapping({}); onClose(); };
  const doImport = async () => {
    setBusy(true);
    try { await onImport(valid); setText(''); setMapping({}); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={close} title="Importa da CSV">
      <div style={s.col}>
        <p style={s.muted}>
          Incolla il contenuto o scegli un file CSV (da Excel: Salva come CSV). Colonne: nome, prezzo, unita, iva, categoria, tipo, giacenza. Separatore «;» o «,», decimali con la virgola ok.
        </p>
        <div style={s.row}>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>Scegli file CSV</Button>
        </div>
        <Field label="Oppure incolla qui">
          <Textarea rows={5} value={text} onChange={(e) => load(e.target.value)} placeholder={'nome;prezzo;unita;iva\nTubo rame 16;9,50;m;22'} spellCheck={false} />
        </Field>

        {rows.length > 0 && (
          <>
            <label style={{ ...s.row, minHeight: 44 }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ width: 22, height: 22 }} />
              La prima riga contiene le intestazioni
            </label>
            <div style={s.grid2}>
              {CSV_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                  <Select value={mapping[f.key] === undefined ? '' : String(mapping[f.key])} onChange={(e) => setCol(f.key, e.target.value)}>
                    <option value="">{f.required ? 'Scegli colonna' : '— non presente —'}</option>
                    {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{colLabel(i)}</option>)}
                  </Select>
                </Field>
              ))}
            </div>

            {mapping.name === undefined || mapping.price === undefined ? (
              <p style={s.error} role="alert">Indica almeno le colonne Nome e Prezzo.</p>
            ) : (
              <>
                <div style={s.row} aria-live="polite">
                  <Badge tone="success">{valid.length} voci pronte</Badge>
                  {bad.length > 0 && <Badge tone="danger">{bad.length} righe con errori</Badge>}
                  {warns.length > 0 && <Badge tone="warning">{warns.length} con avvisi</Badge>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={s.table}>
                    <thead><tr><th align="left">Riga</th><th align="left">Voce</th><th align="right">Prezzo</th><th align="left">Esito</th></tr></thead>
                    <tbody>
                      {results.slice(0, 8).map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          <td>{r.item?.name ?? '—'}</td>
                          <td align="right">{r.item ? `${r.item.price.toFixed(2).replace('.', ',')} € / ${r.item.unit}` : '—'}</td>
                          <td style={r.errors.length ? { color: 'var(--danger, #b42318)' } : undefined}>{[...r.errors, ...r.warnings].join('; ') || 'ok'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {results.length > 8 && <p style={s.muted}>… e altre {results.length - 8} righe.</p>}
                </div>
                {bad.length > 8 && <p style={s.muted}>Righe con errori (le altre verranno ignorate): {bad.map((b) => b.line).join(', ')}</p>}
              </>
            )}
          </>
        )}

        <div style={s.row}>
          <Button type="button" size="lg" style={{ flex: 1 }} disabled={!valid.length || busy} onClick={doImport}>
            {valid.length ? `Importa ${valid.length} voci` : 'Importa'}
          </Button>
          <Button type="button" variant="secondary" size="lg" onClick={close}>Annulla</Button>
        </div>
      </div>
    </Sheet>
  );
}
