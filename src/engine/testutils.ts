import type { DocLine } from '../types';
import { DEFAULT_CATALOG, type Case, type ExpLine } from './cases';
import { parseDictation } from './index';

export function lineOk(l: DocLine | undefined, e: ExpLine): string[] {
  if (!l) return ['riga mancante'];
  const errs: string[] = [];
  if (e.id !== undefined) {
    const ids = Array.isArray(e.id) ? e.id : [e.id];
    if (!l.catalogItemId || !ids.includes(l.catalogItemId)) errs.push(`id ${l.catalogItemId} != ${ids.join('|')}`);
  }
  if (e.free !== undefined) {
    if (l.catalogItemId) errs.push(`atteso libera, trovato ${l.catalogItemId}`);
    if (!l.description.toLowerCase().includes(e.free.toLowerCase())) errs.push(`descr "${l.description}" senza "${e.free}"`);
  }
  if (Math.abs(l.qty - e.qty) > 1e-9) errs.push(`qty ${l.qty} != ${e.qty}`);
  if (e.unit && l.unit !== e.unit) errs.push(`unit ${l.unit} != ${e.unit}`);
  if (e.review !== undefined && !!l.needsReview !== e.review) errs.push(`review ${!!l.needsReview} != ${e.review}`);
  if (e.price !== undefined && l.unitPrice !== e.price) errs.push(`prezzo ${l.unitPrice} != ${e.price}`);
  return errs;
}

export function caseErrors(c: Case): string[] {
  const r = parseDictation(c.text, c.catalog ?? DEFAULT_CATALOG);
  const errs: string[] = [];
  if (c.customer !== undefined && (r.customerName ?? null) !== c.customer) errs.push(`cliente ${r.customerName} != ${c.customer}`);
  if (r.lines.length !== c.lines.length) errs.push(`numero righe ${r.lines.length} != ${c.lines.length}: ${r.lines.map((l) => `${l.description}x${l.qty}`).join(' | ')}`);
  c.lines.forEach((e, i) => errs.push(...lineOk(r.lines[i], e).map((x) => `riga ${i + 1}: ${x}`)));
  if (c.leftovers) {
    if (c.leftovers.length === 0 && r.leftovers.length) errs.push(`leftovers inattesi: ${r.leftovers.join(' | ')}`);
    for (const lo of c.leftovers) if (!r.leftovers.some((x) => x.toLowerCase().includes(lo.toLowerCase()))) errs.push(`leftover mancante "${lo}" in [${r.leftovers.join(' | ')}]`);
  }
  return errs;
}

