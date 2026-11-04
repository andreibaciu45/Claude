import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AuditEntry, DocLine, DocStatus, Profile, QuoteDocument, QuoteStatus, SdiEvent, ValidationIssue } from '../types';
import { uid } from '../types';
import {
  appendAudit, createCreditNote, createInvoiceFromQuote, createResubmissionDraft, deleteDocument, getDocument, getProfile, issueInvoice, listAudit,
  listDocuments, nextDocumentNumber, recordPayment, recordSdiEvent, reopenRejectedInvoice, saveDocument,
} from '../storage';
import { validateInvoiceForIssue } from '../../shared/fatturapa';
import {
  BOLLO_TEXT, COURTESY_TEXT, DRAFT_TEXT, FORFETTARIO_TEXT, creditNoteLines, docTitle, documentTotals, draftTotals, fmtDate, fmtNum, fmtQty, generateDocumentPdf, lineAmount,
} from '../pdf';
import { Badge, Button, EmptyState, Money, PageHeader, Select, Sheet, useToast } from '../ui';
import { LimitGate } from '../billing/LimitGate';
import type { Allowance } from '../billing/allowance';
import { checkAllowanceNow } from '../billing/useAllowance';
import { recordDocumentCreated } from '../billing/usage';
import { syncEngine } from '../sync/engine';
import { STATUS_LABEL, STATUS_TONE, canShareFiles, downloadBlob, fileNameFor, sharePdf, shareText, todayIso, waNumber } from './quote/shared';
import { ActivityLog } from './invoice/ActivityLog';
import { CreditNoteSheet } from './invoice/CreditNoteSheet';
import { InvoiceBadges, InvoicePanel, Timeline } from './invoice/InvoicePanel';
import { IssueSheet } from './invoice/IssueSheet';
import { CorrectRejectedSheet, ResubmitNewSheet } from './invoice/RejectedSheets';
import { PaymentSheet, SdiEventSheet, SdiGuideSheet } from './invoice/SdiSheets';
import {
  QUOTE_STATUSES, availableActions, daysSince, displayNumber, isCreditNote, isDraftInvoice, isFiscalInvoice, isLegacyInvoice, kindLabel, lastIssuedIso, newInvoiceFiscal, paidAmount, windowExpired,
} from './invoice/model';
import './quote/quote.css';
import './invoice/invoice.css';

type SheetName = 'activity' | 'issue' | 'credit' | 'guide' | 'send' | 'outcome' | 'payment' | 'delete' | 'convert' | 'correct' | 'resubmit' | null;
const LEGACY_STATUSES: DocStatus[] = ['bozza', 'inviato', 'pagato'];

/** Estrae le segnalazioni da un InvoiceValidationError (duck typing: funziona anche tra moduli/mock). */
const issuesOf = (e: unknown): ValidationIssue[] | null => {
  const l = (e as { issues?: unknown } | null)?.issues;
  return Array.isArray(l) && l.length ? (l as ValidationIssue[]) : null;
};

