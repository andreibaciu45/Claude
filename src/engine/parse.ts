/**
 * parseDictation: testo dettato -> righe di preventivo agganciate al catalogo.
 *
 * Pipeline: lex -> modificatori di documento (sconto, IVA, "come da preventivo precedente") -> cliente
 * -> token semantici (quantità+unità come ancore, prezzi, specifiche) -> segmentazione in righe
 * (con scelta del confine tra testo "dopo" una quantità e testo "prima" della successiva guidata dal
 * catalogo) -> matching -> DocLine -> rifiniture (stessa voce in più righe = note, mani, conversioni).
 */
import type { CatalogItem, DocLine, ParseResult, Unit } from '../types';
import { uid } from '../types';
import { CONJ, extractCustomer, FILLER } from './customer';
import { matchCustomer, type CustomerCandidate, type CustomerMatch, type CustomerRef } from './customerMatch';
import { LOCATION_GLUE, LOCATION_WORDS, NOTE_NOISE } from './lexicon';
import { getMatcher, matchTokens, MATCH_MIN, REVIEW_BELOW, type MatchOpts, type MatchResult, type Matcher } from './match';
import { extractModifiers, type Discount } from './modifiers';
import { fmtNum, isHalfWord, readNumber } from './numbers';
import { lex, stem, type RawTok } from './text';
import { readUnit, UNIT_LABEL } from './units';

/* ------------------------------------------------------------------ tipi pubblici */

export interface ParseContext {
  /** rubrica clienti esistente: il cliente dettato viene agganciato con fuzzy match */
  customers?: CustomerRef[];
}
export interface LineMeta {
  /** dettaglio che distingue righe con la stessa voce (stanza, zona...) */
  note?: string;
  /** numero di mani/passate dette ("due mani"): annotato, la quantità NON è moltiplicata */
  coats?: number;
  /** conversione di unità applicata (es. "50 cm -> 0,5 m") */
  converted?: string;
}
/**
 * Risultato esteso. Oltre a `ParseResult`:
 * - `discount`: sconto detto. In percentuale è già applicato a `discountPct` di ogni riga; in euro è già
 *   inserito come riga "Sconto" a prezzo negativo (NON applicarlo di nuovo).
 * - `vatRate` / `vatMode`: "IVA al dieci" (già applicata a `vat` di ogni riga), "più IVA" (`plus`: i prezzi sono
 *   netti, nulla da fare), "IVA compresa" (`included`: i prezzi detti sono stati scorporati e segnati da rivedere).
 * - `referencesPrevious`: "come da preventivo precedente" (la UI può proporre di copiare le righe).
 * - `lineMeta`: note/mani/conversioni per id di riga. `warnings`: avvisi in italiano mostrabili all'utente.
 * - `customerId` / `customerMatch`: solo con `parseDictationWithContext` e rubrica.
 */
export interface ParseResultV2 extends ParseResult {
  discount?: Discount;
  vatRate?: number;
  vatMode?: 'plus' | 'included';
  referencesPrevious?: boolean;
  lineMeta?: Record<string, LineMeta>;
  warnings?: string[];
  customerId?: string;
  customerMatch?: CustomerMatch;
  customerCandidates?: CustomerCandidate[];
}

/** Oltre questa lunghezza il testo viene troncato (protezione da input abnormi). */
export const MAX_TRANSCRIPT_CHARS = 30000;
export const MAX_QTY = 1e7;
export const MAX_PRICE = 1e7;

/* ------------------------------------------------------------------ token */

type QtyTok = { k: 'qty'; v: number; u: Unit | null; art: boolean; inferred?: boolean; neg?: boolean; side?: 'before' | 'both'; conv?: { from: string; exact: boolean; orig: number } };
type WordTok = { k: 'w'; w: string; raw: string; num?: number };
type Tok =
  | QtyTok
  | WordTok
  | { k: 'sep' }
  | { k: 'conj' }
  | { k: 'price'; v: number }
  | { k: 'mod'; text: string; n: number };

const SPEC_WORDS = new Set(['n', 'numero', 'diametro', 'sezione', 'tipo', 'modello', 'misura', 'codice']);
const SPEC_PREP = new Set([...SPEC_WORDS, 'da', 'di', 'con', 'dal', 'a']);
const SOFT_PREP = new Set(['da', 'di', 'con', 'dal', 'a']);
const ART_BLOCK = new Set([...SPEC_PREP, 'per', 'in', 'su', 'tra', 'fra', 'come', 'che', 'o', 'se', 'del', 'della', 'dei', 'delle']);
/** nomi di unità senza numero: rumore nel testo di una riga */
const UNIT_NOISE = new Set(['metro', 'metri', 'mq', 'mc', 'litri', 'litro', 'chili', 'chilo', 'kg', 'pezzi', 'pezzo', 'ore', 'ora']);
const MOD_WORDS = new Set(['mani', 'mano', 'passata', 'passate', 'volte']);
/** parole che non portano significato nella descrizione di una riga */
const DESC_STOP = new Set([
  'di', 'd', 'da', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell', 'dal', 'dalla', 'il', 'lo', 'la', 'le',
  'i', 'gli', 'l', 'un', 'uno', 'una', 'con', 'per', 'a', 'ad', 'al', 'alla', 'alle', 'ai', 'in', 'su', 'sul', 'e',
  'ed', 'euro', 'cadauno', 'cadauna', 'ciascuno', 'ciascuna', 'cad', 'totale', 'prezzo', 'costa', 'costano', 'tutto',
  'tutti', 'questo', 'quello', 'sono', 'cosa',
]);
const GENERIC_JOB = new Set(['lavori', 'lavoro', 'intervento', 'interventi', 'opere', 'opera', 'lavoretto', 'lavoretti', 'ordine', 'offerta']);
const PRICE_PRE = new Set(['a', 'da', 'di', 'per', 'costa', 'costano', 'prezzo', 'totale', 'al', 'circa']);
const PRICE_POST_UNIT = new Set(['metro', 'metri', 'pezzo', 'pezzi', 'ora', 'ore', 'litro', 'litri', 'chilo', 'kg', 'mq', 'giorno', 'giornata', 'quadro', 'quadrato']);
const CENTS_AFTER = new Set(['centesimi', 'centesimo', 'cent', 'l', 'al', 'cadauno', 'cadauna', 'ciascuno', 'ciascuna', 'cad', 'alla', 'per', 'a', 'il', 'la', 'e']);

