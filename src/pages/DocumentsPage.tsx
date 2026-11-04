import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocStatus, Profile, QuoteDocument } from '../types';
import { getProfile, listDocuments, saveDocument } from '../storage';
import { documentTotals, fmtDate, generateDocumentPdf } from '../pdf';
import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, Select, Stat, useToast } from '../ui';
import { STATUS_LABEL, STATUS_TONE, downloadBlob, fileNameFor } from './quote/shared';
import { INVOICE_STATUSES, PAYMENT_LABEL, QUOTE_STATUSES, displayNumber, isCreditNote, isFiscalInvoice, kindLabel } from './invoice/model';
import './quote/quote.css';
import './invoice/invoice.css';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
type KindFilter = 'tutti' | 'preventivo' | 'fattura' | 'nota';
const KIND_OPTS: { v: KindFilter; label: string }[] = [
  { v: 'tutti', label: 'Tutti i tipi' }, { v: 'preventivo', label: 'Preventivi' }, { v: 'fattura', label: 'Fatture' }, { v: 'nota', label: 'Note di credito' },
];
const kindOf = (d: QuoteDocument): KindFilter => (d.type === 'preventivo' ? 'preventivo' : isCreditNote(d) ? 'nota' : 'fattura');
/** Anno di competenza: anno fiscale per le fatture, anno della data per gli altri. */
const yearOf = (d: QuoteDocument): number => Number((isFiscalInvoice(d) ? d.invoice!.operationDate : d.date)?.slice(0, 4)) || new Date(d.createdAt).getFullYear();
const quarterOf = (d: QuoteDocument): number => Math.floor((Number((isFiscalInvoice(d) ? d.invoice!.operationDate : d.date).slice(5, 7)) - 1) / 3) + 1;

/** Fattura/nota emessa e valida ai fini del riepilogo (non bozza, non scartata). */
const counted = (d: QuoteDocument): boolean => isFiscalInvoice(d) && d.status !== 'bozza' && d.status !== 'scartata';

