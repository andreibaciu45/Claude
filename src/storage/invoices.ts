/**
 * Fatturazione elettronica lato client: emissione, note di credito, esiti SDI, pagamenti, audit.
 *
 * Regole (docs/CONTRACT-V2.md, docs/FISCAL-SPEC.md §1 e §5):
 *  - numero fiscale assegnato SOLO all'emissione, in UNA transazione IndexedDB su profile+documents+audit
 *    (se qualcosa fallisce non si scrive nulla: nessun buco);
 *  - fattura emessa = immutabile (`invoice.lockedAt`); si annulla con nota di credito TD04;
 *  - audit append-only.
 * Fonti fiscali secondarie: DA VERIFICARE con un commercialista.
 */
import type { AuditEntry, DocLine, Profile, QuoteDocument, SdiEvent, ValidationIssue, InvoiceFiscal, DocStatus } from '../types';
import { uid } from '../types';
import { computeTotals } from '../engine/totals';
import * as fatturapa from '../../shared/fatturapa';
import { generateFatturaPA, validateInvoiceForIssue } from '../../shared/fatturapa';
import { getBackend, newAuditId, withDefaults, type Tx } from './db';

// ---------------------------------------------------------------- errori

export class ImmutableDocumentError extends Error {
  constructor(message = 'Documento fiscale emesso: non è modificabile né eliminabile. Per correggerlo emetti una nota di credito.') {
    super(message);
    this.name = 'ImmutableDocumentError';
  }
}

export class InvoiceValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[] = [], message?: string) {
    super(message ?? `Fattura non emettibile: ${issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ') || 'dati non validi'}`);
    this.name = 'InvoiceValidationError';
    this.issues = issues;
  }
}

/** Transizione di stato SDI non consentita. */
export class InvalidSdiTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSdiTransitionError';
  }
}

const issueErr = (field: string, code: string, message: string): InvoiceValidationError =>
  new InvoiceValidationError([{ field, code, message, severity: 'error' }]);

// ---------------------------------------------------------------- utilità

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** SHA-256 esadecimale (WebCrypto). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto non disponibile: impossibile calcolare l\'hash della fattura.');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Progressivo invio (5 caratteri base-36). Usa quello di shared/fatturapa se esportato. */
function progressivo(n: number): string {
  try {
    const f = (fatturapa as unknown as Record<string, unknown>).formatProgressivoInvio;
    if (typeof f === 'function') return (f as (n: number) => string)(n);
  } catch { /* export assente: fallback locale */ }
  return n.toString(36).toUpperCase().padStart(5, '0');
}

const counterKey = (sectional: string, year: number): string => `${sectional}-${year}`;

const isFiscalInvoice = (d: QuoteDocument | undefined): d is QuoteDocument & { invoice: InvoiceFiscal } =>
  !!d && d.type === 'fattura' && !!d.invoice && !d.invoice.legacy;

async function addAudit(t: Tx, e: Omit<AuditEntry, 'id' | 'at' | 'actor'> & { at?: number }): Promise<void> {
  const at = e.at ?? Date.now();
  await t.add('audit', { ...e, id: newAuditId(at), at, actor: 'user' } satisfies AuditEntry);
}
export { addAudit as __addAudit };

/** Transizioni di stato consentite per effetto di eventi SDI (non per saveDocument libero). */
export const SDI_STATUS_TRANSITIONS: Partial<Record<DocStatus, DocStatus[]>> = {
  emessa: ['inviata'],
  inviata: ['consegnata', 'mancata_consegna', 'scartata'],
  mancata_consegna: ['consegnata'],
  scartata: ['inviata'],
};

/** Giorni entro cui una fattura scartata si può rinviare con lo stesso numero/data (FISCAL-SPEC §1.2). */
export const RESUBMIT_DAYS = 5;

/**
 * `saveDocument` su un documento già bloccato: ammessi solo sdiEvents, payments, paymentStatus e
 * transizioni di stato consentite. Altrimenti ImmutableDocumentError.
 * `allowLock` = true per documenti provenienti dalla sync (già emessi altrove): vedi `saveSyncedDocument`.
 */
