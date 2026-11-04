import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DocLine, Profile, QuoteDocument } from '../types';
import { documentTotals } from './totals';
import { lineEuro } from '../storage/invoiceTotals';
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
export const fmtQty = (n: number): string => {
  return fmtNum(n, 3).replace(/,?0+$/, '');
};
export const fmtDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Importo di riga: stesso calcolo in centesimi del totale documento e dell'XML (un solo arrotondamento half-up). */
export const lineAmount = (l: DocLine): number => lineEuro(l);

export const FORFETTARIO_TEXT =
  'Operazione effettuata ai sensi dell’art. 1, commi 54-89, Legge n. 190/2014 e successive modificazioni – regime forfettario, non soggetta a IVA.';
export const BOLLO_TEXT = 'Imposta di bollo assolta in modo virtuale (DPR 642/72).';
/** Fattura/nota di credito fiscale emessa: il PDF è solo una copia leggibile. */
export const COURTESY_TEXT = 'Copia di cortesia della fattura elettronica: l’originale è il file XML trasmesso tramite SDI.';
/** Fattura v1 migrata (non fiscale). */
export const LEGACY_COURTESY_TEXT = 'Documento di cortesia: non sostituisce la fattura elettronica trasmessa tramite SDI.';
export const DRAFT_TEXT = 'BOZZA - documento senza numero e senza valore fiscale. Non inviare al cliente.';

/** Fattura o nota di credito con dati fiscali (non legacy). */
const isFiscal = (d: QuoteDocument): boolean => d.type === 'fattura' && !!d.invoice && !d.invoice.legacy;
const isNote = (d: QuoteDocument): boolean => isFiscal(d) && d.invoice!.tipoDocumento === 'TD04';
const isDraft = (d: QuoteDocument): boolean => isFiscal(d) && !d.invoice!.lockedAt && d.status === 'bozza';
/** Data fiscale del documento (elemento XML Data = data operazione). */
const docDate = (d: QuoteDocument): string => (isFiscal(d) && d.invoice!.operationDate) || d.date;

/* ---------- colori ---------- */
const PRIMARY: [number, number, number] = [11, 92, 107];
const INK: [number, number, number] = [25, 35, 40];
const MUTED: [number, number, number] = [95, 110, 117];
const SOFT: [number, number, number] = [233, 240, 242];
const LINE: [number, number, number] = [200, 211, 215];

const W = 210;
const H = 297;
const M = 15;
const FOOT = 18; // spazio riservato al footer

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

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

export async function generateDocumentPdf(doc: QuoteDocument, profile: Profile): Promise<Blob> {
  return renderDocumentPdf(doc, profile).output('blob');
}