const isBoundary = (t: Tok) => t.k === 'sep' || t.k === 'conj';
const isW = (t: Tok): t is WordTok => t.k === 'w';
const meaningful = (toks: Tok[]) => toks.filter((t): t is WordTok => isW(t) && !DESC_STOP.has(t.w) && !UNIT_NOISE.has(t.w));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ token semantici */

function toTokens(R: RawTok[], matcher: Matcher): Tok[] {
  const catalogNums = matcher.nums;
  const out: Tok[] = [];
  const last = () => out[out.length - 1];
  let negNext = false;
  let i = 0;
  while (i < R.length) {
    const t = R[i];
    if (t.kind === 'punct') {
      out.push({ k: 'sep' });
      i++;
      continue;
    }
    if (t.kind === 'word') {
      if (t.w === 'a' && R[i + 1]?.w === 'corpo') {
        out.push({ k: 'qty', v: 1, u: 'corpo', art: false });
        i += 2;
        continue;
      }
      if (t.w === 'oltre' && R[i + 1]?.w === 'a') {
        out.push({ k: 'conj' });
        i += 2;
        continue;
      }
      if (t.w === 'meno' && R[i + 1] && readNumber(R, i + 1)) {
        negNext = true;
        i++;
        continue;
      }
      if (CONJ.has(t.w) || FILLER.has(t.w)) {
        out.push({ k: 'conj' });
        i++;
        continue;
      }
    }
    const nr = readNumber(R, i);
    if (!nr) {
      out.push({ k: 'w', w: t.w, raw: t.raw });
      i++;
      continue;
    }
    let { v } = nr;
    const neg = negNext;
    negNext = false;
    if (!Number.isFinite(v)) v = MAX_QTY * 10;
    let j = nr.next;

    // "tre e mezzo metri"
    if (Number.isInteger(v) && R[j]?.w === 'e' && isHalfWord(R[j + 1]?.w)) {
      const u2 = readUnit(R, j + 2);
      if (u2 && u2.kind === 'unit' && ['m', 'mq', 'mc', 'kg', 'l'].includes(u2.u)) {
        v += 0.5;
        j += 2;
      }
    }

    // "cavo due e mezzo" (specifica con mezzo, senza unità dopo)
    if (Number.isInteger(v) && R[j]?.w === 'e' && isHalfWord(R[j + 1]?.w) && !readUnit(R, j + 2)) {
      const pv = last();
      if (pv && isW(pv) && !isBoundary(pv)) {
        v += 0.5;
        j += 2;
      }
    }

    // prezzo: "1200 euro", "un euro e venti" (= 1,20)
    if (R[j] && R[j].kind === 'word' && (R[j].w === 'euro' || R[j].w === 'eur' || R[j].w === 'euri')) {
      let pv = v;
      let end = j + 1;
      if (R[end]?.w === 'e') {
        const c = readNumber(R, end + 1);
        const af = c ? R[c.next] : undefined;
        if (c && !c.art && Number.isInteger(c.v) && c.v >= 1 && c.v < 100 && (!af || af.kind === 'punct' || (af.kind === 'word' && CENTS_AFTER.has(af.w)))) {
          pv = v + c.v / 100;
          end = c.next;
          if (R[end]?.w === 'centesimi' || R[end]?.w === 'centesimo' || R[end]?.w === 'cent') end++;
        }
      }
      out.push({ k: 'price', v: pv });
      i = end;
      continue;
    }

    // moltiplicazione: "quattro per cinque (metri)"
    if (R[j]?.w === 'per') {
      const n2 = readNumber(R, j + 1);
      if (n2 && !n2.art) {
        const un = readUnit(R, n2.next);
        const p = last();
        const prevB = !p || isBoundary(p) || p.k === 'qty' || p.k === 'price';
        const unitOk = !un || (un.kind === 'unit' && (un.u === 'm' || un.u === 'mq'));
        if (prevB && unitOk) {
          out.push({ k: 'qty', v: Math.round(v * n2.v * 1000) / 1000, u: 'mq', art: false, inferred: true });
          i = un ? un.next : n2.next;
          continue;
        }
        const spec = `${v}x${n2.v}`;
        out.push({ k: 'w', w: spec, raw: spec });
        i = n2.next;
        continue;
      }
    }

    const un = readUnit(R, j);
    const pw = last();
    const pw2 = out[out.length - 2];
    const prevBoundary0 = !pw || isBoundary(pw) || pw.k === 'qty' || pw.k === 'price' || pw.k === 'mod';

    // unità convertibili: cm -> m, ml -> l, g -> kg, minuti -> h...
    if (un && un.kind === 'conv') {
      const nextDi = R[un.next]?.w === 'di' || R[un.next]?.w === 'd';
      const asQty = un.from === 'mm' ? v >= 100 && prevBoundary0 && nextDi : un.from === 'cm' ? prevBoundary0 || nextDi : true;
      if (asQty) {
        const q = r3(v * un.factor);
        const exact = Math.abs(v * un.factor * 1000 - Math.round(v * un.factor * 1000)) < 1e-6 && un.from !== 'mm';
        out.push({ k: 'qty', v: q, u: un.u, art: false, neg, conv: { from: un.from, exact, orig: v } });
        i = un.next;
        continue;
      }
      out.push({ k: 'w', w: String(v), raw: fmtNum(v), num: v });
      i = un.next;
      continue;
    }

    const prevDaWord = !!pw && isW(pw) && (pw.w === 'da' || pw.w === 'di') && !!pw2 && isW(pw2) && !isBoundary(pw2);
    const specLike =
      !!un && un.kind === 'unit' && (un.u === 'l' || un.u === 'kg') && catalogNums.has(v) && !nr.art &&
      ((!!pw && isW(pw) && !ART_BLOCK.has(pw.w)) || (prevDaWord && matcher.cooccur([(pw2 as WordTok).w], v)));
    if (un && un.kind === 'unit' && !specLike) {
      let q = v;
      let nj = un.next;
      if (R[nj]?.w === 'e' && isHalfWord(R[nj + 1]?.w) && !readUnit(R, nj + 2)) {
        q += 0.5;
        nj += 2;
      }
      out.push({ k: 'qty', v: q, u: un.u, art: nr.art, neg });
      i = nj;
      continue;
    }
    if (specLike || (un && un.kind === 'spec')) {
      out.push({ k: 'w', w: String(v), raw: fmtNum(v), num: v });
      i = un && un.kind === 'spec' ? un.next : j;
      continue;
    }

    // "due mani" / "tre passate"
    if (R[j] && R[j].kind === 'word' && MOD_WORDS.has(R[j].w)) {
      out.push({ k: 'mod', text: `${fmtNum(v)} ${R[j].raw}`, n: v });
      i = j + 1;
      continue;
    }

    // dopo "a corpo": un numero nudo è il prezzo ("a corpo 1200")
    const p = last();
    if (p && p.k === 'qty' && p.u === 'corpo' && !un && !nr.art) {
      out.push({ k: 'price', v });
      i = j;
      continue;
    }

    // numero senza unità: quantità (pezzi) oppure specifica ("cavo 2,5", "tubo da 16")
    const next = R[j];
    const nextIsWord = !!next && next.kind === 'word' && !CONJ.has(next.w) && !FILLER.has(next.w);
    const atEnd = !next || next.kind === 'punct' || (next.kind === 'word' && (CONJ.has(next.w) || FILLER.has(next.w)));
    const prevBoundary = !p || isBoundary(p) || p.k === 'qty' || p.k === 'price' || p.k === 'mod';
    const prevSpecNum = !!p && isW(p) && p.num !== undefined;
    const prevPrep = !!p && isW(p) && SPEC_PREP.has(p.w);
    const prevHardSpec = !!p && isW(p) && SPEC_WORDS.has(p.w);
    const artAfterWord = nr.art && !!p && isW(p) && !ART_BLOCK.has(p.w);
    const wordKnown = (w: string) => matcher.vocab.has(w) || matcher.vocab.has(stem(w));
    // numero dopo un nome senza preposizione: "quattro prese tre interruttori" (quantità) oppure
    // "cavo 4 colore nero" (specifica). Si decide col catalogo: è una specifica se una voce contiene
    // il nome + il numero e la parola successiva non appartiene ad un'altra voce.
    let nounThenQty = false;
    if (nextIsWord && !prevPrep && !prevBoundary && !prevSpecNum && !artAfterWord && !nr.art && p && isW(p) && Number.isInteger(v) && p.num === undefined) {
      const nw = next.w;
      const isSpec = matcher.cooccur([p.w], v);
      const nextKnown = wordKnown(nw);
      nounThenQty = isSpec ? nextKnown && !matcher.cooccur([p.w, nw], v) : nextKnown;
    }
    // "di tre vetri", "a due condizionatori", "pulizia filtri di quattro split": la preposizione NON
    // introduce una specifica se il catalogo non conosce "nome + numero" e dopo c'è una parola di catalogo.
    let softPrepQty = false;
    if (nextIsWord && prevPrep && !prevHardSpec && p && isW(p) && SOFT_PREP.has(p.w) && !nr.art && Number.isInteger(v) && v >= 1 && v < 1000) {
      const before = pw2 && isW(pw2) && !isBoundary(pw2) ? pw2.w : undefined;
      const specEvidence = before !== undefined && matcher.cooccur([before], v);
      softPrepQty = !specEvidence && wordKnown(next.w) && !(next.kind === 'word' && /^(mm|cm|kw|kva|btu|volt|v|w|a|amp|ampere|watt)$/.test(next.w));
    }
    // numero a fine segmento dopo un nome: "sensori di movimento tre", "cartuccia anticalcare 3"
    let trailingQty = false;
    if (atEnd && !prevPrep && !prevSpecNum && !prevBoundary && !nr.art && p && isW(p) && p.num === undefined && Number.isInteger(v) && wordKnown(p.w)) {
      trailingQty = nr.spoken && !/^\d/.test(t.w) ? v <= 99 && !matcher.cooccur([p.w], v) : v >= 1 && v <= 20 && !matcher.nums.has(v);
    }
    // "cucina uno ... camera uno": un numero-articolo dopo una parola di luogo (o a fine segmento dopo un nome) è postposto
    const postArt = nr.art && !!p && isW(p) && !prevPrep && p.num === undefined && (LOCATION_WORDS.has(p.w) || (atEnd && wordKnown(p.w)));
    if (postArt) {
      out.push({ k: 'qty', v, u: null, art: true, neg, side: 'before' });
    } else if ((nextIsWord && !prevPrep && (prevBoundary || prevSpecNum || artAfterWord || nounThenQty)) || softPrepQty || trailingQty) {
      // il nome quantificato sta PRIMA del numero ("sensori di movimento tre") o attorno ("sostituzione di tre vetri")
      out.push({ k: 'qty', v, u: null, art: nr.art, neg, ...(trailingQty ? { side: 'before' as const } : softPrepQty ? { side: 'both' as const } : {}) });
    } else if (nr.art) {
      out.push({ k: 'w', w: t.w, raw: t.raw });
    } else {
      out.push({ k: 'w', w: String(v), raw: fmtNum(v), num: v });
    }
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------------ costruzione righe */

interface Piece {
  toks: Tok[];
  start: number;
}
interface Gap {
  pieces: Piece[];
  startsB: boolean;
  endsB: boolean;
  hasB: boolean;
}

function splitGap(T: Tok[], from: number, to: number): Gap {
  const pieces: Piece[] = [];
  let cur: Tok[] = [];
  let start = from;
  let hasB = false;
  for (let i = from; i < to; i++) {
    if (isBoundary(T[i])) {
      hasB = true;
      if (cur.length) pieces.push({ toks: cur, start });
      cur = [];
      start = i + 1;
    } else {
      if (!cur.length) start = i;
      cur.push(T[i]);
    }
  }
  if (cur.length) pieces.push({ toks: cur, start });
  return {
    pieces,
    hasB,
    startsB: from < to && isBoundary(T[from]),
    endsB: from < to && isBoundary(T[to - 1]),
  };
}

const wordsText = (toks: Tok[]): string =>
  toks
    .filter(isW)
    .filter((t) => !UNIT_NOISE.has(t.w) || t.num !== undefined)
    .map((t) => (t.num !== undefined ? String(t.num) : t.w))
    .join(' ');

interface LineDraft {
  anchor: QtyTok;
  pos: number;
  lead: Tok[];
  trail: Tok[];
  coats?: number;
}
interface Orphan {
  toks: Tok[];
  pos: number;
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Descrizione "pulita" per le righe libere. */
function describe(toks: Tok[]): string {
  const ws = toks.filter(isW);
  const parts: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const t = ws[i];
    if ((t.w === 'da' || t.w === 'di') && ws[i + 1]?.num !== undefined) continue;
    parts.push(t.num !== undefined ? fmtNum(t.num) : t.raw);
  }
  // togli stopword in testa e in coda
  let a = 0;
  let b = parts.length;
  const lowers = parts.map((p) => p.toLowerCase());
  while (a < b && DESC_STOP.has(lowers[a])) a++;
  while (b > a && DESC_STOP.has(lowers[b - 1])) b--;
  return capitalize(parts.slice(a, b).join(' ').trim());
}

/** Estrae un eventuale prezzo parlato e ripulisce i connettivi attorno. */
function takePrice(toks: Tok[]): { price?: number; toks: Tok[] } {
  const idx = toks.findIndex((t) => t.k === 'price');
  if (idx < 0) return { toks };
  const price = (toks[idx] as { k: 'price'; v: number }).v;
  const rest = toks.slice();
  let end = idx + 1;
  // "al metro", "a pezzo", "cadauno"
  while (rest[end] && isW(rest[end]) && (['al', 'a', 'per', 'l', 'cadauno', 'cadauna', 'ciascuno', 'ciascuna', 'cad'].includes((rest[end] as WordTok).w) || PRICE_POST_UNIT.has((rest[end] as WordTok).w))) end++;
  let start = idx;
  while (start > 0 && isW(rest[start - 1]) && PRICE_PRE.has((rest[start - 1] as WordTok).w)) start--;
  rest.splice(start, end - start);
  return { price, toks: rest };
}

const stripLocation = (txt: string): string => txt.split(' ').filter((w) => !LOCATION_WORDS.has(w)).join(' ');

/** Parole "di luogo" a parte, tutte le altre sono contenuto: la frase contiene solo luoghi? */
function onlyLocation(toks: Tok[]): boolean {
  const ws = toks.filter(isW).filter((t) => !t.num);
  const real = ws.filter((t) => !DESC_STOP.has(t.w) && !LOCATION_GLUE.has(t.w) && !UNIT_NOISE.has(t.w));
  return real.length > 0 && real.every((t) => LOCATION_WORDS.has(t.w));
}

/** Parti della frase che distinguono una riga dalle altre con la stessa voce (luoghi e dettagli). */
function noteWords(src: Tok[], item: CatalogItem): string {
  const itemToks = new Set(matchTokens([item.name, ...(item.aliases ?? [])].join(' ')).map(stem));
  const ws = src.filter(isW).filter((t) => t.num === undefined);
  const keep = ws.map((t) => {
    const w = t.w;
    if (DESC_STOP.has(w) || NOTE_NOISE.has(w) || UNIT_NOISE.has(w) || /^\d/.test(w) || w.length < 3) return false;
    const st = stem(w);
    for (const it of itemToks) if (it === st || (it.length >= 5 && st.length >= 5 && (it.startsWith(st) || st.startsWith(it)))) return false;
    return true;
  });
  const parts: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    if (keep[i]) parts.push(ws[i].w);
    else if ((ws[i].w === 'da' || ws[i].w === 'di') && keep[i - 1] && keep[i + 1]) parts.push(ws[i].w);
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ parse */

interface Out {
  pos: number;
  line?: DocLine;
  leftover?: string;
  orphan?: boolean;
  text?: string;
  src?: Tok[];
  item?: CatalogItem;
  coats?: number;
  converted?: string;
  spokenPrice?: boolean;
  inherited?: boolean;
}

function parseCore(transcript: string, catalog: CatalogItem[], ctx: ParseContext): ParseResultV2 {
  const empty: ParseResultV2 = { lines: [], leftovers: [] };
  if (typeof transcript !== 'string' || !transcript.trim()) return empty;
  const warnings: string[] = [];
  let text = transcript;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = text.slice(0, MAX_TRANSCRIPT_CHARS);
    warnings.push('Testo molto lungo: ho letto solo la prima parte.');
  }
  const cat = Array.isArray(catalog) ? catalog.filter((c) => c && typeof c.id === 'string') : [];
  const matcher: Matcher = getMatcher(cat);
  const live = new Map<string, CatalogItem>();
  for (const it of cat) if (!live.has(it.id)) live.set(it.id, it);
  const resolve = (it: CatalogItem): CatalogItem => live.get(it.id) ?? it;

  const itemStems = new Map<string, Set<string>>();
  const stemsOf = (it: CatalogItem): Set<string> => {
    let st = itemStems.get(it.id);
    if (!st) itemStems.set(it.id, (st = new Set(matchTokens([it.name, ...(it.aliases ?? [])].join(' ')).map(stem))));
    return st;
  };
  /** match con e senza le parole di luogo: "intonaco bagno" è l'intonaco, non il rivestimento del bagno */
  const bestLoc = (txt: string, opts: MatchOpts): MatchResult | null => {
    const a = matcher.best(txt, opts);
    const stripped = stripLocation(txt);
    if (stripped === txt || !stripped.trim()) return a;
    const b = matcher.best(stripped, opts);
    if (!b) return a;
    if (!a || b.score > a.score + 0.05) return b;
    if (b.score >= MATCH_MIN && b.item.id !== a.item.id) {
      const content = stripped.split(' ').filter((w) => !/^\d/.test(w)).map(stem);
      const st = stemsOf(a.item);
      if (content.length && !content.some((q) => st.has(q))) return b; // la voce `a` è sostenuta solo dal luogo
    }
    return a;
  };

  const R0 = lex(text);
  const mods = extractModifiers(R0);
  const known = new Set<string>();
  for (const c of ctx.customers ?? []) for (const w of lex(c.name)) if (w.kind === 'word') known.add(w.w);
  const isCatalogWord = (w: string) =>
    !known.has(w) && (matcher.vocab.has(w) || matcher.vocab.has(stem(w)));
  const { name: customerName, rest } = extractCustomer(mods.rest, isCatalogWord);

  const all = toTokens(rest, matcher);

  // mani/passate: si attaccano all'ultima quantità che le precede (o alla prima che le segue)
  const T: Tok[] = [];
  const coatsOf = new Map<number, number>();
  let lastQty = -1;
  let earlyCoats: number | undefined;
  for (const t of all) {
    if (t.k === 'mod') {
      if (lastQty >= 0) coatsOf.set(lastQty, t.n);
      else earlyCoats = t.n;
      continue;
    }
    T.push(t);
    if (t.k === 'qty') {
      lastQty = T.length - 1;
      if (earlyCoats !== undefined) {
        coatsOf.set(lastQty, earlyCoats);
        earlyCoats = undefined;
      }
    }
  }
  const looseCoats = earlyCoats;

  const scoreTextRaw = (toks: Tok[], unit: Unit | null, strict: boolean): number => {
    const txt = wordsText(toks);
    if (!meaningful(toks).length) return 0;
    const m = bestLoc(txt, { unit, strictUnit: strict });
    return m ? m.score : 0;
  };

  // "un cancello in ferro 6 mq": "un" è l'articolo, non la quantità, se il testo seguente è una voce
  // di catalogo compatibile con l'unità della quantità successiva
  for (let a = 0; a < T.length; a++) {
    const q = T[a];
    if (q.k !== 'qty' || !q.art || q.u !== null) continue;
    let m = a + 1;
    while (m < T.length && !isBoundary(T[m]) && T[m].k !== 'qty') m++;
    const nq = T[m];
    if (!nq || nq.k !== 'qty' || nq.u === null || m === a + 1) continue;
    const between = T.slice(a + 1, m);
    if (between.some((t) => t.k === 'price')) continue;
    if (scoreTextRaw(between, nq.u, true) >= 0.75) T[a] = { k: 'w', w: 'un', raw: 'un' };
  }

  const anchorsIdx: number[] = [];
  T.forEach((t, i) => {
    if (t.k === 'qty') anchorsIdx.push(i);
  });
  const n = anchorsIdx.length;

  const drafts: LineDraft[] = anchorsIdx.map((idx) => ({ anchor: T[idx] as QtyTok, pos: idx, lead: [], trail: [], coats: coatsOf.get(idx) }));
  const orphans: Orphan[] = [];

  // gap g: tra anchor g-1 e anchor g
  const bounds: [number, number][] = [];
  for (let g = 0; g <= n; g++) {
    const from = g === 0 ? 0 : anchorsIdx[g - 1] + 1;
    const to = g === n ? T.length : anchorsIdx[g];
    bounds.push([from, to]);
  }
  const gaps = bounds.map(([f, t]) => splitGap(T, f, t));

  // la riga j ha già testo "dopo" la quantità?
  const trailExists = (j: number): boolean => {
    const gp = gaps[j + 1];
    if (!gp || gp.startsB || !gp.pieces.length) return false;
    return meaningful(gp.pieces[0].toks).length > 0;
  };
  const leadAllowed = (j: number): boolean =>
    (drafts[j].anchor.u !== null && !trailExists(j)) || drafts[j].anchor.side === 'before' || drafts[j].anchor.side === 'both';

  const scoreText = scoreTextRaw;

  // testo davanti a una quantità che il catalogo riconosce con sicurezza (formato "nome quantità")
  const strongLead = (toks: Tok[], j: number): boolean => {
    const a = drafts[j].anchor;
    const f = toks[0];
    if (a.u === null || !isW(f) || f.w === 'di' || f.w === 'd') return false;
    return scoreText(toks, a.u, true) >= 0.75;
  };

  for (let g = 0; g <= n; g++) {
    const gp = gaps[g];
    if (!gp.pieces.length) continue;
    const left = g > 0 ? g - 1 : -1;
    const right = g < n ? g : -1;

    if (!gp.hasB) {
      const W = gp.pieces[0].toks;
      const start = gp.pieces[0].start;
      if (left >= 0 && right >= 0) {
        let k = W.length;
        if (leadAllowed(right)) {
          const allScore = scoreText(W, null, false);
          let bestK = -1;
          let bestVal = -1;
          for (let c = 0; c < W.length; c++) {
            const lead = W.slice(c);
            const trail = W.slice(0, c);
            const firstLead = meaningful(lead)[0];
            if (!firstLead || (lead[0] as Tok).k !== 'w' || DESC_STOP.has((lead[0] as WordTok).w)) continue;
            if (onlyLocation(lead) || (meaningful(trail).length > 0 && onlyLocation(trail))) continue;
            const trailHas = meaningful(trail).length > 0;
            if (drafts[left].anchor.u === null && !trailHas) continue;
            const sl = scoreText(lead, drafts[right].anchor.u, true);
            if (sl < 0.6) continue;
            const st = trailHas ? scoreText(trail, null, false) : 0;
            if (trailHas && st < 0.5) continue;
            const val = sl + st;
            if (val > bestVal) {
              bestVal = val;
              bestK = c;
            }
          }
          if (bestK >= 0 && bestVal > allScore + 0.1) k = bestK;
        }
        // catena "nome quantità nome quantità": se la riga precedente ha già il testo davanti e nessun
        // testo dietro, il testo di mezzo appartiene alla riga successiva (salvo "di ...")
        const firstW = W[0] as Tok;
        const startsDi = isW(firstW) && (firstW.w === 'di' || firstW.w === 'd');
        if (k === W.length && !startsDi && drafts[left].lead.length && !drafts[left].trail.length && drafts[right].anchor.u !== null) {
          k = 0;
        }
        drafts[left].trail.push(...W.slice(0, k));
        if (k < W.length) drafts[right].lead.push(...W.slice(k));
      } else if (left >= 0) {
        drafts[left].trail.push(...W);
      } else if (right >= 0) {
        if (leadAllowed(right) || strongLead(W, right)) drafts[right].lead.push(...W);
        else orphans.push({ toks: W, pos: start });
      } else {
        orphans.push({ toks: W, pos: start });
      }
      continue;
    }

    const last = gp.pieces.length - 1;
    gp.pieces.forEach((pc, p) => {
      const adjL = p === 0 && !gp.startsB && left >= 0;
      const adjR = p === last && !gp.endsB && right >= 0;
      if (adjL) drafts[left].trail.push(...pc.toks);
      else if (adjR && (leadAllowed(right) || strongLead(pc.toks, right))) drafts[right].lead.push(...pc.toks);
      else orphans.push({ toks: pc.toks, pos: pc.start });
    });
  }

  // testo davanti/dietro una quantità con più voci ("scaldabagno ... compresa manodopera tre ore",
  // "cassetta di scarico con placca"): la quantità resta alla voce più vicina, le altre diventano righe a parte
  for (const d of drafts) {
    if (d.lead.length > 2 && d.lead.every(isW)) {
      const parts = splitAtLinks(d.lead, scoreText);
      if (parts.length > 1) {
        parts.slice(0, -1).forEach((pt, k) => orphans.push({ toks: pt, pos: d.pos - 0.5 + k * 0.01 }));
        d.lead = parts[parts.length - 1];
      }
    }
    if (d.trail.length > 2 && d.trail.every(isW)) {
      const parts = splitAtLinks(d.trail, scoreText);
      if (parts.length > 1) {
        parts.slice(1).forEach((pt, k) => orphans.push({ toks: pt, pos: d.pos + 0.5 + k * 0.01 }));
        d.trail = parts[0];
      }
    }
  }

  /* ---- da bozze a righe ---- */
  // spezzare un frammento è lecito solo se i pezzi non sono già "spiegati" dalla voce che l'intero frammento
  // indica (es. "centralino da 12 moduli": "moduli" è del quadro, non una scatola)
  const splitOk = (toks: Tok[], pieces: Tok[][]): boolean => {
    const w = bestLoc(wordsText(toks), { unit: null });
    if (!w || w.score < 0.5) return true;
    const st = stemsOf(w.item);
    for (const pc of pieces) {
      const content = pc.filter(isW).filter((t) => t.num === undefined && !DESC_STOP.has(t.w)).map((t) => stem(t.w));
      const pm = bestLoc(wordsText(pc), { unit: null });
      if (pm && pm.item.id !== w.item.id && content.length && content.every((c) => st.has(c))) return false;
    }
    return true;
  };
  const leftovers: string[] = [];
  const outs: Out[] = [];
  let manualLabor: CatalogItem[] | null = null;
  let prevCore: { text: string; item: CatalogItem; unit: Unit | null } | null = null;

  const asLeftover = (toks: Tok[]): string | undefined => {
    const ws = toks.filter(isW);
    const txt = ws.map((t) => (t.num !== undefined ? fmtNum(t.num) : t.raw)).join(' ').trim();
    return meaningful(toks).length || ws.some((t) => t.num !== undefined) ? txt : undefined;
  };

  const clampQty = (q: number, flags: { review: boolean }): number => {
    let x = q;
    if (!Number.isFinite(x) || x <= 0) {
      flags.review = true;
      return 1;
    }
    if (x > MAX_QTY) {
      flags.review = true;
      warnings.push('Quantità enorme: da verificare.');
      x = MAX_QTY;
    }
    return x;
  };
  const clampPrice = (p: number | undefined, flags: { review: boolean }): number | undefined => {
    if (p === undefined) return undefined;
    if (!Number.isFinite(p) || p < 0) {
      flags.review = true;
      return 0;
    }
    if (p > MAX_PRICE) {
      flags.review = true;
      return MAX_PRICE;
    }
    return p;
  };

  const buildLine = (anchor: QtyTok | null, toksIn0: Tok[], pos: number, coats?: number) => {
    // frammenti senza quantità: le parole generiche ("lavori", "intervento") non sono voci
    const toksIn = anchor ? toksIn0 : toksIn0.filter((t) => !(isW(t) && GENERIC_JOB.has(t.w)));
    const { price: price0, toks } = takePrice(toksIn);
    const flags = { review: false };
    const price = clampPrice(price0, flags);
    const has = meaningful(toks).length > 0;
    let matchText = wordsText(toks);
    if (anchor && !has) {
      if (anchor.u === 'h' || anchor.u === 'gg') matchText = 'manodopera';
      else if (anchor.u === 'corpo') matchText = '';
      else {
        outs.push({ pos, leftover: `${fmtNum(anchor.v)} ${anchor.u ? UNIT_LABEL[anchor.u] : ''}`.trim() });
        return;
      }
    }
    if (!anchor && !has) {
      const lo = asLeftover(toks);
      if (lo) outs.push({ pos, leftover: lo });
      return;
    }
    // riga ellittica "... e uno da trentadue": stessa famiglia della riga precedente, altra specifica
    const mw = meaningful(toks);
    if (anchor && prevCore && mw.length > 0 && mw.every((t) => t.num !== undefined)) {
      matchText = `${prevCore.text} ${mw.map((t) => t.num).join(' ')}`;
    }
    const unitOpt = anchor?.u ?? null;
    let m = matchText ? bestLoc(matchText, { unit: unitOpt }) : null;
    if (anchor && !has && (anchor.u === 'h' || anchor.u === 'gg')) {
      manualLabor ??= cat.filter((c) => c.kind === 'manodopera');
      const same = manualLabor.filter((c) => c.unit === anchor.u);
      if (same.length === 1) m = { item: same[0], score: 0.9, ambiguous: false };
    }
    let qty = anchor ? anchor.v : 1;
    if (anchor?.neg) {
      flags.review = true;
      warnings.push('Quantità negativa: ho usato il valore positivo, da verificare.');
    }
    const coatsTxt = coats !== undefined ? `${fmtNum(coats)} ${coats === 1 ? 'mano' : 'mani'}` : undefined;

    // riga di sola località ("... 30 mq" dopo "tinteggiare soggiorno 50 mq"): stessa voce della precedente
    if ((!m || m.score < MATCH_MIN) && anchor && anchor.u !== null && prevCore && onlyLocation(toks) &&
      (prevCore.item.unit === anchor.u || (prevCore.item.kind === 'manodopera' && (anchor.u === 'h' || anchor.u === 'gg')))) {
      const it = resolve(prevCore.item);
      qty = clampQty(qty, flags);
      outs.push({
        pos,
        inherited: true,
        item: it,
        src: toks,
        coats,
        line: {
          id: uid(), catalogItemId: it.id, description: it.name, qty, unit: it.unit,
          unitPrice: price ?? it.price, vat: it.vat, needsReview: flags.review,
        },
        spokenPrice: price !== undefined,
      });
      return;
    }

    if (m && m.score >= MATCH_MIN) {
      const it = resolve(m.item);
      let converted: string | undefined;
      let unitConv = false;
      if (anchor && anchor.u === 'h' && it.unit === 'gg') {
        qty = r3(anchor.v / 8);
        converted = `${fmtNum(anchor.v)} h = ${fmtNum(qty)} gg (giornata di 8 ore)`;
        unitConv = true;
      } else if (anchor && anchor.u === 'gg' && it.unit === 'h') {
        qty = r3(anchor.v * 8);
        converted = `${fmtNum(anchor.v)} gg = ${fmtNum(qty)} h (giornata di 8 ore)`;
        unitConv = true;
      } else if (anchor?.conv && anchor.u === it.unit) {
        converted = `${fmtNum(anchor.conv.orig)} ${anchor.conv.from} = ${fmtNum(qty)} ${it.unit}`;
      }
      // "a corpo" su una voce a misura: riga a corpo (1) col prezzo detto; senza prezzo resta da rivedere
      const lump = !!anchor && anchor.u === 'corpo' && it.unit !== 'corpo';
      if (lump && price === undefined) flags.review = true;
      qty = clampQty(qty, flags);
      const unitMismatch = !!anchor && anchor.u !== null && anchor.u !== it.unit && !unitConv && !lump;
      const bareNonPz = !!anchor && anchor.u === null && it.unit !== 'pz';
      const convRough = !!anchor?.conv && !anchor.conv.exact;
      const review =
        flags.review || unitMismatch || bareNonPz || unitConv || convRough || m.score < REVIEW_BELOW || m.ambiguous || !anchor || !!anchor.inferred;
      if (anchor) prevCore = { text: toks.filter(isW).filter((t) => t.num === undefined && !DESC_STOP.has(t.w) && !UNIT_NOISE.has(t.w)).map((t) => t.w).join(' '), item: it, unit: anchor.u };
      outs.push({
        pos,
        orphan: !anchor,
        text: asLeftover(toks),
        src: toks,
        item: it,
        coats,
        converted,
        spokenPrice: price !== undefined,
        line: {
          id: uid(),
          catalogItemId: it.id,
          description: it.name,
          qty,
          unit: lump ? 'corpo' : it.unit,
          unitPrice: price ?? it.price,
          vat: it.vat,
          needsReview: review,
        },
      });
      return;
    }
    // non trovato a catalogo
    if (!anchor && price === undefined) {
      const lo = asLeftover(toks);
      if (lo) outs.push({ pos, leftover: lo });
      return;
    }
    const desc = describe(toks) || (anchor?.u === 'h' || anchor?.u === 'gg' ? 'Manodopera' : '');
    if (!desc) {
      outs.push({ pos, leftover: asLeftover(toks) ?? '' });
      return;
    }
    qty = clampQty(qty, flags);
    outs.push({
      pos,
      coats,
      spokenPrice: price !== undefined,
      line: {
        id: uid(),
        description: desc,
        qty,
        unit: anchor?.u ?? 'pz',
        unitPrice: price ?? 0,
        vat: 22,
        needsReview: true,
      },
    });
  };

  for (const d of drafts) buildLine(d.anchor, [...d.lead, ...d.trail], d.pos, d.coats);

  // frammenti senza quantità: se contengono più voci di catalogo ("manutenzione caldaia con analisi di
  // combustione") si spezzano in una riga per voce
  for (const o of orphans) for (const part of splitOrphan(o.toks, scoreText, splitOk)) buildLine(null, part, o.pos);

  outs.sort((a, b) => a.pos - b.pos);
  const lines: DocLine[] = [];
  const meta = new Map<string, LineMeta>();
  const spoken = new Set<string>();
  const seenIds = new Set<string>();
  const anchoredIds = new Set(outs.filter((o) => o.line?.catalogItemId && !o.orphan).map((o) => o.line!.catalogItemId));
  const kept: Out[] = [];
  for (const o of outs) {
    if (o.line && o.orphan && o.line.catalogItemId && (anchoredIds.has(o.line.catalogItemId) || seenIds.has(o.line.catalogItemId))) {
      // frammento senza quantità che ripete una voce già presente ("sostituzione sifone ... un sifone")
      leftovers.push(o.text ?? o.line.description);
    } else if (o.line) {
      if (o.line.catalogItemId && o.orphan) seenIds.add(o.line.catalogItemId);
      kept.push(o);
    } else if (o.leftover) leftovers.push(o.leftover);
  }

  // stessa voce su più righe: la nota (stanza, zona...) distingue le righe
  const groups = new Map<string, Out[]>();
  for (const o of kept) if (o.item) (groups.get(o.item.id) ?? (groups.set(o.item.id, []), groups.get(o.item.id)!)).push(o);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const notes = g.map((o) => noteWords(o.src ?? [], o.item!).split(' ').filter(Boolean));
    const common = new Set(notes[0].filter((w) => notes.every((nw) => nw.includes(w))));
    g.forEach((o, i) => {
      const note = notes[i].filter((w) => !common.has(w)).join(' ');
      if (note) meta.set(o.line!.id, { ...(meta.get(o.line!.id) ?? {}), note });
    });
  }
  for (const o of kept) {
    const l = o.line!;
    const mt: LineMeta = meta.get(l.id) ?? {};
    if (o.coats !== undefined) mt.coats = o.coats;
    if (o.converted) mt.converted = o.converted;
    const extra = [mt.note, mt.coats !== undefined ? `${fmtNum(mt.coats)} ${mt.coats === 1 ? 'mano' : 'mani'}` : undefined].filter(Boolean);
    if (extra.length) l.description = `${l.description} (${extra.join(', ')})`;
    if (mt.note || mt.coats !== undefined || mt.converted) meta.set(l.id, mt);
    if (o.spokenPrice) spoken.add(l.id);
    lines.push(l);
  }

  /* ---- coats senza riga a cui attaccarsi ---- */
  if (looseCoats !== undefined) {
    if (lines.length === 1) {
      const l = lines[0];
      const mt = meta.get(l.id) ?? {};
      if (looseCoats !== undefined && mt.coats === undefined) {
        mt.coats = looseCoats;
        l.description = `${l.description} (${fmtNum(looseCoats)} ${looseCoats === 1 ? 'mano' : 'mani'})`;
        meta.set(l.id, mt);
      }
    } else if (looseCoats !== undefined) leftovers.push(`${fmtNum(looseCoats)} mani`);
  }

  /* ---- IVA, sconto ---- */
  if (mods.vatRate !== undefined) for (const l of lines) l.vat = mods.vatRate;
  if (mods.vatMode === 'included') {
    for (const l of lines) {
      if (spoken.has(l.id)) {
        l.unitPrice = round2(l.unitPrice / (1 + l.vat / 100));
        l.needsReview = true;
      }
    }
    if (spoken.size) warnings.push('IVA compresa: ho scorporato i prezzi detti, da verificare.');
  }
  const disc = mods.discount;
  if (disc && lines.length) {
    if (disc.pct !== undefined) {
      for (const l of lines) l.discountPct = Math.max(0, Math.min(100, disc.pct));
      if (disc.uncertain) warnings.push(`Sconto: ho inteso ${fmtNum(disc.pct)}%, non hai detto se percentuale o euro.`);
    } else if (disc.amount !== undefined && disc.amount > 0) {
      const byVat = new Map<number, number>();
      for (const l of lines) byVat.set(l.vat, (byVat.get(l.vat) ?? 0) + Math.abs(l.qty * l.unitPrice));
      const vat = [...byVat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 22;
      lines.push({ id: uid(), description: 'Sconto', qty: 1, unit: 'corpo', unitPrice: -Math.min(disc.amount, MAX_PRICE), vat, needsReview: !!disc.uncertain });
      if (disc.uncertain) warnings.push(`Sconto: ho inteso ${fmtNum(disc.amount)} euro, non hai detto se percentuale o euro.`);
    }
  }

  const res: ParseResultV2 = { customerName, lines, leftovers };
  if (disc) res.discount = disc;
  if (mods.vatRate !== undefined) res.vatRate = mods.vatRate;
  if (mods.vatMode) res.vatMode = mods.vatMode;
  if (mods.referencesPrevious) res.referencesPrevious = true;
  if (meta.size) res.lineMeta = Object.fromEntries(meta);
  if (warnings.length) res.warnings = [...new Set(warnings)];
  return res;
}

const LINK_WORDS = new Set(['con', 'compreso', 'compresa', 'compresi', 'comprese', 'incluso', 'inclusa', 'inclusi', 'incluse', 'piu', 'comprensivo', 'comprensiva']);

/**
 * Spezza il testo di una riga con quantità dove c'è un connettivo di aggiunta ("con placca", "compresa
 * manodopera"): vale solo se ogni parte è, da sola, una buona voce di catalogo.
 */
function splitAtLinks(toks: Tok[], score: (toks: Tok[], unit: Unit | null, strict: boolean) => number): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isW(t) && LINK_WORDS.has(t.w)) {
      if (cur.length) parts.push(cur);
      cur = [];
      const nx = toks[i + 1];
      if (nx && isW(nx) && (nx.w === 'di' || nx.w === 'd')) i++;
    } else cur.push(t);
  }
  if (cur.length) parts.push(cur);
  if (parts.length < 2) return [toks];
  return parts.every((pt) => meaningful(pt).length > 0 && score(pt, null, false) >= 0.75) ? parts : [toks];
}

