import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Input } from '../../ui';

export const HOLD_MS = 1200;
export const FALLBACK_WORD = 'CONFERMO';

interface Props {
  label: string;
  onConfirm: () => void;
  variant?: 'primary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  durationMs?: number;
  /** Mostra l'alternativa per chi non riesce a tenere premuto (digitare la parola di conferma). */
  alternative?: boolean;
}

/**
 * Conferma a pressione prolungata. Touch/mouse: tieni premuto; tastiera: tieni premuti Spazio o Invio.
 * Alternativa chiara: digitare CONFERMO. Un semplice tocco NON conferma.
 */
export function HoldButton({ label, onConfirm, variant = 'danger', disabled, busy, durationMs = HOLD_MS, alternative = true }: Props) {
  const [progress, setProgress] = useState(0);
  const [tip, setTip] = useState(false);
  const [word, setWord] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const firedAt = useRef(0);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const hintId = useId();
  const off = !!disabled || !!busy;

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setProgress(0);
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => { if (off) stop(); }, [off, stop]);

  const start = () => {
    if (off || timer.current) return;
    setTip(false);
    startedAt.current = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - startedAt.current) / durationMs);
      setProgress(p);
      if (p >= 1) {
        stop();
        firedAt.current = Date.now();
        confirmRef.current();
      }
    }, 30);
  };

  const isKey = (k: string) => k === ' ' || k === 'Enter' || k === 'Spacebar';
  const secs = (durationMs / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 });
  const pct = Math.round(progress * 100);

  return (
    <div className="hold">
      <button
        type="button"
        className="btn hold-btn"
        data-variant={variant}
        data-holding={progress > 0 ? 'true' : undefined}
        disabled={off}
        aria-describedby={hintId}
        onPointerDown={(e) => { if (e.button === 0 || e.pointerType === 'touch') start(); }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (isKey(e.key)) { e.preventDefault(); if (!e.repeat) start(); } }}
        onKeyUp={(e) => { if (isKey(e.key)) { e.preventDefault(); stop(); } }}
        onBlur={stop}
        onClick={(e) => { e.preventDefault(); if (!off && progress === 0 && Date.now() - firedAt.current > 600) setTip(true); }}
      >
        <span className="hold-fill" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
        <span className="hold-label">{busy ? 'Attendi…' : progress > 0 ? `Continua a tenere premuto… ${pct}%` : label}</span>
      </button>
      <div role="progressbar" aria-label="Avanzamento della pressione" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="hold-sr" />
      <p id={hintId} className="hold-hint" data-alert={tip ? 'true' : undefined} aria-live="polite">
        {tip ? 'Un tocco non basta: tieni premuto il pulsante finché la barra si riempie.' : `Tieni premuto per ${secs} secondi (da tastiera: tieni premuto Spazio o Invio).`}
      </p>
      {alternative && (
        <details className="hold-alt">
          <summary>Non riesco a tenere premuto</summary>
          <div className="stack-sm">
            <label className="field-label" htmlFor={`${hintId}-w`}>Per confermare scrivi “{FALLBACK_WORD}”</label>
            <Input id={`${hintId}-w`} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="characters" disabled={off} />
            <Button variant={variant} disabled={off || word.trim().toUpperCase() !== FALLBACK_WORD} onClick={() => { setWord(''); onConfirm(); }}>
              {label} (con parola)
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
