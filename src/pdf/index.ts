import type { DocLine, Profile, QuoteDocument } from '../types';
import { documentTotals } from './totals';
import { lineEuro, isDiscountLine } from '../storage/invoiceTotals';
import { discountBasisPoints, formatDecimal } from '../../shared/fiscal/money';
export { isDiscountLine };
import { BOLLO_LEGAL_TEXT, FORFETTARIO_LEGAL_TEXT } from '../../shared/fatturapa';
export { documentTotals, draftTotals } from './totals';
export type { DocTotals } from './totals';

/* ---------- formattazione it-IT (indipendente dall'ICU del browser) ---------- */
const group = (intPart: string) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const fmtNum = (n: number, decimals = 2): string => {
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(decimals).split('.');
  return (neg ? '-' : '') + group(i) + (d ? ',' + d : '');
};
export const fmtEuro = (n: number): string => `€ ${fmtNum(n)}`;
/** Decimale it-IT con cifre tra min e max (zeri finali tolti oltre min), separatore delle migliaia. Aritmetica sulla stringa, nessun arrotondamento extra. */
export const fmtDec = (n: number, min: number, max: number): string => {
  const s = formatDecimal(Math.abs(n), min, max);
  const [i, d] = s.split('.');
  return (n < 0 && Number(s) !== 0 ? '-' : '') + group(i) + (d ? ',' + d : '');
};
/** REV-F1: quantità fino a 8 decimali (come nell'XML), non 3. */
export const fmtQty = (n: number): string => fmtDec(n, 0, 8);
/** REV-F1: prezzo unitario fino a 8 decimali (come nell'XML): 0,125 non diventa "0,13". */
export const fmtPrice = (n: number): string => fmtDec(n, 2, 8);
/** Sconto % come usato nel calcolo (centesimi di punto): 12,25% non diventa "12,3%". */
export const fmtDiscount = (pct: number): string => `${fmtDec(discountBasisPoints(pct) / 100, 0, 2)}%`;
export const fmtDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
export const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Importo di riga: stesso calcolo in centesimi del totale documento e dell'XML (un solo arrotondamento half-up). */
export const lineAmount = (l: DocLine): number => lineEuro(l);

/** Diciture di legge: UNA sola definizione condivisa con l'XML (shared/fatturapa/legalText). */
export const FORFETTARIO_TEXT = FORFETTARIO_LEGAL_TEXT;
export const BOLLO_TEXT = BOLLO_LEGAL_TEXT;
/** Fattura/nota di credito fiscale emessa: il PDF è solo una copia leggibile. */
export const COURTESY_TEXT = 'Copia di cortesia della fattura elettronica: l’originale è il file XML trasmesso tramite SDI.';
/** Fattura v1 migrata (non fiscale). */
export const LEGACY_COURTESY_TEXT = 'Documento di cortesia: non sostituisce la fattura elettronica trasmessa tramite SDI.';
export const DRAFT_TEXT = 'BOZZA - documento senza numero e senza valore fiscale. Non inviare al cliente.';

/** Fattura o nota di credito con dati fiscali (non legacy). */
export const isFiscal = (d: QuoteDocument): boolean => d.type === 'fattura' && !!d.invoice && !d.invoice.legacy;
export const isNote = (d: QuoteDocument): boolean => isFiscal(d) && d.invoice!.tipoDocumento === 'TD04';
export const isDraft = (d: QuoteDocument): boolean => isFiscal(d) && !d.invoice!.lockedAt && d.status === 'bozza';
/** Data fiscale del documento (elemento XML Data = data operazione). */
export const docDate = (d: QuoteDocument): string => (isFiscal(d) && d.invoice!.operationDate) || d.date;

export const docTitle = (doc: QuoteDocument): string => {
  if (doc.type === 'preventivo') return `PREVENTIVO n. ${doc.number}`;
  if (!isFiscal(doc)) return `FATTURA (copia di cortesia) n. ${doc.number}`;
  const inv = doc.invoice!;
  if (isDraft(doc)) return isNote(doc) ? 'NOTA DI CREDITO (bozza)' : 'FATTURA (bozza)';
  return `${isNote(doc) ? 'NOTA DI CREDITO' : 'FATTURA'} n. ${inv.number ?? doc.number}`;
};

/** Righe sotto il titolo: riferimento alla fattura rettificata e motivo (solo nota di credito TD04). */
export const creditNoteLines = (doc: QuoteDocument): string[] => {
  if (!isNote(doc)) return [];
  const inv = doc.invoice!;
  const out: string[] = [];
  const num = inv.number ?? doc.number;
  const orig = inv.originalNumber ? `rettifica la fattura n. ${inv.originalNumber}${inv.originalDate ? ` del ${fmtDate(inv.originalDate)}` : ''}` : 'rettifica la fattura originale';
  out.push(`NOTA DI CREDITO n. ${num} del ${fmtDate(docDate(doc))} ${orig}`);
  if (inv.creditNoteReason?.trim()) out.push(`Motivo: ${inv.creditNoteReason.trim()}`);
  return out;
};

/**
 * Genera il PDF. jsPDF e jsPDF-AutoTable (pesanti) si caricano SOLO qui, al primo uso: restano fuori dal bundle principale.
 * Il disegno vero e proprio è in ./render (esposto ai test come `renderDocumentPdf`).
 */
export async function generateDocumentPdf(doc: QuoteDocument, profile: Profile): Promise<Blob> {
  const { renderDocumentPdf } = await import('./render');
  return renderDocumentPdf(doc, profile).output('blob');
}
