import type { DocStatus, DocType, Profile, QuoteDocument } from '../../types';
import { generateDocumentPdf, fmtEuro, fmtNum } from '../../pdf';
import { displayNumber, isFiscalInvoice, kindLabel } from '../invoice/model';

export const STATUS_ORDER: DocStatus[] = ['bozza', 'inviato', 'accettato', 'pagato'];
export const STATUS_LABEL: Record<DocStatus, string> = {
  bozza: 'Bozza', inviato: 'Inviato', accettato: 'Accettato', pagato: 'Pagato', rifiutato: 'Rifiutato', scaduto: 'Scaduto', convertito: 'Convertito',
  emessa: 'Emessa', inviata: 'Inviata allo SDI', consegnata: 'Consegnata', mancata_consegna: 'Mancata consegna', scartata: 'Scartata dallo SDI', stornata: 'Stornata',
};
export const STATUS_TONE: Record<DocStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  bozza: 'neutral', inviato: 'info', accettato: 'success', pagato: 'success', rifiutato: 'danger', scaduto: 'warning', convertito: 'neutral',
  emessa: 'info', inviata: 'info', consegnata: 'success', mancata_consegna: 'warning', scartata: 'danger', stornata: 'neutral',
};
export const TYPE_LABEL: Record<DocType, string> = { preventivo: 'Preventivo', fattura: 'Fattura' };

export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const fileNameFor = (doc: QuoteDocument): string => {
  const safe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${safe(kindLabel(doc))}_${safe(displayNumber(doc)) || 'senza_numero'}_${safe(doc.customer.name) || 'cliente'}.pdf`;
};

export const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export const canShareFiles = (): boolean => {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] });
  } catch { return false; }
};

export const shareText = (doc: QuoteDocument, profile: Profile, total: number): string => {
  const what = doc.type === 'preventivo' ? 'il preventivo' : kindLabel(doc) === 'Nota di credito' ? 'la nota di credito (copia di cortesia)' : 'la fattura (copia di cortesia)';
  const n = isFiscalInvoice(doc) ? displayNumber(doc) : doc.number;
  return `Buongiorno ${doc.customer.name}, le invio ${what} n. ${n} del ${doc.date.split('-').reverse().join('/')} per un totale di ${fmtEuro(total)}.\n${profile.businessName}${profile.phone ? ' - ' + profile.phone : ''}`;
};

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Condivide il PDF col foglio di sistema se possibile, altrimenti lo scarica. */
export async function sharePdf(doc: QuoteDocument, profile: Profile, text: string): Promise<ShareResult> {
  const blob = await generateDocumentPdf(doc, profile);
  const name = fileNameFor(doc);
  if (canShareFiles()) {
    const file = new File([blob], name, { type: 'application/pdf' });
    try {
      await navigator.share({ files: [file], title: `${kindLabel(doc)} ${displayNumber(doc)}`, text });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}

/** Numero di telefono -> formato internazionale per wa.me (solo cifre), default prefisso IT. */
export const waNumber = (phone?: string): string => {
  if (!phone) return '';
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  d = d.replace(/^0+(?=3)/, '');
  return d.length >= 8 ? '39' + d : '';
};

export { fmtEuro, fmtNum };
