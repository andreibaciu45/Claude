import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DocStatus, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { deleteDocument, getDocument, getProfile, nextDocumentNumber, saveDocument } from '../storage';
import { computeTotals } from '../engine';
import { BOLLO_TEXT, COURTESY_TEXT, FORFETTARIO_TEXT, fmtNum, fmtQty, generateDocumentPdf, docTitle } from '../pdf';
import { Badge, Button, EmptyState, Money, PageHeader, Sheet, useToast } from '../ui';
import {
  STATUS_LABEL, STATUS_ORDER, STATUS_TONE, canShareFiles, downloadBlob, fileNameFor, sharePdf, shareText, todayIso, waNumber,
} from './quote/shared';
import { lineTotal } from './quote/QuoteEditor';
import './quote/quote.css';

const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

export default function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [doc, setDoc] = useState<QuoteDocument | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    setError(null); setMissing(false);
    try {
      const [d, p] = await Promise.all([id ? getDocument(id) : Promise.resolve(undefined), getProfile()]);
      setProfile(p);
      if (!d) setMissing(true); else setDoc(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile leggere il documento.');
    }
  }, [id]);
  useEffect(() => { setDoc(null); void load(); }, [load]);

  const totals = useMemo(
    () => (doc && profile ? computeTotals(doc.lines, { forfettario: profile.regimeForfettario, type: doc.type }) : null),
    [doc, profile],
  );

  const run = async (key: string, fn: () => Promise<void>, errMsg: string) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e) { toast(e instanceof Error && e.message ? `${errMsg} (${e.message})` : errMsg); }
    finally { setBusy(null); }
  };

  if (error) return <EmptyState title="Documento non disponibile" text={error} action={<Button onClick={() => void load()}>Riprova</Button>} />;
  if (missing) return <EmptyState title="Documento non trovato" text="Potrebbe essere stato eliminato." action={<Link className="btn" data-variant="primary" to="/documenti">Vai ai documenti</Link>} />;
  if (!doc || !profile || !totals) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;

  const forf = profile.regimeForfettario;
  const total = totals.gross;

  const setStatus = (status: DocStatus) => run('status', async () => {
    const upd = { ...doc, status, updatedAt: Date.now() };
    await saveDocument(upd);
    setDoc(upd);
  }, 'Non sono riuscito ad aggiornare lo stato.');

  const download = () => run('pdf', async () => {
    downloadBlob(await generateDocumentPdf(doc, profile), fileNameFor(doc));
  }, 'Non sono riuscito a creare il PDF.');

  const share = () => run('share', async () => {
    const r = await sharePdf(doc, profile, shareText(doc, profile, total));
    if (r === 'downloaded') toast('PDF scaricato');
  }, 'Condivisione non riuscita.');

  const whatsapp = () => {
    const text = shareText(doc, profile, total);
    if (canShareFiles()) { void share(); return; }
    // Niente condivisione file: apro WhatsApp subito (gesto utente) e scarico il PDF da allegare
    const num = waNumber(doc.customer.phone);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    void run('wa', async () => {
      downloadBlob(await generateDocumentPdf(doc, profile), fileNameFor(doc));
      toast('PDF scaricato: allegalo al messaggio su WhatsApp.');
    }, 'Non sono riuscito a creare il PDF.');
  };

  const duplicate = () => run('dup', async () => {
    const now = Date.now();
    const copy: QuoteDocument = {
      ...doc, id: uid(), number: await nextDocumentNumber(doc.type), date: todayIso(), status: 'bozza',
      lines: doc.lines.map((l) => ({ ...l, id: uid() })), createdAt: now, updatedAt: now,
    };
    await saveDocument(copy);
    toast('Documento duplicato');
    nav(`/documenti/${copy.id}`);
  }, 'Duplicazione non riuscita.');

  const convert = () => run('conv', async () => {
    const now = Date.now();
    const inv: QuoteDocument = {
      ...doc, id: uid(), type: 'fattura', number: await nextDocumentNumber('fattura'), date: todayIso(), status: 'bozza',
      lines: doc.lines.map((l) => ({ ...l, id: uid() })), createdAt: now, updatedAt: now,
    };
    await saveDocument(inv);
    toast(`Creata la fattura ${inv.number}`);
    nav(`/documenti/${inv.id}`);
  }, 'Conversione non riuscita.');

  const remove = () => run('del', async () => {
    await deleteDocument(doc.id);
    toast('Documento eliminato');
    nav('/documenti', { replace: true });
  }, 'Eliminazione non riuscita.');

  const p = profile;
  const city = [p.zip, p.city].filter(Boolean).join(' ') + (p.province ? ` (${p.province})` : '');
  const c = doc.customer;

  return (
    <div className="stack">
      <PageHeader
        title={doc.type === 'preventivo' ? 'Preventivo' : 'Fattura'}
        subtitle={`n. ${doc.number}`}
        actions={<Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>}
      />

      <div className="dv-actions">
        <Button onClick={download} disabled={!!busy}>{busy === 'pdf' ? 'Creo PDF…' : 'Scarica PDF'}</Button>
        <Button variant="secondary" onClick={share} disabled={!!busy}>{busy === 'share' ? 'Attendi…' : 'Condividi'}</Button>
        <Button variant="secondary" className="span-2" onClick={whatsapp} disabled={!!busy}>Invia su WhatsApp</Button>
      </div>

      <div>
        <div className="field-label" id="dv-status-l">Stato del documento</div>
        <div className="segmented dv-status" role="radiogroup" aria-labelledby="dv-status-l">
          {STATUS_ORDER.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={doc.status === s} disabled={!!busy} onClick={() => doc.status !== s && void setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <article className="dv-paper" aria-label={`Anteprima ${docTitle(doc)}`}>
        <header className="dv-head">
          {p.logoDataUrl && <img src={p.logoDataUrl} alt="Logo" />}
          <div>
            <div className="dv-biz">{p.businessName || 'La tua azienda'}</div>
            <div className="dv-small">
              {p.address && <div>{p.address}{city.trim() ? ` - ${city}` : ''}</div>}
              {(p.vatNumber || p.fiscalCode) && <div>{[p.vatNumber && `P.IVA ${p.vatNumber}`, p.fiscalCode && `C.F. ${p.fiscalCode}`].filter(Boolean).join('  ')}</div>}
              {(p.phone || p.email) && <div>{[p.phone, p.email].filter(Boolean).join('  ')}</div>}
              {p.artigianiNumber && <div>Albo Imprese Artigiane n. {p.artigianiNumber}</div>}
            </div>
          </div>
        </header>

        <div className="dv-title">
          <h2>{docTitle(doc)}</h2>
          <span>{fmtDate(doc.date)}</span>
        </div>

        <div className="dv-cust">
          <small>{doc.type === 'preventivo' ? 'PREVENTIVO PER' : 'FATTURATO A'}</small>
          <strong>{c.name}</strong>
          {c.address && <div>{c.address}</div>}
          {c.vatOrFiscalCode && <div>P.IVA / C.F.: {c.vatOrFiscalCode}</div>}
          {(c.email || c.phone) && <div>{[c.email, c.phone].filter(Boolean).join('  ')}</div>}
        </div>

        <div role="list" aria-label="Righe del documento">
          {doc.lines.map((l) => (
            <div className="dv-line" role="listitem" key={l.id}>
              <div className="dv-line-desc">{l.description}</div>
              <div className="dv-line-calc">
                <span>
                  {fmtQty(l.qty)} {l.unit} × {fmtNum(l.unitPrice)} €
                  {l.discountPct ? ` (−${fmtNum(l.discountPct, l.discountPct % 1 ? 1 : 0)}%)` : ''}
                  {!forf ? ` · IVA ${l.vat}%` : ''}
                </span>
                <strong className="num"><Money value={lineTotal(l)} /></strong>
              </div>
            </div>
          ))}
        </div>

        <div className="dv-totals">
          <div><span>Imponibile</span><span className="num"><Money value={totals.net} /></span></div>
          {!forf && totals.byRate.map((r) => (
            <div key={r.rate}><span>IVA {r.rate}%</span><span className="num"><Money value={r.vat} /></span></div>
          ))}
          {totals.stamp > 0 && <div><span>Marca da bollo</span><span className="num"><Money value={totals.stamp} /></span></div>}
          <div className="dv-total"><span>TOTALE</span><span className="num"><Money value={totals.gross} /></span></div>
        </div>

        {doc.notes && <section className="dv-section"><h3>Note</h3><p>{doc.notes}</p></section>}
        {(forf || doc.type === 'fattura') && (
          <div>
            {forf && <p className="dv-legal">{FORFETTARIO_TEXT}</p>}
            {forf && totals.stamp > 0 && <p className="dv-legal">{BOLLO_TEXT}</p>}
            {doc.type === 'fattura' && <p className="dv-legal">{COURTESY_TEXT}</p>}
          </div>
        )}
      </article>

      <div className="dv-actions">
        <Link className="btn" data-variant="secondary" to={`/?edit=${doc.id}`}>Modifica</Link>
        <Button variant="secondary" onClick={duplicate} disabled={!!busy}>Duplica</Button>
        {doc.type === 'preventivo' && (
          <>
            <Button className="span-2" onClick={convert} disabled={!!busy || doc.status !== 'accettato'}>Converti in fattura</Button>
            {doc.status !== 'accettato' && <p className="muted span-2 qe-note" style={{ gridColumn: '1 / -1' }}>Per convertirlo in fattura, segna prima il preventivo come “Accettato”.</p>}
          </>
        )}
        <Button variant="danger" className="span-2" onClick={() => setConfirmDel(true)} disabled={!!busy}>Elimina</Button>
      </div>

      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Eliminare il documento?">
        <div className="dv-confirm">
          <p>{docTitle(doc)} per {doc.customer.name} verrà eliminato in modo definitivo.</p>
          <Button variant="danger" onClick={() => { setConfirmDel(false); void remove(); }}>Sì, elimina</Button>
          <Button variant="secondary" onClick={() => setConfirmDel(false)}>Annulla</Button>
        </div>
      </Sheet>
    </div>
  );
}
