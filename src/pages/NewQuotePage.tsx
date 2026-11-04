import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogItem, Customer, DocLine, DocType, Profile, QuoteDocument } from '../types';
import { uid } from '../types';
import { getDocument, getProfile, listCatalog, nextDocumentNumber, saveDocument } from '../storage';
import { parseDictationWithContext, prepareCatalog } from '../engine';
import type { CustomerCandidate } from '../engine';
import { docBelongsTo, listCustomers, upsertCustomer, type StoredCustomer } from '../storage/customers';
import { listDocuments } from '../storage';
import { draftTotals } from '../pdf/totals';
import { Button, Card, EmptyState, Field, PageHeader, Segmented, Skeleton, Textarea, useToast, Money } from '../ui';
import { useSpeech } from '../hooks/useSpeech';
import { QuoteEditor } from './quote/QuoteEditor';
import { ExistingDrafts } from './quote/ExistingDrafts';
import { useHideVoiceFab } from '../voice/ui/fabVisibility';
import { InvoiceOptions } from './invoice/InvoiceOptions';
import { inferChannel, isLegacyInvoice, isLocked, newInvoiceFiscal, normalizeCustomerForInvoice } from './invoice/model';
import { clearDraft, loadDraft, saveDraft } from './quote/draft';
import { TYPE_LABEL, todayIso } from './quote/shared';
import { LimitGate } from '../billing/LimitGate';
import { UsageCounter } from '../billing/UsageCounter';
import { checkAllowanceNow, useDocumentAllowance } from '../billing/useAllowance';
import { usePlan } from '../billing/usePlan';
import { hasVoicePrivacyAck, setVoicePrivacyAck } from '../voice/privacy';
import { VoicePrivacyDialog } from '../voice/ui/VoicePrivacyDialog';
import { isNativeSpeechAvailable } from '../voice/provider/native';
import { recordDocumentCreated } from '../billing/usage';
import './quote/quote.css';
import './quote/customerPicker.css';

const EXAMPLE = 'preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera';
const join = (a: string, b: string) => (a && b ? `${a.replace(/\s+$/, '')} ${b}` : a || b);
const emptyCustomer = (): Customer => ({ id: uid(), name: '' });
/** Cliente di rubrica -> cliente del documento (copia dei dati; il campo legacy v1 resta vuoto). */
const fromBook = (c: StoredCustomer): Customer => { const { createdAt: _c, updatedAt: _u, ...rest } = c; return rest; };

