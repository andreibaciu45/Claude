import { useEffect, useRef, useState } from 'react';
import type { CatalogItem, Customer, DocLine, DocType, Totals, Unit } from '../../types';
import { UNITS, roundMoney, uid } from '../../types';
import { Badge, Button, Card, Field, Input, Money, Select, Textarea } from '../../ui';
import { NumInput } from './NumInput';
import { CatalogSheet } from './CatalogSheet';
import './quote.css';

const VAT_RATES = [22, 10, 4, 0];
export const lineTotal = (l: DocLine) => roundMoney(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));

export const newLine = (vat: number): DocLine => ({ id: uid(), description: '', qty: 1, unit: 'pz', unitPrice: 0, vat });

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

interface Props {
  type: DocType;
  customer: Customer;
  onCustomer: (c: Customer) => void;
  lines: DocLine[];
  onLines: (l: DocLine[]) => void;
  notes: string;
  onNotes: (n: string) => void;
  totals: Totals;
  forfettario: boolean;
  defaultVat: number;
  catalog: CatalogItem[];
  customerError?: string;
}

export function QuoteEditor(p: Props) {
  const { lines, onLines, customer, onCustomer, catalog } = p;
  const [pickFor, setPickFor] = useState<string | 'new' | null>(null);
  const [undo, setUndo] = useState<{ line: DocLine; index: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const patch = (id: string, ch: Partial<DocLine>) => onLines(lines.map((l) => (l.id === id ? { ...l, ...ch } : l)));
  const remove = (id: string) => {
    const index = lines.findIndex((l) => l.id === id);
    if (index < 0) return;
    setUndo({ line: lines[index], index });
    onLines(lines.filter((l) => l.id !== id));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndo(null), 7000);
  };
  const restore = () => {
    if (!undo) return;
    const next = lines.slice();
    next.splice(Math.min(undo.index, next.length), 0, undo.line);
    onLines(next);
    setUndo(null);
  };
  const fromCatalog = (c: CatalogItem): Partial<DocLine> => ({
    catalogItemId: c.id, description: c.name, unit: c.unit, unitPrice: c.price, vat: c.vat, needsReview: false,
  });
  const onPick = (c: CatalogItem) => {
    if (pickFor === 'new') onLines([...lines, { ...newLine(p.defaultVat), ...fromCatalog(c) }]);
    else if (pickFor) patch(pickFor, fromCatalog(c));
    setPickFor(null);
  };
  const setC = (ch: Partial<Customer>) => onCustomer({ ...customer, ...ch });
  const toReview = lines.filter((l) => l.needsReview).length;
  const extraOpen = !!(customer.address || customer.email || customer.phone || customer.vatOrFiscalCode);

  return (
    <div className="qe stack">
      <Card>
        <div className="stack-sm">
          <Field label="Cliente" error={p.customerError}>
            <Input
              id="qe-customer"
              value={customer.name}
              onChange={(e) => setC({ name: e.target.value })}
              placeholder="Nome e cognome o ragione sociale"
              autoComplete="off"
              aria-invalid={p.customerError ? true : undefined}
            />
          </Field>
          <details className="qe-details" open={extraOpen}>
            <summary>Indirizzo, email, telefono (facoltativi)</summary>
            <div className="stack-sm qe-details-body">
              <Field label="Indirizzo"><Input value={customer.address ?? ''} onChange={(e) => setC({ address: e.target.value })} autoComplete="street-address" /></Field>
              <div className="grid-2">
                <Field label="Email"><Input type="email" inputMode="email" value={customer.email ?? ''} onChange={(e) => setC({ email: e.target.value })} /></Field>
                <Field label="Telefono"><Input type="tel" inputMode="tel" value={customer.phone ?? ''} onChange={(e) => setC({ phone: e.target.value })} /></Field>
              </div>
              <Field label="P.IVA / Codice fiscale"><Input value={customer.vatOrFiscalCode ?? ''} onChange={(e) => setC({ vatOrFiscalCode: e.target.value })} /></Field>
            </div>
          </details>
        </div>
      </Card>

      <section aria-labelledby="qe-lines-h" className="stack-sm">
        <div className="row-between">
          <h2 id="qe-lines-h">Righe ({lines.length})</h2>
          {toReview > 0 && <Badge tone="warning">{toReview} da verificare</Badge>}
        </div>
        {lines.length === 0 && <p className="muted">Nessuna riga. Aggiungi una voce dal catalogo o scrivila a mano.</p>}
        {lines.map((l, i) => (
          <article key={l.id} className="qe-line" data-review={l.needsReview ? 'true' : undefined} aria-label={`Riga ${i + 1}: ${l.description || 'senza descrizione'}`}>
            <div className="qe-line-top">
              {l.needsReview ? <Badge tone="warning">Da verificare</Badge> : <span className="muted qe-line-n">Voce {i + 1}</span>}
              <button type="button" className="qe-iconbtn qe-del" aria-label={`Elimina riga ${i + 1}`} onClick={() => remove(l.id)}>
                <Icon d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6M14 10v6" />
              </button>
            </div>
            <Textarea
              className="qe-desc"
              aria-label={`Descrizione riga ${i + 1}`}
              rows={2}
              value={l.description}
              placeholder="Descrizione (es. Tubo rame 16 mm)"
              onChange={(e) => patch(l.id, { description: e.target.value })}
            />
            {l.needsReview && (
              <p className="qe-review-hint">Voce non trovata nel catalogo: controlla prezzo e unità.</p>
            )}
            <div className="qe-line-actions">
              <Button type="button" variant={l.needsReview ? 'primary' : 'ghost'} size="sm" onClick={() => setPickFor(l.id)}>
                {l.needsReview ? 'Scegli dal catalogo' : 'Cambia voce'}
              </Button>
              {l.needsReview && <Button type="button" variant="ghost" size="sm" onClick={() => patch(l.id, { needsReview: false })}>Va bene così</Button>}
            </div>
            <div className="qe-qty-row">
              <div className="qe-stepper" role="group" aria-label={`Quantità riga ${i + 1}`}>
                <button type="button" className="qe-step" aria-label="Diminuisci quantità" onClick={() => patch(l.id, { qty: Math.max(0, roundMoney(l.qty - 1)) })}>−</button>
                <NumInput className="qe-qty" label={`Quantità riga ${i + 1}`} value={l.qty} onChange={(n) => patch(l.id, { qty: n })} />
                <button type="button" className="qe-step" aria-label="Aumenta quantità" onClick={() => patch(l.id, { qty: roundMoney(l.qty + 1) })}>+</button>
              </div>
              <Select aria-label={`Unità di misura riga ${i + 1}`} value={l.unit} onChange={(e) => patch(l.id, { unit: e.target.value as Unit })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
            <div className="qe-fields">
              <label className="qe-mini"><span>Prezzo unit. €</span>
                <NumInput label={`Prezzo unitario riga ${i + 1}`} value={l.unitPrice} onChange={(n) => patch(l.id, { unitPrice: n, needsReview: false })} />
              </label>
              <label className="qe-mini"><span>Sconto %</span>
                <NumInput label={`Sconto percentuale riga ${i + 1}`} value={l.discountPct ?? 0} max={100} onChange={(n) => patch(l.id, { discountPct: n || undefined })} />
              </label>
              {!p.forfettario && (
                <label className="qe-mini"><span>IVA %</span>
                  <Select aria-label={`IVA riga ${i + 1}`} value={l.vat} onChange={(e) => patch(l.id, { vat: Number(e.target.value) })}>
                    {(VAT_RATES.includes(l.vat) ? VAT_RATES : [l.vat, ...VAT_RATES]).map((v) => <option key={v} value={v}>{v}%</option>)}
                  </Select>
                </label>
              )}
            </div>
            <div className="qe-line-total"><span>Totale riga{p.forfettario ? '' : ' (netto IVA)'}</span><strong className="num"><Money value={lineTotal(l)} /></strong></div>
          </article>
        ))}

        <div className="qe-add">
          <Button type="button" variant="secondary" onClick={() => onLines([...lines, newLine(p.defaultVat)])}>+ Riga libera</Button>
          <Button type="button" variant="secondary" onClick={() => setPickFor('new')}>+ Dal catalogo</Button>
        </div>
        {catalog.length === 0 && <p className="muted qe-note">Il catalogo è vuoto: <a href="#/catalogo">aggiungi le tue voci</a> per averle pronte quando detti.</p>}
      </section>

      <Card>
        <Field label="Note (facoltative)" hint="Compaiono sul documento: tempi, esclusioni, condizioni particolari.">
          <Textarea rows={3} value={p.notes} onChange={(e) => p.onNotes(e.target.value)} placeholder="Es. Il prezzo non comprende opere murarie." />
        </Field>
      </Card>

      <TotalsCard totals={p.totals} type={p.type} forfettario={p.forfettario} />

      {undo && (
        <div className="qe-undo" role="status">
          <span>Riga eliminata</span>
          <button type="button" onClick={restore}>Annulla</button>
        </div>
      )}

      <CatalogSheet
        open={pickFor !== null}
        onClose={() => setPickFor(null)}
        catalog={catalog}
        onPick={onPick}
        hint={pickFor && pickFor !== 'new' ? 'La voce scelta sostituisce descrizione, unità, prezzo e IVA della riga.' : undefined}
      />
    </div>
  );
}

export function TotalsCard({ totals, type, forfettario }: { totals: Totals; type: DocType; forfettario: boolean }) {
  return (
    <Card>
      <h2>Riepilogo</h2>
      <dl className="qe-totals">
        <div><dt>Imponibile</dt><dd className="num"><Money value={totals.net} /></dd></div>
        {!forfettario && totals.byRate.map((r) => (
          <div key={r.rate}><dt>IVA {r.rate}% <span className="muted">su <Money value={r.base} /></span></dt><dd className="num"><Money value={r.vat} /></dd></div>
        ))}
        {forfettario && <div className="qe-forf"><dt>Regime forfettario</dt><dd>senza IVA</dd></div>}
        {totals.stamp > 0 && <div><dt>Marca da bollo</dt><dd className="num"><Money value={totals.stamp} /></dd></div>}
        <div className="qe-grand"><dt>TOTALE</dt><dd className="num"><Money value={totals.gross} /></dd></div>
      </dl>
      {forfettario && type === 'preventivo' && <p className="muted qe-note">Il bollo da 2 € si applica alle fatture sopra 77,47 €.</p>}
    </Card>
  );
}