export default function DocumentView() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [doc, setDoc] = useState<QuoteDocument | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [serverIssues, setServerIssues] = useState<ValidationIssue[]>([]);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState(false);
  /** Limite del piano Free raggiunto: mostra la schermata gentile invece di creare un nuovo documento. */
  const [gate, setGate] = useState<{ allowance: Allowance; signedIn: boolean } | null>(null);
  const [activity, setActivity] = useState<AuditEntry[] | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [allDocs, setAllDocs] = useState<QuoteDocument[]>([]);
  const [related, setRelated] = useState<{
    original: QuoteDocument | null; creditNotes: QuoteDocument[]; quote: QuoteDocument | null; invoice: QuoteDocument | null;
    resubmission: QuoteDocument | null; resubmissionOf: QuoteDocument | null; lastIssued: string;
  }>({ original: null, creditNotes: [], quote: null, invoice: null, resubmission: null, resubmissionOf: null, lastIssued: '' });

  const loadExtras = useCallback(async (d: QuoteDocument) => {
    if (d.type === 'fattura' && isFiscalInvoice(d)) {
      try { setAudit(await listAudit(d.id)); setAuditError(false); } catch { setAudit(null); setAuditError(true); }
    }
    try {
      const all = await listDocuments();
      setAllDocs(all);
      setRelated({
        original: d.invoice?.originalDocumentId ? all.find((x) => x.id === d.invoice!.originalDocumentId) ?? null : null,
        creditNotes: all.filter((x) => x.invoice?.originalDocumentId === d.id),
        quote: d.convertedFromQuoteId ? all.find((x) => x.id === d.convertedFromQuoteId) ?? null : null,
        invoice: d.convertedToInvoiceId ? all.find((x) => x.id === d.convertedToInvoiceId) ?? null : null,
        resubmission: all.find((x) => x.invoice?.resubmissionOf === d.id) ?? null,
        resubmissionOf: d.invoice?.resubmissionOf ? all.find((x) => x.id === d.invoice!.resubmissionOf) ?? null : null,
        lastIssued: lastIssuedIso(all, d),
      });
    } catch { /* i collegamenti sono un extra: la pagina funziona anche senza */ }
  }, []);

  const load = useCallback(async () => {
    setError(null); setMissing(false);
    try {
      const [d, p] = await Promise.all([id ? getDocument(id) : Promise.resolve(undefined), getProfile()]);
      setProfile(p);
      if (!d) setMissing(true); else { setDoc(d); void loadExtras(d); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile leggere il documento.');
    }
  }, [id, loadExtras]);
  useEffect(() => { setDoc(null); setSheet(null); setServerIssues([]); setAudit(null); setGate(null); setActivity(null); void load(); }, [load]);

  // registro attività del documento: si legge quando si apre la scheda (e ad ogni riapertura, per vedere le voci appena scritte)
  const activityOpen = sheet === 'activity';
  useEffect(() => {
    if (!activityOpen || !id) return;
    let alive = true;
    setActivity(null); setActivityError(false);
    listAudit(id).then((a) => { if (alive) setActivity(a); }).catch(() => { if (alive) setActivityError(true); });
    return () => { alive = false; };
  }, [activityOpen, id]);

  // ritorno dal profilo (scheda "Emetti" -> "Correggi nel profilo" -> salva): riapre la scheda di emissione, una sola volta
  const reopenIssue = (location.state as { reopen?: string } | null)?.reopen === 'issue';
  useEffect(() => {
    if (reopenIssue && doc && isDraftInvoice(doc)) {
      setServerIssues([]); setSheet('issue');
      nav(location.pathname, { replace: true, state: null });
    }
  }, [reopenIssue, doc, nav, location.pathname]);

  const totals = useMemo(() => (doc && profile ? documentTotals(doc, profile.regimeForfettario) : null), [doc, profile]);
  const localIssues = useMemo<ValidationIssue[]>(() => {
    if (!doc || !profile || !isDraftInvoice(doc)) return [];
    try {
      // "il numero verrà assegnato all'emissione" è normale per una bozza: non è un avviso da mostrare
      return validateInvoiceForIssue(doc, profile, related.lastIssued ? { lastIssuedDate: related.lastIssued } : {}).filter((i) => i.code !== 'number_missing');
    } catch { return []; }
  }, [doc, profile, related.lastIssued]);
  const issues = useMemo(() => {
    const seen = new Set(localIssues.map((i) => `${i.field}|${i.code}`));
    return [...localIssues, ...serverIssues.filter((i) => !seen.has(`${i.field}|${i.code}`))];
  }, [localIssues, serverIssues]);

  const run = async (key: string, fn: () => Promise<void>, errMsg: string) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e) { toast(e instanceof Error && e.message ? `${errMsg} (${e.message})` : errMsg, 'error'); }
    finally { setBusy(null); }
  };

  if (error) return <EmptyState title="Documento non disponibile" text={error} action={<Button onClick={() => void load()}>Riprova</Button>} />;
  if (missing) return <EmptyState title="Documento non trovato" text="Potrebbe essere stato eliminato." action={<Link className="btn" data-variant="primary" to="/documenti">Vai ai documenti</Link>} />;
  if (!doc || !profile || !totals) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;

  const fiscal = isFiscalInvoice(doc);
  const legacy = isLegacyInvoice(doc);
  const draftInv = isDraftInvoice(doc);
  const nc = isCreditNote(doc);
  const act = availableActions(doc);
  const forf = profile.regimeForfettario;
  const inv = doc.invoice;
  const num = displayNumber(doc);
  const issued = fiscal && !draftInv;
  const residual = Math.max(0, Math.round((totals.gross - paidAmount(doc)) * 100) / 100);

  const apply = (upd: QuoteDocument) => { setDoc(upd); void loadExtras(upd); };

  const setStatus = (status: DocStatus) => run('status', async () => {
    const upd = { ...doc, status, updatedAt: Date.now() };
    await saveDocument(upd);
    setDoc(upd);
  }, 'Non sono riuscito ad aggiornare lo stato.');

  const download = () => run('pdf', async () => {
    downloadBlob(await generateDocumentPdf(doc, profile), fileNameFor(doc));
  }, 'Non sono riuscito a creare il PDF.');

  const share = () => run('share', async () => {
    const r = await sharePdf(doc, profile, shareText(doc, profile, totals.gross));
    if (r === 'downloaded') toast('PDF scaricato');
  }, 'Condivisione non riuscita.');

  const whatsapp = () => {
    const text = shareText(doc, profile, totals.gross);
    if (canShareFiles()) { void share(); return; }
    const phone = waNumber(doc.customer.phone);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    void run('wa', async () => {
      downloadBlob(await generateDocumentPdf(doc, profile), fileNameFor(doc));
      toast('PDF scaricato: allegalo al messaggio su WhatsApp.');
    }, 'Non sono riuscito a creare il PDF.');
  };

  const downloadXml = () => {
    if (!inv?.xml) { toast('XML non disponibile per questo documento.', 'error'); return; }
    downloadBlob(new Blob([inv.xml], { type: 'application/xml' }), inv.fileName || `${num.replace(/[^\w-]+/g, '_')}.xml`);
    const late = daysSince(inv.operationDate) > 12 && (doc.status === 'emessa' || doc.status === 'scartata');
    toast(late
      ? 'XML scaricato. Attenzione: sono passati più di 12 giorni dalla data dell’operazione.'
      : 'XML scaricato: ora caricalo sul portale dell’Agenzia delle Entrate.');
    // registro (append-only): il download dell'XML lascia traccia; oltre i 12 giorni lo scrive anche (FISCAL-SPEC §1.5)
    void (async () => {
      try {
        await appendAudit({
          docId: doc.id, action: 'download_xml', xmlSha256: inv.xmlSha256,
          detail: `Scaricato ${inv.fileName ?? 'XML'}${late ? ` — attenzione: oltre 12 giorni dalla data operazione (${inv.operationDate})` : ''}`,
        });
        setAudit(await listAudit(doc.id));
      } catch { /* il registro non deve bloccare il download */ }
    })();
  };

  const downloadOldXml = (v: { xml?: string; fileName?: string }) => {
    if (!v.xml) return;
    downloadBlob(new Blob([v.xml], { type: 'application/xml' }), v.fileName || 'xml-precedente.xml');
  };

  /**
   * Piano Free: un NUOVO documento (duplicato, fattura da preventivo) conta nel limite mensile. Si controlla PRIMA di crearlo e,
   * se il limite è raggiunto, si mostra la schermata gentile. Le note di credito, lo storno e la consultazione non passano mai da qui.
   * Se la verifica non riesce non si blocca l'utente (come in "Nuovo documento").
   */
  const withinLimit = async (): Promise<boolean> => {
    let a: Allowance;
    try { a = await checkAllowanceNow(); } catch { return true; }
    if (a.canCreate) return true;
    setSheet(null);
    setGate({ allowance: a, signedIn: syncEngine.getStatus().signedIn });
    return false;
  };

  const duplicate = () => run('dup', async () => {
    if (!(await withinLimit())) return;
    const now = Date.now();
    const lines = doc.lines.map((l) => ({ ...l, id: uid() }));
    let copy: QuoteDocument;
    if (fiscal) {
      const t = draftTotals(lines, 'fattura', forf, false);
      const c = { ...doc.customer };
      copy = {
        ...doc, id: uid(), number: '', date: todayIso(), status: 'bozza', lines, createdAt: now, updatedAt: now,
        convertedFromQuoteId: undefined, convertedToInvoiceId: undefined, invoice: newInvoiceFiscal({
          date: todayIso(), customer: c, stampDue: t.stampDue, stampChargedToCustomer: inv?.stampDutyChargedToCustomer ?? !!profile.stampDutyDefaultChargedToCustomer,
        }),
      };
    } else {
      copy = { ...doc, id: uid(), number: await nextDocumentNumber(doc.type), date: todayIso(), status: 'bozza', lines, createdAt: now, updatedAt: now, convertedToInvoiceId: undefined };
    }
    await saveDocument(copy);
    recordDocumentCreated(copy.id, copy.createdAt);
    toast(fiscal ? 'Creata una nuova bozza' : 'Documento duplicato');
    nav(`/documenti/${copy.id}`);
  }, 'Duplicazione non riuscita.');

  const convert = () => run('conv', async () => {
    setSheet(null);
    if (!(await withinLimit())) return;
    const created = await createInvoiceFromQuote(doc.id);
    recordDocumentCreated(created.id, created.createdAt);
    toast('Creata la bozza di fattura');
    nav(`/documenti/${created.id}`);
  }, 'Conversione non riuscita.');

  const remove = () => run('del', async () => {
    setSheet(null);
    await deleteDocument(doc.id);
    toast(draftInv ? 'Bozza eliminata' : 'Documento eliminato');
    nav('/documenti', { replace: true });
  }, 'Eliminazione non riuscita.');

  const issue = () => run('issue', async () => {
    try {
      const upd = await issueInvoice(doc.id);
      setServerIssues([]); setSheet(null); apply(upd);
      toast(`Fattura emessa: n. ${upd.invoice?.number ?? ''}`, 'success');
    } catch (e) {
      const list = issuesOf(e);
      if (!list) throw e;
      setServerIssues(list);
      toast('La fattura ha dei problemi da correggere.', 'error');
    }
  }, 'Emissione non riuscita.');

  const makeCreditNote = (o: { reason: string; lines?: DocLine[] }) => run('credit', async () => {
    const created = await createCreditNote(doc.id, o);
    setSheet(null);
    toast(`Nota di credito emessa: n. ${created.invoice?.number ?? ''}`, 'success');
    nav(`/documenti/${created.id}`);
  }, 'Nota di credito non riuscita.');

  const correctRejected = (patch: { customer?: QuoteDocument['customer']; lines?: DocLine[]; notes?: string }) => run('correct', async () => {
    try {
      const upd = await reopenRejectedInvoice(doc.id, patch);
      setServerIssues([]); setSheet(null); apply(upd);
      toast('File XML rigenerato con lo stesso numero e la stessa data. Scaricalo e rinvialo.', 'success');
    } catch (e) {
      const list = issuesOf(e);
      if (!list) throw e;
      toast(list.find((i) => i.severity === 'error')?.message ?? 'Ci sono dati da correggere.', 'error');
    }
  }, 'Correzione non riuscita.');

  const resubmitNew = () => run('resubmit', async () => {
    const created = await createResubmissionDraft(doc.id);
    setSheet(null);
    toast('Creata la nuova bozza collegata', 'success');
    nav(`/documenti/${created.id}`);
  }, 'Non sono riuscito a creare la nuova bozza.');

  const saveSdi = (ev: SdiEvent) => run('sdi', async () => {
    const upd = await recordSdiEvent(doc.id, ev);
    setSheet(null); apply(upd);
    toast(ev.type === 'INVIO' ? 'Segnata come inviata' : 'Esito registrato', 'success');
  }, 'Registrazione non riuscita.');

  const savePayment = (p: { date: string; amount: number; method?: string }) => run('pay', async () => {
    const upd = await recordPayment(doc.id, p);
    setSheet(null); apply(upd);
    toast('Incasso registrato', 'success');
  }, 'Registrazione non riuscita.');

  const city = [profile.zip, profile.city].filter(Boolean).join(' ') + (profile.province ? ` (${profile.province})` : '');
  const c = doc.customer;
  const custCity = [c.zip, c.city].filter(Boolean).join(' ') + (c.province ? ` (${c.province})` : '');
  const docDate = (fiscal && inv?.operationDate) || doc.date;
  const quoteStatus = doc.status as QuoteStatus;

  return (
    <div className="stack">
      <PageHeader
        title={kindLabel(doc)}
        subtitle={`n. ${num}`}
        actions={fiscal ? <InvoiceBadges doc={doc} /> : <Badge tone={STATUS_TONE[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>}
      />

      {draftInv && (
        <p className="iv-note" data-tone="warning" role="note">
          <strong>BOZZA</strong>: non ha ancora un numero e non è stata emessa. Il numero viene assegnato solo quando emetti la fattura.
        </p>
      )}
      {legacy && doc.type === 'fattura' && <p className="iv-note" role="note">Fattura di cortesia (versione precedente dell’app): non è un documento fiscale.</p>}

      {draftInv && (
        <Button size="lg" className="btn-block" onClick={() => { setServerIssues([]); setSheet('issue'); }} disabled={!!busy}>Emetti fattura</Button>
      )}

      {issued && <InvoicePanel
        doc={doc} totals={totals} busy={busy} original={related.original} creditNotes={related.creditNotes}
        resubmission={related.resubmission} resubmissionOf={related.resubmissionOf}
        onCorrect={() => setSheet('correct')} onResubmitNew={() => setSheet('resubmit')} onDownloadOldXml={downloadOldXml}
        onDownloadXml={downloadXml} onGuide={() => setSheet('guide')} onSend={() => setSheet('send')} onOutcome={() => setSheet('outcome')}
        onPayment={() => setSheet('payment')} onCreditNote={() => setSheet('credit')}
      />}

      <div className="dv-actions">
        <Button onClick={download} disabled={!!busy}>{busy === 'pdf' ? 'Creo PDF…' : draftInv ? 'Scarica PDF (bozza)' : issued ? 'Scarica PDF (copia di cortesia)' : 'Scarica PDF'}</Button>
        {act.shareCourtesy && <Button variant="secondary" onClick={share} disabled={!!busy}>{busy === 'share' ? 'Attendi…' : 'Condividi'}</Button>}
        {act.shareCourtesy && <Button variant="secondary" className="span-2" onClick={whatsapp} disabled={!!busy}>Invia su WhatsApp</Button>}
      </div>

      {doc.type === 'preventivo' && (
        <div>
          <label className="field-label" htmlFor="dv-qstatus">Stato del preventivo</label>
          <Select id="dv-qstatus" value={quoteStatus} disabled={!!busy} onChange={(e) => void setStatus(e.target.value as DocStatus)}>
            {QUOTE_STATUSES.filter((s) => s !== 'convertito' || quoteStatus === 'convertito').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
      )}
      {legacy && doc.type === 'fattura' && (
        <div>
          <div className="field-label" id="dv-status-l">Stato del documento</div>
          <div className="segmented dv-status" role="radiogroup" aria-labelledby="dv-status-l">
            {LEGACY_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={doc.status === s} disabled={!!busy} onClick={() => doc.status !== s && void setStatus(s)}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
        </div>
      )}

      {(related.quote || related.invoice) && (
        <div className="iv-links">
          {related.quote && <Link to={`/documenti/${related.quote.id}`}>Creata dal preventivo n. {related.quote.number}</Link>}
          {related.invoice && <Link to={`/documenti/${related.invoice.id}`}>Convertito nella fattura {related.invoice.invoice?.number ? `n. ${related.invoice.invoice.number}` : '(bozza)'}</Link>}
        </div>
      )}

      <article className="dv-paper" data-draft={draftInv ? 'true' : undefined} aria-label={`Anteprima ${docTitle(doc)}`}>
        <header className="dv-head">
          {profile.logoDataUrl && <img src={profile.logoDataUrl} alt="Logo" />}
          <div>
            <div className="dv-biz">{profile.businessName || 'La tua azienda'}</div>
            <div className="dv-small">
              {profile.address && <div>{profile.address}{city.trim() ? ` - ${city}` : ''}</div>}
              {(profile.vatNumber || profile.fiscalCode) && <div>{[profile.vatNumber && `P.IVA ${profile.vatNumber}`, profile.fiscalCode && `C.F. ${profile.fiscalCode}`].filter(Boolean).join('  ')}</div>}
              {(profile.phone || profile.email) && <div>{[profile.phone, profile.email].filter(Boolean).join('  ')}</div>}
              {profile.artigianiNumber && <div>Albo Imprese Artigiane n. {profile.artigianiNumber}</div>}
            </div>
          </div>
        </header>

        <div className="dv-title">
          <h2>{docTitle(doc)}</h2>
          <span>{fmtDate(docDate)}</span>
        </div>
        {creditNoteLines(doc).map((l) => <p key={l} className="dv-legal" style={{ color: 'inherit', fontWeight: 600 }}>{l}</p>)}

        <div className="dv-cust">
          <small>{doc.type === 'preventivo' ? 'PREVENTIVO PER' : nc ? 'INTESTATA A' : 'FATTURATO A'}</small>
          <strong>{c.name}</strong>
          {c.address && <div>{c.address}</div>}
          {fiscal && custCity.trim() && <div>{custCity}</div>}
          {fiscal ? (
            (c.vatNumber || c.fiscalCode) ? <div>{[c.vatNumber && `P.IVA ${c.vatNumber}`, c.fiscalCode && `C.F. ${c.fiscalCode}`].filter(Boolean).join('  ')}</div> : c.vatOrFiscalCode ? <div>P.IVA / C.F.: {c.vatOrFiscalCode}</div> : null
          ) : (c.vatOrFiscalCode && <div>P.IVA / C.F.: {c.vatOrFiscalCode}</div>)}
          {fiscal && c.codiceDestinatario && c.codiceDestinatario !== '0000000' && <div>Codice destinatario: {c.codiceDestinatario}</div>}
          {fiscal && c.pec && <div>PEC: {c.pec}</div>}
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
                <strong className="num"><Money value={lineAmount(l)} /></strong>
              </div>
            </div>
          ))}
        </div>

        <div className="dv-totals">
          <div><span>Imponibile</span><span className="num"><Money value={totals.net} /></span></div>
          {!forf && totals.byRate.map((r) => (
            <div key={r.rate}><span>IVA {r.rate}%</span><span className="num"><Money value={r.vat} /></span></div>
          ))}
          {totals.stamp > 0 && <div><span>{fiscal ? 'Rimborso imposta di bollo' : 'Marca da bollo'}</span><span className="num"><Money value={totals.stamp} /></span></div>}
          <div className="dv-total"><span>TOTALE</span><span className="num"><Money value={totals.gross} /></span></div>
        </div>

        {doc.notes && <section className="dv-section"><h3>Note</h3><p>{doc.notes}</p></section>}
        {(forf || doc.type === 'fattura') && (
          <div>
            {forf && <p className="dv-legal">{FORFETTARIO_TEXT}</p>}
            {forf && totals.stampDue > 0 && <p className="dv-legal">{BOLLO_TEXT}</p>}
            {draftInv && <p className="dv-legal">{DRAFT_TEXT}</p>}
            {issued && <p className="dv-legal">{COURTESY_TEXT}</p>}
            {legacy && doc.type === 'fattura' && <p className="dv-legal">Documento di cortesia: non sostituisce la fattura elettronica trasmessa tramite SDI.</p>}
          </div>
        )}
      </article>

      {issued && <Timeline doc={doc} audit={audit} auditError={auditError} />}

      <div className="dv-actions">
        {act.edit && <Link className="btn" data-variant="secondary" to={`/?edit=${doc.id}`}>Modifica</Link>}
        {act.duplicate && <Button variant="secondary" onClick={duplicate} disabled={!!busy}>{fiscal ? 'Duplica come bozza' : 'Duplica'}</Button>}
        {act.convertToInvoice && (
          <>
            <Button className="span-2" onClick={() => (doc.status === 'accettato' ? void convert() : setSheet('convert'))} disabled={!!busy}>
              {busy === 'conv' ? 'Creo la bozza…' : 'Converti in fattura'}
            </Button>
            {doc.status !== 'accettato' && <p className="muted qe-note" style={{ gridColumn: '1 / -1' }}>Di solito si converte un preventivo accettato: dagli altri stati chiedo conferma.</p>}
          </>
        )}
        {act.delete && <Button variant="danger" className="span-2" onClick={() => setSheet('delete')} disabled={!!busy}>{draftInv ? 'Elimina bozza' : 'Elimina'}</Button>}
      </div>

      <div className="dv-actions">
        <Button variant="ghost" className="span-2" onClick={() => setSheet('activity')}>Registro attività di questo documento</Button>
      </div>

      <Sheet open={sheet === 'activity'} onClose={() => setSheet(null)} title="Registro attività">
        <ActivityLog entries={activity} error={activityError} docs={allDocs.length ? allDocs : [doc]} fileName={`registro-attivita-${num.replace(/[^\w-]+/g, '_')}`} onToast={(m) => toast(m)} />
      </Sheet>

      <Sheet open={!!gate} onClose={() => setGate(null)} title="Limite del piano raggiunto">
        {gate && <LimitGate allowance={gate.allowance} signedIn={gate.signedIn} />}
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title={draftInv ? 'Eliminare la bozza?' : 'Eliminare il documento?'}>
        <div className="dv-confirm">
          <p>{docTitle(doc)} per {doc.customer.name} verrà eliminato in modo definitivo.{draftInv ? ' Nessun numero di fattura viene consumato.' : ''}</p>
          <Button variant="danger" onClick={() => void remove()} disabled={!!busy}>Sì, elimina</Button>
          <Button variant="secondary" onClick={() => setSheet(null)}>Annulla</Button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'convert'} onClose={() => setSheet(null)} title="Convertire in fattura?">
        <div className="dv-confirm">
          <p>Il preventivo è “{STATUS_LABEL[doc.status].toLowerCase()}”, non “accettato”. Creo comunque una bozza di fattura con le stesse righe? Potrai controllarla e modificarla prima di emetterla.</p>
          <Button onClick={() => void convert()} disabled={!!busy}>Sì, crea la bozza di fattura</Button>
          <Button variant="secondary" onClick={() => setSheet(null)}>Annulla</Button>
        </div>
      </Sheet>

      {draftInv && <IssueSheet open={sheet === 'issue'} onClose={() => setSheet(null)} returnTo={`/documenti/${doc.id}`} doc={doc} profile={profile} totals={totals} issues={issues} busy={busy === 'issue'} onIssue={() => void issue()} />}
      {issued && (
        <>
          <SdiGuideSheet open={sheet === 'guide'} onClose={() => setSheet(null)} fileName={inv?.fileName} />
          <SdiEventSheet open={sheet === 'send'} mode="send" onClose={() => setSheet(null)} busy={busy === 'sdi'} onSave={saveSdi} />
          <SdiEventSheet open={sheet === 'outcome'} mode="outcome" onClose={() => setSheet(null)} busy={busy === 'sdi'} onSave={saveSdi} />
          <PaymentSheet open={sheet === 'payment'} onClose={() => setSheet(null)} doc={doc} residual={residual} busy={busy === 'pay'} onSave={savePayment} />
          {act.creditNote && <CreditNoteSheet open={sheet === 'credit'} onClose={() => setSheet(null)} doc={doc} busy={busy === 'credit'} creditNotes={related.creditNotes} forfettario={forf} onCreate={makeCreditNote} />}
          {doc.status === 'scartata' && (
            <>
              <CorrectRejectedSheet open={sheet === 'correct'} onClose={() => setSheet(null)} doc={doc} profile={profile} busy={busy === 'correct'} onSubmit={(pt) => void correctRejected(pt)} />
              <ResubmitNewSheet open={sheet === 'resubmit'} onClose={() => setSheet(null)} doc={doc} expired={windowExpired(doc)} busy={busy === 'resubmit'} onConfirm={() => void resubmitNew()} />
            </>
          )}
        </>
      )}
    </div>
  );
}
