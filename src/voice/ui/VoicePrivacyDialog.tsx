/** Informativa microfono: finestra modale accessibile (role="dialog"), ESC = «Preferisco scrivere». */
import { useEffect, useId, useRef } from 'react';
import { Button } from '../../ui';
import { VOICE_PRIVACY_TEXT, type VoicePrivacyVariant } from '../privacy';

export function VoicePrivacyDialog({ variant, onAccept, onDecline }: { variant: VoicePrivacyVariant; onAccept: () => void; onDecline: () => void }) {
  const t = VOICE_PRIVACY_TEXT[variant];
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const declineRef = useRef(onDecline);
  declineRef.current = onDecline;

  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); declineRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, []);

  return (
    <div className="sheet-overlay">
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="voice-privacy">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head"><h2 id={titleId}>{t.title}</h2></div>
        <div className="sheet-body vc-body">
          {t.paragraphs.map((p) => <p key={p} className="vc-hint">{p}</p>)}
          <Button data-autofocus size="lg" onClick={onAccept}>{t.accept}</Button>
          <Button variant="secondary" onClick={onDecline}>{t.decline}</Button>
        </div>
      </div>
    </div>
  );
}
