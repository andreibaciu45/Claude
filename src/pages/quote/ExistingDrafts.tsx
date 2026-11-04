import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Skeleton } from '../../ui';
import { listDocuments } from '../../storage';
import type { QuoteDocument } from '../../types';
import { TYPE_LABEL } from './shared';

/**
 * Mostrata nella home quando il limite mensile del piano Free è raggiunto: non si possono creare nuovi documenti,
 * ma le bozze già salvate restano modificabili. Elenca le ultime bozze con un link diretto, così si capisce
 * subito come continuare a lavorare invece di trovarsi davanti a un vicolo cieco.
 */
export function ExistingDrafts() {
  const [drafts, setDrafts] = useState<QuoteDocument[] | null>(null);
  useEffect(() => {
    let alive = true;
    listDocuments()
      .then((all) => { if (alive) setDrafts(all.filter((d) => d.status === 'bozza').sort((a, b) => b.updatedAt - a.updatedAt)); })
      .catch(() => { if (alive) setDrafts([]); });
    return () => { alive = false; };
  }, []);

  if (!drafts) return <Skeleton lines={2} label="Cerco le tue bozze…" />;
  const shown = drafts.slice(0, 3);
  return (
    <Card>
      <section className="stack-sm qe-drafts" aria-labelledby="qe-drafts-title">
        <h2 id="qe-drafts-title" className="qe-drafts-title">Continua a lavorare sulle tue bozze</h2>
        {shown.length === 0 ? (
          <p className="muted qe-note">Non hai bozze da riprendere. Dai Documenti puoi aprire, scaricare e inviare quelli già creati.</p>
        ) : (
          <>
            <p className="muted qe-note">Le bozze si possono ancora modificare, anche senza nuovi documenti disponibili.</p>
            <ul className="qe-drafts-list">
              {shown.map((d) => (
                <li key={d.id}>
                  <Link to={`/documenti/${d.id}`} className="qe-draft-link">
                    <span className="qe-draft-name">{d.customer.name || 'Senza cliente'}</span>
                    <span className="muted">{TYPE_LABEL[d.type]}{d.number ? ` ${d.number}` : ' (bozza senza numero)'}</span>
                    <Badge tone="warning">bozza</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {drafts.length > shown.length && <Link to="/documenti">Vedi tutte le bozze ({drafts.length})</Link>}
      </section>
    </Card>
  );
}
