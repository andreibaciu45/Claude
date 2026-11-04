/**
 * Matching di un testo parlato contro il catalogo (name + aliases).
 * Scoring proprio: copertura pesata IDF delle parole (query e voce), stemming leggero,
 * numeri canonici ("sedici" = 16), tolleranza a refusi, parole composte ("salva vita" = "salvavita"),
 * penalità per numeri in conflitto (tubo 16 vs 22), bonus di compatibilità con l'unità parlata.
 */
import type { CatalogItem, Unit } from '../types';
import { fmtNumRaw } from './util';
import { readNumber } from './numbers';
import { lex, MATCH_STOP, stem } from './text';

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

/** Distanza di Levenshtein limitata a `max`: restituisce max+1 se la supera (uscita anticipata, a banda). */
export function levBounded(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const lo = Math.max(1, i - max);
    const hi = Math.min(lb, i + max);
    if (lo > 1) cur[lo - 1] = max + 1;
    for (let j = lo; j <= hi; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < lb) cur[hi + 1] = max + 1;
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return Math.min(prev[lb], max + 1);
}

function sim(a: string, b: string): number {
  if (a === b) return 1;
  const na = isNumTok(a);
  const nb = isNumTok(b);
  if (na || nb) return na && nb && parseFloat(a) === parseFloat(b) ? 1 : 0;
  const la = a.length;
  const lb = b.length;
  // la "s" privativa cambia il significato: smontaggio/montaggio, scarico/carico, sfilare/filare
  if (la !== lb && Math.min(la, lb) >= 5 && ((la > lb && a.charCodeAt(0) === 115 && a.slice(1) === b) || (lb > la && b.charCodeAt(0) === 115 && b.slice(1) === a))) return 0;
  const mn = Math.min(la, lb);
  const mx = Math.max(la, lb);
  if (mn >= 4 && (a.startsWith(b) || b.startsWith(a))) return mn / mx >= 0.7 ? 0.85 : mn >= 5 ? 0.7 : 0;
  if (mx >= 5) {
    const d = levBounded(a, b, mx >= 8 ? 2 : 1);
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
  set: Set<string>;
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
  /** voce di catalogo per id */
  byId(id: string): CatalogItem | undefined;
  /** numero di voci indicizzate */
  size: number;
}

const unitCompatible = (item: CatalogItem, u: Unit | null | undefined): boolean =>
  !u || item.unit === u || (item.kind === 'manodopera' && (u === 'h' || u === 'gg') && (item.unit === 'h' || item.unit === 'gg'));

/** Peso dei token numerici di DOCUMENTO non riscontrati nella frase (misure nel nome: "120x200"). */
const DOC_NUM_WEIGHT = 0.4;
/** Bonus se l'unità parlata coincide con quella della voce (ore/giornate/a corpo identificano molto la voce). */
const UNIT_BONUS = 0.12;
const UNIT_BONUS_STRONG = 0.2;
const CACHE_MAX = 4000;

export function createMatcher(catalog: CatalogItem[]): Matcher {
  const entries: ItemDocs[] = catalog.map((item) => ({
    item,
    docs: [item.name, ...(item.aliases ?? [])]
      .map((t) => matchTokens(typeof t === 'string' ? t : ''))
      .filter((r) => r.length > 0)
      .map((raw) => {
        const stems = raw.map(stem);
        return { raw, stems, set: new Set(stems) };
      }),
  }));
  const N = Math.max(1, entries.length);
  const df = new Map<string, number>();
  const vocab = new Set<string>();
  const nums = new Set<number>();
  const numDocs = new Map<number, Doc[]>();
  const ids = new Map<string, CatalogItem>();
  /** stem (anche concatenazioni di stem adiacenti: "salva"+"vita") -> indici delle voci che lo contengono */
  const postings = new Map<string, number[]>();
  const post = (key: string, idx: number) => {
    const l = postings.get(key);
    if (!l) postings.set(key, [idx]);
    else if (l[l.length - 1] !== idx) l.push(idx);
  };
  entries.forEach((e, idx) => {
    if (!ids.has(e.item.id)) ids.set(e.item.id, e.item);
    const seen = new Set<string>();
    for (const d of e.docs) {
      for (let i = 0; i < d.raw.length; i++) {
        const t = d.raw[i];
        if (isNumTok(t)) {
          const v = parseFloat(t);
          nums.add(v);
          let l = numDocs.get(v);
          if (!l) numDocs.set(v, (l = []));
          l.push(d);
        } else {
          const nx = d.raw[i + 1];
          if (nx !== undefined && !isNumTok(nx)) post(stem(t + nx), idx);
        }
      }
      for (const s of d.stems) {
        seen.add(s);
        if (!isNumTok(s)) post(s, idx);
      }
    }
    for (const s of seen) {
      df.set(s, (df.get(s) ?? 0) + 1);
      vocab.add(s);
    }
  });

  /* ---- indice per similarità: bucket per lunghezza e per primi 4 caratteri ---- */
  const byLen = new Map<number, string[]>();
  const byPre = new Map<string, string[]>();
  for (const s of postings.keys()) {
    (byLen.get(s.length) ?? (byLen.set(s.length, []), byLen.get(s.length)!)).push(s);
    if (s.length >= 4) {
      const k = s.slice(0, 4);
      (byPre.get(k) ?? (byPre.set(k, []), byPre.get(k)!)).push(s);
    }
  }
  const similarMemo = new Map<string, string[]>();
  /** stem del catalogo con sim >= 0.7 rispetto a q (esatti, prefissi, refusi) */
  const similarStems = (q: string): string[] => {
    const hit = similarMemo.get(q);
    if (hit) return hit;
    const res = new Set<string>();
    if (!isNumTok(q)) {
      if (postings.has(q)) res.add(q);
      if (q.length >= 4) for (const s of byPre.get(q.slice(0, 4)) ?? []) if (s !== q && sim(q, s) >= 0.7) res.add(s);
      if (q.length >= 4) for (let L = q.length - 2; L <= q.length + 2; L++) for (const s of byLen.get(L) ?? []) if (s !== q && !res.has(s) && sim(q, s) >= 0.7) res.add(s);
    }
    const arr = [...res];
    if (similarMemo.size > CACHE_MAX) similarMemo.clear();
    similarMemo.set(q, arr);
    return arr;
  };

  const maxIdf = Math.log(1 + (N + 0.5) / 0.5);
  const weight = (tok: string): number => {
    const f = df.get(tok) ?? 0;
    const idf = f === 0 ? maxIdf : Math.log(1 + (N - f + 0.5) / (f + 0.5));
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
      const w = isNumTok(d) ? weight(d) * DOC_NUM_WEIGHT : weight(d);
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
      const qStemsAll = qRaw.map(stem);
      const qSet = new Set(qStemsAll);
      // candidati: voci con almeno una parola (non numerica) simile a una della frase
      const cand = new Set<number>();
      for (const q of qStemsAll) for (const s of similarStems(q)) for (const idx of postings.get(s)!) cand.add(idx);
      for (let i = 0; i + 1 < qRaw.length; i++) {
        if (isNumTok(qRaw[i]) || isNumTok(qRaw[i + 1])) continue;
        const l = postings.get(stem(qRaw[i] + qRaw[i + 1]));
        if (l) for (const idx of l) cand.add(idx);
      }
      const order = [...cand].sort((a, b) => a - b);
      const scored: { item: CatalogItem; score: number }[] = [];
      for (const idx of order) {
        const e = entries[idx];
        if (opts.strictUnit && !unitCompatible(e.item, opts.unit)) continue;
        let sc = 0;
        for (const d of e.docs) {
          const dStems = toStems(d.raw, qSet);
          sc = Math.max(sc, scoreDoc(toStems(qRaw, d.set), dStems));
        }
        if (sc >= 0.35 && opts.unit) {
          if (e.item.unit === opts.unit) sc += opts.unit === 'h' || opts.unit === 'gg' ? UNIT_BONUS_STRONG : opts.unit === 'corpo' ? UNIT_BONUS / 2 : UNIT_BONUS;
          else if (e.item.kind === 'manodopera' && (opts.unit === 'h' || opts.unit === 'gg')) sc += 0.05;
        }
        if (sc > 0) scored.push({ item: e.item, score: sc });
      }
      // primo e secondo senza ordinare tutto (stabile: a parità vince l'indice più basso)
      let b0: { item: CatalogItem; score: number } | undefined;
      let b1: { item: CatalogItem; score: number } | undefined;
      for (const x of scored) {
        if (!b0 || x.score > b0.score) {
          b1 = b0;
          b0 = x;
        } else if (!b1 || x.score > b1.score) b1 = x;
      }
      if (b0) {
        res = {
          item: b0.item,
          score: Math.min(1, b0.score),
          second: b1,
          ambiguous: !!b1 && b1.score >= MATCH_MIN && b0.score - b1.score < AMBIGUITY_GAP,
        };
      }
    }
    if (cache.size > CACHE_MAX) cache.clear();
    cache.set(key, res);
    return res;
  }

  function cooccur(words: string[], num: number): boolean {
    const ws = words.map((w) => stem(w));
    const docs = numDocs.get(num);
    if (!docs) return false;
    return docs.some((d) => ws.every((w) => d.stems.includes(w)));
  }

  return { best, vocab, nums, cooccur, byId: (id) => ids.get(id), size: entries.length };
}