export function assertSaveAllowed(existing: QuoteDocument | undefined, incoming: QuoteDocument, allowLock = false): void {
  const lockedNow = !!existing?.invoice?.lockedAt;
  if (!lockedNow) {
    if (incoming.invoice?.lockedAt && !allowLock) {
      throw new ImmutableDocumentError('Una fattura si blocca solo emettendola (issueInvoice), non salvandola.');
    }
    return;
  }
  const strip = (d: QuoteDocument) => {
    const c = clone(d) as QuoteDocument;
    delete (c as Partial<QuoteDocument>).updatedAt;
    delete (c as Partial<QuoteDocument>).status;
    if (c.invoice) {
      delete (c.invoice as Partial<InvoiceFiscal>).sdiEvents;
      delete (c.invoice as Partial<InvoiceFiscal>).payments;
      delete (c.invoice as Partial<InvoiceFiscal>).paymentStatus;
    }
    // pointer di conversione/stornata non fanno parte del contenuto fiscale
    delete (c as Partial<QuoteDocument>).convertedToInvoiceId;
    return stable(c);
  };
  if (strip(existing!) !== strip(incoming)) {
    throw new ImmutableDocumentError();
  }
  if (incoming.status !== existing!.status) {
    const ok = SDI_STATUS_TRANSITIONS[existing!.status]?.includes(incoming.status);
    if (!ok) {
      throw new ImmutableDocumentError(
        `Transizione di stato non consentita su fattura emessa: ${existing!.status} -> ${incoming.status}. Usa recordSdiEvent o createCreditNote.`);
    }
  }
}

// ---------------------------------------------------------------- audit

export const listAudit = async (docId?: string): Promise<AuditEntry[]> => {
  const all = await getBackend().transact('readonly', (t) => t.all<AuditEntry>('audit'));
  return all
    .filter((e) => !docId || e.docId === docId)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

// ---------------------------------------------------------------- bozza da preventivo

const customerChannel = (c: QuoteDocument['customer']): InvoiceFiscal['customerChannel'] => {
  if (c.country && c.country.toUpperCase() !== 'IT') return 'estero';
  if (c.codiceDestinatario && !/^0+$/.test(c.codiceDestinatario)) return 'codice';
  if (c.pec) return 'pec';
  return c.vatNumber ? 'codice' : 'consumatore';
};

/** Preventivo -> nuova fattura in BOZZA (copia righe e cliente; segna il preventivo 'convertito'). */
export const createInvoiceFromQuote = async (quoteId: string): Promise<QuoteDocument> =>
  getBackend().transact('readwrite', async (t) => {
    const quote = await t.get<QuoteDocument>('documents', quoteId);
    if (!quote) throw new Error('Preventivo non trovato.');
    if (quote.type !== 'preventivo') throw new Error('Il documento non è un preventivo.');
    if (quote.convertedToInvoiceId && (await t.get('documents', quote.convertedToInvoiceId))) {
      throw new Error('Questo preventivo è già stato convertito in fattura.');
    }
    const profile = withDefaults(await t.getProfile());
    const now = Date.now();
    const forf = profile.regimeForfettario;
    const lines: DocLine[] = clone(quote.lines).map((l) => ({
      ...l, id: uid(), ...(forf ? { vat: 0, natura: l.natura ?? 'N2.2' } : {}),
    }));
    const stamp = computeTotals(lines, { forfettario: forf, type: 'fattura' }).stamp;
    const today = todayIso();
    const invoice: InvoiceFiscal = {
      tipoDocumento: 'TD01',
      year: Number(today.slice(0, 4)),
      sectional: 'FT',
      operationDate: today,
      stampDuty: stamp > 0,
      stampDutyChargedToCustomer: stamp > 0 && !!profile.stampDutyDefaultChargedToCustomer,
      stampAmount: stamp,
      customerChannel: customerChannel(quote.customer),
      sdiEvents: [],
      paymentStatus: 'non_pagata',
      payments: [],
    };
    const inv: QuoteDocument = {
      id: uid(), type: 'fattura', number: '', date: today, customer: clone(quote.customer), lines,
      notes: quote.notes, status: 'bozza', invoice, convertedFromQuoteId: quote.id, createdAt: now, updatedAt: now,
    };
    await t.put('documents', inv);
    await t.put('documents', { ...quote, status: 'convertito', convertedToInvoiceId: inv.id, updatedAt: now });
    await addAudit(t, { docId: inv.id, action: 'create', detail: `Bozza fattura creata dal preventivo ${quote.number}`, at: now });
    await addAudit(t, { docId: quote.id, action: 'convert_quote', detail: `Convertito in fattura (bozza ${inv.id})`, at: now });
    return inv;
  });

// ---------------------------------------------------------------- emissione (cuore)

interface EmitPlan {
  /** Documento (bozza) da emettere, già completo salvo i campi assegnati all'emissione. */
  draft: QuoteDocument;
  /** Dati da cui dipende l'emissione: se cambiano tra preparazione e scrittura si ripete. */
  deps: unknown;
  /** Effetti collaterali nella stessa transazione (es. segnare 'stornata' la fattura originale). */
  finalize?: (t: Tx, issued: QuoteDocument) => Promise<void>;
  auditAction?: 'issue';
}

export interface IssueResult { doc: QuoteDocument; warnings: string[] }

let emitChain: Promise<unknown> = Promise.resolve();
/** Serializza le emissioni in questo contesto (più schede: la verifica in transazione + retry copre il resto). */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = emitChain.then(fn, fn);
  emitChain = run.catch(() => undefined);
  return run;
}

