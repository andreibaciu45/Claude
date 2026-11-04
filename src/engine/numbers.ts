/**
 * Numeri italiani in lettere e cifre -> number.
 * Supporta: zero..novantanove, cento, mille, composti ("centoventi", "duemilacinquecento"),
 * "mille e cinquecento", "venti mila", decimali ("due virgola cinque", "2,5"),
 * mezzo/mezza (0,5), "un paio" (2), "una decina" (10), "una dozzina" (12).
 */
import { lex, type RawTok } from './text';

const UNITS_W = [
  'zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici',
  'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove',
];
const TENS_W = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

let MAP: Map<string, number> | null = null;

function build(): Map<string, number> {
  const m = new Map<string, number>();
  const put = (w: string, n: number) => {
    if (!m.has(w)) m.set(w, n);
  };
  const v99: string[][] = [];
  for (let n = 0; n < 100; n++) {
    if (n < 20) v99[n] = [UNITS_W[n]];
    else {
      const t = TENS_W[Math.floor(n / 10)];
      const u = n % 10;
      if (u === 0) v99[n] = [t];
      else if (u === 1 || u === 8) v99[n] = [t.slice(0, -1) + UNITS_W[u], t + UNITS_W[u]];
      else v99[n] = [t + UNITS_W[u]];
    }
  }
  const v999: string[][] = [];
  for (let n = 0; n < 1000; n++) {
    if (n < 100) {
      v999[n] = v99[n];
      continue;
    }
    const h = Math.floor(n / 100);
    const r = n % 100;
    const prefix = h === 1 ? 'cento' : UNITS_W[h] + 'cento';
    const rest = r === 0 ? [''] : v99[r];
    const list: string[] = [];
    for (const rv of rest) {
      list.push(prefix + rv);
      if (rv.startsWith('o') && r !== 0) list.push(prefix.slice(0, -1) + rv);
    }
    v999[n] = list;
  }
  for (let n = 0; n < 1000; n++) for (const w of v999[n]) put(w, n);
  for (let n = 1000; n < 10000; n++) {
    const t = Math.floor(n / 1000);
    const r = n % 1000;
    const prefix = t === 1 ? 'mille' : UNITS_W[t] + 'mila';
    const rest = r === 0 ? [''] : v999[r];
    for (const rv of rest) put(prefix + rv, n);
  }
  put('un', 1);
  put('una', 1);
  put('mezzo', 0.5);
  put('mezza', 0.5);
  put('mezz', 0.5);
  return m;
}

export function wordValue(w: string): number | undefined {
  if (!MAP) MAP = build();
  return MAP.get(w);
}

export const isArticleNum = (w: string) => w === 'un' || w === 'uno' || w === 'una';
export const isHalfWord = (w?: string) => w === 'mezzo' || w === 'mezza' || w === 'mezz';

export interface NumRead {
  v: number;
  /** indice del primo token dopo il numero */
  next: number;
  /** vale "un/uno/una" usato come articolo */
  art: boolean;
  spoken: boolean;
}

const COLLECTIVES: Record<string, number> = {
  paio: 2, coppia: 2, decina: 10, dozzina: 12, ventina: 20, trentina: 30, quarantina: 40, cinquantina: 50,
  centinaio: 100,
};

function canMerge(cur: number, y: number): boolean {
  if (cur < 20 || y <= 0) return false;
  const p = cur % 10 !== 0 ? 1 : cur % 100 !== 0 ? 10 : cur % 1000 !== 0 ? 100 : 1000;
  return y < p;
}

/** Legge un intero (cifre o lettere) senza parte decimale. */
function readInt(R: RawTok[], i: number): { v: number; next: number; art: boolean; spoken: boolean } | null {
  const t = R[i];
  if (!t) return null;
  let v: number;
  let j = i + 1;
  let art = false;
  let spoken = false;
  if (t.kind === 'digit') {
    if (!/^\d+(\.\d+)?$/.test(t.w)) return null;
    v = parseFloat(t.w);
    const n = R[j];
    if (n && n.kind === 'word' && (n.w === 'mila' || n.w === 'mille') && Number.isInteger(v) && v > 0 && v < 1000) {
      v *= 1000;
      j++;
    }
    return { v, next: j, art, spoken };
  }
  if (t.kind !== 'word') return null;
  const x = wordValue(t.w);
  if (x === undefined) return null;
  spoken = true;
  if (isArticleNum(t.w)) {
    art = true;
    const n = R[j];
    if (n && n.kind === 'word' && COLLECTIVES[n.w] !== undefined) {
      return { v: COLLECTIVES[n.w], next: j + 1, art: false, spoken };
    }
  }
  v = x;
  if (isHalfWord(t.w)) return { v, next: j, art: false, spoken };
  for (;;) {
    const nt = R[j];
    if (!nt) break;
    let k = j;
    if (nt.kind === 'word' && nt.w === 'e' && v >= 100) k = j + 1;
    const nx = R[k];
    if (!nx || nx.kind !== 'word') break;
    if ((nx.w === 'mila' || nx.w === 'mille') && v > 0 && v < 1000 && k === j) {
      if (nx.w === 'mila') {
        v *= 1000;
        j = k + 1;
        continue;
      }
      break;
    }
    const y = wordValue(nx.w);
    if (y === undefined || isArticleNum(nx.w) || isHalfWord(nx.w)) break;
    if (y === 100 && v > 0 && v < 10 && k === j) {
      v *= 100;
      j = k + 1;
      continue;
    }
    if (!canMerge(v, y)) break;
    v += y;
    j = k + 1;
  }
  return { v, next: j, art: art && v === 1, spoken };
}

/** Legge un numero (anche decimale a parole: "due virgola cinque"). */
export function readNumber(R: RawTok[], i: number): NumRead | null {
  const a = readInt(R, i);
  if (!a) return null;
  let { v, next } = a;
  const m = R[next];
  if (m && m.kind === 'word' && (m.w === 'virgola' || m.w === 'punto') && Number.isInteger(v)) {
    let k = next + 1;
    let zeros = '';
    while (R[k] && R[k].kind === 'word' && R[k].w === 'zero') {
      zeros += '0';
      k++;
    }
    const f = readInt(R, k);
    if (f && Number.isInteger(f.v) && !(f.art && zeros === '' && m.w === 'punto')) {
      v = parseFloat(`${v}.${zeros}${f.v}`);
      next = f.next;
      return { v, next, art: false, spoken: true };
    }
    if (zeros && R[k - 1]) {
      // "due virgola zero" -> 2
      v = parseFloat(`${v}`);
      next = k;
      return { v, next, art: false, spoken: true };
    }
  }
  return { v, next, art: a.art, spoken: a.spoken };
}

/** Converte una stringa che è SOLO un numero ("duemilacinquecento", "2,5", "mezzo") in number; altrimenti null. */
export function parseItalianNumber(s: string): number | null {
  const R = lex(s.trim());
  if (!R.length) return null;
  const r = readNumber(R, 0);
  if (!r) return null;
  // consenti "e mezzo" finale: "due e mezzo"
  let next = r.next;
  let v = r.v;
  if (R[next]?.w === 'e' && isHalfWord(R[next + 1]?.w)) {
    v += 0.5;
    next += 2;
  }
  return next === R.length ? v : null;
}

/** Formatta un numero all'italiana (virgola decimale, niente zeri inutili). */
export function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r).replace('.', ',');
}