/* ------------------------------------------------------------------ cache per catalogo */

/** Firma veloce del contenuto del catalogo (FNV-1a su id, nome, alias, unità, tipo): chiave della cache. */
export function catalogSignature(catalog: CatalogItem[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
    }
    h1 = Math.imul(h1 ^ 0x7c, 16777619);
  };
  for (const it of catalog) {
    feed(it.id);
    feed(it.name);
    feed(it.unit);
    feed(it.kind);
    if (it.aliases) for (const a of it.aliases) feed(a);
    feed('|');
  }
  return `${catalog.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

const MATCHERS = new Map<string, Matcher>();
const MATCHERS_MAX = 6;

/**
 * Matcher memoizzato per contenuto del catalogo: l'indice si costruisce una volta sola e si riusa
 * finché il catalogo non cambia (nome, alias, unità, tipo, id). Prezzo/IVA non entrano nell'indice
 * ma sono letti dalla voce passata a `parseDictation`: vedi `refreshItems` in parse.ts.
 */
export function getMatcher(catalog: CatalogItem[]): Matcher {
  const sig = catalogSignature(catalog);
  const hit = MATCHERS.get(sig);
  if (hit) {
    MATCHERS.delete(sig);
    MATCHERS.set(sig, hit);
    return hit;
  }
  const m = createMatcher(catalog);
  MATCHERS.set(sig, m);
  if (MATCHERS.size > MATCHERS_MAX) MATCHERS.delete(MATCHERS.keys().next().value as string);
  return m;
}

/** Comodità: cerca la voce migliore (o null se nulla di plausibile). */
export function matchCatalog(text: string, catalog: CatalogItem[], opts?: MatchOpts): MatchResult | null {
  const r = getMatcher(catalog).best(text, opts);
  if (!r || r.score < MATCH_MIN) return null;
  // la voce restituita è quella del catalogo passato (prezzo/IVA aggiornati, non quelli dell'indice in cache)
  const live = catalog.find((i) => i.id === r.item.id);
  return live && live !== r.item ? { ...r, item: live } : r;
}
