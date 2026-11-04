/**
 * Aggancio del cliente dettato alla rubrica esistente (fuzzy match, tollerante a refusi,
 * cognome solo, apostrofi/spazi diversi) con segnalazione esplicita delle ambiguità.
 */
import { levBounded } from './match';
import { stripAccents } from './text';

export interface CustomerRef {
  id: string;
  name: string;
}
export interface CustomerCandidate extends CustomerRef {
  score: number;
}
export type CustomerMatchStatus = 'matched' | 'ambiguous' | 'weak' | 'new';
export interface CustomerMatch {
  status: CustomerMatchStatus;
  /** id e nome in rubrica (solo se `matched`); altrimenti il nome dettato */
  id?: string;
  name: string;
  score: number;
}

const TITLE = new Set(['signor', 'signore', 'signora', 'signorina', 'sig', 'sigra', 'dott', 'dottor', 'dottore', 'dottoressa', 'dr', 'ing', 'ingegner', 'ingegnere', 'geom', 'geometra', 'avv', 'avvocato', 'prof', 'professor', 'professore', 'arch', 'architetto', 'ragionier', 'ragioniere', 'don']);
const FILLERS = new Set(['il', 'lo', 'la', 'le', 'i', 'gli', 'l', 'un', 'una']);
const ORG = new Set(['condominio', 'ditta', 'studio', 'famiglia', 'impresa', 'societa', 'azienda', 'cliente']);
const COMPANY = new Set(['srl', 'spa', 'snc', 'sas', 'sa', 'sdf', 'ss', 'srls']);
const PARTICLE = new Set(['de', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'dal', 'dalla', 'da', 'lo', 'la', 'le', 'van', 'von', 'mac', 'mc', 'dall', 'dell', 'd']);

const WEIGHT_PARTICLE = 0.3;
const WEIGHT_ORG = 0.5;
const WEIGHT_COMPANY = 0.2;

interface Tk {
  t: string;
  w: number;
}

function toks(name: string): Tk[] {
  const clean = stripAccents(String(name ?? '')).toLowerCase().replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const out: Tk[] = [];
  for (const t of clean.split(' ')) {
    if (!t || TITLE.has(t) || FILLERS.has(t)) continue;
    out.push({ t, w: COMPANY.has(t) ? WEIGHT_COMPANY : ORG.has(t) ? WEIGHT_ORG : PARTICLE.has(t) ? WEIGHT_PARTICLE : 1 });
  }
  return out;
}

function tokSim(a: string, b: string): number {
  if (a === b) return 1;
  const mn = Math.min(a.length, b.length);
  const mx = Math.max(a.length, b.length);
  if (mn >= 4 && mx - mn <= 2 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (mx >= 4 && levBounded(a, b, 1) <= 1) return mx >= 5 ? 0.85 : 0.75;
  if (mx >= 8 && levBounded(a, b, 2) <= 2) return 0.7;
  return 0;
}

function cover(from: Tk[], to: Tk[]): number {
  let s = 0;
  let t = 0;
  for (const x of from) {
    let b = 0;
    for (const y of to) b = Math.max(b, tokSim(x.t, y.t));
    s += x.w * b;
    t += x.w;
  }
  return t ? s / t : 0;
}

function score(S: Tk[], R: Tk[]): number {
  if (!S.length || !R.length) return 0;
  const tokenScore = 0.65 * cover(S, R) + 0.35 * cover(R, S);
  // "dangelo" = "d angelo", "gian luca" = "gianluca": confronto anche sulle stringhe unite
  const js = S.map((x) => x.t).join('');
  const jr = R.map((x) => x.t).join('');
  const joined = js === jr ? 1 : js.length >= 5 && jr.length >= 5 ? (levBounded(js, jr, 1) <= 1 ? 0.88 : 0) : 0;
  return Math.max(tokenScore, joined);
}

export const MATCH_ACCEPT = 0.8;
export const MATCH_WEAK = 0.6;
const AMBIG_GAP = 0.1;
const AMBIG_FLOOR = 0.75;

export function matchCustomer(spoken: string, customers: CustomerRef[]): { match: CustomerMatch; candidates: CustomerCandidate[] } {
  const S = toks(spoken);
  const none = { match: { status: 'new' as const, name: spoken, score: 0 }, candidates: [] as CustomerCandidate[] };
  if (!S.length || !Array.isArray(customers) || !customers.length) return none;
  const scored: CustomerCandidate[] = [];
  for (const c of customers) {
    if (!c || typeof c.name !== 'string') continue;
    const sc = score(S, toks(c.name));
    if (sc >= MATCH_WEAK) scored.push({ id: c.id, name: c.name, score: Math.round(sc * 1000) / 1000 });
  }
  if (!scored.length) return none;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (top.score >= MATCH_ACCEPT) {
    if (second && second.score >= AMBIG_FLOOR && top.score - second.score < AMBIG_GAP) {
      const cands = scored.filter((x) => x.score >= AMBIG_FLOOR && top.score - x.score < AMBIG_GAP);
      return { match: { status: 'ambiguous', name: spoken, score: top.score }, candidates: cands.slice(0, 5) };
    }
    return { match: { status: 'matched', id: top.id, name: top.name, score: top.score }, candidates: scored.slice(0, 3) };
  }
  return { match: { status: 'weak', name: spoken, score: top.score }, candidates: scored.slice(0, 3) };
}
