import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, Sheet, useToast } from '../ui';
import { deleteCatalogItem, getProfile, listCatalog, saveCatalogItem } from '../storage';
import type { CatalogItem, ItemKind } from '../types';
import ItemSheet, { KIND_LABEL } from './catalog/ItemSheet';
import ImportSheet from './catalog/ImportSheet';
import { itemsToCsv } from './catalog/csv';
import { sampleItems, TRADE_LABEL } from './catalog/samples';
import type { Trade } from './catalog/samples';
import { downloadText, s } from './catalog/styles';

const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function CatalogPage() {
  const toast = useToast();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [defaultVat, setDefaultVat] = useState(22);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ItemKind | ''>('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CatalogItem | null>(null);

  const reload = useCallback(async () => {
    try { setItems(await listCatalog()); } catch { toast('Impossibile leggere il listino'); }
    setLoaded(true);
  }, [toast]);

  useEffect(() => {
    void reload();
    void getProfile().then((p) => setDefaultVat(p.defaultVat)).catch(() => undefined);
  }, [reload]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'it')), [items]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (category && i.category !== category) return false;
      if (!q) return true;
      return norm(i.name).includes(q) || i.aliases.some((a) => norm(a).includes(q)) || norm(i.category ?? '').includes(q);
    });
  }, [items, query, kind, category]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (i: CatalogItem) => { setEditing(i); setSheetOpen(true); };

  const save = async (i: CatalogItem) => {
    try {
      await saveCatalogItem(i);
      setSheetOpen(false);
      toast(editing ? 'Voce aggiornata' : 'Voce aggiunta');
      await reload();
    } catch { toast('Salvataggio non riuscito'); }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteCatalogItem(toDelete.id); toast('Voce eliminata'); } catch { toast('Eliminazione non riuscita'); }
    setToDelete(null);
    setSheetOpen(false);
    await reload();
  };

  const addSamples = async (t: Trade) => {
    try {
      const existing = new Set(items.map((i) => norm(i.name)));
      const fresh = sampleItems(t).filter((i) => !existing.has(norm(i.name)));
      for (const i of fresh) await saveCatalogItem({ ...i, vat: i.vat === 22 ? defaultVat : i.vat });
      toast(`Aggiunte ${fresh.length} voci per ${TRADE_LABEL[t].toLowerCase()}`);
    } catch { toast('Operazione non riuscita'); }
    setSamplesOpen(false);
    await reload();
  };

  const importItems = async (list: CatalogItem[]) => {
    try {
      for (const i of list) await saveCatalogItem(i);
      toast(`Importate ${list.length} voci`);
      setImportOpen(false);
      await reload();
    } catch { toast('Importazione non riuscita'); }
  };

  const exportCsv = () => {
    downloadText(`listino-${new Date().toISOString().slice(0, 10)}.csv`, itemsToCsv(items), 'text/csv;charset=utf-8');
    toast('Listino esportato');
  };

  const samplesButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => setSamplesOpen(true)}>Aggiungi voci di esempio</Button>
  );

  return (
    <div>
      <PageHeader
        title="Il mio listino"
        subtitle="Materiali, manodopera e servizi che userai nei preventivi"
        actions={<Button onClick={openNew} size="lg">+ Nuova voce</Button>}
      />
      <div style={s.page}>
        {loaded && items.length === 0 ? (
          <EmptyState
            title="Il tuo listino è vuoto"
            text="Aggiungi le voci che usi più spesso: quando detterai un preventivo l'app le troverà da sola. Puoi partire da un listino di esempio e correggere i prezzi."
            action={
              <div style={{ ...s.col, alignItems: 'stretch' }}>
                {samplesButton('primary')}
                <Button variant="secondary" onClick={openNew}>Crea la prima voce</Button>
                <Button variant="ghost" onClick={() => setImportOpen(true)}>Importa da CSV</Button>
              </div>
            }
          />
        ) : (
          <>
            <Input type="search" aria-label="Cerca nel listino" placeholder="Cerca voce, sinonimo o categoria…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div style={s.scrollRow} role="group" aria-label="Filtra per tipo">
              <button type="button" style={s.pill(kind === '')} aria-pressed={kind === ''} onClick={() => setKind('')}>Tutto ({items.length})</button>
              {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => (
                <button key={k} type="button" style={s.pill(kind === k)} aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            {categories.length > 0 && (
              <div style={s.scrollRow} role="group" aria-label="Filtra per categoria">
                {categories.map((c) => (
                  <button key={c} type="button" style={s.pill(category === c)} aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>{c}</button>
                ))}
              </div>
            )}

            {!loaded ? <p style={s.muted}>Caricamento…</p> : filtered.length === 0 ? (
              <EmptyState title="Nessuna voce trovata" text="Prova a cambiare la ricerca o i filtri." action={<Button variant="secondary" onClick={() => { setQuery(''); setKind(''); setCategory(''); }}>Azzera filtri</Button>} />
            ) : (
              <ul style={s.list} aria-label="Voci del listino">
                {filtered.map((i) => (
                  <li key={i.id}>
                    <Card>
                      <button
                        type="button"
                        onClick={() => openEdit(i)}
                        aria-label={`Modifica ${i.name}`}
                        style={{ all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer', minHeight: 44, padding: 12 }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                          <span style={s.title}>{i.name}</span>
                          <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}><Money value={i.price} /> <span style={s.muted}>/ {i.unit}</span></span>
                        </div>
                        <div style={{ ...s.row, marginTop: 6 }}>
                          <Badge tone={i.kind === 'manodopera' ? 'info' : i.kind === 'servizio' ? 'warning' : 'neutral'}>{KIND_LABEL[i.kind]}</Badge>
                          <span style={s.muted}>IVA {i.vat}%</span>
                          {i.category && <span style={s.muted}>· {i.category}</span>}
                          {i.stock !== undefined && <span style={s.muted}>· Giacenza: {i.stock} {i.unit}</span>}
                        </div>
                        {i.aliases.length > 0 && <div style={{ ...s.muted, marginTop: 4, fontSize: 13 }}>Anche: {i.aliases.join(', ')}</div>}
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ ...s.row, marginTop: 8 }}>
              {samplesButton('secondary')}
              <Button variant="secondary" onClick={() => setImportOpen(true)}>Importa CSV</Button>
              <Button variant="secondary" onClick={exportCsv} disabled={!items.length}>Esporta CSV</Button>
            </div>
          </>
        )}
      </div>

      <ItemSheet
        open={sheetOpen}
        item={editing}
        defaultVat={defaultVat}
        categories={categories}
        onClose={() => setSheetOpen(false)}
        onSave={save}
        onDelete={(i) => setToDelete(i)}
      />
      <ImportSheet open={importOpen} defaultVat={defaultVat} onClose={() => setImportOpen(false)} onImport={importItems} />

      <Sheet open={samplesOpen} onClose={() => setSamplesOpen(false)} title="Voci di esempio">
        <div style={s.col}>
          <p style={s.muted}>Aggiunge 20 voci realistiche (manodopera oraria inclusa) con prezzi indicativi: ricordati di adeguarli ai tuoi. Le voci già presenti non vengono duplicate.</p>
          {(Object.keys(TRADE_LABEL) as Trade[]).map((t) => (
            <Button key={t} variant="secondary" size="lg" onClick={() => void addSamples(t)}>{TRADE_LABEL[t]}</Button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!toDelete} onClose={() => setToDelete(null)} title="Eliminare la voce?">
        <div style={s.col}>
          <p>«{toDelete?.name}» verrà rimossa dal listino. I documenti già creati non cambiano.</p>
          <Button variant="danger" size="lg" onClick={() => void confirmDelete()}>Sì, elimina</Button>
          <Button variant="secondary" size="lg" onClick={() => setToDelete(null)}>Annulla</Button>
        </div>
      </Sheet>
    </div>
  );
}