class RetryEmit extends Error {}

function issuedYear(operationDate: string): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(operationDate ?? '');
  return m ? Number(m[1]) : null;
}

interface Candidate {
  issued: QuoteDocument; // senza xml
  key: string;
  seq: number;
  prog: number;
  progStr: string;
  warnings: string[];
  gen: { xml: string; fileName: string; progressivoInvio: string };
}

function buildCandidate(draft: QuoteDocument, profile: Profile, docs: QuoteDocument[], now: number): Candidate {
  const inv0 = draft.invoice;
  if (!inv0) throw issueErr('invoice', 'required', 'Dati fiscali della fattura mancanti.');
  const year = issuedYear(inv0.operationDate);
  if (year === null) throw issueErr('invoice.operationDate', 'required', 'Data operazione mancante o non valida (formato AAAA-MM-GG).');
  const sectional = inv0.tipoDocumento === 'TD04' ? 'NC' : 'FT';
  const key = counterKey(sectional, year);
  const counters = profile.invoiceYearCounters ?? {};
  // il contatore non deve mai restare indietro rispetto ai numeri già presenti (es. dopo un import)
  const maxDocSeq = docs.reduce((m, d) => {
    const i = d.invoice;
    return i && !i.legacy && i.sectional === sectional && i.year === year && typeof i.seq === 'number' ? Math.max(m, i.seq) : m;
  }, 0);
  const seq = Math.max(counters[key] ?? 0, maxDocSeq) + 1;
  const prog = Math.max(1, Math.floor(profile.nextProgressivoInvio ?? 1));
  const progStr = progressivo(prog);
  const number = sectional === 'NC' ? `NC${seq}/${year}` : `${seq}/${year}`;

  const issued: QuoteDocument = {
    ...clone(draft),
    number,
    date: inv0.operationDate,
    status: 'emessa',
    updatedAt: now,
    invoice: {
      ...clone(inv0), year, sectional, seq, number, issuedAt: now, lockedAt: now, progressivoInvio: progStr, legacy: undefined,
    },
  };
  delete (issued.invoice as Partial<InvoiceFiscal>).legacy;

  const issues = validateInvoiceForIssue(issued, profile) ?? [];
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new InvoiceValidationError(issues);
  const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);

  // Regola cronologica (FISCAL-SPEC non la fissa con certezza): WARNING non bloccante, registrato in audit.
  const latest = docs
    .filter((d) => isFiscalInvoice(d) && d.invoice.lockedAt && d.invoice.sectional === sectional && d.invoice.year === year)
    .reduce<string>((m, d) => (d.invoice!.operationDate > m ? d.invoice!.operationDate : m), '');
  if (latest && inv0.operationDate < latest) {
    warnings.push(`La data operazione (${inv0.operationDate}) è anteriore all'ultima fattura emessa nello stesso sezionale/anno (${latest}): verifica la cronologia con il tuo commercialista.`);
  }

  const gen = generateFatturaPA(issued, profile, progStr);
  return { issued, key, seq, prog, progStr, warnings, gen };
}

