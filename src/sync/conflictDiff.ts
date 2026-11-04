/**
 * Confronto leggibile fra due versioni di una bozza in conflitto (locale / server).
 * Funzioni pure: nessun accesso a storage o rete.
 */
import type { DocLine, QuoteDocument } from '../types';
import { computeTotals } from '../engine';

export interface ConflictDiffRow {
  /** nome del campo in italiano: Cliente, Righe, Totale, Note, Data, Stato */
  field: string;
  local: string;
  server: string;
}

const MAX_LINES_SHOWN = 8;
const eur = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;
const norm = (s: string | undefined): string => (s ?? '').trim();

function lineText(l: DocLine): string {
  const disc = l.discountPct ? ` -${l.discountPct}%` : '';
  return `${norm(l.description) || '(senza descrizione)'} · ${l.qty} ${l.unit} × ${eur(l.unitPrice)}${disc}`;
}

function linesText(lines: DocLine[] | undefined): string {
  const ls = lines ?? [];
  if (!ls.length) return 'Nessuna riga';
  const shown = ls.slice(0, MAX_LINES_SHOWN).map(lineText);
  if (ls.length > MAX_LINES_SHOWN) shown.push(`… e altre ${ls.length - MAX_LINES_SHOWN}`);
  return shown.join('\n');
}

const sameLines = (a: DocLine[] | undefined, b: DocLine[] | undefined): boolean =>
  JSON.stringify((a ?? []).map(lineKey)) === JSON.stringify((b ?? []).map(lineKey));
const lineKey = (l: DocLine) => [norm(l.description), l.qty, l.unit, l.unitPrice, l.vat, l.discountPct ?? 0, l.catalogItemId ?? ''];

function totalOf(d: QuoteDocument, forfettario: boolean): number {
  try { return computeTotals(d.lines ?? [], { forfettario, type: d.type }).gross; } catch { return 0; }
}

/** Solo i campi che DIFFERISCONO (cliente, righe, totale, note, data, stato). Vuoto = versioni equivalenti per l'utente. */
export function diffDrafts(local: QuoteDocument, server: QuoteDocument, opts: { forfettario?: boolean } = {}): ConflictDiffRow[] {
  const f = !!opts.forfettario;
  const rows: ConflictDiffRow[] = [];
  if (norm(local.customer?.name) !== norm(server.customer?.name)) {
    rows.push({ field: 'Cliente', local: norm(local.customer?.name) || '(nessuno)', server: norm(server.customer?.name) || '(nessuno)' });
  }
  if (!sameLines(local.lines, server.lines)) rows.push({ field: 'Righe', local: linesText(local.lines), server: linesText(server.lines) });
  const lt = totalOf(local, f), st = totalOf(server, f);
  if (Math.round(lt * 100) !== Math.round(st * 100)) rows.push({ field: 'Totale', local: eur(lt), server: eur(st) });
  if (norm(local.notes) !== norm(server.notes)) rows.push({ field: 'Note', local: norm(local.notes) || '(nessuna)', server: norm(server.notes) || '(nessuna)' });
  if (local.date !== server.date) rows.push({ field: 'Data', local: local.date, server: server.date });
  if (local.status !== server.status) rows.push({ field: 'Stato', local: String(local.status), server: String(server.status) });
  return rows;
}

export const isDocLike = (v: unknown): v is QuoteDocument =>
  !!v && typeof v === 'object' && typeof (v as QuoteDocument).id === 'string' && Array.isArray((v as QuoteDocument).lines);

/**
 * Copia locale come NUOVO documento bozza: nuovo id, nota "copia in conflitto", nessun numero fiscale,
 * nessun legame con altri documenti, nessuna traccia di emissione/SDI.
 */
export function makeConflictCopy(d: QuoteDocument, newId: string, now: number): QuoteDocument {
  const copy: QuoteDocument = structuredClone(d);
  copy.id = newId;
  copy.createdAt = now;
  copy.updatedAt = now;
  const tag = `Copia in conflitto (modifica locale del ${new Date(d.updatedAt || now).toLocaleDateString('it-IT')})`;
  copy.notes = copy.notes?.trim() ? `${tag}\n${copy.notes}` : tag;
  delete copy.convertedToInvoiceId;
  if (d.type === 'fattura') {
    copy.number = '';
    copy.status = 'bozza';
    if (copy.invoice) {
      const inv = copy.invoice;
      delete inv.number; delete inv.seq; delete inv.issuedAt; delete inv.lockedAt; delete inv.progressivoInvio;
      delete inv.xml; delete inv.xmlSha256; delete inv.fileName; delete inv.xmlHistory; delete inv.resubmissionOf;
      inv.sdiEvents = []; inv.payments = []; inv.paymentStatus = 'non_pagata';
    }
  } else {
    copy.number = `${d.number} (copia in conflitto)`;
  }
  return copy;
}
