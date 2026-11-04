/**
 * Rubrica clienti (`/clienti`): elenco ricercabile, scheda con dati fiscali, documenti e fatturato (sola lettura),
 * modifica / eliminazione / unione duplicati, importazione ed esportazione CSV.
 *
 * SOLO LOCALE: la rubrica non è sincronizzata col server (il contratto di sync non ha l'entità 'customer') e viaggia
 * nel backup JSON v3. I documenti già creati mantengono la propria copia dei dati cliente.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Field, Input, Money, PageHeader, Select, Sheet, Skeleton, useToast } from '../ui';
import type { Customer, Profile, QuoteDocument } from '../types';
import { getProfile, listDocuments } from '../storage';
import {
  deleteCustomer, importCustomersFromDocuments, listCustomers, mergeCustomers, normName, searchCustomers, upsertCustomer, upsertCustomers,
  type StoredCustomer,
} from '../storage/customers';
import { matchCustomer } from '../engine';
import { downloadText } from './catalog/download';
import { displayNumber, kindLabel } from './invoice/model';
import { STATUS_LABEL, STATUS_TONE } from './quote/shared';
import { documentTotals, fmtDate } from '../pdf';
import { customersToCsv, parseCustomersCsv } from './customers/csv';
import { customerStats } from './customers/stats';
import { validateCustomer } from './customers/validate';
import CustomerSheet from './customers/CustomerSheet';
import './catalog/catalog.css';
import './customers/customers.css';

const place = (c: Customer) => [c.city, c.province && `(${c.province})`].filter(Boolean).join(' ');
const ids = (c: Customer) => [c.vatNumber && `P.IVA ${c.vatNumber}`, c.fiscalCode && `CF ${c.fiscalCode}`].filter(Boolean).join(' · ');

export default function CustomersPage() {
  const toast = useToast();
  const [list, setList] = useState<StoredCustomer[] | null>(null);
  const [docs, setDocs] = useState<QuoteDocument[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<StoredCustomer | null>(null);
  const [form, setForm] = useState<{ customer: StoredCustomer | null } | null>(null);
  const [dup, setDup] = useState<{ existing: StoredCustomer; draft: Customer } | null>(null);
  const [toDelete, setToDelete] = useState<StoredCustomer | null>(null);
  const [mergeFor, setMergeFor] = useState<StoredCustomer | null>(null);
  const [mergeWith, setMergeWith] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [c, d, p] = await Promise.all([listCustomers(), listDocuments(), getProfile()]);
      setList(c); setDocs(d); setProfile(p); setError(false);
      setOpen((cur) => (cur ? c.find((x) => x.id === cur.id) ?? null : cur));
    } catch { setError(true); setList((l) => l ?? []); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const shown = useMemo(() => {
    if (!list) return [];
    return query.trim() ? searchCustomers(query, list, 200) : list;
  }, [list, query]);

  // possibili duplicati (nomi molto simili che il dedup esatto non ha unito); limite per non rallentare rubriche enormi
  const suspects = useMemo(() => {
    if (!list || list.length < 2 || list.length > 400) return [] as [StoredCustomer, StoredCustomer][];
    const out: [StoredCustomer, StoredCustomer][] = [];
    const seen = new Set<string>();
    for (const a of list) {
      const { match, candidates } = matchCustomer(a.name, list.filter((x) => x.id !== a.id));
      if (match.status === 'new') continue;
      for (const b of candidates) {
        if (b.score < 0.8) continue;
        const other = list.find((x) => x.id === b.id)!;
        if (a.vatNumber && other.vatNumber && a.vatNumber !== other.vatNumber) continue; // P.IVA diverse = clienti diversi
        const key = [a.id, b.id].sort().join('|');
        if (!seen.has(key)) { seen.add(key); out.push([a, other]); }
      }
    }
    return out.slice(0, 20);
  }, [list]);

  const doMerge = async (keep: StoredCustomer, remove: StoredCustomer) => {
    try { await mergeCustomers(keep.id, [remove.id]); toast('Schede unite'); setMergeFor(null); await reload(); }
    catch { toast('Unione non riuscita'); }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    try { await deleteCustomer(toDelete.id); toast('Cliente eliminato dalla rubrica'); setToDelete(null); setOpen(null); await reload(); }
    catch { toast('Eliminazione non riuscita'); }
  };

  const onImportFile = async (f?: File) => {
    if (!f) return;
    const r = parseCustomersCsv(await f.text());
    if (r.error) { toast(r.error, 'error'); return; }
    try {
      const res = await upsertCustomers(r.customers);
      toast(`Importati ${res.created} nuovi clienti, ${res.merged} già presenti (dati completati)${r.ignored ? `, ${r.ignored} righe senza nome ignorate` : ''}`, 'success');
      await reload();
    } catch { toast('Importazione non riuscita', 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const fromDocs = async () => {
    try { const n = await importCustomersFromDocuments(); toast(n ? `Aggiornati o aggiunti ${n} clienti dai documenti` : 'Nessun nuovo cliente nei documenti', 'success'); await reload(); }
    catch { toast('Operazione non riuscita', 'error'); }
  };

  if (!list) return <div className="cat-page"><PageHeader title="Clienti" /><Skeleton blocks={2} lines={3} /></div>;

  const stats = open && profile ? customerStats(open, docs, profile.regimeForfettario, { book: list }) : null;
  const openErrors = open ? validateCustomer(open) : {};

  return (
    <div className="cat-page">
      <PageHeader
        title="Clienti"
        subtitle="La tua rubrica: non riscrivi più nome, P.IVA e indirizzo."
        actions={<Button size="sm" onClick={() => setForm({ customer: null })}>Nuovo cliente</Button>}
      />
      <p className="cu-note" role="note">
        La rubrica resta su questo dispositivo e nel backup: <strong>non è sincronizzata</strong> con l’account. Eliminare o modificare un cliente non cambia i documenti già creati, che conservano la loro copia dei dati.
      </p>
      {error && <p className="cat-error" role="alert">Impossibile leggere la rubrica. <button type="button" className="link" onClick={() => void reload()}>Riprova</button></p>}

      {list.length > 0 && (
        <Field label="Cerca cliente">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, P.IVA o codice fiscale" autoComplete="off" />
        </Field>
      )}

      {suspects.length > 0 && !query && (
        <details className="cat-details">
          <summary>Possibili duplicati ({suspects.length})</summary>
          <ul className="cu-docs">
            {suspects.map(([a, b]) => (
              <li key={a.id + b.id}>
                <span>{a.name} <span className="cu-meta">/ {b.name}</span></span>
                <Button size="sm" variant="secondary" onClick={() => { setMergeFor(a); setMergeWith(b.id); }}>Unisci…</Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {list.length === 0 && !error ? (
        <EmptyState
          title="Nessun cliente in rubrica"
          text="Aggiungi un cliente, importa un file CSV oppure crea un documento: il cliente viene salvato qui in automatico."
          action={<div className="cat-row"><Button onClick={() => setForm({ customer: null })}>Nuovo cliente</Button><Button variant="secondary" onClick={() => fileRef.current?.click()}>Importa CSV</Button></div>}
        />
      ) : (
        <Card>
          {shown.length === 0 ? <p className="cat-card-body cat-muted">Nessun cliente corrisponde a «{query}».</p> : (
            <ul className="cu-list" aria-label="Elenco clienti">
              {shown.map((c) => (
                <li key={c.id}>
                  <button type="button" className="cu-item" onClick={() => setOpen(c)}>
                    <div className="cu-name">{c.name}</div>
                    {(ids(c) || place(c)) && <div className="cu-meta">{[ids(c), place(c)].filter(Boolean).join(' · ')}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="cat-row">
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>Importa CSV</Button>
        <Button variant="secondary" size="sm" disabled={!list.length} onClick={() => downloadText(`clienti-${new Date().toISOString().slice(0, 10)}.csv`, customersToCsv(list), 'text/csv;charset=utf-8')}>Esporta CSV</Button>
        <Button variant="ghost" size="sm" onClick={fromDocs}>Aggiungi dai documenti</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void onImportFile(e.target.files?.[0])} />
      </div>
      <p className="cu-note">Il CSV usa il separatore «;» e la prima riga con le intestazioni (Nome, Partita IVA, Codice fiscale, Indirizzo, CAP, Comune, Provincia, Paese, Codice destinatario, PEC, Email, Telefono).</p>

      {/* scheda cliente */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? 'Cliente'}>
        {open && (
          <div className="cat-col">
            {Object.keys(openErrors).length > 0 && <Badge tone="warning">Dati da controllare: {Object.values(openErrors).join(' ')}</Badge>}
            <dl className="cu-dl">
              {([['Partita IVA', open.vatNumber], ['Codice fiscale', open.fiscalCode], ['Indirizzo', [open.address, [open.zip, open.city, open.province].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
                ['Paese', open.country], ['Codice destinatario', open.codiceDestinatario], ['PEC', open.pec], ['Email', open.email], ['Telefono', open.phone]] as [string, string | undefined][])
                .filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
            </dl>
            {stats && (
              <>
                <div className="cu-stats">
                  <div className="cu-stat"><small>Fatturato</small><strong><Money value={stats.invoiced} /></strong></div>
                  <div className="cu-stat"><small>Documenti fiscali (fatture e note di credito)</small><strong>{stats.invoices}</strong></div>
                  <div className="cu-stat"><small>Preventivi</small><strong>{stats.quotes}</strong></div>
                </div>
                <p className="cu-note">Fatturato = fatture emesse meno note di credito, importi lordi. Calcolato dai documenti, sola lettura.</p>
                <h3 style={{ margin: 0 }}>Documenti ({stats.docs.length})</h3>
                {stats.docs.length === 0 ? <p className="cu-note">Nessun documento per questo cliente.</p> : (
                  <ul className="cu-docs">
                    {stats.docs.map((d) => (
                      <li key={d.id}>
                        <Link to={`/documenti/${d.id}`}>{kindLabel(d)} {displayNumber(d)} <span className="cu-meta">{fmtDate(d.date)}</span></Link>
                        <span><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge> <Money value={documentTotals(d, !!profile?.regimeForfettario).gross} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <div className="cat-row cat-row--end">
              <Button onClick={() => { setForm({ customer: open }); }}>Modifica</Button>
              <Button variant="secondary" onClick={() => { setMergeFor(open); setMergeWith(''); }} disabled={list.length < 2}>Unisci…</Button>
              <Button variant="danger" onClick={() => setToDelete(open)}>Elimina</Button>
            </div>
          </div>
        )}
      </Sheet>

      <CustomerSheet
        open={!!form}
        customer={form?.customer ?? null}
        onClose={() => setForm(null)}
        onSaved={async (c) => { setForm(null); toast('Cliente salvato', 'success'); await reload(); setOpen((cur) => (cur ? c : cur)); }}
        onDuplicate={(existing, draft) => setDup({ existing, draft })}
      />

      <Sheet open={!!dup} onClose={() => setDup(null)} title="Cliente già in rubrica">
        {dup && (
          <div className="cat-col">
            <p>Esiste già <strong>{dup.existing.name}</strong>{ids(dup.existing) ? ` (${ids(dup.existing)})` : ''} con la stessa Partita IVA, codice fiscale o nome.</p>
            <div className="cat-row cat-row--end">
              <Button onClick={async () => { try { await upsertCustomer(dup.draft); toast('Dati uniti alla scheda esistente', 'success'); setDup(null); setForm(null); await reload(); } catch { toast('Operazione non riuscita', 'error'); } }}>Completa la scheda esistente</Button>
              <Button variant="secondary" onClick={() => { setDup(null); setForm(null); setOpen(dup.existing); }}>Apri la scheda esistente</Button>
              <Button variant="ghost" onClick={() => setDup(null)}>Torna alla modifica</Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!toDelete} onClose={() => setToDelete(null)} title="Eliminare il cliente?">
        {toDelete && (
          <div className="cat-col">
            <p><strong>{toDelete.name}</strong> viene tolto dalla rubrica.</p>
            <p className="cu-note">I preventivi e le fatture già creati <strong>non vengono toccati</strong>: conservano la loro copia dei dati cliente (anche le fatture emesse, che sono immutabili). Potrai ricreare il cliente quando vuoi.</p>
            <div className="cat-row cat-row--end">
              <Button variant="danger" onClick={doDelete}>Elimina dalla rubrica</Button>
              <Button variant="secondary" onClick={() => setToDelete(null)}>Annulla</Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!mergeFor} onClose={() => setMergeFor(null)} title="Unisci duplicati">
        {mergeFor && (() => {
          const other = list.find((x) => x.id === mergeWith);
          return (
            <div className="cat-col">
              <p>Tengo la scheda <strong>{mergeFor.name}</strong> e le aggiungo i dati mancanti dell’altra, che poi viene eliminata dalla rubrica. I documenti non cambiano.</p>
              <Field label="Scheda da unire">
                <Select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)}>
                  <option value="">Scegli…</option>
                  {list.filter((x) => x.id !== mergeFor.id).sort((a, b) => Number(normName(b.name).includes(normName(mergeFor.name).split(' ')[0] ?? '')) - Number(normName(a.name).includes(normName(mergeFor.name).split(' ')[0] ?? ''))).map((x) => <option key={x.id} value={x.id}>{x.name}{x.vatNumber ? ` — ${x.vatNumber}` : ''}</option>)}
                </Select>
              </Field>
              <div className="cat-row cat-row--end">
                <Button disabled={!other} onClick={() => other && void doMerge(mergeFor, other)}>Unisci</Button>
                <Button variant="secondary" onClick={() => setMergeFor(null)}>Annulla</Button>
              </div>
            </div>
          );
        })()}
      </Sheet>
    </div>
  );
}