async function emit(
  plan: (t: Tx, now: number) => Promise<EmitPlan>,
  auditDetail: (c: Candidate) => string,
): Promise<IssueResult> {
  return serialize(async () => {
    const now = Date.now();
    for (let attempt = 0; attempt < 6; attempt++) {
      // 1) preparazione (sola lettura): numero, validazione, XML, hash. L'hash (async) sta FUORI dalla tx di scrittura.
      const prep = await getBackend().transact('readonly', async (t) => {
        const p = await plan(t, now);
        const profile = withDefaults(await t.getProfile());
        const docs = await t.all<QuoteDocument>('documents');
        return { p, profile, docs };
      });
      const cand = buildCandidate(prep.p.draft, prep.profile, prep.docs, now);
      const xmlSha256 = await sha256Hex(cand.gen.xml);
      const fingerprint = stable([prep.p.draft, prep.p.deps, prep.profile.invoiceYearCounters, prep.profile.nextProgressivoInvio,
        prep.docs.filter((d) => d.invoice?.seq !== undefined).map((d) => [d.id, d.invoice!.seq])]);

      // 2) scrittura atomica: profile + documents + audit
      try {
        return await getBackend().transact('readwrite', async (t) => {
          const p = await plan(t, now);
          const profile = withDefaults(await t.getProfile());
          const docs = await t.all<QuoteDocument>('documents');
          const fp = stable([p.draft, p.deps, profile.invoiceYearCounters, profile.nextProgressivoInvio,
            docs.filter((d) => d.invoice?.seq !== undefined).map((d) => [d.id, d.invoice!.seq])]);
          if (fp !== fingerprint) throw new RetryEmit();

          const final: QuoteDocument = {
            ...cand.issued,
            invoice: { ...cand.issued.invoice!, xml: cand.gen.xml, xmlSha256, fileName: cand.gen.fileName,
              progressivoInvio: cand.gen.progressivoInvio || cand.progStr },
          };
          profile.invoiceYearCounters = { ...(profile.invoiceYearCounters ?? {}), [cand.key]: cand.seq };
          profile.nextProgressivoInvio = cand.prog + 1;
          await t.putProfile(profile);
          await t.put('documents', final);
          const detail = auditDetail(cand) + (cand.warnings.length ? ` | Avvisi: ${cand.warnings.join(' ')}` : '');
          await addAudit(t, { docId: final.id, action: 'issue', detail, xmlSha256, at: now });
          if (p.finalize) await p.finalize(t, final);
          return { doc: final, warnings: cand.warnings };
        });
      } catch (e) {
        if (e instanceof RetryEmit) continue;
        throw e;
      }
    }
    throw new Error('Emissione non riuscita: i dati sono cambiati più volte durante l\'operazione. Riprova.');
  });
}

/**
 * Emette e restituisce anche gli avvisi non bloccanti (es. data anteriore all'ultima fattura emessa).
 * `issueInvoice` è la stessa operazione con la firma del contratto (ritorna solo il documento).
 */
export async function issueInvoiceWithWarnings(docId: string): Promise<IssueResult> {
  return emit(
    async (t) => {
      const d = await t.get<QuoteDocument>('documents', docId);
      if (!d) throw new Error('Fattura non trovata.');
      if (d.type !== 'fattura') throw new Error('Solo le fatture si emettono; un preventivo va prima convertito.');
      if (d.invoice?.lockedAt || (d.status !== 'bozza' && !d.invoice?.legacy)) throw new ImmutableDocumentError('Fattura già emessa.');
      return { draft: d, deps: null };
    },
    (c) => `Emessa ${c.issued.invoice!.number} (${c.gen.fileName})`,
  );
}

/** Bozza fattura -> EMESSA, in UNA transazione: assegna seq (anno+sezionale), genera XML, hash, lockedAt, audit. Lancia InvoiceValidationError. */
export const issueInvoice = async (docId: string): Promise<QuoteDocument> => (await issueInvoiceWithWarnings(docId)).doc;

// ---------------------------------------------------------------- nota di credito

const cents = (n: number): number => Math.round(n * 100);

const CREDITABLE: DocStatus[] = ['emessa', 'inviata', 'consegnata', 'mancata_consegna'];