export default function DocumentsPage() {
  const toast = useToast();
  const [docs, setDocs] = useState<QuoteDocument[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('tutti');
  const [status, setStatus] = useState<DocStatus | 'tutti'>('tutti');
  const [year, setYear] = useState<number | 'tutti'>('tutti');
  const [busy, setBusy] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, p] = await Promise.all([listDocuments(), getProfile()]);
      setDocs(d.slice().sort((a, b) => b.createdAt - a.createdAt));
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile leggere l’archivio.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const forf = !!profile?.regimeForfettario;
  const years = useMemo(() => [...new Set([thisYear, ...(docs ?? []).map(yearOf)])].sort((a, b) => b - a), [docs, thisYear]);
  const statusOptions: DocStatus[] = kind === 'preventivo' ? QUOTE_STATUSES : kind === 'tutti' ? [...QUOTE_STATUSES, ...INVOICE_STATUSES.filter((s) => s !== 'bozza')] : INVOICE_STATUSES;

  const rows = useMemo(() => {
    if (!docs) return [];
    const t = norm(q.trim());
    return docs
      .filter((d) => (kind === 'tutti' || kindOf(d) === kind) && (status === 'tutti' || d.status === status) && (year === 'tutti' || yearOf(d) === year))
      .filter((d) => !t || norm(`${d.customer.name} ${d.number} ${d.invoice?.number ?? ''}`).includes(t))
      .map((d) => ({ d, total: documentTotals(d, forf).gross }));
  }, [docs, q, kind, status, year, forf]);

  /* Riepilogo: solo somme dei documenti dell'archivio, nessun calcolo fiscale. */
  const summary = useMemo(() => {
    const ys = year === 'tutti' ? thisYear : year;
    const mine = (docs ?? []).filter((d) => counted(d) && yearOf(d) === ys);
    const inv = mine.filter((d) => !isCreditNote(d));
    const sign = (d: QuoteDocument) => (isCreditNote(d) ? -1 : 1);
    const net = mine.reduce((s, d) => s + sign(d) * documentTotals(d, forf).net, 0);
    const q4 = Math.floor(new Date().getMonth() / 3) + 1;
    const stamps = mine.filter((d) => !isCreditNote(d) && d.invoice!.stampDuty && quarterOf(d) === (ys === thisYear ? q4 : quarterOf(d)));
    const toCollect = inv.filter((d) => d.status !== 'stornata').reduce((s, d) => s + Math.max(0, documentTotals(d, forf).gross - d.invoice!.payments.reduce((a, p) => a + p.amount, 0)), 0);
    return { ys, count: inv.length, net: Math.round(net * 100) / 100, q4, stamps: stamps.length, stampSum: stamps.reduce((s, d) => s + (d.invoice!.stampAmount || 2), 0), toCollect: Math.round(toCollect * 100) / 100 };
  }, [docs, year, thisYear, forf]);

  const pdf = async (d: QuoteDocument) => {
    if (!profile) return;
    setBusy(d.id + 'pdf');
    try { downloadBlob(await generateDocumentPdf(d, profile), fileNameFor(d)); }
    catch { toast('Non sono riuscito a creare il PDF.', 'error'); }
    finally { setBusy(null); }
  };
  /** Avanzamento rapido dello stato: solo preventivi e fatture di cortesia. Le fatture fiscali si gestiscono dal documento. */
  const NEXT_Q: Partial<Record<DocStatus, DocStatus>> = { bozza: 'inviato', inviato: 'accettato' };
  const advance = async (d: QuoteDocument, next: DocStatus) => {
    setBusy(d.id + 'st');
    try {
      const upd = { ...d, status: next, updatedAt: Date.now() };
      await saveDocument(upd);
      setDocs((cur) => cur && cur.map((x) => (x.id === d.id ? upd : x)));
      toast(`${kindLabel(d)} ${d.number}: ${STATUS_LABEL[next].toLowerCase()}`);
    } catch { toast('Non sono riuscito ad aggiornare lo stato.', 'error'); }
    finally { setBusy(null); }
  };

  if (error) return <EmptyState title="Archivio non disponibile" text={error} action={<Button onClick={() => void load()}>Riprova</Button>} />;
  if (!docs) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;

  const reset = () => { setQ(''); setKind('tutti'); setStatus('tutti'); setYear('tutti'); };
  const eur = (n: number) => <Money value={n} />;

  return (
    <div className="stack">
      <PageHeader title="Documenti" subtitle={`${docs.length} ${docs.length === 1 ? 'documento' : 'documenti'} in archivio`} />

      {docs.length === 0 ? (
        <EmptyState title="Ancora nessun documento" text="Detta il tuo primo preventivo: in pochi secondi lo trovi qui." action={<Link className="btn" data-variant="primary" to="/">Nuovo preventivo</Link>} />
      ) : (
        <>
          <section aria-label={`Riepilogo ${summary.ys}`} className="stack-sm">
            <div className="dl-summary">
              <Stat label={`Fatture emesse ${summary.ys}`} value={summary.count} />
              <Stat label="Fatturato (imponibile)" value={eur(summary.net)} hint="Al netto delle note di credito" />
              <Stat label="Ancora da incassare" value={eur(summary.toCollect)} />
              <Stat label={`Bolli ${summary.ys === thisYear ? `${summary.q4}° trimestre` : 'anno'}`} value={`${summary.stamps} · ${summary.stampSum.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}`} hint="Conteggio indicativo" />
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>Somme dei documenti presenti in app, non un calcolo fiscale: per tasse, soglie e bolli da versare chiedi al tuo commercialista.</p>
          </section>

          <div className="dl-filters">
            <Input type="search" aria-label="Cerca per cliente o numero" placeholder="Cerca cliente o numero…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            <div className="dl-chips" role="group" aria-label="Filtra per tipo">
              {KIND_OPTS.map((o) => (
                <button key={o.v} type="button" className="chip" aria-pressed={kind === o.v} onClick={() => { setKind(o.v); setStatus('tutti'); }}>{o.label}</button>
              ))}
            </div>
            <div className="dl-selects">
              <Select aria-label="Filtra per stato" value={status} onChange={(e) => setStatus(e.target.value as DocStatus | 'tutti')}>
                <option value="tutti">Tutti gli stati</option>
                {[...new Set(statusOptions)].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
              <Select aria-label="Filtra per anno" value={String(year)} onChange={(e) => setYear(e.target.value === 'tutti' ? 'tutti' : Number(e.target.value))}>
                <option value="tutti">Tutti gli anni</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState title="Nessun risultato" text="Cambia la ricerca o i filtri." action={<Button variant="secondary" onClick={reset}>Azzera filtri</Button>} />
          ) : (
            <ul className="dl-list" aria-label="Elenco documenti">
              {rows.map(({ d, total }) => {
                const fiscal = isFiscalInvoice(d);
                const nc = isCreditNote(d);
                const num = displayNumber(d);
                const next = !fiscal ? (d.type === 'preventivo' ? NEXT_Q[d.status] : undefined) : undefined;
                return (
                  <li key={d.id}>
                    <Card className="dl-card">
                      <Link to={`/documenti/${d.id}`} className="dl-link" aria-label={`${kindLabel(d)} ${num}, ${d.customer.name}`}>
                        <div className="dl-row">
                          <span className="dl-num">{kindLabel(d)} {num}</span>
                          <span className="row" style={{ gap: 4 }}>
                            {nc && <Badge tone="info">Nota di credito</Badge>}
                            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                          </span>
                        </div>
                        <div className="dl-cust">{d.customer.name || 'Cliente senza nome'}</div>
                        <div className="dl-meta">
                          <span>{fmtDate((fiscal && d.invoice!.operationDate) || d.date)}{fiscal && !nc && d.status !== 'bozza' && d.status !== 'scartata' ? ` · ${PAYMENT_LABEL[d.invoice!.paymentStatus]}` : ''}</span>
                          <span className="dl-total num">{nc ? <>−<Money value={total} /></> : <Money value={total} />}</span>
                        </div>
                      </Link>
                      <div className="dl-actions">
                        <button type="button" onClick={() => void pdf(d)} disabled={!profile || busy === d.id + 'pdf'}>{busy === d.id + 'pdf' ? 'Creo PDF…' : 'Scarica PDF'}</button>
                        {fiscal ? (
                          <Link to={`/documenti/${d.id}`} className="dl-open">{d.status === 'bozza' ? 'Apri ed emetti' : 'Apri'}</Link>
                        ) : (
                          <button type="button" onClick={() => next && void advance(d, next)} disabled={!next || busy === d.id + 'st'}>
                            {next ? `Segna ${STATUS_LABEL[next].toLowerCase()}` : d.type === 'preventivo' ? 'Apri per gestirlo' : 'Completato'}
                          </button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
