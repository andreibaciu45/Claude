/**
 * Matching di un testo parlato contro il catalogo (name + aliases).
 * Scoring proprio: copertura pesata IDF delle parole (query e voce), stemming leggero,
 * numeri canonici ("sedici" = 16), tolleranza a refusi, parole composte ("salva vita" = "salvavita"),
 * penalità per numeri in conflitto (tubo 16 vs 22), bonus di compatibilità con l'unità parlata.
 */
import type { CatalogItem, Unit } from '../types';
import { fmtNumRaw } from './util';
import { readNumber } from './numbers';
import { lex, levenshtein, MATCH_STOP, stem } from './text';

export const MATCH_MIN = 0.55;
export const REVIEW_BELOW = 0.7;
export const AMBIGUITY_GAP = 0.06;

export interface MatchOpts {
  unit?: Unit | null;
  /** considera solo voci con unità compatibile */
  strictUnit?: boolean;
}

export interface MatchResult {
  item: CatalogItem;
  score: number;
  second?: { item: CatalogItem; score: number };
  /** secondo classificato troppo vicino al primo */
  ambiguous: boolean;
}

const isNumTok = (t: string) => /^\d+(\.\d+)?$/.test(t);

/** Token "grezzi" (minuscoli, senza accenti, numeri canonici) senza stopword. */
export function matchTokens(text: string): string[] {
  const R = lex(text);
  const out: string[] = [];
  for (let i = 0; i < R.length; ) {
    const t = R[i];
    if (t.kind === 'punct') {
      i++;
      continue;
    }
    const nr = readNumber(R, i);
    if (nr) {
      if (!nr.art) out.push(fmtNumRaw(nr.v));
      i = nr.next;
      continue;
    }
    if (t.kind === 'digit') {
      for (const part of t.w.split('x')) if (part) out.push(fmtNumRaw(parseFloat(part)));
    } else if (!MATCH_STOP.has(t.w)) out.push(t.w);
    i++;
  }
  return out;
}

function sim(a: string, b: string): number {
  const na = isNumTok(a);
  const nb = isNumTok(b);
  if (na || nb) return na && nb && parseFloat(a) === parseFloat(b) ? 1 : 0;
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  const mn = Math.min(la, lb);
  const mx = Math.max(la, lb);
  if (mn >= 4 && (a.startsWith(b) || b.startsWith(a))) return mn / mx >= 0.7 ? 0.85 : mn >= 5 ? 0.7 : 0;
  if (mx >= 5) {
    const d = levenshtein(a, b);
    if (d <= 1) return 0.85;
    if (mx >= 8 && d <= 2) return 0.7;
  }
  return 0;
}

/** Unisce coppie adiacenti la cui concatenazione è nota nell'altro insieme ("salva"+"vita"). */
function toStems(raw: string[], other: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    if (b !== undefined && !isNumTok(a) && !isNumTok(b) && other.has(stem(a + b))) {
      out.push(stem(a + b));
      i++;
      continue;
    }
    out.push(stem(a));
  }
  return out;
}

interface Doc {
  raw: string[];
  stems: string[];
}
interface ItemDocs {
  item: CatalogItem;
  docs: Doc[];
}

export interface Matcher {
  best(text: string, opts?: MatchOpts): MatchResult | null;
  /** stem di tutte le parole del catalogo */
  vocab: Set<string>;
  /** numeri presenti nelle voci di catalogo (specifiche: 16, 2.5, 80...) */
  nums: Set<number>;
  /** esiste una voce/alias che contiene (gli stem di) tutte queste parole e questo numero? */
  cooccur(words: string[], num: number): boolean;
}

const unitCompatible = (item: CatalogItem, u: Unit | null | undefined): boolean =>
  !u || item.unit === u || (item.kind === 'manodopera' && (u === 'h' || u === 'gg') && (item.unit === 'h' || item.unit === 'gg'));

