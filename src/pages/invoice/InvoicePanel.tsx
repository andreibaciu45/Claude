import { Link } from 'react-router-dom';
import type { AuditEntry, QuoteDocument } from '../../types';
import { Badge, Button, Money } from '../../ui';
import type { DocTotals } from '../../pdf/totals';
import { fmtDate } from '../../pdf';
import {
  AUDIT_LABEL, CHANNEL_LABEL, OUTCOME_LABEL, PAYMENT_LABEL, PAYMENT_TONE, SDI_INFO, availableActions, daysSince, isCreditNote, paidAmount,
} from './model';
import type { Actions } from './model';
import { SDI_DEADLINE_WARNING } from './SdiSheets';

export interface Handlers {
  onDownloadXml: () => void; onGuide: () => void; onSend: () => void; onOutcome: () => void; onPayment: () => void; onCreditNote: () => void;
}

/** Badge di stato (fiscale + pagamento) di una fattura/nota di credito. */
export function InvoiceBadges({ doc }: { doc: QuoteDocument }) {
  const inv = doc.invoice!;
  const info = SDI_INFO[doc.status] ?? SDI_INFO.emessa;
  return (
    <span className="iv-badges">
      {isCreditNote(doc) && <Badge tone="info">Nota di credito</Badge>}
      <Badge tone={info.tone}>{info.label}</Badge>
      {!isCreditNote(doc) && doc.status !== 'bozza' && doc.status !== 'scartata' && <Badge tone={PAYMENT_TONE[inv.paymentStatus]}>{PAYMENT_LABEL[inv.paymentStatus]}</Badge>}
    </span>
  );
}

export interface PanelProps extends Handlers {
  doc: QuoteDocument;
  totals: DocTotals;
  busy: string | null;
  original?: QuoteDocument | null;
  creditNotes: QuoteDocument[];
  now?: Date;
}

/** Pannello di una fattura/nota di credito EMESSA (immutabile). */
export function InvoicePanel(p: PanelProps) {
  const { doc, totals, busy } = p;
  const inv = doc.invoice!;
  const a: Actions = availableActions(doc);
  const info = SDI_INFO[doc.status] ?? SDI_INFO.emessa;
  const paid = paidAmount(doc);
  const late = (doc.status === 'emessa' || doc.status === 'scartata') && daysSince(inv.operationDate, p.now) > 12;
  const nc = isCreditNote(doc);
  return (
    <section className="card iv-panel" aria-label="Stato della fattura elettronica">
      <div className="iv-badges"><InvoiceBadges doc={doc} /></div>
      <p className="iv-meaning">{info.meaning}</p>
      {late && <p className="iv-note" data-tone="warning" role="alert">Sono passati più di 12 giorni dalla data dell’operazione ({fmtDate(inv.operationDate)}): se non l’hai ancora trasmessa allo SDI verifica i termini con il tuo commercialista.</p>}
      {doc.status === 'scartata' && <p className="iv-note" data-tone="danger">Se lo scarto dipende da un dato sbagliato, il file va corretto e rigenerato: questa funzione non è ancora disponibile nell’app, chiedi al tuo commercialista.</p>}
      {!nc && doc.status !== 'bozza' && (
        <p className="iv-meaning" aria-label="Incassi">
          Incassato: <strong className="num"><Money value={paid} /></strong> su <strong className="num"><Money value={totals.gross} /></strong>
        </p>
      )}

      <div className="iv-links">
        {nc && inv.originalDocumentId && (
          <Link to={`/documenti/${inv.originalDocumentId}`}>Rettifica la fattura n. {p.original?.invoice?.number ?? inv.originalNumber ?? ''}{inv.originalDate ? ` del ${fmtDate(inv.originalDate)}` : ''}</Link>
        )}
        {p.creditNotes.map((c) => (
          <Link key={c.id} to={`/documenti/${c.id}`}>Stornata dalla nota di credito n. {c.invoice?.number ?? c.number}{c.invoice?.operationDate ? ` del ${fmtDate(c.invoice.operationDate)}` : ''}</Link>
        ))}
        {nc && inv.creditNoteReason && <span className="muted">Motivo: {inv.creditNoteReason}</span>}
      </div>

      <div className="dv-actions">
        {a.downloadXml && <Button className="span-2" onClick={p.onDownloadXml} disabled={!!busy || !inv.xml}>Scarica XML</Button>}
        {a.howToSend && <Button variant="secondary" className="span-2" onClick={p.onGuide}>Come inviarla allo SDI</Button>}
        {a.markSent && <Button variant="secondary" onClick={p.onSend} disabled={!!busy}>{doc.status === 'scartata' ? 'Segna come rinviata' : 'Segna come inviata'}</Button>}
        {a.recordOutcome && <Button variant="secondary" onClick={p.onOutcome} disabled={!!busy}>Registra esito SDI</Button>}
        {a.recordPayment && <Button variant="secondary" className="span-2" onClick={p.onPayment} disabled={!!busy}>Registra incasso</Button>}
        {a.creditNote && <Button variant="danger" className="span-2" onClick={p.onCreditNote} disabled={!!busy}>Annulla con nota di credito</Button>}
      </div>
      {(doc.status === 'emessa' || doc.status === 'inviata') && <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>{SDI_DEADLINE_WARNING}</p>}
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 0 }}>Documento emesso: non si può modificare né eliminare. Per annullarlo serve una nota di credito.</p>
    </section>
  );
}

const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

/** Cronologia: usa il registro (audit) se disponibile, altrimenti ricostruisce gli eventi dai dati della fattura. */
export function Timeline({ doc, audit, auditError }: { doc: QuoteDocument; audit: AuditEntry[] | null; auditError: boolean }) {
  const inv = doc.invoice!;
  const items: { at: number; title: string; detail?: string }[] = [];
  if (audit && audit.length) {
    for (const e of audit) items.push({ at: e.at, title: AUDIT_LABEL[e.action] ?? e.action, detail: e.detail });
  } else {
    items.push({ at: doc.createdAt, title: 'Bozza creata' });
    if (inv.issuedAt) items.push({ at: inv.issuedAt, title: `Emessa con il n. ${inv.number ?? ''}` });
    for (const ev of inv.sdiEvents) {
      items.push({
        at: ev.at, title: OUTCOME_LABEL[ev.type],
        detail: [CHANNEL_LABEL[ev.channel], ev.errorCodes?.length ? `codici: ${ev.errorCodes.join(', ')}` : '', ev.note ?? ''].filter(Boolean).join(' · '),
      });
    }
    for (const pay of inv.payments) items.push({ at: new Date(`${pay.date}T12:00:00`).getTime() || 0, title: `Incasso di ${pay.amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}`, detail: pay.method });
  }
  items.sort((x, y) => x.at - y.at);
  return (
    <section className="card stack-sm" aria-label="Cronologia">
      <h2 style={{ fontSize: 'var(--fs-lg)', margin: 0 }}>Cronologia</h2>
      {auditError && <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Il registro completo non è disponibile in questo momento: mostro gli eventi principali.</p>}
      {items.length === 0 ? <p className="muted">Nessun evento.</p> : (
        <ol className="iv-timeline">
          {items.map((it, i) => (
            <li key={`${it.at}-${i}`}>
              <strong>{it.title}</strong>
              <time dateTime={new Date(it.at).toISOString()}>{fmtDateTime(it.at)}</time>
              {it.detail && <span className="muted">{it.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