/** Costruisce il PDF (esposto per i test, che leggono il testo con compress:false). */
export function renderDocumentPdf(doc: QuoteDocument, profile: Profile, opts: { compress?: boolean } = {}): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: opts.compress ?? true }) as PdfWithTable;
  const forf = !!profile.regimeForfettario;
  const fiscal = isFiscal(doc);
  const note = isNote(doc);
  const draft = isDraft(doc);
  const totals = documentTotals(doc, forf);
  const title = docTitle(doc);

  pdf.setProperties({ title: `${title} - ${doc.customer.name}`, author: profile.businessName, creator: 'VocePreventivo' });

  /* ---------- intestazione ---------- */
  let y = M;
  let textX = M;
  if (profile.logoDataUrl) {
    try {
      const props = pdf.getImageProperties(profile.logoDataUrl);
      const maxW = 42, maxH = 24;
      const r = Math.min(maxW / props.width, maxH / props.height);
      const w = props.width * r, h = props.height * r;
      pdf.addImage(profile.logoDataUrl, props.fileType, M, y, w, h);
      textX = M + w + 6;
    } catch { /* logo non valido: si prosegue senza */ }
  }
  const compW = W - M - textX;
  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'bold').setFontSize(14);
  const nameLines = pdf.splitTextToSize(profile.businessName || 'La tua azienda', compW) as string[];
  pdf.text(nameLines, textX, y + 5);
  let cy = y + 5 + (nameLines.length - 1) * 5.8 + 5;
  pdf.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
  const cityLine = [profile.zip, profile.city].filter(Boolean).join(' ') + (profile.province ? ` (${profile.province})` : '');
  const info: string[] = [];
  if (profile.ownerName) info.push(profile.ownerName);
  const addr = [profile.address, cityLine.trim()].filter(Boolean).join(' - ');
  if (addr) info.push(addr);
  const ids = [profile.vatNumber && `P.IVA ${profile.vatNumber}`, profile.fiscalCode && `C.F. ${profile.fiscalCode}`].filter(Boolean).join('   ');
  if (ids) info.push(ids);
  const contacts = [profile.phone && `Tel. ${profile.phone}`, profile.email, profile.pec && `PEC ${profile.pec}`].filter(Boolean).join('   ');
  if (contacts) info.push(contacts);
  if (profile.artigianiNumber) info.push(`Albo Imprese Artigiane n. ${profile.artigianiNumber}`);
  for (const l of info) {
    for (const part of pdf.splitTextToSize(l, compW) as string[]) {
      pdf.text(part, textX, cy);
      cy += 4.1;
    }
  }
  y = Math.max(cy, y + (profile.logoDataUrl ? 26 : 0)) + 3;
  pdf.setDrawColor(...PRIMARY).setLineWidth(0.6).line(M, y, W - M, y);
  y += 9;

  /* ---------- titolo + data ---------- */
  pdf.setTextColor(...PRIMARY).setFont('helvetica', 'bold').setFontSize(17);
  const titleLines = pdf.splitTextToSize(title, W - 2 * M - 50) as string[];
  pdf.text(titleLines, M, y);
  pdf.setTextColor(...INK).setFont('helvetica', 'normal').setFontSize(10);
  pdf.text(`Data: ${fmtDate(docDate(doc))}`, W - M, y, { align: 'right' });
  y += (titleLines.length - 1) * 7 + 9;
  const refs = creditNoteLines(doc);
  if (refs.length) {
    pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK);
    for (const r of refs) for (const part of pdf.splitTextToSize(r, W - 2 * M) as string[]) { pdf.text(part, M, y - 2); y += 4.8; }
    y += 3;
  }

  /* ---------- cliente ---------- */
  const c = doc.customer;
  const custLines: string[] = [];
  if (c.address) custLines.push(...(pdf.splitTextToSize(c.address, 110) as string[]));
  if (fiscal) {
    const cityC = [c.zip, c.city].filter(Boolean).join(' ') + (c.province ? ` (${c.province})` : '');
    if (cityC.trim() && !(c.address ?? '').includes(c.city ?? '\u0000')) custLines.push(cityC.trim());
    const ids = [c.vatNumber && `P.IVA ${c.vatNumber}`, c.fiscalCode && `C.F. ${c.fiscalCode}`].filter(Boolean).join('   ');
    if (ids) custLines.push(ids);
    else if (c.vatOrFiscalCode) custLines.push(`P.IVA / C.F.: ${c.vatOrFiscalCode}`);
    if (!note && c.codiceDestinatario && c.codiceDestinatario !== '0000000') custLines.push(`Codice destinatario: ${c.codiceDestinatario}`);
    if (!note && c.pec) custLines.push(`PEC: ${c.pec}`);
  } else if (c.vatOrFiscalCode) custLines.push(`P.IVA / C.F.: ${c.vatOrFiscalCode}`);
  const cc = [c.email, c.phone && `Tel. ${c.phone}`].filter(Boolean).join('   ');
  if (cc) custLines.push(cc);
  const boxH = 9.5 + custLines.length * 4.4;
  pdf.setFillColor(...SOFT).roundedRect(M, y - 4, W - 2 * M, boxH, 2, 2, 'F');
  pdf.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...MUTED);
  pdf.text(doc.type === 'preventivo' ? 'PREVENTIVO PER' : note ? 'INTESTATA A' : 'FATTURATO A', M + 4, y + 0.5);
  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK);
  pdf.text((pdf.splitTextToSize(c.name || '-', W - 2 * M - 8) as string[])[0], M + 4, y + 6);
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK);
  custLines.forEach((l, i) => pdf.text(l, M + 4, y + 10.8 + i * 4.4));
  y += boxH + 5;

  /* ---------- tabella righe ---------- */
  const head = forf
    ? [['Descrizione', 'Qtà', 'U.M.', 'Prezzo', 'Sconto', 'Importo']]
    : [['Descrizione', 'Qtà', 'U.M.', 'Prezzo', 'Sconto', 'IVA', 'Importo']];
  const body = doc.lines.map((l) => {
    const base = [l.description || '-', fmtQty(l.qty), l.unit, fmtNum(l.unitPrice), l.discountPct ? `${fmtNum(l.discountPct, l.discountPct % 1 ? 1 : 0)}%` : '-'];
    return forf ? [...base, fmtNum(lineAmount(l))] : [...base, `${fmtNum(l.vat, 0)}%`, fmtNum(lineAmount(l))];
  });
  const right = { halign: 'right' as const };
  const colStyles: Record<number, object> = forf
    ? { 0: { cellWidth: 'auto' }, 1: { ...right, cellWidth: 16 }, 2: { cellWidth: 13 }, 3: { ...right, cellWidth: 24 }, 4: { ...right, cellWidth: 16 }, 5: { ...right, cellWidth: 26 } }
    : { 0: { cellWidth: 'auto' }, 1: { ...right, cellWidth: 15 }, 2: { cellWidth: 12 }, 3: { ...right, cellWidth: 22 }, 4: { ...right, cellWidth: 15 }, 5: { ...right, cellWidth: 12 }, 6: { ...right, cellWidth: 24 } };

  const runningHeader = () => {
    const n = pdf.getCurrentPageInfo().pageNumber;
    if (n > 1) {
      pdf.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...MUTED);
      pdf.text(profile.businessName || '', M, 10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`${title} - ${doc.customer.name}`, W - M, 10, { align: 'right' });
      pdf.setDrawColor(...LINE).setLineWidth(0.2).line(M, 12, W - M, 12);
    }
  };

  autoTable(pdf, {
    startY: y,
    head, body,
    margin: { left: M, right: M, top: 18, bottom: FOOT + 4 },
    theme: 'plain',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8.8, cellPadding: { top: 2.2, bottom: 2.2, left: 1.8, right: 1.8 }, textColor: INK, overflow: 'linebreak', lineColor: LINE, lineWidth: 0 },
    headStyles: { fillColor: PRIMARY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.3 },
    columnStyles: colStyles,
    didParseCell: (d) => {
      if (d.section === 'head' && [1, 3, 4, 5, 6].includes(d.column.index) && d.column.index >= (forf ? 1 : 1)) {
        if (d.column.index !== 2) d.cell.styles.halign = 'right';
      }
    },
    didDrawCell: (d) => {
      if (d.section === 'body') {
        pdf.setDrawColor(...LINE).setLineWidth(0.15);
        pdf.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
      }
    },
    didDrawPage: runningHeader,
  });

  y = (pdf.lastAutoTable?.finalY ?? y) + 6;

  /* ---------- helper di spazio ---------- */
  const ensure = (needed: number) => {
    if (y + needed > H - FOOT - 4) {
      pdf.addPage();
      runningHeader();
      y = 20;
    }
  };

  /* ---------- totali ---------- */
  const boxW = 78;
  const bx = W - M - boxW;
  const rows: [string, string, boolean?][] = [];
  const stampLabel = fiscal ? 'Rimborso imposta di bollo' : 'Marca da bollo';
  if (forf) {
    rows.push(['Imponibile', fmtEuro(totals.net)]);
    if (totals.stamp > 0) rows.push([stampLabel, fmtEuro(totals.stamp)]);
  } else {
    rows.push(['Imponibile', fmtEuro(totals.net)]);
    for (const r of totals.byRate) rows.push([`IVA ${fmtNum(r.rate, 0)}% su ${fmtEuro(r.base)}`, fmtEuro(r.vat)]);
    if (!totals.byRate.length) rows.push(['IVA', fmtEuro(totals.vat)]);
    if (totals.stamp > 0) rows.push([stampLabel, fmtEuro(totals.stamp)]);
  }
  ensure(rows.length * 5.6 + 16);
  pdf.setFontSize(9.5);
  for (const [k, v] of rows) {
    pdf.setFont('helvetica', 'normal').setTextColor(...MUTED);
    pdf.text(k, bx, y);
    pdf.setTextColor(...INK);
    pdf.text(v, W - M, y, { align: 'right' });
    y += 5.6;
  }
  y += 1;
  pdf.setFillColor(...PRIMARY).roundedRect(bx - 3, y - 5, boxW + 3, 11, 1.5, 1.5, 'F');
  pdf.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(11.5);
  pdf.text(forf || doc.type === 'preventivo' ? 'TOTALE' : 'TOTALE DOCUMENTO', bx, y + 2);
  pdf.text(fmtEuro(totals.gross), W - M - 1.5, y + 2, { align: 'right' });
  y += 14;

  /* ---------- condizioni e note ---------- */
  const block = (label: string, text: string, opts: { small?: boolean; muted?: boolean } = {}) => {
    const size = opts.small ? 8 : 9;
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, W - 2 * M) as string[];
    const lh = size * 0.46;
    ensure((label ? 5 : 0) + lines.length * lh + 3);
    if (label) {
      pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...PRIMARY);
      pdf.text(label.toUpperCase(), M, y);
      y += 4.4;
    }
    pdf.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...(opts.muted ? MUTED : INK));
    for (const l of lines) { pdf.text(l, M, y); y += lh; }
    y += 3.5;
  };

  const conds: string[] = [];
  if (doc.type === 'preventivo' && profile.quoteValidityDays > 0) {
    conds.push(`Preventivo valido ${profile.quoteValidityDays} giorni, fino al ${fmtDate(addDays(doc.date, profile.quoteValidityDays))}.`);
  }
  if (!note && profile.paymentTerms) conds.push(`Pagamento: ${profile.paymentTerms}.`.replace(/\.\.$/, '.'));
  if (!note && profile.iban) conds.push(`IBAN: ${profile.iban}${profile.businessName ? ` - intestato a ${profile.businessName}` : ''}`);
  if (conds.length) block('Condizioni', conds.join('\n'));
  if (doc.notes?.trim()) block('Note', doc.notes.trim());
  if (forf) {
    block('', FORFETTARIO_TEXT, { small: true });
    if (totals.stampDue > 0) block('', BOLLO_TEXT, { small: true });
  }
  if (draft) block('', DRAFT_TEXT, { small: true });
  else if (doc.type === 'fattura' && !fiscal) block('', LEGACY_COURTESY_TEXT, { small: true, muted: true });

  /* ---------- footer + numeri pagina ---------- */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINE).setLineWidth(0.2).line(M, H - FOOT + 2, W - M, H - FOOT + 2);
    pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    if (profile.footerNotes) {
      const f = (pdf.splitTextToSize(profile.footerNotes, W - 2 * M - 25) as string[]).slice(0, 2);
      pdf.text(f, M, H - FOOT + 6);
    }
    pdf.text(`Pagina ${i} di ${pages}`, W - M, H - FOOT + 6, { align: 'right' });
    if (fiscal) {
      pdf.setFontSize(7).setTextColor(...MUTED);
      pdf.text(draft ? DRAFT_TEXT : COURTESY_TEXT, W / 2, H - 6, { align: 'center', maxWidth: W - 2 * M });
    }
    if (draft) {
      pdf.saveGraphicsState();
      pdf.setGState(pdf.GState({ opacity: 0.13 }));
      pdf.setTextColor(180, 35, 24).setFont('helvetica', 'bold').setFontSize(110);
      pdf.text('BOZZA', W / 2, H / 2 + 20, { align: 'center', angle: 35 });
      pdf.restoreGraphicsState();
    }
  }

  return pdf;
}