export function createMatcher(catalog: CatalogItem[]): Matcher {
  const entries: ItemDocs[] = catalog.map((item) => ({
    item,
    docs: [item.name, ...(item.aliases ?? [])]
      .map((t) => matchTokens(t))
      .filter((r) => r.length > 0)
      .map((raw) => ({ raw, stems: raw.map(stem) })),
  }));
  const N = Math.max(1, entries.length);
  const df = new Map<string, number>();
  const vocab = new Set<string>();
  const nums = new Set<number>();
  for (const e of entries) {
    for (const d of e.docs) for (const t of d.raw) if (isNumTok(t)) nums.add(parseFloat(t));
    const seen = new Set<string>();
    for (const d of e.docs) for (const s of d.stems) seen.add(s);
    for (const s of seen) {
      df.set(s, (df.get(s) ?? 0) + 1);
      vocab.add(s);
    }
  }
  const weight = (tok: string): number => {
    const f = df.get(tok) ?? 0;
    const idf = Math.log(1 + (N - f + 0.5) / (f + 0.5));
    return isNumTok(tok) ? idf * 1.2 : idf;
  };

  function scoreDoc(qStems: string[], dStems: string[]): number {
    if (!qStems.length || !dStems.length) return 0;
    let qs = 0;
    let qt = 0;
    let hit = false;
    for (const q of qStems) {
      let b = 0;
      for (const d of dStems) b = Math.max(b, sim(q, d));
      const w = weight(q);
      qs += w * b;
      qt += w;
      if (b >= 0.7 && !isNumTok(q)) hit = true;
    }
    if (!hit) return 0;
    let ds = 0;
    let dt = 0;
    for (const d of dStems) {
      let b = 0;
      for (const q of qStems) b = Math.max(b, sim(q, d));
      const w = weight(d);
      ds += w * b;
      dt += w;
    }
    let s = 0.75 * (qs / qt) + 0.25 * (ds / dt);
    const qn = qStems.filter(isNumTok);
    const dn = dStems.filter(isNumTok);
    if (qn.length && dn.length) {
      const miss = qn.filter((n) => !dn.some((x) => parseFloat(x) === parseFloat(n))).length;
      s *= 1 - (0.45 * miss) / qn.length;
    }
    return s;
  }

  const cache = new Map<string, MatchResult | null>();

  function best(text: string, opts: MatchOpts = {}): MatchResult | null {
    const key = `${text}|${opts.unit ?? ''}|${opts.strictUnit ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const qRaw = matchTokens(text);
    let res: MatchResult | null = null;
    if (qRaw.length && entries.length) {
      const qSet = new Set(qRaw.map(stem));
      const scored: { item: CatalogItem; score: number }[] = [];
      for (const e of entries) {
        if (opts.strictUnit && !unitCompatible(e.item, opts.unit)) continue;
        const qStemsFor = (d: Doc) => toStems(qRaw, new Set(d.stems));
        let sc = 0;
        for (const d of e.docs) {
          const dStems = toStems(d.raw, qSet);
          sc = Math.max(sc, scoreDoc(qStemsFor(d), dStems));
        }
        if (sc >= 0.35 && opts.unit) {
          if (e.item.unit === opts.unit) sc += 0.12;
          else if (e.item.kind === 'manodopera' && (opts.unit === 'h' || opts.unit === 'gg')) sc += 0.05;
        }
        if (sc > 0) scored.push({ item: e.item, score: sc });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored.length) {
        const [b0, b1] = scored;
        res = {
          item: b0.item,
          score: Math.min(1, b0.score),
          second: b1,
          ambiguous: !!b1 && b1.score >= MATCH_MIN && b0.score - b1.score < AMBIGUITY_GAP,
        };
      }
    }
    cache.set(key, res);
    return res;
  }

  function cooccur(words: string[], num: number): boolean {
    const ws = words.map((w) => stem(w));
    return entries.some((e) =>
      e.docs.some((d) => d.raw.some((t) => isNumTok(t) && parseFloat(t) === num) && ws.every((w) => d.stems.includes(w))),
    );
  }

  return { best, vocab, nums, cooccur };
}

/** Comodità: cerca la voce migliore (o null se nulla di plausibile). */
export function matchCatalog(text: string, catalog: CatalogItem[], opts?: MatchOpts): MatchResult | null {
  const r = createMatcher(catalog).best(text, opts);
  return r && r.score >= MATCH_MIN ? r : null;
}