/**
 * Spezza un frammento senza quantità in più voci di catalogo (programmazione dinamica sulle parole):
 * "installazione box doccia piatto doccia 80" -> ["box doccia", "piatto doccia 80"].
 * Spezza solo se ogni pezzo è una buona corrispondenza e il frammento intero non lo è.
 */
function splitOrphan(
  toks: Tok[],
  score: (toks: Tok[], unit: Unit | null, strict: boolean) => number,
  ok: (whole: Tok[], pieces: Tok[][]) => boolean = () => true,
): Tok[][] {
  const idx: number[] = [];
  toks.forEach((t, i) => {
    if (isW(t)) idx.push(i);
  });
  const n = idx.length;
  if (n < 3 || n > 24) return [toks];
  const whole = score(toks, null, false);
  if (whole >= 0.85) return [toks];
  const W = idx.map((i) => toks[i] as WordTok);
  const THETA = 0.3;
  const MINP = 0.8;
  const best: number[] = new Array(n + 1).fill(-Infinity);
  const from: number[] = new Array(n + 1).fill(-1);
  const piece: number[] = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === -Infinity) continue;
    const w = W[i];
    const skipCost = DESC_STOP.has(w.w) || NOTE_NOISE.has(w.w) || w.num !== undefined || LOCATION_WORDS.has(w.w) ? 0.02 : 0.25;
    if (best[i] - skipCost > best[i + 1]) {
      best[i + 1] = best[i] - skipCost;
      from[i + 1] = i;
      piece[i + 1] = -1;
    }
    for (let j = i + 1; j <= Math.min(n, i + 6); j++) {
      const slice = W.slice(i, j);
      if (DESC_STOP.has(slice[0].w) || NOTE_NOISE.has(slice[0].w) || slice[0].num !== undefined) continue;
      if (!slice.some((t) => t.num === undefined && !DESC_STOP.has(t.w))) continue;
      const s = score(slice, null, false);
      if (s < MINP) continue;
      const nW = slice.filter((t) => t.num === undefined && !DESC_STOP.has(t.w)).length;
      const val = best[i] + s * nW - THETA;
      if (val > best[j]) {
        best[j] = val;
        from[j] = i;
        piece[j] = i;
      }
    }
  }
  const parts: [number, number][] = [];
  for (let j = n; j > 0; j = from[j]) if (piece[j] >= 0) parts.unshift([piece[j], j]);
  if (parts.length < 2) return [toks];
  const pieces = parts.map(([a, b]) => W.slice(a, b));
  return ok(toks, pieces) ? pieces : [toks];
}

