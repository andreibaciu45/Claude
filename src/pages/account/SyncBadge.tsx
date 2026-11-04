import { Link } from 'react-router-dom';
import { Badge } from '../../ui';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { badgeView } from './format';

/**
 * Indicatore compatto dello stato di sincronizzazione. Non mostra nulla se non c'è un account
 * (l'app funziona senza). Pensato per header/tab bar; porta alla pagina /account.
 */
export function SyncBadge({ linkToAccount = true }: { linkToAccount?: boolean }) {
  const st = useSyncStatus();
  const v = badgeView(st);
  if (!v) return null;
  const inner = <Badge tone={v.tone}>{v.label}</Badge>;
  return (
    <span role="status" aria-live="polite" aria-label={`Sincronizzazione: ${v.label}`}>
      {linkToAccount ? <Link to="/account" style={{ textDecoration: 'none' }}>{inner}</Link> : inner}
    </span>
  );
}
export default SyncBadge;
