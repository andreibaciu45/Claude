/**
 * Esecutore dei comandi: chiama SOLO le funzioni pubbliche dei contratti (src/storage, src/engine, src/pdf).
 *
 *  planCommand()    -> risolve il documento bersaglio, controlla le precondizioni e prepara il RIEPILOGO in chiaro
 *                      (documento, cliente, importo). Non scrive nulla.
 *  executeCommand() -> esegue. Per i comandi IRREVERSIBILI esige il gettone di conferma creato da policy/ (altrimenti lancia).
 *
 * Audit: il contratto non espone una funzione pubblica per scrivere nel registro. Si usa `appendAudit` di src/storage se
 * esiste (richiesta all'agente STORAGE-FATTURE); altrimenti si ripiega in silenzio (le funzioni di storage registrano già
 * le proprie azioni). Vedi `voiceAudit`.
 */
import * as storage from '../storage';
import {
  createCreditNote, createInvoiceFromQuote, getDocument, getProfile, issueInvoice, listCatalog, listDocuments,
  nextDocumentNumber, recordPayment, recordSdiEvent, saveDocument, deleteDocument,
} from '../storage';
import { computeTotals, parseDictation } from '../engine';
import { generateDocumentPdf } from '../pdf';
import type { AuditEntry, Customer, DocLine, InvoiceFiscal, Profile, QuoteDocument } from '../types';
import { roundMoney, uid } from '../types';
import { consumeConfirmation, riskOf, type Confirmation, type ConfirmSummary, type TargetInfo } from './policy';
import { docLabel, isCreditNote, resolveRef, toChoice, type DocChoice } from './resolve';
import type { Command, DocRef } from './types';

/* ------------------------------------------------------------------ tipi */

export interface ExecContext {
  currentDocumentId?: string;
  /** trascrizione originale (audit `voiceTranscript`) */
  transcript?: string;
  now?: Date;
  /** salvataggio file (default: link temporaneo). Iniettabile nei test. */
  download?: (blob: Blob, filename: string) => void;
}

export type PlanResult =
  | { status: 'ready'; command: Command; summary: ConfirmSummary; target: TargetInfo }
  /** più documenti possibili: l'utente sceglie, poi si ripianifica con `command` (riferimento già fissato all'id) */
  | { status: 'choose'; message: string; choices: Array<DocChoice & { command: Command }> }
  | { status: 'blocked'; message: string; issues?: string[]; hint?: string };

export interface ExecResult {
  message: string;
  navigateTo?: string;
  /** annullamento (solo azioni reversibili) */
  undo?: () => Promise<void>;
  items?: DocChoice[];
}

export class VoiceExecError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) { super(message); this.name = 'VoiceExecError'; this.issues = issues; }
}

/* ------------------------------------------------------------------ utilità */

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const fmtEur = (n: number) => eur.format(Number.isFinite(n) ? n : 0);
const isoToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ISSUED = new Set(['emessa', 'inviata', 'consegnata', 'mancata_consegna']);
const isIssued = (d: QuoteDocument) => d.type === 'fattura' && (!!d.invoice?.lockedAt || ISSUED.has(String(d.status)) || d.status === 'stornata');
const pin = (c: Command, id: string): Command => ('ref' in c ? ({ ...c, ref: { kind: 'id', id } as DocRef } as Command) : c);

const totalsOf = (d: QuoteDocument, p: Profile) => computeTotals(d.lines, { forfettario: !!p.regimeForfettario, type: d.type });

function paidSoFar(d: QuoteDocument): number {
  return roundMoney((d.invoice?.payments ?? []).reduce((s, x) => s + (Number.isFinite(x.amount) ? x.amount : 0), 0));
}

