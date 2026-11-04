/**
 * parseDictation: testo dettato -> righe di preventivo agganciate al catalogo.
 *
 * Pipeline: lex -> cliente -> token semantici (quantità+unità come ancore, prezzi, specifiche)
 * -> segmentazione in righe (con scelta del confine tra testo "dopo" una quantità e testo "prima"
 * della successiva guidata dal catalogo) -> matching -> DocLine.
 */
import type { CatalogItem, DocLine, ParseResult, Unit } from '../types';
import { uid } from '../types';
import { CONJ, extractCustomer, FILLER } from './customer';
import { getMatcher, MATCH_MIN, REVIEW_BELOW, type Matcher } from './match';
import { fmtNum, isHalfWord, readNumber } from './numbers';
import { lex, type RawTok } from './text';
import { readUnit, UNIT_LABEL } from './units';

type QtyTok = { k: 'qty'; v: number; u: Unit | null; art: boolean; inferred?: boolean };
type WordTok = { k: 'w'; w: string; raw: string; num?: number };
type Tok =
  | QtyTok
  | WordTok
  | { k: 'sep' }
  | { k: 'conj' }
  | { k: 'price'; v: number }
  | { k: 'mod'; text: string };

const SPEC_PREP = new Set(['da', 'di', 'n', 'numero', 'diametro', 'sezione', 'tipo', 'modello', 'misura', 'codice', 'con', 'dal', 'a']);
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
const PRICE_POST_UNIT = new Set(['metro', 'metri', 'pezzo', 'pezzi', 'ora', 'ore', 'litro', 'litri', 'chilo', 'kg', 'mq', 'giorno', 'giornata']);

const isBoundary = (t: Tok) => t.k === 'sep' || t.k === 'conj';
const isW = (t: Tok): t is WordTok => t.k === 'w';
const meaningful = (toks: Tok[]) => toks.filter((t): t is WordTok => isW(t) && !DESC_STOP.has(t.w) && !UNIT_NOISE.has(t.w));

/* ------------------------------------------------------------------ token semantici */

