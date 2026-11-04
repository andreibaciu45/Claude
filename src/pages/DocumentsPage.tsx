import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocStatus, DocType, Profile, QuoteDocument } from '../types';
import { getProfile, listDocuments, saveDocument } from '../storage';
import { computeTotals } from '../engine';
import { generateDocumentPdf } from '../pdf';
import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, useToast } from '../ui';
import { STATUS_LABEL, STATUS_ORDER, STATUS_TONE, TYPE_LABEL, downloadBlob, fileNameFor } from './quote/shared';
import './quote/quote.css';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

export default function DocumentsPage() {
  const toast = useToast();
  const [docs, setDocs] = useState<QuoteDocument[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState<DocType | 'tutti'>('tutti');
  const [status, setStatus] = useState<DocStatus | 'tutti'>('tutti');
  const [busy, setBusy] = useState<string | null>(null);

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

  const rows = useMemo(() => {
    if (!docs) return [];
    const t = norm(q.trim());
    return docs
      .filter((d) => (type === 'tutti' || d.type === type) && (status === 'tutti' || d.status === status))
      .filter((d) => !t || norm(`${d.customer.name} ${d.number}`).includes(t))
      .map((d) => ({ d, total: computeTotals(d.lines, { forfettario: !!profile?.regimeForfettario, type: d.type }).gross }));
  }, [docs, q, type, status, profile]);

  const pdf = async (d: QuoteDocument) => {
    if (!profile) return;
    setBusy(d.id + 'pdf');
    try { downloadBlob(await generateDocumentPdf(d, profile), fileNameFor(d)); }
    catch { toast('Non sono riuscito a creare il PDF.'); }
    finally { setBusy(null); }
  };
  const advance = async (d: QuoteDocument) => {
    const next = STATUS_ORDER[STATUS_ORDER.indexOf(d.status) + 1];
    if (!next) return;
    setBusy(d.id + 'st');
    try {
      const upd = { ...d, status: next, updatedAt: Date.now() };
      await saveDocument(upd);
      setDocs((cur) => cur && cur.map((x) => (x.id === d.id ? upd : x)));
      toast(`${TYPE_LABEL[d.type]} ${d.number}: ${STATUS_LABEL[next].toLowerCase()}`);
    } catch { toast('Non sono riuscito ad aggiornare lo stato.'); }
    finally { setBusy(null); }
  };

  if (error) return <EmptyState title="Archivio non disponibile" text={error} action={<Button onClick={() => void load()}>Riprova</Button>} />;
  if (!docs) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;

  return (
    <div className="stack">
      <PageHeader title="Documenti" subtitle={`${docs.length} ${docs.length === 1 ? 'documento' : 'documenti'} in archivio`} />

      {docs.length === 0 ? (
        <EmptyState
          title="Ancora nessun documento"
          text="Detta il tuo primo preventivo: in pochi secondi lo trovi qui."
          action={<Link className="btn" data-variant="primary" to="/">Nuovo preventivo</Link>}
        />
      ) : (
        <>
          <div className="dl-filters">
            <Input type="search" aria-label="Cerca per cliente o numero" placeholder="Cerca cliente o numero…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            <div className="dl-chips" role="group" aria-label="Filtra per tipo">
              {(['tutti', 'preventivo', 'fattura'] as const).map((t) => (
                <button key={t} type="button" className="chip" aria-pressed={type === t} onClick={() => setType(t)}>
                  {t === 'tutti' ? 'Tutti i tipi' : t === 'preventivo' ? 'Preventivi' : 'Fatture'}
                </button>
              ))}
            </div>
            <div className="dl-chips" role="group" aria-label="Filtra per stato">
              {(['tutti', ...STATUS_ORDER] as const).map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {s === 'tutti' ? 'Tutti gli stati' : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState title="Nessun risultato" text="Cambia la ricerca o i filtri." action={<Button variant="secondary" onClick={() => { setQ(''); setType('tutti'); setStatus('tutti'); }}>Azzera filtri</Button>} />
          ) : (
            <ul className="dl-list" aria-label="Elenco documenti">
              {rows.map(({ d, total }) => {
                const next = STATUS_ORDER[STATUS_ORDER.indexOf(d.status) + 1];
                return (
                  <li key={d.id}>
                    <Card className="dl-card">
                      <Link to={`/documenti/${d.id}`} className="dl-link" aria-label={`${TYPE_LABEL[d.type]} ${d.number}, ${d.customer.name}`}>
                        <div className="dl-row">
                          <span className="dl-num">{TYPE_LABEL[d.type]} {d.number}</span>
                          <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                        </div>
                        <div className="dl-cust">{d.customer.name || 'Cliente senza nome'}</div>
                        <div className="dl-meta">
                          <span>{fmtDate(d.date)}</span>
                          <span className="dl-total num"><Money value={total} /></span>
                        </div>
                      </Link>
                      <div className="dl-actions">
                        <button type="button" onClick={() => void pdf(d)} disabled={!profile || busy === d.id + 'pdf'}>{busy === d.id + 'pdf' ? 'Creo PDF…' : 'Scarica PDF'}</button>
                        <button type="button" onClick={() => void advance(d)} disabled={!next || busy === d.id + 'st'}>
                          {next ? `Segna ${STATUS_LABEL[next].toLowerCase()}` : 'Completato'}
                        </button>
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