async function voiceAudit(docId: string, action: AuditEntry['action'], ctx: ExecContext, detail?: string): Promise<void> {
  try {
    const fn = (storage as unknown as Record<string, unknown>).appendAudit;
    if (typeof fn !== 'function') return;
    await (fn as (e: Pick<AuditEntry, 'docId' | 'action' | 'detail' | 'voiceTranscript'>) => Promise<void>)({
      docId, action: 'voice_command', detail: `${action}${detail ? `: ${detail}` : ''}`, voiceTranscript: ctx.transcript,
    });
  } catch { /* l'audit non deve mai far fallire l'azione già eseguita */ }
}

const isImmutable = (e: unknown) => (e as { constructor?: { name?: string } })?.constructor?.name === 'ImmutableDocumentError';

function wrapStorageError(e: unknown): never {
  if (e instanceof VoiceExecError) throw e;
  const issues = (e as { issues?: Array<{ message?: string; severity?: string }> })?.issues;
  if (Array.isArray(issues) && issues.length) {
    const errs = issues.filter((i) => i.severity !== 'warning').map((i) => i.message ?? '').filter(Boolean);
    throw new VoiceExecError('La fattura non supera i controlli prima dell’emissione.', errs);
  }
  if (isImmutable(e)) throw new VoiceExecError('Il documento è già emesso: non si può modificare né cancellare. Se serve annullarlo, usa la nota di credito.');
  throw e instanceof Error ? new VoiceExecError(e.message) : new VoiceExecError('Operazione non riuscita.');
}

