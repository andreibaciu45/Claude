/** MOTORE VOCE — API pubblica. Firme fisse: parseDictation, computeTotals. */
export { parseDictation } from './parse';
export { computeTotals } from './totals';
export { normalizeText } from './normalize';
export { parseItalianNumber, fmtNum } from './numbers';
export { matchCatalog, createMatcher } from './match';
export type { MatchResult } from './match';
