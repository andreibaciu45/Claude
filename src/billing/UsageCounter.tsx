import { Link } from 'react-router-dom';
import type { Allowance } from './allowance';
import { isNativeApp } from './platform';

/** Contatore discreto "Documenti questo mese: 2/3" + avviso (non allarmistico) a 1 documento rimanente. Per il Pro non mostra nulla. */
export function UsageCounter({ allowance }: { allowance: Allowance | null }) {
  if (!allowance || allowance.limit === null) return null;
  const { used, limit, remaining } = allowance;
  const native = isNativeApp();
  return (
    <div style={{ margin: 0 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }} aria-live="polite">
        Documenti questo mese: {Math.min(used, limit)}/{limit}
      </p>
      {remaining === 1 && (
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }} role="note">
          Ti resta 1 documento gratuito questo mese.{' '}
          {native ? 'Puoi gestire il tuo abbonamento dal sito.' : <Link to="/account">Vedi il piano Pro</Link>}
        </p>
      )}
    </div>
  );
}
