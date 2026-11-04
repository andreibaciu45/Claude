import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditEntry, DocStatus, Profile, QuoteDocument } from '../types';
import { getProfile, listAudit, listDocuments, saveDocument } from '../storage';
import { documentTotals, fmtDate, generateDocumentPdf } from '../pdf';
import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, Select, Sheet, Stat, useToast } from '../ui';
import { STATUS_LABEL, STATUS_TONE, downloadBlob, fileNameFor } from './quote/shared';
import { INVOICE_STATUSES, PAYMENT_LABEL, QUOTE_STATUSES, displayNumber, isCreditNote, isFiscalInvoice, kindLabel } from './invoice/model';
import { FORFETTARIO_THRESHOLD, docYear, invoiceRegisterCsv, invoiceXmlEntries, isCounted, stampsByQuarter, thresholdStatus } from './invoice/register';
import { ActivityLog } from './invoice/ActivityLog';
import { createZip } from './invoice/zip';
import './quote/quote.css';
import './invoice/invoice.css';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
type KindFilter = 'tutti' | 'preventivo' | 'fattura' | 'nota';
const KIND_OPTS: { v: KindFilter; label: string }[] = [
  { v: 'tutti', label: 'Tutti i tipi' }, { v: 'preventivo', label: 'Preventivi' }, { v: 'fattura', label: 'Fatture' }, { v: 'nota', label: 'Note di credito' },
];
const kindOf = (d: QuoteDocument): KindFilter => (d.type === 'preventivo' ? 'preventivo' : isCreditNote(d) ? 'nota' : 'fattura');
/** Anno di competenza: anno fiscale per le fatture, anno della data per gli altri. */
const yearOf = docYear;
const counted = isCounted;

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
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<AuditEntry[] | null>(null);
  const [activityError, setActivityError] = useState(false);
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

  /* Riepilogo: solo somme dei documenti dell'archivio, nessun calcolo fiscale. Importi sempre da documentTotals (centesimi, come XML e PDF). */
  const summary = useMemo(() => {
    const ys = year === 'tutti' ? thisYear : year;
    const all = docs ?? [];
    const mine = all.filter((d) => counted(d) && yearOf(d) === ys);
    const inv = mine.filter((d) => !isCreditNote(d));
    const sign = (d: QuoteDocument) => (isCreditNote(d) ? -1 : 1);
    const netC = mine.reduce((s, d) => s + sign(d) * Math.round(documentTotals(d, forf).net * 100), 0);
    const q4 = Math.floor(new Date().getMonth() / 3) + 1;
    const toCollectC = inv.filter((d) => d.status !== 'stornata').reduce((s, d) => s + Math.max(0, Math.round(documentTotals(d, forf).gross * 100) - d.invoice!.payments.reduce((a, p) => a + Math.round(p.amount * 100), 0)), 0);
    const quarters = stampsByQuarter(all, ys, forf);
    return { ys, count: inv.length, net: netC / 100, q4, quarters, toCollect: toCollectC / 100, thr: thresholdStatus(all, ys) };
  }, [docs, year, thisYear, forf]);

  const exportCsv = () => {
    if (!docs) return;
    const y = year === 'tutti' ? undefined : year;
    const csv = invoiceRegisterCsv(docs, forf, y);
    if (csv.split('\r\n').filter(Boolean).length <= 1) { toast('Nessuna fattura emessa da esportare per questo anno.', 'error'); return; }
    downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `registro-fatture-${y ?? 'tutti'}.csv`);
    toast('Registro esportato (CSV).');
  };

  /** Tutti gli XML emessi dell'anno scelto (o di tutti gli anni) in un unico ZIP, generato sul dispositivo. */
  const exportXmlZip = () => {
    if (!docs) return;
    const y = year === 'tutti' ? undefined : year;
    const files = invoiceXmlEntries(docs, y);
    if (!files.length) { toast('Nessun file XML da esportare per questo anno.', 'error'); return; }
    try {
      const zip = createZip(files.map((f) => ({ name: f.name, data: f.data })));
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `xml-fatture-${y ?? 'tutti'}.zip`);
      toast(`ZIP con ${files.length} ${files.length === 1 ? 'file XML' : 'file XML'} pronto.`);
    } catch { toast('Non sono riuscito a creare lo ZIP.', 'error'); }
  };

  const openActivity = () => {
    setActivityOpen(true); setActivity(null); setActivityError(false);
    listAudit().then(setActivity).catch(() => setActivityError(true));
  };

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
              {summary.ys === thisYear ? (
                <Stat label={`Bolli ${summary.q4}° trimestre`} value={`${summary.quarters[summary.q4 - 1].count} · ${(summary.quarters[summary.q4 - 1].cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}`} hint="Fatture e note con bollo, conteggio indicativo" />
              ) : (
                <Stat label={`Bolli ${summary.ys} per trimestre`} value={summary.quarters.map((q, i) => `T${i + 1}: ${q.count}`).join(' · ')} hint="Conteggio indicativo" />
              )}
            </div>
            {forf && (
              <div className="dl-thr" data-level={summary.thr.level} aria-label={`Soglia forfettario ${summary.ys}`}>
                <div className="dl-thr-head">
                  <strong>Incassato {summary.ys}</strong>
                  <span className="num">{eur(summary.thr.collectedCents / 100)} su {eur(FORFETTARIO_THRESHOLD)}</span>
                </div>
                <div className="dl-bar" role="progressbar" aria-label={`Incassato ${summary.ys} rispetto alla soglia di ${FORFETTARIO_THRESHOLD.toLocaleString('it-IT')} euro`}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(summary.thr.ratio * 100))}>
                  <span style={{ width: `${Math.min(100, summary.thr.ratio * 100)}%` }} />
                </div>
                {summary.thr.level === 'warn' && (
                  <p className="iv-note" data-tone="warning" role="alert">Hai incassato il {Math.round(summary.thr.ratio * 100)}% della soglia di {FORFETTARIO_THRESHOLD.toLocaleString('it-IT')} € ({eur(summary.thr.remainingCents / 100)} ancora disponibili): parlane con il tuo commercialista [DA VERIFICARE].</p>
                )}
                {summary.thr.level === 'over' && (
                  <p className="iv-note" data-tone="danger" role="alert">Hai raggiunto o superato la soglia di {FORFETTARIO_THRESHOLD.toLocaleString('it-IT')} € nel {summary.ys}: contatta subito il tuo commercialista per capire le conseguenze sul regime forfettario [DA VERIFICARE].</p>
                )}
                <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>
                  Ricavi “per cassa” (ipotesi [DA VERIFICARE]): solo gli incassi registrati in app con data {summary.ys}, senza note di credito né ricavi non fatturati qui.
                </p>
              </div>
            )}
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <Button variant="secondary" onClick={exportCsv}>Esporta registro fatture (CSV)</Button>
              <Button variant="secondary" onClick={exportXmlZip}>Esporta tutti gli XML (ZIP)</Button>
              <Button variant="ghost" onClick={openActivity}>Registro attività</Button>
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>
              Per il commercialista: il CSV elenca fatture e note emesse (anno di competenza, sezionale, totale e fattura stornata); lo ZIP contiene i file XML emessi
              {year === 'tutti' ? ' di tutti gli anni' : ` del ${year}`}, senza bozze né fatture scartate dallo SDI.
            </p>
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

      <Sheet open={activityOpen} onClose={() => setActivityOpen(false)} title="Registro attività">
        <ActivityLog entries={activity} error={activityError} docs={docs} showSubject fileName="registro-attivita" onToast={(m) => toast(m)} />
      </Sheet>
    </div>
  );
}