/** Crea ED EMETTE una nota di credito TD04 collegata alla fattura. Senza `lines` = storno totale. Segna la fattura 'stornata' se totale. */
export const createCreditNote = async (
  invoiceId: string,
  opts: { reason: string; lines?: DocLine[] },
): Promise<QuoteDocument> => {
  const ncId = uid();
  const reason = (opts.reason ?? '').trim();
  const r = await emit(
    async (t, now) => {
      const orig = await t.get<QuoteDocument>('documents', invoiceId);
      if (!orig) throw new Error('Fattura da stornare non trovata.');
      if (!isFiscalInvoice(orig) || orig.invoice.tipoDocumento !== 'TD01') throw new Error('Si può stornare solo una fattura fiscale (TD01).');
      if (!CREDITABLE.includes(orig.status)) {
        throw new Error(`La fattura è nello stato "${orig.status}": non si può stornare (solo emessa, inviata, consegnata o in mancata consegna).`);
      }
      if (!reason) throw issueErr('creditNoteReason', 'required', 'Indica la causale della nota di credito.');
      const profile = withDefaults(await t.getProfile());
      const all = await t.all<QuoteDocument>('documents');
      const prior = all.filter((d) => d.invoice?.tipoDocumento === 'TD04' && d.invoice.originalDocumentId === orig.id && d.invoice.lockedAt);
      const forf = profile.regimeForfettario;
      const origNet = cents(computeTotals(orig.lines, { forfettario: forf, type: 'fattura' }).net);
      const priorNet = prior.reduce((s, d) => s + cents(computeTotals(d.lines, { forfettario: forf, type: 'fattura' }).net), 0);
      let lines: DocLine[];
      if (opts.lines) {
        if (!opts.lines.length) throw issueErr('lines', 'required', 'Indica almeno una riga da stornare.');
        lines = clone(opts.lines).map((l) => ({ ...l, id: uid() }));
      } else {
        if (prior.length) throw issueErr('lines', 'partial_exists', 'La fattura ha già note di credito parziali: indica le righe da stornare.');
        lines = clone(orig.lines).map((l) => ({ ...l, id: uid() }));
      }
      const ncNet = cents(computeTotals(lines, { forfettario: forf, type: 'fattura' }).net);
      if (ncNet <= 0) throw issueErr('lines', 'invalid_amount', 'L\'importo della nota di credito deve essere positivo.');
      if (priorNet + ncNet > origNet) {
        throw issueErr('lines', 'exceeds_original', 'La nota di credito supera l\'importo ancora stornabile della fattura.');
      }
      const full = priorNet + ncNet >= origNet;
      const stamp = computeTotals(lines, { forfettario: forf, type: 'fattura' }).stamp;
      const today = todayIso();
      const invoice: InvoiceFiscal = {
        tipoDocumento: 'TD04',
        year: Number(today.slice(0, 4)),
        sectional: 'NC',
        operationDate: today,
        stampDuty: stamp > 0,
        stampDutyChargedToCustomer: false,
        stampAmount: stamp,
        customerChannel: orig.invoice.customerChannel,
        originalDocumentId: orig.id,
        originalNumber: orig.invoice.number,
        originalDate: orig.invoice.operationDate,
        creditNoteReason: reason,
        sdiEvents: [],
        paymentStatus: 'non_pagata',
        payments: [],
      };
      const draft: QuoteDocument = {
        id: ncId, type: 'fattura', number: '', date: today, customer: clone(orig.customer), lines,
        notes: orig.notes, status: 'bozza', invoice, createdAt: now, updatedAt: now,
      };
      return {
        draft,
        deps: { origId: orig.id, origStatus: orig.status, origUpdated: orig.updatedAt, priorNet, ids: prior.map((d) => d.id) },
        finalize: async (tx, issued) => {
          const o = (await tx.get<QuoteDocument>('documents', orig.id))!;
          const detail = `${full ? 'Stornata integralmente' : 'Stornata in parte'} dalla nota di credito ${issued.invoice!.number}: ${reason}`;
          if (full) await tx.put('documents', { ...o, status: 'stornata', updatedAt: now });
          await addAudit(tx, { docId: orig.id, action: 'credit_note', detail, xmlSha256: issued.invoice!.xmlSha256, at: now });
        },
      };
    },
    (c) => `Emessa nota di credito ${c.issued.invoice!.number} su ${c.issued.invoice!.originalNumber} (${c.gen.fileName}): ${reason}`,
  );
  return r.doc;
};

// ---------------------------------------------------------------- esiti SDI

