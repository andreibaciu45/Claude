import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogItem, Customer, DocLine, DocType, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { getDocument, getProfile, listCatalog, nextDocumentNumber, saveDocument } from '../storage';
import { parseDictation } from '../engine';
import { draftTotals } from '../pdf/totals';
import { Button, Card, EmptyState, Field, PageHeader, Textarea, useToast, Money } from '../ui';
import { useSpeech } from '../hooks/useSpeech';
import { QuoteEditor } from './quote/QuoteEditor';
import { InvoiceOptions } from './invoice/InvoiceOptions';
import { inferChannel, isLegacyInvoice, isLocked, newInvoiceFiscal, normalizeCustomerForInvoice } from './invoice/model';
import { clearDraft, loadDraft, saveDraft } from './quote/draft';
import { TYPE_LABEL, todayIso } from './quote/shared';
import './quote/quote.css';

const EXAMPLE = 'preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera';
const join = (a: string, b: string) => (a && b ? `${a.replace(/\s+$/, '')} ${b}` : a || b);
const emptyCustomer = (): Customer => ({ id: uid(), name: '' });

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
  </svg>
);

export default function NewQuotePage() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const focusField = params.get('focus');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [original, setOriginal] = useState<QuoteDocument | null>(null);
  const [lockedDoc, setLockedDoc] = useState<QuoteDocument | null>(null);
  const [operationDate, setOperationDate] = useState(todayIso());
  const [stampCharged, setStampCharged] = useState(false);

  const [stage, setStage] = useState<'input' | 'edit'>('input');
  const [type, setType] = useState<DocType>('preventivo');
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState<Customer>(emptyCustomer);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [notes, setNotes] = useState('');
  const [leftovers, setLeftovers] = useState<string[]>([]);
  const [customerError, setCustomerError] = useState<string | undefined>();
  const [saving, setSaving] = useState<DocType | 'edit' | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const speech = useSpeech('it-IT');
  const baseRef = useRef('');
  const sessionRef = useRef(false);
  const textRef = useRef('');
  textRef.current = text;
  const wasListening = useRef(false);
  const skipAuto = useRef(false);
  const interpretRef = useRef<(t: string) => void>(() => {});
  const errorRef = useRef<string | null>(null);
  errorRef.current = speech.error;

  /* ---------- caricamento dati ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [p, c] = await Promise.all([getProfile(), listCatalog()]);
        if (!alive) return;
        setProfile(p);
        setCatalog(c);
        setStampCharged(!!p.stampDutyDefaultChargedToCustomer);
        if (editId) {
          const d = await getDocument(editId);
          if (!alive) return;
          if (!d) { setLoadError('Documento non trovato.'); }
          else if (isLocked(d)) { setLockedDoc(d); }
          else {
            if (d.invoice && !d.invoice.legacy) { setOperationDate(d.invoice.operationDate || d.date); setStampCharged(d.invoice.stampDutyChargedToCustomer); }
            setOriginal(d); setType(d.type); setCustomer(d.customer); setLines(d.lines);
            setNotes(d.notes ?? ''); setText(d.transcript ?? ''); setStage('edit');
          }
        } else {
          const dr = loadDraft();
          if (dr) {
            setStage(dr.stage); setType(dr.type); setText(dr.transcript); setCustomer(dr.customer);
            setLines(dr.lines); setNotes(dr.notes);
          }
        }
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Impossibile leggere i dati.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [editId, reloadKey]);

  /* ---------- bozza locale ---------- */
  const draftReady = !loading && !loadError && !editId;
  useEffect(() => {
    if (!draftReady) return;
    const meaningful = text.trim() || lines.length || customer.name.trim() || notes.trim();
    const t = window.setTimeout(() => {
      if (meaningful) saveDraft({ stage, type, transcript: text, customer, lines, notes, savedAt: Date.now() });
      else clearDraft();
    }, 400);
    return () => window.clearTimeout(t);
  }, [draftReady, stage, type, text, customer, lines, notes]);

  /* ---------- dettatura ---------- */
  useEffect(() => {
    if (sessionRef.current) setText(join(baseRef.current, speech.transcript));
  }, [speech.transcript]);

  const interpret = useCallback((raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setInterpreting(true);
    try {
      const res = parseDictation(t, catalog);
      if (!res.lines.length && !res.customerName) {
        toast('Non ho riconosciuto nessuna voce. Prova con una frase più completa o compila a mano.');
        return;
      }
      setCustomer((c) => ({ ...c, name: res.customerName ?? c.name }));
      setLines(res.lines.map((l) => ({ ...l, id: l.id || uid() })));
      setLeftovers(res.leftovers ?? []);
      if (/\bfattur/i.test(t)) setType('fattura');
      setStage('edit');
      window.scrollTo({ top: 0 });
    } catch {
      toast('Non sono riuscito a interpretare il testo. Puoi compilare le righe a mano.');
    } finally {
      setInterpreting(false);
    }
  }, [catalog, toast]);

  interpretRef.current = interpret;
  // Auto-interpretazione al termine della dettatura (piccolo ritardo per i risultati finali tardivi)
  useEffect(() => {
    if (speech.listening) { wasListening.current = true; return; }
    if (!wasListening.current) return;
    wasListening.current = false;
    sessionRef.current = true; // lascia aggiornare il testo con gli ultimi risultati
    const t = window.setTimeout(() => {
      sessionRef.current = false;
      if (skipAuto.current) { skipAuto.current = false; return; }
      if (!errorRef.current) interpretRef.current(textRef.current);
    }, 700);
    return () => window.clearTimeout(t);
  }, [speech.listening]);

  const onMic = () => {
    if (speech.listening) { speech.stop(); return; }
    baseRef.current = text;
    sessionRef.current = true;
    speech.reset();
    speech.start();
  };
  const onType = (v: string) => {
    sessionRef.current = false;
    baseRef.current = v;
    if (speech.listening) { skipAuto.current = true; speech.stop(); }
    speech.reset();
    setText(v);
  };

  /* ---------- totali ---------- */
  const forfettario = !!profile?.regimeForfettario;
  const totals = useMemo(() => draftTotals(lines, type, forfettario, stampCharged), [lines, forfettario, type, stampCharged]);
  const toReview = lines.filter((l) => l.needsReview).length;

  const restart = () => {
    if ((lines.length || customer.name) && !window.confirm('Ricominciare? Le righe attuali andranno perse.')) return;
    setLines([]); setCustomer(emptyCustomer()); setNotes(''); setText(''); setLeftovers([]);
    baseRef.current = ''; speech.reset(); clearDraft(); setStage('input');
  };

  const validate = (): boolean => {
    if (!customer.name.trim()) {
      setCustomerError('Inserisci il nome del cliente.');
      document.getElementById('qe-customer')?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    if (!lines.length) { toast('Aggiungi almeno una riga.'); return false; }
    setCustomerError(undefined);
    return true;
  };

  const generate = async (t: DocType) => {
    if (saving || !validate()) return;
    setSaving(t);
    try {
      const now = Date.now();
      const isInv = t === 'fattura';
      const date = isInv ? operationDate || todayIso() : todayIso();
      const cust = isInv ? normalizeCustomerForInvoice({ ...customer, name: customer.name.trim() }) : { ...customer, name: customer.name.trim() };
      // Fattura fiscale: bozza SENZA numero (lo assegna issueInvoice). Nessuna chiamata a nextDocumentNumber.
      const doc: QuoteDocument = {
        id: uid(), type: t, number: isInv ? '' : await nextDocumentNumber(t), date,
        customer: cust, lines, notes: notes.trim() || undefined,
        status: 'bozza', transcript: text.trim() || undefined, createdAt: now, updatedAt: now,
        ...(isInv ? { invoice: newInvoiceFiscal({ date, customer: cust, stampDue: totals.stampDue, stampChargedToCustomer: stampCharged }) } : {}),
      };
      await saveDocument(doc);
      clearDraft();
      nav(`/documenti/${doc.id}`);
    } catch (e) {
      toast(`Salvataggio non riuscito${e instanceof Error ? `: ${e.message}` : ''}`);
      setSaving(null);
    }
  };

  const saveEdit = async () => {
    if (!original || saving || !validate()) return;
    setSaving('edit');
    try {
      const isFiscalDraft = !!original.invoice && !original.invoice.legacy;
      const cust = isFiscalDraft ? normalizeCustomerForInvoice({ ...customer, name: customer.name.trim() }) : { ...customer, name: customer.name.trim() };
      const date = isFiscalDraft ? operationDate || original.date : original.date;
      await saveDocument({
        ...original, customer: cust, lines, notes: notes.trim() || undefined, date, updatedAt: Date.now(),
        ...(isFiscalDraft ? {
          invoice: {
            ...original.invoice!, operationDate: date, year: Number(date.slice(0, 4)) || original.invoice!.year,
            stampDuty: totals.stampDue > 0, stampAmount: totals.stampDue, stampDutyChargedToCustomer: stampCharged, customerChannel: inferChannel(cust),
          },
        } : {}),
      });
      toast('Modifiche salvate');
      nav(`/documenti/${original.id}`);
    } catch (e) {
      toast(`Salvataggio non riuscito${e instanceof Error ? `: ${e.message}` : ''}`);
      setSaving(null);
    }
  };

  /* ---------- focus sul campo indicato dai controlli pre-emissione ---------- */
  useEffect(() => {
    if (loading || !focusField || stage !== 'edit') return;
    const id = focusField === 'customer.name' ? 'qe-customer' : `f-${focusField}`;
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView?.({ block: 'center' });
      el.focus();
    }, 120);
    return () => window.clearTimeout(t);
  }, [loading, focusField, stage]);

  /* ---------- render ---------- */
  if (loading) return <div className="qe-loading" role="status" aria-label="Caricamento"><span className="spinner" /></div>;
  if (lockedDoc) {
    return (
      <EmptyState
        title="Documento emesso: non modificabile"
        text="Una fattura emessa non si può modificare né eliminare. Per annullarla emetti una nota di credito dalla pagina del documento."
        action={<Link className="btn" data-variant="primary" to={`/documenti/${lockedDoc.id}`}>Apri il documento</Link>}
      />
    );
  }
  if (loadError) {
    return (
      <EmptyState
        title="Qualcosa non va"
        text={loadError}
        action={<Button onClick={() => setReloadKey((k) => k + 1)}>Riprova</Button>}
      />
    );
  }

  const profileIncomplete = !!profile && (!profile.businessName.trim() || !profile.vatNumber.trim());
  const editing = !!original;
  const micState = speech.listening ? 'listening' : interpreting ? 'processing' : 'idle';

  return (
    <div className="stack">
      <PageHeader
        title={editing ? (original?.invoice && !original.invoice.legacy ? 'Modifica bozza di fattura' : `Modifica ${TYPE_LABEL[type].toLowerCase()} ${original?.number ?? ''}`) : stage === 'input' ? 'Nuovo preventivo' : type === 'fattura' ? 'Controlla la bozza di fattura' : 'Controlla e genera'}
        subtitle={stage === 'input' && !editing ? 'Detta a voce o scrivi: preparo io la scheda.' : undefined}
        actions={stage === 'edit' && !editing ? <Button variant="ghost" size="sm" onClick={restart}>Ricomincia</Button> : undefined}
      />

      {profileIncomplete && (
        <div className="qe-banner" role="note">
          Mancano ragione sociale o P.IVA: i documenti usciranno incompleti. <Link to="/profilo">Completa il profilo</Link>
        </div>
      )}

      {stage === 'input' && (
        <>
          <Card className="qe-mic-card">
            {speech.unsupported ? (
              <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
                Il dettato vocale non è disponibile su questo browser (prova Chrome o Safari). Scrivi il testo qui sotto.
              </p>
            ) : (
              <div className="mic-wrap">
                <button
                  type="button"
                  className="mic"
                  data-state={micState}
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? 'Termina la dettatura' : 'Inizia a dettare'}
                  onClick={onMic}
                  disabled={interpreting}
                >
                  <MicIcon />
                </button>
                <div className="mic-label" aria-live="polite">
                  {speech.listening ? 'Sto ascoltando… tocca per finire' : interpreting ? 'Interpreto…' : 'Tocca per dettare'}
                </div>
              </div>
            )}
            <div className="qe-live" aria-live="polite">
              {speech.listening && (
                speech.transcript
                  ? <><strong>{speech.finalText}</strong>{speech.interimText && <em> {speech.interimText}</em>}</>
                  : <em>Parla pure, ti ascolto…</em>
              )}
            </div>
            {speech.error && <div className="qe-error" role="alert">{speech.error}</div>}
          </Card>

          <Field label="Testo del preventivo" hint="Puoi correggere il testo prima di interpretarlo.">
            <Textarea
              rows={5}
              value={text}
              onChange={(e) => onType(e.target.value)}
              placeholder={EXAMPLE}
              aria-label="Testo del preventivo"
            />
          </Field>

          <div className="stack-sm">
            <Button size="lg" className="btn-block" onClick={() => interpret(text)} disabled={!text.trim() || interpreting || speech.listening}>
              Interpreta
            </Button>
            <Button variant="secondary" className="btn-block" onClick={() => { setStage('edit'); if (!lines.length) setLines([]); }}>
              Compila a mano
            </Button>
          </div>

          <div className="qe-example">
            <strong>Prova a dire:</strong> “{EXAMPLE}”
            <button type="button" onClick={() => onType(EXAMPLE)}>Usa questo esempio</button>
          </div>

          {catalog.length === 0 && (
            <p className="muted qe-note">Il tuo catalogo è vuoto: le voci dettate non avranno un prezzo. <Link to="/catalogo">Aggiungi le voci al catalogo</Link>.</p>
          )}
        </>
      )}

      {stage === 'edit' && (
        <>
          {!editing && (
            <div className="segmented qe-seg" role="radiogroup" aria-label="Tipo di documento">
              {(['preventivo', 'fattura'] as DocType[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
              ))}
            </div>
          )}
          {type === 'fattura' && !editing && <p className="muted qe-note">Salvi una bozza: il numero viene assegnato solo quando emetti la fattura (con conferma). La bozza si può ancora modificare ed eliminare.</p>}
          {editing && original && isLegacyInvoice(original) && <p className="muted qe-note">Fattura di cortesia (versione precedente): non è un documento fiscale.</p>}

          {text.trim() && (
            <details className="qe-details">
              <summary>Testo dettato</summary>
              <p className="muted">{text}</p>
            </details>
          )}
          {leftovers.length > 0 && (
            <div className="qe-leftovers">
              <strong>Non ho capito:</strong> {leftovers.map((l) => `“${l}”`).join(', ')}. Aggiungi queste voci a mano se servono.
            </div>
          )}
          {catalog.length === 0 && (
            <p className="muted qe-note">Catalogo vuoto: <Link to="/catalogo">aggiungi le tue voci</Link> per far trovare prezzi e unità in automatico.</p>
          )}

          <QuoteEditor
            type={type}
            customer={customer}
            onCustomer={(c) => { setCustomer(c); if (c.name.trim()) setCustomerError(undefined); }}
            lines={lines}
            onLines={setLines}
            notes={notes}
            onNotes={setNotes}
            totals={totals}
            forfettario={forfettario}
            defaultVat={profile?.defaultVat ?? 22}
            catalog={catalog}
            customerError={customerError}
            extra={type === 'fattura' && (!editing || (!!original?.invoice && !original.invoice.legacy)) ? (
              <InvoiceOptions operationDate={operationDate} onOperationDate={setOperationDate} stampCharged={stampCharged} onStampCharged={setStampCharged} stampDue={totals.stampDue} forfettario={forfettario} />
            ) : undefined}
          />

          <div className="sticky-actions qe-actions">
            <div className="qe-actions-info">
              <span>{toReview > 0 ? `${toReview} ${toReview === 1 ? 'riga da verificare' : 'righe da verificare'}` : `${lines.length} ${lines.length === 1 ? 'riga' : 'righe'}`}</span>
              <span>Totale <strong className="num"><Money value={totals.gross} /></strong></span>
            </div>
            {editing ? (
              <div className="qe-actions-btns">
                <Button variant="secondary" onClick={() => nav(`/documenti/${original!.id}`)} disabled={!!saving}>Annulla</Button>
                <Button onClick={saveEdit} disabled={!!saving}>{saving ? 'Salvo…' : 'Salva modifiche'}</Button>
              </div>
            ) : (
              <div className="qe-actions-btns" style={{ gridTemplateColumns: '1fr' }}>
                {type === 'fattura' ? (
                  <Button onClick={() => generate('fattura')} disabled={!!saving}>{saving === 'fattura' ? 'Salvo…' : 'Salva bozza fattura'}</Button>
                ) : (
                  <Button onClick={() => generate('preventivo')} disabled={!!saving}>{saving === 'preventivo' ? 'Salvo…' : 'Genera preventivo'}</Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