function toTokens(R: RawTok[], matcher: Matcher): Tok[] {
  const catalogNums = matcher.nums;
  const out: Tok[] = [];
  const last = () => out[out.length - 1];
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

    // prezzo: "1200 euro"
    if (R[j] && R[j].kind === 'word' && (R[j].w === 'euro' || R[j].w === 'eur' || R[j].w === 'euri')) {
      out.push({ k: 'price', v });
      i = j + 1;
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
    const specLike =
      !!un && un.kind === 'unit' && (un.u === 'l' || un.u === 'kg') && catalogNums.has(v) &&
      !!pw && isW(pw) && !ART_BLOCK.has(pw.w) && !nr.art;
    if (un && un.kind === 'unit' && !specLike) {
      let q = v;
      let nj = un.next;
      if (R[nj]?.w === 'e' && isHalfWord(R[nj + 1]?.w) && !readUnit(R, nj + 2)) {
        q += 0.5;
        nj += 2;
      }
      out.push({ k: 'qty', v: q, u: un.u, art: nr.art });
      i = nj;
      continue;
    }
    if (specLike || (un && un.kind === 'spec')) {
      out.push({ k: 'w', w: String(v), raw: fmtNum(v), num: v });
      i = j;
      continue;
    }

    // "due mani" / "tre passate"
    if (R[j] && R[j].kind === 'word' && MOD_WORDS.has(R[j].w)) {
      out.push({ k: 'mod', text: `${fmtNum(v)} ${R[j].raw}` });
      i = j + 1;
      continue;
    }

    // numero senza unità: quantità (pezzi) oppure specifica ("cavo 2,5", "tubo da 16")
    const p = last();
    const next = R[j];
    const nextIsWord = !!next && next.kind === 'word' && !CONJ.has(next.w) && !FILLER.has(next.w);
    const prevBoundary = !p || isBoundary(p) || p.k === 'qty' || p.k === 'price' || p.k === 'mod';
    const prevSpecNum = !!p && isW(p) && p.num !== undefined;
    const prevPrep = !!p && isW(p) && SPEC_PREP.has(p.w);
    const artAfterWord = nr.art && !!p && isW(p) && !ART_BLOCK.has(p.w);
    // numero dopo un nome senza preposizione: "quattro prese tre interruttori" (quantità) oppure
    // "cavo 4 colore nero" (specifica). Si decide col catalogo: è una specifica se una voce contiene
    // il nome + il numero e la parola successiva non appartiene ad un'altra voce.
    let nounThenQty = false;
    if (nextIsWord && !prevPrep && !prevBoundary && !prevSpecNum && !artAfterWord && !nr.art && p && isW(p) && Number.isInteger(v) && p.num === undefined) {
      const nw = next.w;
      const isSpec = matcher.cooccur([p.w], v);
      const nextKnown = matcher.vocab.has(nw) || matcher.vocab.has(nw.replace(/[aeio]$/, ''));
      nounThenQty = isSpec ? nextKnown && !matcher.cooccur([p.w, nw], v) : nextKnown;
    }
    if (nextIsWord && !prevPrep && (prevBoundary || prevSpecNum || artAfterWord || nounThenQty)) {
      out.push({ k: 'qty', v, u: null, art: nr.art });
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

export function parseDictation(transcript: string, catalog: CatalogItem[]): ParseResult {
  const empty: ParseResult = { lines: [], leftovers: [] };
  if (!transcript || !transcript.trim()) return empty;

  const matcher: Matcher = getMatcher(catalog ?? []);
  const R0 = lex(transcript);
  const { name: customerName, rest } = extractCustomer(R0, (w) => {
    return matcher.vocab.has(w) || matcher.vocab.has(w.length >= 4 ? w.replace(/[aeio]$/, '') : w);
  });

  const all = toTokens(rest, matcher);
  const mods: string[] = all.filter((t): t is { k: 'mod'; text: string } => t.k === 'mod').map((t) => t.text);
  const T = all.filter((t) => t.k !== 'mod');

  const anchorsIdx: number[] = [];
  T.forEach((t, i) => {
    if (t.k === 'qty') anchorsIdx.push(i);
  });
  const n = anchorsIdx.length;

  const drafts: LineDraft[] = anchorsIdx.map((idx) => ({ anchor: T[idx] as QtyTok, pos: idx, lead: [], trail: [] }));
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
  const leadAllowed = (j: number): boolean => drafts[j].anchor.u !== null && !trailExists(j);

  const scoreText = (toks: Tok[], unit: Unit | null, strict: boolean): number => {
    const txt = wordsText(toks);
    if (!meaningful(toks).length) return 0;
    const m = matcher.best(txt, { unit, strictUnit: strict });
    return m ? m.score : 0;
  };

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

  /* ---- da bozze a righe ---- */
  const leftovers: string[] = [];
  type Out = { pos: number; line?: DocLine; leftover?: string; orphan?: boolean; text?: string };
  const outs: Out[] = [];

  const asLeftover = (toks: Tok[]): string | undefined => {
    const ws = toks.filter(isW);
    const txt = ws.map((t) => (t.num !== undefined ? fmtNum(t.num) : t.raw)).join(' ').trim();
    return meaningful(toks).length || ws.some((t) => t.num !== undefined) ? txt : undefined;
  };

  const buildLine = (anchor: QtyTok | null, toksIn0: Tok[], pos: number) => {
    // frammenti senza quantità: le parole generiche ("lavori", "intervento") non sono voci
    const toksIn = anchor ? toksIn0 : toksIn0.filter((t) => !(isW(t) && GENERIC_JOB.has(t.w)));
    const { price, toks } = takePrice(toksIn);
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
    let m = matchText ? matcher.best(matchText, { unit: anchor?.u ?? null }) : null;
    if (anchor && !has && (anchor.u === 'h' || anchor.u === 'gg')) {
      const same = catalog.filter((c) => c.kind === 'manodopera' && c.unit === anchor.u);
      if (same.length === 1) m = { item: same[0], score: 0.9, ambiguous: false };
    }
    const qty = anchor ? anchor.v : 1;
    if (m && m.score >= MATCH_MIN) {
      const it = m.item;
      const unitMismatch = !!anchor && anchor.u !== null && anchor.u !== it.unit;
      const bareNonPz = !!anchor && anchor.u === null && it.unit !== 'pz';
      const review =
        unitMismatch || bareNonPz || m.score < REVIEW_BELOW || m.ambiguous || !anchor || !!anchor.inferred;
      outs.push({
        pos,
        orphan: !anchor,
        text: asLeftover(toks),
        line: {
          id: uid(),
          catalogItemId: it.id,
          description: it.name,
          qty,
          unit: it.unit,
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
    outs.push({
      pos,
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

  for (const d of drafts) buildLine(d.anchor, [...d.lead, ...d.trail], d.pos);
  for (const o of orphans) buildLine(null, o.toks, o.pos);
  outs.sort((a, b) => a.pos - b.pos);
  const lines: DocLine[] = [];
  const anchoredIds = new Set(outs.filter((o) => o.line?.catalogItemId && !o.orphan).map((o) => o.line!.catalogItemId));
  for (const o of outs) {
    if (o.line && o.orphan && o.line.catalogItemId && anchoredIds.has(o.line.catalogItemId)) {
      // frammento senza quantità che ripete una voce già presente ("sostituzione sifone ... un sifone")
      leftovers.push(o.text ?? o.line.description);
    } else if (o.line) lines.push(o.line);
    else if (o.leftover) leftovers.push(o.leftover);
  }
  leftovers.push(...mods);
  return { customerName, lines, leftovers };
}
