// STUB — l'agente MOTORE VOCE lo implementa con le stesse firme.
import type { CatalogItem, DocLine, DocType, ParseResult, Totals } from '../types';
export const parseDictation = (_t: string, _c: CatalogItem[]): ParseResult => ({ lines: [], leftovers: [] });
export const computeTotals = (_l: DocLine[], _o: { forfettario: boolean; type: DocType }): Totals => ({ net: 0, vat: 0, stamp: 0, gross: 0, byRate: [] });