function normName(s: string) { return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Riusa i dati anagrafici di un cliente già presente nei documenti (stesso nome), per non perdere P.IVA/CF/indirizzo. */
export function findKnownCustomer(name: string, docs: QuoteDocument[]): Customer | undefined {
  const q = normName(name);
  if (!q) return undefined;
  const sorted = [...docs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const exact = sorted.find((d) => normName(d.customer?.name ?? '') === q);
  if (exact) return { ...exact.customer };
  const toks = q.split(' ');
  const part = sorted.filter((d) => { const n = normName(d.customer?.name ?? '').split(' '); return toks.every((t) => n.includes(t)); });
  const names = new Set(part.map((d) => normName(d.customer.name)));
  return names.size === 1 ? { ...part[0].customer } : undefined;
}

function freshInvoiceFiscal(profile: Profile, doc: Pick<QuoteDocument, 'lines' | 'date'>): InvoiceFiscal {
  const stamp = computeTotals(doc.lines, { forfettario: !!profile.regimeForfettario, type: 'fattura' }).stamp;
  return {
    tipoDocumento: 'TD01', year: Number(doc.date.slice(0, 4)) || new Date().getFullYear(), sectional: 'FT', operationDate: doc.date,
    stampDuty: stamp > 0, stampDutyChargedToCustomer: !!profile.stampDutyDefaultChargedToCustomer, stampAmount: stamp > 0 ? 2 : 0,
    customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [],
  };
}

const field = (label: string, value: string) => ({ label, value });

function baseFields(d: QuoteDocument, p: Profile): ConfirmSummary['fields'] {
  const t = totalsOf(d, p);
  return [
    field('Documento', docLabel(d)),
    field('Cliente', d.customer?.name || '(senza cliente)'),
    field('Importo', fmtEur(t.gross)),
    field('Data', d.date.split('-').reverse().join('/')),
  ];
}

/* ------------------------------------------------------------------ pianificazione */

const preferFor = (c: Command): ((d: QuoteDocument) => boolean) | undefined => {
  switch (c.type) {
    case 'issue_invoice': return (d) => d.type === 'fattura' && d.status === 'bozza';
    case 'credit_note': return (d) => d.type === 'fattura' && !!d.invoice?.lockedAt && !isCreditNote(d) && d.status !== 'stornata';
    case 'mark_paid': return (d) => d.type === 'fattura' && !!d.invoice?.lockedAt && d.invoice.paymentStatus !== 'pagata';
    case 'mark_sent': return (d) => d.status === 'bozza' && d.type === 'preventivo' || d.status === 'emessa';
    case 'delete_draft': case 'add_line': return (d) => d.status === 'bozza';
    case 'convert_quote': return (d) => d.type === 'preventivo' && d.status !== 'convertito';
    case 'quote_status': return (d) => d.type === 'preventivo';
    default: return undefined;
  }
};

const blocked = (message: string, hint?: string, issues?: string[]): PlanResult => ({ status: 'blocked', message, hint, issues });

export async function planCommand(command: Command, ctx: ExecContext = {}): Promise<PlanResult> {
  switch (command.type) {
    case 'confirm': case 'affirm': case 'dismiss': case 'undo':
      return { status: 'ready', command, summary: { headline: '', fields: [], warnings: [] }, target: {} };
    case 'new_document': {
      const [catalog, docs] = await Promise.all([listCatalog(), listDocuments()]);
      const res = parseDictation(command.dictation, catalog);
      if (!res.customerName && !res.lines.length) {
        return { status: 'ready', command, summary: { headline: `Nuovo ${command.docType}`, fields: [], warnings: [], consequence: 'Apro la schermata di dettatura.' }, target: {} };
      }
      if (!res.customerName) return blocked('Non ho capito per quale cliente.', 'Prova così: «preventivo per Rossi, tre metri di tubo».');
      const known = findKnownCustomer(res.customerName, docs);
      const review = res.lines.filter((l) => l.needsReview).length;
      return {
        status: 'ready', command, target: {},
        summary: {
          headline: `Creo ${command.docType === 'fattura' ? 'una bozza di fattura' : 'un preventivo'}`,
          fields: [field('Cliente', known?.name ?? res.customerName), field('Voci', String(res.lines.length))],
          warnings: review ? [`${review} voci non trovate a catalogo: da verificare.`] : [],
        },
      };
    }
    case 'list': return { status: 'ready', command, summary: { headline: '', fields: [], warnings: [] }, target: {} };
    default: break;
  }

  // comandi su un documento esistente
  const [docs, profile] = await Promise.all([listDocuments(), getProfile()]);
  const r = resolveRef((command as Extract<Command, { ref: DocRef }>).ref, docs, { currentDocumentId: ctx.currentDocumentId, prefer: preferFor(command), today: ctx.now });
  if (!r.ok) {
    if (r.reason === 'ambiguous') return { status: 'choose', message: r.message, choices: r.candidates.map((d) => ({ ...toChoice(d), command: pin(command, d.id) })) };
    return blocked(r.message);
  }
  const d = r.doc;
  const pinned = pin(command, d.id);
  const t = totalsOf(d, profile);
  const ready = (summary: ConfirmSummary, target: TargetInfo = {}): PlanResult => ({ status: 'ready', command: pinned, summary, target });
  const noRev = d.lines.filter((l) => l.needsReview).length;

  switch (command.type) {
    case 'open': return ready({ headline: `Apro ${docLabel(d)}`, fields: [], warnings: [] });

    case 'download':
      if (command.format === 'xml' && !(d.type === 'fattura' && d.invoice?.xml)) {
        return blocked(d.type === 'fattura' ? 'L’XML esiste solo per le fatture già emesse.' : 'L’XML esiste solo per le fatture, non per i preventivi.', d.type === 'fattura' ? 'Emetti prima la fattura.' : 'Per il preventivo puoi scaricare il PDF.');
      }
      return ready({ headline: `Scarico ${command.format.toUpperCase()} di ${docLabel(d)}`, fields: [], warnings: [] });

    case 'issue_invoice': {
      if (d.type !== 'fattura') return blocked('I preventivi non si emettono.', 'Puoi convertirlo in fattura: «converti il preventivo in fattura».');
      if (isIssued(d)) return blocked(`${docLabel(d)} è già emessa.`, 'Una fattura emessa non si modifica: per annullarla serve la nota di credito.');
      if (d.status !== 'bozza') return blocked(`${docLabel(d)} è nello stato «${d.status}»: non è una bozza da emettere.`);
      const issues: string[] = [];
      if (!d.customer?.name?.trim()) issues.push('Manca il cliente.');
      if (!d.lines.length) issues.push('La fattura non ha righe.');
      if (noRev) issues.push(`${noRev} ${noRev === 1 ? 'riga è da verificare' : 'righe sono da verificare'} (voce non trovata a catalogo o prezzo da confermare).`);
      if (d.lines.some((l) => !(l.unitPrice > 0))) issues.push('Ci sono righe senza prezzo.');
      if (issues.length) return blocked('Non posso emettere: la bozza ha dei problemi.', 'Correggi la bozza e riprova.', issues);
      const warnings: string[] = [];
      if (t.stamp > 0) warnings.push(`Include marca da bollo di ${fmtEur(t.stamp)}.`);
      return ready({
        headline: 'Emettere questa fattura?',
        fields: [...baseFields(d, profile), field('Numero', 'assegnato al momento dell’emissione')],
        warnings,
        consequence: 'Dopo l’emissione la fattura non si può più modificare né cancellare: si può solo stornare con una nota di credito.',
      });
    }

    case 'credit_note': {
      if (d.type !== 'fattura') return blocked('La nota di credito si fa su una fattura, non su un preventivo.', 'Per un preventivo puoi eliminarlo o segnarlo come rifiutato.');
      if (isCreditNote(d)) return blocked('Questo documento è già una nota di credito.');
      if (d.status === 'stornata') return blocked(`${docLabel(d)} è già stornata.`);
      if (d.status === 'bozza' && !d.invoice?.lockedAt) return blocked(`${docLabel(d)} è ancora una bozza: non serve una nota di credito.`, 'Puoi eliminare la bozza: «elimina la bozza».');
      if (d.status === 'scartata') return blocked(`${docLabel(d)} è stata scartata dallo SDI e si considera non emessa.`, 'Correggila e reinviala entro 5 giorni (stesso numero e data), non serve la nota di credito.');
      if (!isIssued(d)) return blocked(`${docLabel(d)} non risulta emessa.`);
      return ready({
        headline: 'Stornare questa fattura con nota di credito?',
        fields: [
          ...baseFields(d, profile),
          field('Storno', 'totale'),
          field('Motivo', command.reason ?? 'Annullamento fattura'),
        ],
        warnings: [],
        consequence: 'La nota di credito viene emessa subito e collegata alla fattura originale. Non si può annullare: eventuali correzioni richiedono un nuovo documento.',
      });
    }

    case 'mark_paid': {
      if (d.type !== 'fattura') return blocked('I preventivi non si incassano: il pagamento si registra sulla fattura.');
      if (isCreditNote(d)) return blocked('Una nota di credito non si incassa.');
      if (!d.invoice?.lockedAt) return blocked(`${docLabel(d)} non è ancora emessa.`, 'Emetti la fattura prima di registrare l’incasso.');
      if (d.status === 'scartata') return blocked(`${docLabel(d)} è stata scartata dallo SDI: si considera non emessa.`);
      const residual = roundMoney(t.gross - paidSoFar(d));
      if (residual <= 0.004) return blocked(`${docLabel(d)} risulta già pagata per intero.`);
      const amount = command.amount ?? residual;
      if (!(amount > 0)) return blocked('L’importo del pagamento non è valido.');
      const warnings = amount > residual + 0.004 ? [`L’importo supera il residuo da incassare (${fmtEur(residual)}).`] : [];
      return ready({
        headline: 'Registrare questo incasso?',
        fields: [field('Documento', docLabel(d)), field('Cliente', d.customer.name), field('Importo', fmtEur(amount)), field('Residuo prima', fmtEur(residual)), field('Data', isoToday(ctx.now).split('-').reverse().join('/'))],
        warnings,
        consequence: 'Il pagamento non modifica la fattura emessa; per correggerlo servirà un’annotazione.',
      });
    }

    case 'mark_sent': {
      if (d.type === 'preventivo') {
        if (d.status !== 'bozza') return blocked(`${docLabel(d)} è già «${d.status}».`);
        return ready({ headline: 'Segnare il preventivo come inviato?', fields: baseFields(d, profile), warnings: [] });
      }
      if (!d.invoice?.lockedAt) return blocked(`${docLabel(d)} non è ancora emessa.`, 'Emetti la fattura prima di segnarla come inviata allo SDI.');
      if (d.status !== 'emessa') return blocked(`${docLabel(d)} risulta già «${d.status}».`);
      return ready({
        headline: 'Segnare la fattura come inviata allo SDI?',
        fields: baseFields(d, profile), warnings: [],
        consequence: 'Registro l’invio dal portale dell’Agenzia delle Entrate con la data di oggi. Non trasmetto nulla allo SDI.',
      });
    }

    case 'quote_status':
      if (d.type !== 'preventivo') return blocked('Accettato/rifiutato vale solo per i preventivi.');
      if (d.status === 'convertito') return blocked('Questo preventivo è già stato convertito in fattura.');
      return ready({ headline: `Segnare come ${command.status}?`, fields: baseFields(d, profile), warnings: [] });

    case 'convert_quote':
      if (d.type !== 'preventivo') return blocked('Si può convertire in fattura solo un preventivo.');
      if (d.status === 'convertito') return blocked(`${docLabel(d)} è già stato convertito in fattura.`, 'Apri la fattura già creata oppure scegli un altro preventivo.');
      return ready({
        headline: 'Creare la bozza di fattura da questo preventivo?',
        fields: baseFields(d, profile),
        warnings: noRev ? [`${noRev} righe da verificare.`] : [],
        consequence: 'Creo una bozza (senza numero) con righe e cliente; il preventivo passa a «convertito».',
      });

    case 'duplicate':
      if (isCreditNote(d)) return blocked('Una nota di credito non si duplica.');
      return ready({ headline: `Duplico ${docLabel(d)} come nuova bozza`, fields: baseFields(d, profile), warnings: [] });

    case 'add_line': {
      if (d.type === 'fattura' && (isIssued(d) || d.status !== 'bozza')) return blocked(`${docLabel(d)} è già emessa: non si modifica.`, 'Per correggerla serve la nota di credito.');
      if (d.type === 'preventivo' && d.status === 'convertito') return blocked('Questo preventivo è già stato convertito in fattura.');
      const catalog = await listCatalog();
      const parsed = parseDictation(command.dictation, catalog);
      if (!parsed.lines.length) return blocked('Non ho riconosciuto nessuna voce da aggiungere.', 'Prova: «aggiungi due ore di manodopera».');
      const rev = parsed.lines.filter((l) => l.needsReview).length;
      return ready({
        headline: `Aggiungo ${parsed.lines.length} ${parsed.lines.length === 1 ? 'voce' : 'voci'} a ${docLabel(d)}`,
        fields: [field('Documento', docLabel(d)), field('Cliente', d.customer.name), ...parsed.lines.slice(0, 4).map((l) => field('Voce', `${l.qty} ${l.unit} ${l.description}`))],
        warnings: rev ? [`${rev} voci non trovate a catalogo: da verificare.`] : [],
      });
    }

    case 'delete_draft': {
      if (d.type === 'fattura' && (isIssued(d) || d.status !== 'bozza')) {
        return blocked(`${docLabel(d)} è stata emessa: una fattura emessa non si cancella.`, 'Puoi stornarla con una nota di credito: «annulla la fattura con nota di credito».');
      }
      return ready({ headline: `Eliminare ${docLabel(d)}?`, fields: baseFields(d, profile), warnings: d.type === 'preventivo' && d.status === 'convertito' ? ['Il preventivo è collegato a una fattura.'] : [] }, { hasLines: d.lines.length > 0 });
    }
  }
}

/* ------------------------------------------------------------------ esecuzione */

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'documento';

export async function executeCommand(command: Command, ctx: ExecContext = {}, confirmation?: Confirmation): Promise<ExecResult> {
  // difesa in profondità: gli irreversibili non partono senza gettone valido, qualunque sia il chiamante
  if (riskOf(command) === 'irreversible') consumeConfirmation(confirmation, command);
  try {
    return await run(command, ctx);
  } catch (e) {
    return wrapStorageError(e);
  }
}

async function load(ref: DocRef | undefined, command: Command, ctx: ExecContext): Promise<QuoteDocument> {
  if (ref?.kind === 'id') {
    const d = await getDocument(ref.id);
    if (!d) throw new VoiceExecError('Il documento non esiste più.');
    return d;
  }
  // senza riferimento fissato (uso diretto): stessa risoluzione della pianificazione
  const docs = await listDocuments();
  const r = resolveRef(ref ?? { kind: 'current' }, docs, { currentDocumentId: ctx.currentDocumentId, prefer: preferFor(command), today: ctx.now });
  if (!r.ok) throw new VoiceExecError(r.message);
  return r.doc;
}

async function run(command: Command, ctx: ExecContext): Promise<ExecResult> {
  const today = isoToday(ctx.now);
  const now = (ctx.now ?? new Date()).getTime();
  switch (command.type) {
    case 'confirm': case 'affirm': case 'dismiss': case 'undo':
      return { message: '' };

    case 'new_document': {
      const [profile, catalog, docs] = await Promise.all([getProfile(), listCatalog(), listDocuments()]);
      const res = parseDictation(command.dictation, catalog);
      if (!res.customerName && !res.lines.length) return { message: 'Detta il documento.', navigateTo: '/' };
      if (!res.customerName) throw new VoiceExecError('Non ho capito per quale cliente.');
      const customer: Customer = findKnownCustomer(res.customerName, docs) ?? { id: uid(), name: res.customerName };
      const lines: DocLine[] = res.lines.map((l) => ({ ...l, id: l.id || uid() }));
      const doc: QuoteDocument = {
        id: uid(), type: command.docType,
        number: command.docType === 'preventivo' ? await nextDocumentNumber('preventivo') : '',
        date: today, customer, lines, status: 'bozza', transcript: ctx.transcript ?? command.dictation, createdAt: now, updatedAt: now,
      };
      if (doc.type === 'fattura') doc.invoice = freshInvoiceFiscal(profile, doc);
      await saveDocument(doc);
      await voiceAudit(doc.id, 'create', ctx, `${doc.type} per ${customer.name}`);
      const rev = lines.filter((l) => l.needsReview).length;
      return {
        message: `${doc.type === 'preventivo' ? 'Preventivo' : 'Bozza di fattura'} per ${customer.name}: ${lines.length} ${lines.length === 1 ? 'voce' : 'voci'}${rev ? `, ${rev} da verificare` : ''}.`,
        navigateTo: `/documenti/${doc.id}`,
        undo: async () => { await deleteDocument(doc.id); },
      };
    }

    case 'list': {
      const docs = await listDocuments();
      const q = command.customerName ? normName(command.customerName).split(' ') : [];
      const items = docs
        .filter((d) => !command.docType || d.type === command.docType)
        .filter((d) => !q.length || q.every((t) => normName(d.customer?.name ?? '').split(' ').some((w) => w.startsWith(t))))
        .slice(0, 20).map(toChoice);
      return { message: items.length ? `${items.length} ${items.length === 1 ? 'documento' : 'documenti'}.` : 'Nessun documento trovato.', items };
    }

    case 'open': {
      const d = await load(command.ref, command, ctx);
      return { message: `Apro ${docLabel(d)}.`, navigateTo: `/documenti/${d.id}` };
    }

    case 'download': {
      const d = await load(command.ref, command, ctx);
      const save = ctx.download ?? triggerDownload;
      if (command.format === 'xml') {
        const xml = d.invoice?.xml;
        if (!xml) throw new VoiceExecError('L’XML esiste solo per le fatture già emesse.');
        save(new Blob([xml], { type: 'application/xml' }), d.invoice?.fileName ?? `${safeName(docLabel(d))}.xml`);
        await voiceAudit(d.id, 'download_xml', ctx);
        return { message: `XML di ${docLabel(d)} scaricato.` };
      }
      const profile = await getProfile();
      const blob = await generateDocumentPdf(d, profile);
      save(blob, `${safeName(docLabel(d))}.pdf`);
      return { message: `PDF di ${docLabel(d)} scaricato.` };
    }

    case 'convert_quote': {
      const q = await load(command.ref, command, ctx);
      if (q.type !== 'preventivo') throw new VoiceExecError('Si può convertire in fattura solo un preventivo.');
      if (q.status === 'convertito') throw new VoiceExecError('Questo preventivo è già stato convertito in fattura.');
      const before = structuredClone(q);
      const inv = await createInvoiceFromQuote(q.id);
      await voiceAudit(inv.id, 'convert_quote', ctx, `da ${q.number}`);
      return {
        message: `Bozza di fattura creata da ${docLabel(q)}.`,
        navigateTo: `/documenti/${inv.id}`,
        undo: async () => { await deleteDocument(inv.id); await saveDocument(before); },
      };
    }

    case 'issue_invoice': {
      const d = await load(command.ref, command, ctx);
      // riverifica subito prima di agire (la scheda può essere rimasta aperta)
      if (d.type !== 'fattura' || d.status !== 'bozza' || d.invoice?.lockedAt) throw new VoiceExecError(`${docLabel(d)} non è una bozza da emettere.`);
      const out = await issueInvoice(d.id);
      await voiceAudit(out.id, 'issue', ctx, out.number);
      return { message: `Fattura emessa: ${out.number}. Il file XML è pronto da scaricare.`, navigateTo: `/documenti/${out.id}` };
    }

    case 'credit_note': {
      const d = await load(command.ref, command, ctx);
      if (d.type !== 'fattura' || !isIssued(d) || isCreditNote(d) || d.status === 'stornata') throw new VoiceExecError(`${docLabel(d)} non può essere stornata.`);
      const nc = await createCreditNote(d.id, { reason: command.reason?.trim() || 'Annullamento fattura' });
      await voiceAudit(nc.id, 'credit_note', ctx, `storno di ${d.number}`);
      return { message: `Nota di credito ${nc.number} emessa per ${docLabel(d)}.`, navigateTo: `/documenti/${nc.id}` };
    }

    case 'mark_paid': {
      const d = await load(command.ref, command, ctx);
      const profile = await getProfile();
      const residual = roundMoney(totalsOf(d, profile).gross - paidSoFar(d));
      const amount = roundMoney(command.amount ?? residual);
      if (d.type !== 'fattura' || !d.invoice?.lockedAt) throw new VoiceExecError(`${docLabel(d)} non è una fattura emessa.`);
      if (!(amount > 0)) throw new VoiceExecError('Importo non valido.');
      await recordPayment(d.id, { date: today, amount });
      await voiceAudit(d.id, 'payment', ctx, fmtEur(amount));
      return { message: `Incasso di ${fmtEur(amount)} registrato su ${docLabel(d)}.`, navigateTo: `/documenti/${d.id}` };
    }

    case 'mark_sent': {
      const d = await load(command.ref, command, ctx);
      if (d.type === 'preventivo') {
        const before = structuredClone(d);
        await saveDocument({ ...d, status: 'inviato', updatedAt: now });
        await voiceAudit(d.id, 'edit', ctx, 'preventivo inviato');
        return { message: `${docLabel(d)} segnato come inviato.`, undo: async () => { await saveDocument(before); } };
      }
      await recordSdiEvent(d.id, { at: now, type: 'INVIO', channel: 'portale_ade', note: 'Registrato da comando vocale' });
      await voiceAudit(d.id, 'mark_sent', ctx);
      return { message: `${docLabel(d)} segnata come inviata allo SDI.`, navigateTo: `/documenti/${d.id}` };
    }

    case 'quote_status': {
      const d = await load(command.ref, command, ctx);
      if (d.type !== 'preventivo') throw new VoiceExecError('Accettato/rifiutato vale solo per i preventivi.');
      const before = structuredClone(d);
      await saveDocument({ ...d, status: command.status, updatedAt: now });
      await voiceAudit(d.id, 'edit', ctx, command.status);
      return { message: `${docLabel(d)}: ${command.status}.`, undo: async () => { await saveDocument(before); } };
    }

    case 'duplicate': {
      const [d, profile] = await Promise.all([load(command.ref, command, ctx), getProfile()]);
      if (isCreditNote(d)) throw new VoiceExecError('Una nota di credito non si duplica.');
      const copy: QuoteDocument = {
        id: uid(), type: d.type, number: d.type === 'preventivo' ? await nextDocumentNumber('preventivo') : '', date: today,
        customer: { ...d.customer }, lines: d.lines.map((l) => ({ ...l, id: uid() })), notes: d.notes, status: 'bozza',
        transcript: ctx.transcript, createdAt: now, updatedAt: now,
      };
      // mai copiare numero, XML, hash, eventi SDI, collegamenti (FISCAL-SPEC §6)
      if (d.type === 'fattura') copy.invoice = freshInvoiceFiscal(profile, copy);
      await saveDocument(copy);
      await voiceAudit(copy.id, 'duplicate', ctx, `da ${d.number || 'bozza'}`);
      return { message: `Duplicato come nuova bozza.`, navigateTo: `/documenti/${copy.id}`, undo: async () => { await deleteDocument(copy.id); } };
    }

    case 'add_line': {
      const d = await load(command.ref, command, ctx);
      if (d.type === 'fattura' && (d.status !== 'bozza' || d.invoice?.lockedAt)) throw new VoiceExecError(`${docLabel(d)} è già emessa: non si modifica.`);
      const catalog = await listCatalog();
      const parsed = parseDictation(command.dictation, catalog);
      if (!parsed.lines.length) throw new VoiceExecError('Non ho riconosciuto nessuna voce da aggiungere.');
      const before = structuredClone(d);
      const added = parsed.lines.map((l) => ({ ...l, id: uid() }));
      await saveDocument({ ...d, lines: [...d.lines, ...added], updatedAt: now });
      await voiceAudit(d.id, 'edit', ctx, `aggiunte ${added.length} righe`);
      const rev = added.filter((l) => l.needsReview).length;
      return {
        message: `${added.length} ${added.length === 1 ? 'voce aggiunta' : 'voci aggiunte'}${rev ? `, ${rev} da verificare` : ''}.`,
        navigateTo: `/documenti/${d.id}`,
        undo: async () => { await saveDocument(before); },
      };
    }

    case 'delete_draft': {
      const d = await load(command.ref, command, ctx);
      if (d.type === 'fattura' && (d.status !== 'bozza' || d.invoice?.lockedAt)) {
        throw new VoiceExecError(`${docLabel(d)} è stata emessa: una fattura emessa non si cancella.`, ['Puoi stornarla con una nota di credito.']);
      }
      const before = structuredClone(d);
      await deleteDocument(d.id);
      await voiceAudit(d.id, 'delete_draft', ctx, docLabel(d));
      return { message: `${docLabel(d)} eliminato.`, navigateTo: '/documenti', undo: async () => { await saveDocument(before); } };
    }
  }
}
