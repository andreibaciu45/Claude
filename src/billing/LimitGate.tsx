import { Link } from 'react-router-dom';
import { Card } from '../ui';
import type { Allowance } from './allowance';
import { isNativeApp } from './platform';
import { FREE_DOCS_PER_MONTH, PRO_PRICE_MONTH, PRO_PRICE_YEAR, formatEur } from './pricing';
import { nextMonthStart } from './usage';

/**
 * Schermata gentile al raggiungimento del limite del piano Free. Nessuna dark pattern:
 * niente conto alla rovescia, niente colpevolizzazione, "continua a consultare" ben visibile e allo stesso peso.
 * App nativa: nessun prezzo né pulsante d'acquisto (Apple 3.1.1, docs/MOBILE.md §7).
 */
export function LimitGate({ signedIn, now = Date.now() }: { allowance?: Allowance | null; signedIn: boolean; now?: number }) {
  const native = isNativeApp();
  const resets = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' }).format(nextMonthStart(now));
  return (
    <Card>
      <div className="stack" role="region" aria-label="Limite del piano raggiunto">
        <h2 style={{ fontSize: 20, margin: 0 }}>Hai usato i {FREE_DOCS_PER_MONTH} documenti gratuiti di questo mese</h2>
        <p style={{ margin: 0 }}>
          Il piano Gratis include {FREE_DOCS_PER_MONTH} nuovi documenti al mese: il contatore riparte il {resets}.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Non perdi nulla: puoi sempre consultare, modificare e scaricare i tuoi documenti. Le fatture emesse restano
          accessibili e le puoi stornare con una nota di credito anche oltre il limite.
        </p>
        {native ? (
          <p style={{ margin: 0 }}>Gestisci il tuo abbonamento dal sito.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              Con il piano Pro i documenti sono illimitati e si sincronizzano su più dispositivi:{' '}
              {formatEur(PRO_PRICE_MONTH)} al mese oppure {formatEur(PRO_PRICE_YEAR)} all’anno. Disdici quando vuoi.
            </p>
            <Link className="btn" data-variant="primary" to="/account">
              {signedIn ? 'Passa a Pro' : 'Accedi o registrati per passare a Pro'}
            </Link>
          </>
        )}
        <Link className="btn" data-variant="secondary" to="/documenti">Continua a consultare i documenti</Link>
      </div>
    </Card>
  );
}
