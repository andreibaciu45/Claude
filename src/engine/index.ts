/** MOTORE VOCE — API pubblica. Firme fisse: parseDictation, computeTotals. */
export { parseDictation } from './parse';
export { computeTotals } from './totals';
export { normalizeText } from './normalize';
export { parseItalianNumber, fmtNum } from './numbers';
export { matchCatalog, createMatcher, getMatcher } from './match';
export { getMatcher as prepareCatalog } from './match';
export type { MatchResult } from './match';
export { parseDictationWithContext, MAX_TRANSCRIPT_CHARS } from './parse';
export type { ParseContext, ParseResultV2, LineMeta } from './parse';
export { matchCustomer } from './customerMatch';
export type { CustomerRef, CustomerCandidate, CustomerMatch, CustomerMatchStatus } from './customerMatch';
export { extractModifiers } from './modifiers';
export type { Modifiers, Discount } from './modifiers';
