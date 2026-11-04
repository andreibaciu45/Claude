import type { SyncStatus } from '../../sync/engine';

export function relativeTime(ts: number | null, now = Date.now()): string {
  if (!ts) return 'mai';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'adesso';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 ora fa' : `${h} ore fa`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ieri' : `${d} giorni fa`;
}

export interface BadgeView { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }

/** Etichetta e tono del badge per uno stato di sync (testabile). Null = non connesso. */
export function badgeView(s: Pick<SyncStatus, 'signedIn' | 'phase' | 'pendingOps' | 'conflicts' | 'migration'>): BadgeView | null {
  if (!s.signedIn) return null;
  if (s.migration) return { label: 'Da avviare', tone: 'info' };
  switch (s.phase) {
    case 'syncing': return { label: 'Sincronizzo…', tone: 'info' };
    case 'offline': return { label: s.pendingOps ? `Offline · ${s.pendingOps} in coda` : 'Offline', tone: 'warning' };
    case 'error': return { label: 'Errore sync', tone: 'danger' };
    case 'conflict': return { label: `${s.conflicts.length} ${s.conflicts.length === 1 ? 'conflitto' : 'conflitti'}`, tone: 'danger' };
    default: return s.pendingOps ? { label: `${s.pendingOps} da inviare`, tone: 'neutral' } : { label: 'Sincronizzato', tone: 'success' };
  }
}
