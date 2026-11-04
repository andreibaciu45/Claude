/** Risoluzione di un `DocRef` ("la fattura 12", "l'ultima", "quella di Rossi", "questa") sui documenti salvati. Puro. */
import type { QuoteDocument } from '../types';
import type { DocRef } from './types';

export interface DocChoice {
  id: string;
  label: string;
  customer: string;
  status: string;
  date: string;
}

export type Resolution =
  | { ok: true; doc: QuoteDocument }
  | { ok: false; reason: 'none' | 'ambiguous' | 'no-current' | 'type-mismatch'; message: string; candidates: QuoteDocument[] };

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Numero progressivo e anno di un documento: 'PRev-0012' -> 12; '12/2026' -> 12 (2026); 'NC1/2026' -> 1 (2026). */
export function docSeq(d: QuoteDocument): { seq: number; year?: number } | null {
  if (d.invoice?.seq !== undefined) return { seq: d.invoice.seq, year: d.invoice.year };
  const m = /(\d+)(?:\s*\/\s*(\d{4}))?\s*$/.exec(d.number ?? '');
  if (!m) return null;
  return { seq: parseInt(m[1], 10), year: m[2] ? parseInt(m[2], 10) : undefined };
}

export const isCreditNote = (d: QuoteDocument): boolean => d.invoice?.tipoDocumento === 'TD04';

export function docLabel(d: QuoteDocument): string {
  const kind = d.type === 'preventivo' ? 'Preventivo' : isCreditNote(d) ? 'Nota di credito' : 'Fattura';
  if (d.type === 'fattura' && (!d.number || d.status === 'bozza') && !d.invoice?.lockedAt) return `${kind} (bozza)`;
  return `${kind} ${d.number}`;
}

export const toChoice = (d: QuoteDocument): DocChoice => ({ id: d.id, label: docLabel(d), customer: d.customer?.name ?? '', status: String(d.status), date: d.date });

const newest = (a: QuoteDocument, b: QuoteDocument) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.date < b.date ? 1 : -1);

export interface ResolveOptions {
  currentDocumentId?: string;
  /** a parità di candidati restringe a quelli che soddisfano il predicato (se ne restano) */
  prefer?: (d: QuoteDocument) => boolean;
  today?: Date;
}

export function resolveRef(ref: DocRef, docs: QuoteDocument[], opts: ResolveOptions = {}): Resolution {
  const none = (message: string, candidates: QuoteDocument[] = []): Resolution => ({ ok: false, reason: 'none', message, candidates });
  const ambiguous = (list: QuoteDocument[], what: string): Resolution => ({
    ok: false, reason: 'ambiguous', candidates: [...list].sort(newest).slice(0, 6),
    message: `Ho trovato più documenti per ${what}: scegli quello giusto.`,
  });

  const pick = (list: QuoteDocument[], what: string): Resolution => {
    if (list.length === 0) return none(`Non trovo ${what}.`);
    if (list.length === 1) return { ok: true, doc: list[0] };
    if (opts.prefer) {
      const pref = list.filter(opts.prefer);
      if (pref.length === 1) return { ok: true, doc: pref[0] };
      if (pref.length > 1) return ambiguous(pref, what);
    }
    return ambiguous(list, what);
  };

  const byType = (list: QuoteDocument[], t?: 'preventivo' | 'fattura') => (t ? list.filter((d) => d.type === t) : list);
  const t = 'docType' in ref ? ref.docType : undefined;
  const typeName = t === 'preventivo' ? 'preventivo' : t === 'fattura' ? 'fattura' : 'documento';

  switch (ref.kind) {
    case 'id': {
      const d = docs.find((x) => x.id === ref.id);
      return d ? { ok: true, doc: d } : none('Il documento non esiste più.');
    }
    case 'number': {
      let list = byType(docs, ref.docType).filter((d) => {
        const s = docSeq(d);
        return s !== null && s.seq === ref.number && (ref.year === undefined || s.year === undefined || s.year === ref.year);
      });
      if (ref.docType !== 'preventivo') {
        // senza altra indicazione "fattura 12" è la fattura, non la nota di credito NC12
        const noNc = list.filter((d) => !isCreditNote(d));
        if (noNc.length) list = noNc;
      }
      if (ref.year === undefined && list.length > 1 && list.every((d) => d.type === list[0].type)) {
        const y = (opts.today ?? new Date()).getFullYear();
        const thisYear = list.filter((d) => docSeq(d)?.year === y);
        if (thisYear.length === 1) list = thisYear;
      }
      return pick(list, `${typeName} numero ${ref.number}${ref.year ? `/${ref.year}` : ''}`);
    }
    case 'last': {
      let list = byType(docs, ref.docType);
      if (ref.draftOnly) list = list.filter((d) => d.status === 'bozza');
      if (!list.length) return none(`Non ci sono ${typeName === 'documento' ? 'documenti' : typeName === 'fattura' ? 'fatture' : 'preventivi'}.`);
      return { ok: true, doc: [...list].sort(newest)[0] };
    }
    case 'customer': {
      const q = strip(ref.name).split(' ').filter(Boolean);
      let list = byType(docs, ref.docType).filter((d) => {
        const n = strip(d.customer?.name ?? '');
        return q.length > 0 && q.every((tok) => n.split(' ').some((w) => w === tok || w.startsWith(tok)));
      });
      if (ref.draftOnly) list = list.filter((d) => d.status === 'bozza');
      if (list.length > 1 && ref.latest) return { ok: true, doc: [...list].sort(newest)[0] };
      return pick(list, `${typeName} di ${ref.name}`);
    }
    case 'current': {
      if (opts.currentDocumentId) {
        const d = docs.find((x) => x.id === opts.currentDocumentId);
        if (d) {
          if (ref.docType && d.type !== ref.docType) {
            return { ok: false, reason: 'type-mismatch', candidates: [d], message: `Il documento aperto è ${d.type === 'fattura' ? 'una fattura' : 'un preventivo'}, non ${ref.docType === 'fattura' ? 'una fattura' : 'un preventivo'}.` };
          }
          return { ok: true, doc: d };
        }
      }
      // nessun documento aperto: se c'è una sola bozza compatibile si usa quella, altrimenti si chiede
      const drafts = byType(docs, ref.docType).filter((d) => d.status === 'bozza');
      if (drafts.length === 1) return { ok: true, doc: drafts[0] };
      if (drafts.length > 1) return { ok: false, reason: 'ambiguous', candidates: [...drafts].sort(newest).slice(0, 6), message: 'Non c’è un documento aperto: quale intendi?' };
      return { ok: false, reason: 'no-current', candidates: [], message: 'Non c’è un documento aperto. Apri il documento oppure dimmi il numero o il cliente.' };
    }
  }
}
