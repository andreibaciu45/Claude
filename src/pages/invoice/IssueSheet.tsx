import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Profile, QuoteDocument, ValidationIssue } from '../../types';
import { FORFETTARIO_TEXT, BOLLO_TEXT, fmtDate } from '../../pdf';
import type { DocTotals } from '../../pdf/totals';
import { Badge, Money, Sheet } from '../../ui';
import { HoldButton } from './HoldButton';
import { issueTarget, previewNumber, splitIssues } from './model';

export const DISCLAIMER =
  'Strumento di supporto: la responsabilità fiscale resta tua. Verifica i dati con il tuo commercialista.';

/** Avvisi puramente informativi: non c'è nulla da "correggere" cliccando. */
const NO_LINK = new Set(['stamp_due', 'stamp_recomputed', 'issue_term_exceeded', 'not_chronological', 'year_mismatch', 'vat_ignored']);

export const IssueIssues = ({ issues, docId, onNavigate, returnTo }: { issues: ValidationIssue[]; docId: string; onNavigate?: () => void; returnTo?: string }) => {
  if (!issues.length) return null;
  return (
    <ul className="iv-issues" aria-label="Controlli prima dell’emissione">
      {issues.map((i, k) => {
        const t = issueTarget(i.field, docId);
        return (
          <li key={`${i.field}-${i.code}-${k}`} className="iv-issue" data-sev={i.severity === 'error' ? 'error' : 'warning'}>
            <strong>{i.severity === 'error' ? 'Da correggere' : 'Attenzione'}</strong>
            <span>{i.message}</span>
            {/* returnTo: dal profilo si torna alla stessa fattura; la bozza è già salvata e non si perde */}
            {(i.severity === 'error' || !NO_LINK.has(i.code)) && <Link to={t.to} state={returnTo ? { returnTo } : undefined} onClick={onNavigate}>{t.label}</Link>}
          </li>
        );
      })}
    </ul>
  );
};

interface Props {
  open: boolean;
  onClose: () => void;
  doc: QuoteDocument;
  profile: Profile;
  totals: DocTotals;
  /** Problemi trovati prima di emettere (validazione locale + eventuale InvoiceValidationError). */
  issues: ValidationIssue[];
  busy: boolean;
  onIssue: () => void;
  /** Percorso a cui tornare dopo aver completato il profilo. */
  returnTo?: string;
}

export function IssueSheet({ open, onClose, doc, profile, totals, issues, busy, onIssue, returnTo }: Props) {
  const [ok, setOk] = useState(false);
  useEffect(() => { if (!open) setOk(false); }, [open]);
  const { errors } = splitIssues(issues);
  const inv = doc.invoice;
  const c = doc.customer;
  const taxId = [c.vatNumber && `P.IVA ${c.vatNumber}`, c.fiscalCode && `C.F. ${c.fiscalCode}`].filter(Boolean).join(' · ') || '—';
  const blocked = errors.length > 0;

  return (
    <Sheet open={open} onClose={onClose} title="Emetti fattura">
      <div className="stack">
        <p className="iv-note" data-tone="warning" role="note">L’emissione è definitiva. Controlla bene il riepilogo.</p>
        <dl className="iv-summary">
          <div><dt>Cliente</dt><dd>{c.name || '—'}</dd></div>
          <div><dt>Dati fiscali</dt><dd>{taxId}</dd></div>
          <div><dt>Data operazione</dt><dd>{fmtDate(inv?.operationDate ?? doc.date)}</dd></div>
          <div><dt>Imponibile</dt><dd className="num"><Money value={totals.net} /></dd></div>
          {totals.stampDue > 0 && (
            <div>
              <dt>Bollo da {totals.stampDue.toLocaleString('it-IT')} €</dt>
              <dd>{inv?.stampDutyChargedToCustomer ? 'addebitato al cliente' : 'a tuo carico'}</dd>
            </div>
          )}
          <div><dt>Totale documento</dt><dd className="num"><Money value={totals.gross} /></dd></div>
          <div><dt>Numero previsto</dt><dd>{previewNumber(doc, profile)} <Badge tone="neutral">anteprima non vincolante</Badge></dd></div>
        </dl>
        {profile.regimeForfettario && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>In fattura comparirà: “{FORFETTARIO_TEXT}”{totals.stampDue > 0 ? ` ${BOLLO_TEXT}` : ''}</p>}

        {issues.length > 0 && <IssueIssues issues={issues} docId={doc.id} onNavigate={onClose} returnTo={returnTo} />}
        {blocked && <p className="iv-note" data-tone="danger" role="alert">Correggi gli errori in rosso per poter emettere la fattura.</p>}

        <label className="iv-check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} disabled={blocked || busy} />
          <span>Ho verificato i dati: dopo l’emissione non si può modificare né cancellare, solo stornare con nota di credito. Confermo di essere in regime forfettario.</span>
        </label>

        <HoldButton label="Tieni premuto per emettere" variant="primary" disabled={blocked || !ok} busy={busy} onConfirm={onIssue} />
        <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>{DISCLAIMER}</p>
      </div>
    </Sheet>
  );
}
