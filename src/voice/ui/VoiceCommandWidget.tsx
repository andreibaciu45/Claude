/**
 * Widget globale dei comandi vocali: pulsante microfono flottante (sopra la tab bar) + bottom-sheet con ascolto,
 * "Intendevi…?", scelta del documento, scheda di conferma (pressione prolungata per le azioni irreversibili) e risultato.
 * Alternativa testuale sempre disponibile ("Scrivi un comando").
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Icon, Input, Sheet, Spinner, useToast } from '../../ui';
import { listCatalog, listDocuments } from '../../storage';
import { executeCommand, planCommand, VoiceExecError, type ExecContext } from '../executor';
import { describeCommand } from '../describe';
import { classifyCommand } from '../intents';
import {
  confirmByHold, confirmByTap, confirmByVoice, createConfirmation, decideIntent, gate, HOLD_CONFIRM_MS, UNDO_WINDOW_MS,
  VOICE_CONFIRM_TTL_MS, ConfirmationRequiredError, type Confirmation, type PendingConfirmation,
} from '../policy';
import { useVoiceInput } from '../provider';
import type { DocChoice } from '../resolve';
import type { Command, ScoredCommand } from '../types';
import { registerBusy, unregisterBusy, withBusy } from '../../pwa/busy';
import { EXAMPLE_GROUPS } from '../examples';
import { hasVoicePrivacyAck, setVoicePrivacyAck } from '../privacy';
import { isNativeSpeechAvailable } from '../provider/native';
import { useVoiceFabHidden } from './fabVisibility';
import { VoicePrivacyDialog } from './VoicePrivacyDialog';
import './voice.css';

const HELP_SEEN_KEY = 'vp.voiceHelpSeen';
const helpSeen = (): boolean => { try { return localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch { return false; } };
const markHelpSeen = (): void => { try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch { /* ignora */ } };

type View =
  | { kind: 'closed' }
  /** informativa microfono prima del primo ascolto; `back` = vista a cui tornare */
  | { kind: 'privacy'; back: View }
  | { kind: 'listen' }
  | { kind: 'working'; heard: string }
  | { kind: 'message'; tone: 'info' | 'error' | 'success'; title: string; text?: string; issues?: string[]; hint?: string; items?: DocChoice[] }
  | { kind: 'disambiguate'; heard: string; options: ScoredCommand[]; conflicting: boolean }
  | { kind: 'choose'; message: string; choices: Array<DocChoice & { command: Command }> }
  | { kind: 'confirm'; pending: PendingConfirmation };

