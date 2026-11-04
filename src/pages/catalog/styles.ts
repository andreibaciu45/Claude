import type { CSSProperties } from 'react';

/** Stili di layout minimi (usano le variabili del design system con fallback). */
export const s = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px 96px', maxWidth: 720, margin: '0 auto' } as CSSProperties,
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } as CSSProperties,
  col: { display: 'flex', flexDirection: 'column', gap: 12 } as CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as CSSProperties,
  list: { display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 } as CSSProperties,
  muted: { color: 'var(--text-muted, #667085)', fontSize: 14 } as CSSProperties,
  title: { fontWeight: 600, fontSize: 16, lineHeight: 1.3 } as CSSProperties,
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 } as CSSProperties,
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 8px 0 12px', borderRadius: 999,
    background: 'var(--surface-2, #eef2f6)', border: '1px solid var(--border, #d0d5dd)', fontSize: 14,
  } as CSSProperties,
  chipBtn: { all: 'unset', cursor: 'pointer', minWidth: 28, minHeight: 28, textAlign: 'center', borderRadius: 999 } as CSSProperties,
  pill: (active: boolean): CSSProperties => ({
    minHeight: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
    border: '1px solid var(--border, #d0d5dd)', color: 'inherit',
    background: active ? 'var(--primary, #1d4ed8)' : 'var(--surface, transparent)',
    ...(active ? { color: 'var(--on-primary, #fff)', borderColor: 'transparent' } : {}),
  }),
  scrollRow: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 } as CSSProperties,
  pre: { fontFamily: 'ui-monospace, monospace', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre' } as CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as CSSProperties,
  box: { border: '1px solid var(--border, #d0d5dd)', borderRadius: 12, padding: 12 } as CSSProperties,
  error: { color: 'var(--danger, #b42318)', fontSize: 14 } as CSSProperties,
};

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