/* ------------------------------------------------------------------ API */

/** Firma storica: testo dettato + catalogo -> righe. (Il risultato è in realtà un `ParseResultV2`.) */
export function parseDictation(transcript: string, catalog: CatalogItem[]): ParseResult {
  return parseCore(transcript, catalog, {});
}

/**
 * Come `parseDictation`, ma con il contesto dell'app: con `ctx.customers` (rubrica) il cliente dettato
 * viene agganciato con fuzzy match; l'ambiguità ("Rossi" con due Rossi in rubrica) è segnalata in
 * `customerMatch.status === 'ambiguous'` + `customerCandidates`, senza scegliere a caso.
 */
export function parseDictationWithContext(transcript: string, catalog: CatalogItem[], ctx: ParseContext = {}): ParseResultV2 {
  const res = parseCore(transcript, catalog, ctx);
  if (ctx.customers?.length && res.customerName) {
    const cm = matchCustomer(res.customerName, ctx.customers);
    res.customerMatch = cm.match;
    if (cm.candidates.length) res.customerCandidates = cm.candidates;
    if (cm.match.status === 'matched' && cm.match.id) {
      res.customerId = cm.match.id;
      res.customerName = cm.match.name;
    } else if (cm.match.status === 'ambiguous') {
      (res.warnings ??= []).push(`Cliente «${res.customerName}»: più corrispondenze in rubrica, scegli quello giusto.`);
    }
  }
  return res;
}