export function VoiceCommandWidget() {
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const currentId = useMemo(() => /^\/documenti\/([^/]+)\/?$/.exec(loc.pathname)?.[1], [loc.pathname]);
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  const [view, setView] = useState<View>({ kind: 'closed' });
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const [undoBar, setUndoBar] = useState<{ message: string; undo: () => Promise<void> } | null>(null);
  const undoRef = useRef<{ message: string; undo: () => Promise<void> } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const transcriptRef = useRef('');
  const [kbOpen, setKbOpen] = useState(false);
  // Home in fase di dettatura: c'è già il microfono grande, il pulsante flottante resta nascosto (vedi fabVisibility.ts).
  const fabHidden = useVoiceFabHidden();
  const vocabRef = useRef<string[]>([]);

  /* ---------- tastiera virtuale: nasconde il pulsante flottante ---------- */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKbOpen(window.innerHeight - vv.height > 160);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  /* ---------- undo ---------- */
  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoRef.current = null;
    setUndoBar(null);
  }, []);
  const offerUndo = useCallback((message: string, undo: () => Promise<void>) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoRef.current = { message, undo };
    setUndoBar({ message, undo });
    undoTimer.current = setTimeout(clearUndo, UNDO_WINDOW_MS);
  }, [clearUndo]);
  const runUndo = useCallback(async () => {
    const u = undoRef.current;
    clearUndo();
    if (!u) { toast('Non c’è niente da annullare.'); return; }
    try { await u.undo(); toast('Azione annullata.', 'success'); } catch { toast('Non sono riuscito ad annullare.', 'error'); }
  }, [clearUndo, toast]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  /* ---------- esecuzione ---------- */
  const ctx = useCallback((): ExecContext => ({ currentDocumentId: currentRef.current, transcript: transcriptRef.current || undefined }), []);

  const finish = useCallback((r: Awaited<ReturnType<typeof executeCommand>>, tone: 'info' | 'success' = 'success') => {
    failures.current = 0;
    if (r.items) { setView({ kind: 'message', tone: 'info', title: r.message, items: r.items }); return; }
    setView({ kind: 'closed' });
    if (r.message) toast(r.message, tone);
    if (r.navigateTo) nav(r.navigateTo);
    if (r.undo) offerUndo(r.message || 'Fatto', r.undo);
  }, [nav, offerUndo, toast]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ConfirmationRequiredError) { setView({ kind: 'message', tone: 'error', title: 'Serve una conferma esplicita', text: e.message }); return; }
    const exec = e instanceof VoiceExecError ? e : null;
    setView({
      kind: 'message', tone: 'error', title: exec ? exec.message : 'Operazione non riuscita',
      text: exec ? undefined : e instanceof Error ? e.message : undefined, issues: exec?.issues.length ? exec.issues : undefined,
    });
  }, []);

  const runConfirmed = useCallback(async (p: PendingConfirmation, token: Confirmation) => {
    setView({ kind: 'working', heard: p.summary.headline });
    // 'voice-command': finché il comando è in esecuzione l'app non si ricarica (rilasciato sempre, anche in caso di errore)
    await withBusy('voice-command', async () => {
      try { finish(await executeCommand(p.command, ctx(), token)); } catch (e) { fail(e); }
    });
  }, [ctx, fail, finish]);

  const handleCommand = useCallback(async (command: Command) => {
    // controllo
    if (command.type === 'undo') { setView({ kind: 'closed' }); await runUndo(); return; }
    if (command.type === 'dismiss') { setView({ kind: 'closed' }); return; }
    if (command.type === 'affirm' || command.type === 'confirm') {
      setView({ kind: 'message', tone: 'info', title: 'Non c’è nessuna azione da confermare', text: 'Dimmi cosa vuoi fare, ad esempio «apri l’ultimo preventivo».' });
      return;
    }
    setView({ kind: 'working', heard: describeCommand(command) });
    await withBusy('voice-command', async () => {
      try {
        const plan = await planCommand(command, ctx());
        if (plan.status === 'blocked') { setView({ kind: 'message', tone: 'error', title: plan.message, issues: plan.issues, hint: plan.hint }); return; }
        if (plan.status === 'choose') { setView({ kind: 'choose', message: plan.message, choices: plan.choices }); return; }
        const g = gate(plan.command, plan.target);
        if (g.kind === 'execute') { finish(await executeCommand(plan.command, ctx())); return; }
        setView({ kind: 'confirm', pending: createConfirmation(plan.command, plan.summary) });
      } catch (e) { fail(e); }
    });
  }, [ctx, fail, finish, runUndo]);

  const handleTranscript = useCallback(async (text: string, nBest: string[] = []) => {
    const t = text.trim();
    if (!t) return;
    transcriptRef.current = t;
    const cur = viewRef.current;
    const cl = classifyCommand(t, { currentDocumentId: currentRef.current, nBest });

    // c'è una scheda di conferma a schermo: solo la frase esplicita (o "annulla") conta
    if (cur.kind === 'confirm') {
      const p = cur.pending;
      if (cl.command?.type === 'dismiss') { setView({ kind: 'closed' }); return; }
      if (p.level === 'tap' && cl.command?.type === 'affirm') {
        const tok = confirmByTap(p);
        if (tok) { await runConfirmed(p, tok); return; }
      }
      const tok = confirmByVoice(p, cl, { screenVisible: document.visibilityState === 'visible' });
      if (tok) { await runConfirmed(p, tok); return; }
      toast(cl.command?.type === 'affirm'
        ? 'Un semplice «sì» non basta: tieni premuto il pulsante oppure di’ «' + (p.what === 'issue' ? 'conferma emissione' : 'conferma storno') + '».'
        : 'Per confermare tieni premuto il pulsante oppure di’ «' + (p.what === 'issue' ? 'conferma emissione' : 'conferma storno') + '».', 'info');
      return;
    }

    const d = decideIntent(cl);
    if (d.kind === 'proceed') { failures.current = 0; await handleCommand(d.command); return; }
    if (d.kind === 'disambiguate') {
      setView({ kind: 'disambiguate', heard: t, options: d.options, conflicting: d.reason === 'conflicting-intent' });
      return;
    }
    failures.current += 1;
    setView({
      kind: 'message', tone: 'error', title: 'Non ho capito il comando', text: `«${t}»`,
      hint: failures.current >= 3 ? 'Se il riconoscimento vocale ti dà problemi, scrivi il comando qui sotto.' : 'Prova con una frase più semplice, ad esempio «apri l’ultimo preventivo».',
    });
  }, [handleCommand, runConfirmed, toast]);

  const handleRef = useRef(handleTranscript);
  handleRef.current = handleTranscript;

  /* ---------- voce ---------- */
  const voice = useVoiceInput(
    (text, alts) => { void handleRef.current(text, alts); },
    () => vocabRef.current,
  );

  const ensureVocab = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([listCatalog(), listDocuments()]);
      vocabRef.current = [...new Set([...c.flatMap((i) => [i.name, ...i.aliases]), ...d.map((x) => x.customer?.name).filter(Boolean)])].slice(0, 200);
    } catch { /* il vocabolario è solo un aiuto */ }
  }, []);

  const beginListening = useCallback(() => {
    if (viewRef.current.kind === 'closed') setView({ kind: 'listen' });
    void ensureVocab();
    voice.start();
  }, [ensureVocab, voice]);

  const startListening = useCallback(() => {
    const cur = viewRef.current;
    if (cur.kind === 'privacy') return; // l'informativa è già a schermo
    if (voice.listening || voice.state === 'processing') return; // doppio avvio
    // informativa sul microfono: una sola volta, prima del primo ascolto (se non c'è microfono non serve)
    if (voice.kind !== 'none' && !hasVoicePrivacyAck()) { setView({ kind: 'privacy', back: cur }); return; }
    beginListening();
  }, [beginListening, voice.kind, voice.listening, voice.state]);

  const leavePrivacy = useCallback((): void => {
    const cur = viewRef.current;
    const back = cur.kind === 'privacy' ? cur.back : cur;
    setView(back.kind === 'closed' || back.kind === 'privacy' ? { kind: 'listen' } : back);
  }, []);
  const acceptPrivacy = useCallback(() => {
    setVoicePrivacyAck();
    leavePrivacy();
    void ensureVocab();
    voice.start();
  }, [ensureVocab, leavePrivacy, voice]);
  const declinePrivacy = leavePrivacy;

  const stopListening = useCallback(() => { voice.stop(); }, [voice]);

  // errori del provider: si mostrano nella vista corrente
  useEffect(() => {
    if (voice.error && viewRef.current.kind === 'closed') setView({ kind: 'listen' });
  }, [voice.error]);

  // schermo spento/pagina nascosta: una scheda irreversibile si chiude (niente conferme "a ritroso")
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') {
        voice.cancel();
        const v = viewRef.current;
        if (v.kind === 'confirm' && v.pending.level === 'explicit') setView({ kind: 'closed' });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [voice]);

  // cambio rotta durante l'ascolto o con una scheda aperta: si ferma il microfono e si chiude ciò che riguardava la pagina
  // precedente (un comando in esecuzione, "working", prosegue e porta da solo alla rotta di destinazione)
  const lastPath = useRef(loc.pathname);
  useEffect(() => {
    if (lastPath.current === loc.pathname) return;
    lastPath.current = loc.pathname;
    voice.cancel();
    const v = viewRef.current;
    if (v.kind !== 'closed' && v.kind !== 'working') setView({ kind: 'closed' });
  }, [loc.pathname, voice]);

  // la scheda si chiude da sola dopo un minuto
  useEffect(() => {
    if (view.kind !== 'confirm') return;
    const t = setTimeout(() => setView({ kind: 'closed' }), Math.max(0, view.pending.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [view]);

  /* ---------- pulsante flottante: tocco = on/off, tenere premuto = push-to-talk ---------- */
  const down = useRef<{ at: number; wasListening: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    down.current = { at: Date.now(), wasListening: voice.listening };
    if (!voice.listening) startListening();
  };
  const onPointerUp = () => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    if (d.wasListening || Date.now() - d.at > 600) stopListening();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      if (voice.listening) stopListening(); else startListening();
    }
  };

  const close = () => {
    voice.cancel();
    setView({ kind: 'closed' });
  };

  const fabState = voice.state === 'processing' || view.kind === 'working' ? 'processing' : voice.listening ? 'listening' : 'idle';
  const sheetTitle = {
    closed: '', privacy: '', listen: 'Comando vocale', working: 'Un attimo…', message: 'Comando vocale', disambiguate: 'Intendevi…?', choose: 'Quale documento?',
    confirm: view.kind === 'confirm' ? view.pending.summary.headline : '',
  }[view.kind];

  return (
    <>
      <button
        type="button" className="vc-fab" hidden={fabHidden} data-state={fabState} data-kb={kbOpen ? 'open' : undefined}
        aria-label={voice.listening ? 'Ferma il comando vocale' : 'Comando vocale: tocca o tieni premuto per parlare'}
        aria-pressed={voice.listening}
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown} onClick={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name="mic" size={28} />
      </button>

      {undoBar && view.kind === 'closed' && (
        <div className="vc-undo" role="status" aria-live="polite">
          <div className="vc-undo-inner">
            <span>{undoBar.message}</span>
            <button type="button" onClick={() => void runUndo()}>Annulla</button>
          </div>
        </div>
      )}

      {view.kind === 'privacy' && (
        <VoicePrivacyDialog variant={isNativeSpeechAvailable() ? 'native' : 'web'} onAccept={acceptPrivacy} onDecline={declinePrivacy} />
      )}

      <Sheet open={view.kind !== 'closed' && view.kind !== 'privacy'} onClose={close} title={sheetTitle}>
        <div className="vc-body">
          {view.kind === 'listen' && (
            <ListenView
              listening={voice.listening} processing={voice.state === 'processing'} partial={voice.partial} error={voice.error}
              noVoice={voice.kind === 'none'} usesServer={voice.usesServer} canRetry={voice.canRetry}
              preferRecorder={voice.preferRecorder} onPrefer={voice.setPreferRecorder} onRetry={voice.retry}
              onStart={startListening} onStop={stopListening} onSubmit={(t) => { voice.cancel(); void handleTranscript(t); }}
            />
          )}
          {view.kind === 'working' && <div className="row" role="status"><Spinner label="Elaboro" /><span>{view.heard}</span></div>}
          {view.kind === 'message' && (
            <MessageView v={view} onOpen={(id) => { setView({ kind: 'closed' }); nav(`/documenti/${id}`); }} onSubmit={(t) => void handleTranscript(t)} onClose={close} />
          )}
          {view.kind === 'disambiguate' && (
            <div className="vc-body">
              <p className="vc-hint">Ho sentito: «{view.heard}»{view.conflicting ? '. Per un’azione importante preferisco essere sicuro.' : '.'}</p>
              <div className="vc-options">
                {view.options.map((o, i) => (
                  <button key={i} type="button" className="vc-option" data-danger={o.command.type === 'issue_invoice' || o.command.type === 'credit_note'} onClick={() => void handleCommand(o.command)}>
                    {describeCommand(o.command)}
                    {(o.command.type === 'issue_invoice' || o.command.type === 'credit_note') && <small>Ti mostrerò il riepilogo e chiederò conferma.</small>}
                  </button>
                ))}
                <button type="button" className="vc-option" onClick={() => setView({ kind: 'listen' })}>Nessuno dei due: riprovo</button>
              </div>
            </div>
          )}
          {view.kind === 'choose' && (
            <div className="vc-body">
              <p className="vc-hint">{view.message}</p>
              <div className="vc-options">
                {view.choices.map((c) => (
                  <button key={c.id} type="button" className="vc-option" onClick={() => void handleCommand(c.command)}>
                    {c.label}
                    <small>{c.customer || 'Senza cliente'} · {c.date.split('-').reverse().join('/')} · {c.status}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {view.kind === 'confirm' && (
            <ConfirmView
              pending={view.pending}
              onTap={() => { const t = confirmByTap(view.pending); if (t) void runConfirmed(view.pending, t); }}
              onHold={(ms) => { const t = confirmByHold(view.pending, ms); if (t) void runConfirmed(view.pending, t); }}
              onListen={startListening} onStop={stopListening} listening={voice.listening} partial={voice.partial}
              onSubmit={(t) => void handleTranscript(t)} onCancel={close}
            />
          )}
        </div>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ sottocomponenti */

function CommandForm({ onSubmit, placeholder = 'Scrivi un comando…', label = 'Scrivi un comando' }: { onSubmit: (t: string) => void; placeholder?: string; label?: string }) {
  const [v, setV] = useState('');
  return (
    <form className="vc-form" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v); setV(''); } }}>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} autoComplete="off" autoCapitalize="sentences" enterKeyHint="send" />
      <Button type="submit" variant="secondary" disabled={!v.trim()}>Invia</Button>
    </form>
  );
}

function ListenView(p: {
  listening: boolean; processing: boolean; partial: string; error: string | null; noVoice: boolean; usesServer: boolean; canRetry: boolean;
  preferRecorder: boolean; onPrefer: (v: boolean) => void; onRetry: () => void; onStart: () => void; onStop: () => void; onSubmit: (t: string) => void;
}) {
  return (
    <>
      {p.noVoice ? (
        <p className="vc-warn">Questo dispositivo non supporta il riconoscimento vocale: scrivi il comando.</p>
      ) : (
        <>
          <Button data-autofocus variant={p.listening ? 'danger' : 'primary'} size="lg" onClick={p.listening ? p.onStop : p.onStart} disabled={p.processing}>
            <Icon name="mic" /> {p.processing ? 'Trascrivo…' : p.listening ? 'Ti ascolto… tocca per inviare' : 'Parla'}
          </Button>
          <div className="vc-live" data-empty={!p.partial} role="status" aria-live="polite">
            {p.processing ? 'Invio l’audio per la trascrizione…' : p.partial || (p.listening ? 'Parla pure…' : 'Tocca «Parla» e dì un comando.')}
          </div>
        </>
      )}
      {p.error && (
        <div role="alert" className="vc-danger">
          {p.error}
          {p.canRetry && <div style={{ marginTop: 'var(--sp-2)' }}><Button size="sm" variant="secondary" onClick={p.onRetry}>Riprova a inviare</Button></div>}
        </div>
      )}
      <CommandForm onSubmit={p.onSubmit} />
      {!p.noVoice && (
        <label className="vc-check">
          <input type="checkbox" checked={p.preferRecorder} onChange={(e) => p.onPrefer(e.target.checked)} />
          <span className="vc-hint">Cantiere rumoroso: registra e trascrivi con il server{p.usesServer ? ' (attivo)' : ''}</span>
        </label>
      )}
      <HelpPanel />
    </>
  );
}

/** «Cosa posso dire?»: aperto al primo uso, poi richiamabile con il pulsante. Esempi verificati contro il classificatore. */
function HelpPanel() {
  const [open, setOpen] = useState(() => !helpSeen());
  const id = useId();
  useEffect(() => { if (open) markHelpSeen(); }, [open]);
  return (
    <div className="vc-help">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="info" size={18} /> Cosa posso dire?
      </Button>
      {open && (
        <div id={id} role="region" aria-label="Cosa posso dire?">
          {EXAMPLE_GROUPS.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="vc-help-title">{g.title}</h3>
              <ul className="vc-examples">{g.items.map((x) => <li key={x.say}>«{x.say}»{x.note ? <small> — {x.note}</small> : null}</li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageView({ v, onOpen, onSubmit, onClose }: {
  v: Extract<View, { kind: 'message' }>; onOpen: (id: string) => void; onSubmit: (t: string) => void; onClose: () => void;
}) {
  return (
    <>
      <div className={v.tone === 'error' ? 'vc-danger' : 'vc-live'} role={v.tone === 'error' ? 'alert' : 'status'} data-empty="false">
        <strong>{v.title}</strong>
        {v.text && <div>{v.text}</div>}
        {v.issues && <ul className="vc-issues">{v.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        {v.hint && <div style={{ marginTop: 'var(--sp-2)', fontWeight: 500 }}>{v.hint}</div>}
      </div>
      {v.items && (
        <ul className="vc-result-list">
          {v.items.map((c) => (
            <li key={c.id}>
              <button type="button" className="vc-option" style={{ width: '100%' }} onClick={() => onOpen(c.id)}>
                {c.label}<small>{c.customer || 'Senza cliente'} · {c.date.split('-').reverse().join('/')} · {c.status}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CommandForm onSubmit={onSubmit} />
      <Button variant="ghost" onClick={onClose}>Chiudi</Button>
    </>
  );
}

function ConfirmView({ pending, onTap, onHold, onListen, onStop, listening, partial, onSubmit, onCancel }: {
  pending: PendingConfirmation; onTap: () => void; onHold: (ms: number) => void; onListen: () => void; onStop: () => void;
  listening: boolean; partial: string; onSubmit: (t: string) => void; onCancel: () => void;
}) {
  const explicit = pending.level === 'explicit';
  const phrase = pending.what === 'issue' ? 'conferma emissione' : 'conferma storno';
  const [voiceLeft, setVoiceLeft] = useState(() => Math.max(0, pending.createdAt + VOICE_CONFIRM_TTL_MS - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setVoiceLeft(Math.max(0, pending.createdAt + VOICE_CONFIRM_TTL_MS - Date.now())), 500);
    return () => clearInterval(t);
  }, [pending]);

  return (
    <div className="vc-card" data-level={pending.level}>
      <dl className="vc-dl">
        {pending.summary.fields.map((f) => (
          <div key={f.label} style={{ display: 'contents' }}>
            <dt>{f.label}</dt><dd data-big={f.label === 'Importo'}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {pending.summary.warnings.map((w) => <p key={w} className="vc-warn">{w}</p>)}
      {pending.summary.consequence && <p className={explicit ? 'vc-danger' : 'vc-hint'}>{pending.summary.consequence}</p>}
      {explicit ? (
        <>
          <HoldButton label={pending.what === 'issue' ? 'Tieni premuto per emettere' : 'Tieni premuto per stornare'} onComplete={onHold} />
          <p className="vc-hint">Oppure di’ «{phrase}»{voiceLeft > 0 ? ` (ancora ${Math.ceil(voiceLeft / 1000)} s)` : ': tempo scaduto, usa il pulsante'}. Un semplice «sì» non basta.</p>
          <div className="vc-actions">
            <Button variant="secondary" onClick={listening ? onStop : onListen} disabled={voiceLeft <= 0}><Icon name="mic" /> {listening ? 'Invia' : 'Parla'}</Button>
            <Button variant="ghost" onClick={onCancel}>Annulla</Button>
          </div>
          {listening && <div className="vc-live" data-empty={!partial} aria-live="polite">{partial || 'Ti ascolto…'}</div>}
          <CommandForm onSubmit={onSubmit} placeholder={`Oppure scrivi: ${phrase}`} label="Scrivi la frase di conferma" />
        </>
      ) : (
        <div className="vc-actions">
          <Button onClick={onTap} data-autofocus>Conferma</Button>
          <Button variant="ghost" onClick={onCancel}>Annulla</Button>
        </div>
      )}
      {pending.summary.warnings.length > 0 && <Badge tone="warning">Controlla gli avvisi prima di confermare</Badge>}
    </div>
  );
}

/**
 * Pulsante a pressione prolungata: conferma solo dopo HOLD_CONFIRM_MS di pressione continua (tocco, mouse o tasto Invio/Spazio).
 * Per tutta la pressione è registrato il lavoro 'hold-confirm' (l'app non si aggiorna a metà); il rilascio avviene in UN solo punto
 * (`release`) ed è garantito: rilascio, pointercancel, perdita del fuoco/della pagina, ESC, completamento e smontaggio.
 */
function HoldButton({ label, onComplete }: { label: string; onComplete: (heldMs: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const done = useRef(false);
  const registered = useRef(false);
  const release = () => {
    start.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    ref.current?.style.setProperty('--hold', '0');
    if (registered.current) { registered.current = false; unregisterBusy('hold-confirm'); }
  };
  const tick = () => {
    if (start.current === null) return;
    const held = performance.now() - start.current;
    ref.current?.style.setProperty('--hold', String(Math.min(1, held / HOLD_CONFIRM_MS)));
    if (held >= HOLD_CONFIRM_MS && !done.current) {
      done.current = true;
      // prima si avvia il comando (registra 'voice-command'), poi si rilascia 'hold-confirm': nessun varco in cui l'app risulti libera
      try { onComplete(held); } finally { release(); }
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (start.current !== null || done.current) return;
    start.current = performance.now();
    if (!registered.current) { registered.current = true; registerBusy('hold-confirm'); }
    raf.current = requestAnimationFrame(tick);
  };
  const cancelHold = () => { release(); done.current = false; };
  const releaseRef = useRef(cancelHold);
  releaseRef.current = cancelHold;
  useEffect(() => {
    const off = () => releaseRef.current();
    const onVis = () => { if (document.visibilityState !== 'visible') off(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') off(); };
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('blur', off);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('keydown', onKey, true);
      releaseRef.current(); // smontaggio (chiusura scheda, cambio rotta, scadenza)
    };
  }, []);
  return (
    <button
      ref={ref} type="button" className="vc-hold" aria-describedby="vc-hold-help"
      onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); begin(); }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onLostPointerCapture={cancelHold} onPointerLeave={cancelHold} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') cancelHold(); }}
      onBlur={cancelHold}
    >
      <span>{label}</span>
      <span id="vc-hold-help" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Tieni premuto per un secondo senza rilasciare.</span>
    </button>
  );
}

export default VoiceCommandWidget;
