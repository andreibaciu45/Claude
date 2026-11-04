import type { DocLine } from '../../types';
import { fmtNum, fmtQty, isDiscountLine, lineAmount } from '../../pdf';
import { Money } from '../../ui';

/**
 * Riga della scheda documento. Una riga di SCONTO in euro (prezzo negativo) si mostra come "Sconto" con
 * l'importo negativo in evidenza, senza "quantità × prezzo" né IVA (colonne che per uno sconto non hanno senso).
 * Struttura `.dv-line-calc strong.num` invariata: serve ai test di coerenza dei totali.
 */
export function DocLineRow({ line: l, forfettario }: { line: DocLine; forfettario: boolean }) {
  if (isDiscountLine(l)) {
    return (
      <div className="dv-line dv-line-discount" role="listitem">
        <div className="dv-line-desc">{l.description?.trim() || 'Sconto'}</div>
        <div className="dv-line-calc">
          <span>Sconto (da detrarre dal totale)</span>
          <strong className="num"><Money value={lineAmount(l)} /></strong>
        </div>
      </div>
    );
  }
  return (
    <div className="dv-line" role="listitem">
      <div className="dv-line-desc">{l.description}</div>
      <div className="dv-line-calc">
        <span>
          {fmtQty(l.qty)} {l.unit} × {fmtNum(l.unitPrice)} €
          {l.discountPct ? ` (−${fmtNum(l.discountPct, l.discountPct % 1 ? 1 : 0)}%)` : ''}
          {!forfettario ? ` · IVA ${l.vat}%` : ''}
        </span>
        <strong className="num"><Money value={lineAmount(l)} /></strong>
      </div>
    </div>
  );
}
