import { useMemo, useState } from 'react';
import type { CatalogItem } from '../../types';
import { Sheet, EmptyState, Input, Money } from '../../ui';
import { Link } from 'react-router-dom';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Props {
  open: boolean;
  onClose: () => void;
  catalog: CatalogItem[];
  onPick: (item: CatalogItem) => void;
  title?: string;
  hint?: string;
}

export function CatalogSheet({ open, onClose, catalog, onPick, title = 'Scegli dal catalogo', hint }: Props) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return catalog.slice().sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const words = t.split(/\s+/);
    return catalog.filter((c) => {
      const hay = norm([c.name, c.category ?? '', ...c.aliases].join(' '));
      return words.every((w) => hay.includes(w));
    });
  }, [q, catalog]);

  return (
    <Sheet open={open} onClose={() => { setQ(''); onClose(); }} title={title}>
      <div className="qe-sheet">
        {hint && <p className="muted qe-sheet-hint">{hint}</p>}
        <Input
          type="search"
          placeholder="Cerca per nome o sinonimo…"
          aria-label="Cerca nel catalogo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {catalog.length === 0 ? (
          <EmptyState title="Il catalogo è vuoto" text="Aggiungi le tue voci (materiali, manodopera) per ritrovarle al volo." action={<Link to="/catalogo">Vai al catalogo</Link>} />
        ) : results.length === 0 ? (
          <p className="muted">Nessuna voce trovata per “{q}”.</p>
        ) : (
          <ul className="qe-pick-list">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" className="qe-pick" onClick={() => { setQ(''); onPick(c); }}>
                  <span className="qe-pick-main">
                    <strong>{c.name}</strong>
                    <span className="muted">{c.kind} · IVA {c.vat}%</span>
                  </span>
                  <span className="qe-pick-price num">
                    <Money value={c.price} /> <span className="muted">/ {c.unit}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
