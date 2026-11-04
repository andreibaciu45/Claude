import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Sheet } from '../../ui';
import { UNITS, uid } from '../../types';
import type { CatalogItem, ItemKind, Unit } from '../../types';
import { parseNumber } from './csv';
import './catalog.css';

const KIND_LABEL: Record<ItemKind, string> = { materiale: 'Materiale', manodopera: 'Manodopera', servizio: 'Servizio' };
export { KIND_LABEL };
const UNIT_LABEL: Record<Unit, string> = { pz: 'pz (pezzi)', m: 'm (metri)', mq: 'mq', mc: 'mc', kg: 'kg', l: 'l (litri)', h: 'h (ore)', gg: 'gg (giorni)', corpo: 'a corpo' };

interface Props {
  open: boolean;
  item: CatalogItem | null; // null = nuova voce
  defaultVat: number;
  categories: string[];
  onClose: () => void;
  onSave: (i: CatalogItem) => void | Promise<void>;
  onDelete?: (i: CatalogItem) => void;
}

const VAT_RATES = [22, 10, 5, 4, 0];

export default function ItemSheet({ open, item, defaultVat, categories, onClose, onSave, onDelete }: Props) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState('');
  const [unit, setUnit] = useState<Unit>('pz');
  const [price, setPrice] = useState('');
  const [vat, setVat] = useState(String(defaultVat));
  const [kind, setKind] = useState<ItemKind>('materiale');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setAliases(item?.aliases ?? []);
    setAliasDraft('');
    setUnit(item?.unit ?? 'pz');
    setPrice(item ? String(item.price).replace('.', ',') : '');
    setVat(String(item?.vat ?? defaultVat));
    setKind(item?.kind ?? 'materiale');
    setCategory(item?.category ?? '');
    setStock(item?.stock === undefined ? '' : String(item.stock).replace('.', ','));
    setErrors({});
    setSaving(false);
  }, [open, item, defaultVat]);

  const addAlias = (raw: string) => {
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    setAliases((cur) => [...cur, ...parts.filter((p) => !cur.some((c) => c.toLowerCase() === p.toLowerCase()))]);
    setAliasDraft('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const p = parseNumber(price);
    const v = parseNumber(vat);
    const st = stock.trim() === '' ? undefined : parseNumber(stock);
    if (!name.trim()) err.name = 'Inserisci il nome della voce';
    if (p === null || p < 0) err.price = 'Inserisci un prezzo valido (es. 12,50)';
    if (v === null || v < 0 || v > 100) err.vat = 'Aliquota non valida';
    if (st === null) err.stock = 'Giacenza non valida';
    setErrors(err);
    if (Object.keys(err).length) return;
    const now = Date.now();
    const finalAliases = [...aliases];
    for (const a of aliasDraft.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!finalAliases.some((c) => c.toLowerCase() === a.toLowerCase())) finalAliases.push(a);
    }
    setSaving(true);
    try {
      await onSave({
        id: item?.id ?? uid(),
        name: name.trim(),
        aliases: finalAliases,
        unit, price: p!, vat: v!, kind,
        category: category.trim() || undefined,
        stock: st ?? undefined,
        createdAt: item?.createdAt ?? now,
        updatedAt: now,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Modifica voce' : 'Nuova voce'}>
      <form onSubmit={submit} className="cat-col" noValidate>
        <Field label="Nome" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Tubo rame 16 mm" autoComplete="off" required />
        </Field>

        <div>
          <Field label="Come lo diresti a voce?" hint="Aggiungi i modi in cui lo nomini quando detti, es. «rame sedici», «tubo di rame». Invio o virgola per aggiungere.">
            <Input
              value={aliasDraft}
              onChange={(e) => setAliasDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAlias(aliasDraft); } }}
              onBlur={() => addAlias(aliasDraft)}
              placeholder="Scrivi un sinonimo"
              autoComplete="off"
              enterKeyHint="done"
            />
          </Field>
          {aliases.length > 0 && (
            <ul className="cat-chips" aria-label="Sinonimi">
              {aliases.map((a) => (
                <li key={a} className="cat-chip">
                  {a}
                  <button type="button" className="cat-chip-x" aria-label={`Rimuovi sinonimo ${a}`} onClick={() => setAliases((c) => c.filter((x) => x !== a))}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cat-grid2">
          <Field label="Prezzo netto (€)" error={errors.price}>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>
          <Field label="Unità">
            <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </Select>
          </Field>
          <Field label="IVA %" error={errors.vat}>
            <Select value={vat} onChange={(e) => setVat(e.target.value)}>
              {[...new Set([...VAT_RATES, Number(vat)].filter((n) => Number.isFinite(n)))].sort((a, b) => b - a).map((r) => <option key={r} value={r}>{r}%</option>)}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
              {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Categoria (facoltativa)">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} list="catalog-categories" placeholder="Es. Tubazioni" />
          </Field>
          <Field label="Giacenza (facoltativa)" error={errors.stock} hint="Lascia vuoto se non gestisci le scorte">
            <Input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="decimal" placeholder="—" />
          </Field>
        </div>
        <datalist id="catalog-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>

        <div className="cat-row">
          <Button type="submit" size="lg" disabled={saving} className="cat-submit">{item ? 'Salva modifiche' : 'Aggiungi voce'}</Button>
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>Annulla</Button>
        </div>
        {item && onDelete && (
          <Button type="button" variant="danger" onClick={() => onDelete(item)}>Elimina voce</Button>
        )}
      </form>
    </Sheet>
  );
}