/** Registra un esito/invio SDI (v1 manuale): aggiorna status coerentemente. */
export const recordSdiEvent = async (docId: string, ev: SdiEvent): Promise<QuoteDocument> =>
  getBackend().transact('readwrite', async (t) => {
    const d = await t.get<QuoteDocument>('documents', docId);
    if (!d) throw new Error('Fattura non trovata.');
    if (!isFiscalInvoice(d) || !d.invoice.lockedAt) {
      throw new InvalidSdiTransitionError('Gli esiti SDI si registrano solo su fatture emesse (non su bozze o fatture di cortesia).');
    }
    if (!ev || !Number.isFinite(ev.at)) throw new InvalidSdiTransitionError('Evento SDI senza data valida.');
    const from = d.status;
    let to: DocStatus | undefined;
    switch (ev.type) {
      case 'INVIO':
        if (from === 'emessa') to = 'inviata';
        else if (from === 'scartata') {
          const ns = [...d.invoice.sdiEvents].reverse().find((e) => e.type === 'NS');
          if (ns && ev.at > ns.at + RESUBMIT_DAYS * 86_400_000) {
            throw new InvalidSdiTransitionError(
              `Sono passati più di ${RESUBMIT_DAYS} giorni dallo scarto: non si può rinviare con lo stesso numero. Crea una nuova fattura collegata.`);
          }
          to = 'inviata';
        }
        break;
      case 'RC': if (from === 'inviata' || from === 'mancata_consegna') to = 'consegnata'; break;
      case 'MC': if (from === 'inviata') to = 'mancata_consegna'; break;
      case 'NS': if (from === 'inviata') to = 'scartata'; break;
      default: throw new InvalidSdiTransitionError(`Evento SDI sconosciuto: ${String((ev as { type: unknown }).type)}`);
    }
    if (!to) {
      throw new InvalidSdiTransitionError(
        `Evento ${ev.type} non consentito con la fattura nello stato "${from}"` +
        (from === 'emessa' ? ': registra prima l\'invio allo SDI.' : from === 'stornata' ? ': la fattura è stornata.' : '.'));
    }
    const now = Date.now();
    const next: QuoteDocument = {
      ...d, status: to, updatedAt: now,
      invoice: { ...d.invoice, sdiEvents: [...d.invoice.sdiEvents, clone(ev)] },
    };
    await t.put('documents', next);
    const label = ev.type === 'INVIO' ? `Invio allo SDI dichiarato (${ev.channel})` : `Esito SDI ${ev.type}${ev.errorCodes?.length ? ` [${ev.errorCodes.join(', ')}]` : ''}`;
    await addAudit(t, {
      docId, action: ev.type === 'INVIO' ? 'mark_sent' : 'sdi_event',
      detail: `${label}: ${from} -> ${to}${ev.note ? ` — ${ev.note}` : ''}`, xmlSha256: d.invoice.xmlSha256, at: now,
    });
    return next;
  });

// ---------------------------------------------------------------- pagamenti

export const recordPayment = async (docId: string, p: { date: string; amount: number; method?: string }): Promise<QuoteDocument> =>
  getBackend().transact('readwrite', async (t) => {
    const d = await t.get<QuoteDocument>('documents', docId);
    if (!d) throw new Error('Fattura non trovata.');
    if (d.type !== 'fattura' || !d.invoice || (!d.invoice.lockedAt && !d.invoice.legacy)) {
      throw new Error('I pagamenti si registrano solo su fatture emesse.');
    }
    if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error('Importo del pagamento non valido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '')) throw new Error('Data del pagamento non valida (AAAA-MM-GG).');
    const profile = withDefaults(await t.getProfile());
    const payments = [...d.invoice.payments, { date: p.date, amount: p.amount, ...(p.method ? { method: p.method } : {}) }];
    const paid = payments.reduce((s, x) => s + cents(x.amount), 0);
    const gross = cents(computeTotals(d.lines, { forfettario: profile.regimeForfettario, type: 'fattura' }).gross);
    const paymentStatus = paid >= gross && gross > 0 ? 'pagata' : paid > 0 ? 'parziale' : 'non_pagata';
    const now = Date.now();
    const next: QuoteDocument = { ...d, updatedAt: now, invoice: { ...d.invoice, payments, paymentStatus } };
    await t.put('documents', next);
    await addAudit(t, { docId, action: 'payment', detail: `Pagamento di ${p.amount.toFixed(2)} € il ${p.date}${p.method ? ` (${p.method})` : ''} -> ${paymentStatus}`, at: now });
    return next;
  });
