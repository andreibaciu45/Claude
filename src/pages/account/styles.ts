import type { CSSProperties } from 'react';

export const a = {
  page: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-4, 16px)', padding: '0 16px 96px', maxWidth: 640, margin: '0 auto' } as CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3, 12px)' } as CSSProperties,
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } as CSSProperties,
  between: { display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' } as CSSProperties,
  muted: { color: 'var(--c-text-2, #667085)', fontSize: 14, margin: 0 } as CSSProperties,
  h2: { fontSize: 18, margin: 0 } as CSSProperties,
  list: { display: 'flex', flexDirection: 'column', gap: 12, listStyle: 'none', margin: 0, padding: 0 } as CSSProperties,
  notice: {
    border: '1px solid var(--c-border, #d0d5dd)', background: 'var(--c-info-soft, #eef4ff)', borderRadius: 12,
    padding: '12px 14px', fontSize: 14, lineHeight: 1.45, margin: 0,
  } as CSSProperties,
  bar: { height: 8, borderRadius: 999, background: 'var(--c-surface-2, #eef2f6)', overflow: 'hidden' } as CSSProperties,
  barFill: (pct: number, full: boolean): CSSProperties => ({
    height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`,
    background: full ? 'var(--c-danger, #b42318)' : 'var(--c-primary, #1d4ed8)',
  }),
  error: { color: 'var(--c-danger, #b42318)', fontSize: 14, fontWeight: 600, margin: 0 } as CSSProperties,
  h3: { fontSize: 16, margin: 0 } as CSSProperties,
  hr: { border: 0, borderTop: '1px solid var(--c-border, #d0d5dd)', margin: '4px 0', width: '100%' } as CSSProperties,
  checkRow: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, cursor: 'pointer' } as CSSProperties,
  checkBox: { width: 22, height: 22, flex: '0 0 22px', marginTop: 1 } as CSSProperties,
  code: { letterSpacing: '0.4em', fontSize: 24, textAlign: 'center' } as CSSProperties,
};

export const PRIVACY_NOTICE =
  'Con un account i tuoi documenti e i dati dei tuoi clienti sono salvati sui nostri server (UE) per la sincronizzazione; senza account restano solo sul dispositivo.';
