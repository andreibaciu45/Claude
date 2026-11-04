/**
 * UI kit VocePreventivo (CSS in src/styles, importato da main.tsx).
 *
 * Export contrattuali (props invariate): Button, Card, Field, Input, Textarea, Select, Sheet, Badge,
 *   EmptyState, PageHeader, Money, ToastProvider, useToast.
 *
 * Export aggiuntivi:
 *   Icon({ name, size?, title? })        name: IconName (mic, file, plus, list, box, user, check, x, trash, edit, download, share, search, settings, alert, euro, send, copy, camera, info)
 *   IconButton(props: button props & { label: string; icon: IconName })   bottone icona 48px con aria-label
 *   MicButton({ state: 'idle'|'listening'|'processing', onClick, disabled?, label? })   microfono grande pulsante
 *   Stat({ label, value, hint? })
 *   Spinner({ label? })
 *   Chip({ selected?, onClick?, children })   pulsante-filtro (aria-pressed)
 *   Segmented<T extends string>({ value, onChange, options: {value:T,label:string}[], ariaLabel })
 *   useToast() -> (msg: string, tone?: 'info'|'success'|'error') => void
 *   utility CSS: .stack .stack-sm .row .row-between .grow .grid-2 .muted .num .sticky-actions .btn-block (Button className="btn-block")
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- Icone (SVG inline, stroke currentColor) ---------- */
const PATHS = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  download: <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  euro: <path d="M18 6.5A7 7 0 1 0 18 17.5M4 10h9M4 14h9" />,
  send: <path d="M21 3 3 10.5l7 3 3 7zM10 13.5 21 3" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
} satisfies Record<string, React.ReactNode>;
export type IconName = keyof typeof PATHS;

export const Icon = ({ name, size = 24, title }: { name: IconName; size?: number; title?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
    role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
    {PATHS[name]}
  </svg>
);

/* ---------- Contratto base ---------- */
export const Button = ({ variant = 'primary', size = 'md', className, type = 'button', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) => (
  <button type={type} className={cx('btn', className)} data-variant={variant} data-size={size} {...p} />
);

export const IconButton = ({ label, icon, className, type = 'button', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName }) => (
  <button type={type} className={cx('icon-btn', className)} aria-label={label} title={label} {...p}><Icon name={icon} /></button>
);

export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cx('card', className)}>{children}</div>;

export const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <small className="field-hint">{hint}</small>}
    {error && <small className="field-error" role="alert">{error}</small>}
  </label>
);

export const Input = ({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) => <input className={cx('input', className)} {...p} />;
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cx('textarea', className)} {...p} />;
export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx('select', className)} {...p} />;

export const Badge = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: React.ReactNode }) => (
  <span className="badge" data-tone={tone}>{children}</span>
);

export const EmptyState = ({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) => (
  <div className="empty">
    <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS.file}</svg>
    <h3>{title}</h3>
    {text && <p>{text}</p>}
    {action && <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div>}
  </div>
);

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <header className="page-header">
    <div className="grow">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </header>
);

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const Money = ({ value }: { value: number }) => <span className="money">{eur.format(Number.isFinite(value) ? value : 0)}</span>;

export const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="stat"><span className="stat-label">{label}</span><span className="stat-value">{value}</span>{hint && <span className="field-hint">{hint}</span>}</div>
);

export const Spinner = ({ label = 'Caricamento…' }: { label?: string }) => <span className="spinner" role="status" aria-label={label} />;

export const Chip = ({ selected, onClick, children }: { selected?: boolean; onClick?: () => void; children: React.ReactNode }) => (
  <button type="button" className="chip" aria-pressed={!!selected} onClick={onClick}>{children}</button>
);

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const MIC_LABELS = { idle: 'Tocca e detta il lavoro', listening: 'Ti ascolto… tocca per fermare', processing: 'Elaboro…' } as const;
export const MicButton = ({ state, onClick, disabled, label }: { state: 'idle' | 'listening' | 'processing'; onClick: () => void; disabled?: boolean; label?: string }) => (
  <div className="mic-wrap">
    <button type="button" className="mic" data-state={state} onClick={onClick} disabled={disabled || state === 'processing'}
      aria-pressed={state === 'listening'} aria-label={state === 'listening' ? 'Ferma dettatura' : 'Avvia dettatura'}>
      <Icon name="mic" size={56} />
    </button>
    <div className="mic-label" aria-live="polite">{label ?? MIC_LABELS[state]}</div>
  </div>
);

/* ---------- Sheet (bottom-sheet accessibile) ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const Sheet = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus],input,textarea,select') ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Chiudi" icon="x" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
};

/* ---------- Toast ---------- */
type ToastTone = 'info' | 'success' | 'error';
type ToastFn = (msg: string, tone?: ToastTone) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<{ id: number; msg: string; tone: ToastTone }[]>([]);
  const seq = useRef(0);
  const push = useCallback<ToastFn>((msg, tone = 'info') => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, msg, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => <div key={t.id} className="toast" data-tone={t.tone}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
};
