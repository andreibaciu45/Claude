/**
 * Registro fatture, statistiche per il forfettario e CSV per il commercialista. Logica PURA (nessun accesso allo storage).
 * Tutti gli importi passano da `documentTotals` (centesimi, lo stesso calcolo di scheda, PDF e XML).
 * Ipotesi [DA VERIFICARE col commercialista]: i ricavi del forfettario sono "per cassa" = somma degli INCASSI registrati
 * in app (data incasso nell'anno); le note di credito non vengono sottratte (il rimborso non è tracciato) e non sono
 * inclusi ricavi non fatturati in app.
 */
import type { QuoteDocument } from '../../types';
import { documentTotals } from '../../pdf/totals';
import { SDI_INFO, isCreditNote, isFiscalInvoice } from './model';

/** Soglia dei ricavi del regime forfettario [DA VERIFICARE]. */
export const FORFETTARIO_THRESHOLD = 85_000;
export const WARN_RATIO = 0.8;

/** Fattura/nota emessa e valida ai fini del registro (non bozza, non scartata: lo scarto la rende "non emessa"). */
export const isCounted = (d: QuoteDocument): boolean => isFiscalInvoice(d) && d.status !== 'bozza' && d.status !== 'scartata' && !!d.invoice!.lockedAt;

const yearOfDate = (iso: string | undefined): number => Number((iso ?? '').slice(0, 4)) || 0;
export const docDateIso = (d: QuoteDocument): string => (isFiscalInvoice(d) && d.invoice!.operationDate) || d.date;
export const docYear = (d: QuoteDocument): number => yearOfDate(docDateIso(d)) || new Date(d.createdAt).getFullYear();
export const docQuarter = (d: QuoteDocument): number => Math.floor(((Number(docDateIso(d).slice(5, 7)) || 1) - 1) / 3) + 1;

const toCents = (n: number): number => Math.round(n * 100);

/** Incassi registrati nell'anno (per data di incasso) sulle fatture emesse non stornate né scartate. */
export function cashCollectedCents(docs: QuoteDocument[], year: number): number {
  let sum = 0;
  for (const d of docs) {
    if (!isCounted(d) || isCreditNote(d) || d.status === 'stornata') continue;
    for (const p of d.invoice!.payments) if (yearOfDate(p.date) === year && Number.isFinite(p.amount)) sum += toCents(p.amount);
  }
  return sum;
}

export type ThresholdLevel = 'ok' | 'warn' | 'over';
export interface ThresholdStatus { collectedCents: number; thresholdCents: number; ratio: number; level: ThresholdLevel; remainingCents: number }

export function thresholdStatus(docs: QuoteDocument[], year: number, threshold = FORFETTARIO_THRESHOLD): ThresholdStatus {
  const collectedCents = cashCollectedCents(docs, year);
  const thresholdCents = toCents(threshold);
  const ratio = thresholdCents > 0 ? collectedCents / thresholdCents : 0;
  const level: ThresholdLevel = ratio >= 1 ? 'over' : ratio >= WARN_RATIO ? 'warn' : 'ok';
  return { collectedCents, thresholdCents, ratio, level, remainingCents: Math.max(0, thresholdCents - collectedCents) };
}

/** Numero di bolli (e importo) per trimestre dell'anno: fatture E note di credito con bollo dovuto, data = data operazione. */
export function stampsByQuarter(docs: QuoteDocument[], year: number, forfettario: boolean): { count: number; cents: number }[] {
  const q = [0, 1, 2, 3].map(() => ({ count: 0, cents: 0 }));
  for (const d of docs) {
    if (!isCounted(d) || docYear(d) !== year) continue;
    const due = toCents(documentTotals(d, forfettario).stampDue);
    if (due <= 0) continue;
    const slot = q[docQuarter(d) - 1];
    slot.count += 1;
    slot.cents += due;
  }
  return q;
}

/* ---------- CSV ---------- */
const num = (cents: number): string => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
};
const itDate = (iso: string): string => (/^(\d{4})-(\d{2})-(\d{2})/.exec(iso) ? iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1') : iso);
/** Cella di testo: protezione da formule (=, +, -, @) e virgolette. */
export const csvText = (v: string): string => {
  let s = String(v ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const REGISTER_HEADER = ['Numero', 'Data', 'Tipo', 'Cliente', 'Imponibile', 'Bollo', 'Stato SDI', 'Incassato'] as const;

/**
 * Registro delle fatture e note di credito EMESSE (bozze escluse), ordinato per data e numero.
 * Separatore ';' e decimali con la virgola (Excel italiano). Imponibile delle note di credito NEGATIVO.
 * `year` = solo quell'anno; omesso = tutti.
 */
export function invoiceRegisterCsv(docs: QuoteDocument[], forfettario: boolean, year?: number): string {
  const rows = docs
    .filter((d) => isFiscalInvoice(d) && d.status !== 'bozza' && !!d.invoice!.lockedAt && (year === undefined || docYear(d) === year))
    .sort((a, b) => {
      const da = docDateIso(a), db = docDateIso(b);
      if (da !== db) return da < db ? -1 : 1;
      return (a.invoice!.sectional + String(a.invoice!.seq ?? 0).padStart(8, '0')).localeCompare(b.invoice!.sectional + String(b.invoice!.seq ?? 0).padStart(8, '0'));
    });
  const lines: string[] = [REGISTER_HEADER.join(';')];
  for (const d of rows) {
    const t = documentTotals(d, forfettario);
    const nc = isCreditNote(d);
    const paid = nc ? 0 : d.invoice!.payments.reduce((s, p) => s + toCents(p.amount), 0);
    lines.push([
      csvText(d.invoice!.number ?? d.number),
      itDate(docDateIso(d)),
      nc ? 'Nota di credito' : 'Fattura',
      csvText(d.customer.name || ''),
      num((nc ? -1 : 1) * toCents(t.net)),
      num(toCents(t.stampDue)),
      csvText((SDI_INFO[d.status] ?? SDI_INFO.emessa).label),
      num(paid),
    ].join(';'));
  }
  return lines.join('\r\n') + '\r\n';
}