/** Proposta dopo la dettatura: aggancio automatico (matched), suggerimento (weak) o scelta tra più clienti (ambiguous). */
interface CustomerHint { kind: 'matched' | 'weak' | 'ambiguous'; spoken: string; candidates: { id: string; name: string }[] }

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
  const [book, setBook] = useState<StoredCustomer[]>([]);
  const [saveToBook, setSaveToBook] = useState(true);
  const [hint, setHint] = useState<CustomerHint | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lineMeta, setLineMeta] = useState<Record<string, { note?: string; coats?: number; converted?: string }>>({});
  const [refPrev, setRefPrev] = useState(false);
  const [prevQuotes, setPrevQuotes] = useState<QuoteDocument[]>([]);
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
  const { allowance, reload: reloadAllowance } = useDocumentAllowance();
  const { signedIn } = usePlan();
  const [limitHit, setLimitHit] = useState(false);

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
    setLockedDoc(null);
    setOriginal(null);
    (async () => {
      try {
        const [p, c, b] = await Promise.all([getProfile(), listCatalog(), listCustomers().catch(() => [] as StoredCustomer[])]);
        if (!alive) return;
        setProfile(p);
        setCatalog(c);
        setBook(b);
        try { prepareCatalog(c); } catch { /* l'indice si costruisce alla prima dettatura */ }
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
  const draftSavedRef = useRef(false); // dopo il salvataggio del documento l'autosalvataggio della bozza locale non deve più scrivere
  useEffect(() => {
    if (!draftReady) return;
    const meaningful = text.trim() || lines.length || customer.name.trim() || notes.trim();
    const t = window.setTimeout(() => {
      if (draftSavedRef.current) return;
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
      const res = parseDictationWithContext(t, catalog, { customers: book.map((c) => ({ id: c.id, name: c.name })) });
      if (!res.lines.length && !res.customerName) {
        toast('Non ho riconosciuto nessuna voce. Prova con una frase più completa o compila a mano.');
        return;
      }
      const spoken = res.customerName ?? '';
      const m = res.customerMatch;
      const bound = m?.status === 'matched' ? book.find((c) => c.id === (res.customerId ?? m.id)) : undefined;
      if (bound) {
        setCustomer(fromBook(bound));
        setHint({ kind: 'matched', spoken, candidates: [{ id: bound.id, name: bound.name }] });
      } else {
        setCustomer((c) => ({ ...c, id: book.some((b) => b.id === c.id) ? uid() : c.id, name: res.customerName ?? c.name }));
        const cands: CustomerCandidate[] = (res.customerCandidates ?? []).slice(0, 3);
        setHint(m && (m.status === 'weak' || m.status === 'ambiguous') && cands.length ? { kind: m.status, spoken, candidates: cands.map((x) => ({ id: x.id, name: x.name })) } : null);
      }
      setLines(res.lines.map((l) => ({ ...l, id: l.id || uid() })));
      setLineMeta(res.lineMeta ?? {});
      setWarnings(res.warnings ?? []);
      setRefPrev(!!res.referencesPrevious);
      setLeftovers(res.leftovers ?? []);
      if (/\bfattur/i.test(t)) setType('fattura');
      setStage('edit');
      window.scrollTo({ top: 0 });
    } catch {
      toast('Non sono riuscito a interpretare il testo. Puoi compilare le righe a mano.');
    } finally {
      setInterpreting(false);
    }
  }, [catalog, book, toast]);

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

  // Informativa sul microfono: mostrata una sola volta prima del primo ascolto (come nel widget dei comandi).
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const startListening = () => {
    baseRef.current = text;
    sessionRef.current = true;
    speech.reset();
    speech.start();
  };
  const onMic = () => {
    if (speech.listening) { speech.stop(); return; }
    if (!hasVoicePrivacyAck()) { setPrivacyOpen(true); return; }
    startListening();
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
    setLines([]); setCustomer(emptyCustomer()); setNotes(''); setText(''); setLeftovers([]); setHint(null); setWarnings([]); setLineMeta({}); setRefPrev(false);
    baseRef.current = ''; speech.reset(); draftSavedRef.current = false; clearDraft(); setStage('input');
  };

  const pickCustomer = (c: Customer) => {
    const b = book.find((x) => x.id === c.id);
    setCustomer(b ? fromBook(b) : c);
    setCustomerError(undefined);
    setHint(null);
  };
  const rejectHint = () => {
    if (hint) setCustomer((c) => ({ ...c, id: uid(), name: hint.spoken || c.name }));
    setHint(null);
  };

  // «come da preventivo precedente»: propone i preventivi di riferimento (dello stesso cliente se noto)
  useEffect(() => {
    if (!refPrev) return;
    let alive = true;
    void listDocuments().then((all) => {
      if (!alive) return;
      const q = all.filter((d) => d.type === 'preventivo');
      const same = customer.name.trim() ? q.filter((d) => docBelongsTo(d, customer)) : [];
      setPrevQuotes((same.length ? same : q).slice(0, 5));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [refPrev, customer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyFrom = (d: QuoteDocument) => {
    setLines((cur) => [...cur, ...d.lines.map((l) => ({ ...l, id: uid() }))]);
    setRefPrev(false);
    toast(`Righe copiate da ${d.number}`);
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
      // Controllo definitivo del limite (limite morbido lato client, vedi src/billing/usage.ts). La bozza resta salvata.
      const fresh = await checkAllowanceNow();
      if (!fresh.canCreate) { setLimitHit(true); reloadAllowance(); setSaving(null); return; }
      const now = Date.now();
      const isInv = t === 'fattura';
      const date = isInv ? operationDate || todayIso() : todayIso();
      let cust = isInv ? normalizeCustomerForInvoice({ ...customer, name: customer.name.trim() }) : { ...customer, name: customer.name.trim() };
      // Rubrica: nuovo cliente salvato in automatico (se l'utente non l'ha escluso); se esiste già si completano solo i campi vuoti.
      // Un errore qui non blocca mai la creazione del documento.
      if (saveToBook) {
        try { const r = await upsertCustomer(cust); cust = { ...cust, id: r.customer.id }; } catch { /* rubrica non disponibile */ }
      }
      // Fattura fiscale: bozza SENZA numero (lo assegna issueInvoice). Nessuna chiamata a nextDocumentNumber.
      const doc: QuoteDocument = {
        id: uid(), type: t, number: isInv ? '' : await nextDocumentNumber(t), date,
        customer: cust, lines, notes: notes.trim() || undefined,
        status: 'bozza', transcript: text.trim() || undefined, createdAt: now, updatedAt: now,
        ...(isInv ? { invoice: newInvoiceFiscal({ date, customer: cust, stampDue: totals.stampDue, stampChargedToCustomer: stampCharged }) } : {}),
      };
      await saveDocument(doc);
      recordDocumentCreated(doc.id, doc.createdAt);
      draftSavedRef.current = true;
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

  /* ---------- microfono: uno solo per schermata ----------
   * Finché sulla home non c'è una scheda aperta (fase di dettatura, microfono grande visibile) il pulsante
   * flottante dei comandi vocali è nascosto; torna dentro la scheda, in caso di limite raggiunto e se il
   * dettato non è supportato (senza microfono grande). Vedi src/voice/ui/fabVisibility.ts. */
  const limitedNow = !original && (limitHit || (!!allowance && !allowance.canCreate));
  useHideVoiceFab(!editId && !loadError && !lockedDoc && stage === 'input' && !limitedNow && !speech.unsupported);

  /* ---------- render ---------- */
  if (loading) return <div className="stack"><Skeleton blocks={2} lines={3} label="Caricamento…" /></div>;
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
  // Solo i documenti NUOVI sono soggetti al limite: modifica e consultazione non lo sono mai.
  const gated = !editing && (limitHit || (!!allowance && !allowance.canCreate));
  const micState = speech.listening ? 'listening' : interpreting ? 'processing' : 'idle';

  return (
    <div className="stack">
      {privacyOpen && (
        <VoicePrivacyDialog
          variant={isNativeSpeechAvailable() ? 'native' : 'web'}
          onAccept={() => { setVoicePrivacyAck(); setPrivacyOpen(false); startListening(); }}
          onDecline={() => setPrivacyOpen(false)}
        />
      )}
      <PageHeader
        title={editing ? (original?.invoice && !original.invoice.legacy ? 'Modifica bozza di fattura' : `Modifica ${TYPE_LABEL[type].toLowerCase()} ${original?.number ?? ''}`) : stage === 'input' ? 'Nuovo preventivo' : type === 'fattura' ? 'Controlla la bozza di fattura' : 'Controlla e genera'}
        subtitle={stage === 'input' && !editing ? (gated ? 'Per questo mese i nuovi documenti gratuiti sono finiti: le bozze restano modificabili.' : 'Detta a voce o scrivi cliente, voci e quantità: preparo io la scheda.') : undefined}
        actions={stage === 'edit' && !editing ? <Button variant="ghost" size="sm" onClick={restart}>Ricomincia</Button> : undefined}
      />

      {!editing && <UsageCounter allowance={allowance} />}

      {gated && <LimitGate allowance={allowance} signedIn={signedIn} />}
      {gated && stage === 'input' && <ExistingDrafts />}

      {profileIncomplete && (
        <div className="qe-banner" role="note">
          Mancano ragione sociale o P.IVA: i documenti usciranno incompleti. <Link to="/profilo">Completa il profilo</Link>
        </div>
      )}

      {!gated && stage === 'input' && (
        <>
          <Card className="qe-mic-card">
            {speech.unsupported ? (
              <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
                Il dettato vocale non è disponibile su questo browser (prova Chrome o Safari). Nessun problema: scrivi qui sotto cliente, lavori e quantità e premi «Interpreta».
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

          <Field label="Testo del preventivo" hint="Puoi correggere il testo prima di interpretarlo. Oppure usa «Compila a mano» se preferisci partire da una scheda vuota.">
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
            <p className="muted qe-note">Il tuo catalogo è ancora vuoto: le voci dettate verranno segnate «da verificare» e senza prezzo. <Link to="/catalogo">Aggiungi le voci al catalogo</Link>.</p>
          )}
        </>
      )}

      {!gated && stage === 'edit' && (
        <>
          {!editing && (
            <Segmented<DocType>
              ariaLabel="Tipo di documento"
              value={type}
              onChange={setType}
              options={(['preventivo', 'fattura'] as DocType[]).map((v) => ({ value: v, label: TYPE_LABEL[v] }))}
            />
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

          {warnings.length > 0 && (
            <div className="qe-leftovers" role="status">
              <strong>Attenzione:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          {refPrev && (
            <div className="cp-banner" role="status">
              <span>Hai detto «come da preventivo precedente»: <strong>non ho copiato nulla</strong>. Scegli il preventivo di riferimento per aggiungere le sue righe, oppure ignora e compila a mano.</span>
              <div className="cp-banner-btns">
                {prevQuotes.map((d) => (
                  <Button key={d.id} size="sm" variant="secondary" onClick={() => copyFrom(d)}>{d.number} · {d.customer.name || 'senza cliente'}</Button>
                ))}
                {prevQuotes.length === 0 && <span className="muted">Non ci sono preventivi salvati.</span>}
                <Button size="sm" variant="ghost" onClick={() => setRefPrev(false)}>Ignora</Button>
              </div>
            </div>
          )}

          <QuoteEditor
            customers={book}
            onPickCustomer={pickCustomer}
            lineMeta={lineMeta}
            customerExtra={<>
              {hint?.kind === 'matched' && (
                <div className="cp-banner" role="status">
                  <span>Cliente in rubrica: <strong>{hint.candidates[0].name}</strong>. Ho compilato i suoi dati.</span>
                  <div className="cp-banner-btns"><Button size="sm" variant="ghost" onClick={rejectHint}>Non è lui{hint.spoken ? `: usa «${hint.spoken}»` : ''}</Button></div>
                </div>
              )}
              {hint && hint.kind !== 'matched' && (
                <div className="cp-banner" role="status">
                  <span>{hint.kind === 'ambiguous' ? `Ho trovato più clienti simili a «${hint.spoken}»: quale intendevi?` : `Intendevi ${hint.candidates[0].name}?`}</span>
                  <div className="cp-banner-btns">
                    {hint.candidates.map((c) => (
                      <Button key={c.id} size="sm" variant="secondary" onClick={() => pickCustomer({ id: c.id, name: c.name })}>{hint.kind === 'weak' ? `Sì, ${c.name}` : c.name}</Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => setHint(null)}>No, è un cliente nuovo</Button>
                  </div>
                </div>
              )}
              {!editing && customer.name.trim() && (
                <label className="cp-check">
                  <input type="checkbox" checked={saveToBook} onChange={(e) => setSaveToBook(e.target.checked)} />
                  <span>{book.some((b) => b.id === customer.id) ? 'Completa la scheda in rubrica con i dati nuovi' : 'Salva questo cliente in rubrica'}</span>
                </label>
              )}
            </>}
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
