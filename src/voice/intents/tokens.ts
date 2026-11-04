/**
 * Tokenizzazione per il classificatore di comandi: riusa il livello testo e i numeri del motore
 * (src/engine) così "dodici", "duemilaventisei", "12/2026" e "2,5" sono letti allo stesso modo del dettato.
 */
import { lex, levenshtein } from '../../engine/text';
import { readNumber } from '../../engine/numbers';

export interface Tok {
  /** parola canonica (minuscola, senza accenti) oppure numero come stringa */
  w: string;
  /** testo originale (per i nomi dei clienti) */
  raw: string;
  /** valore numerico se il token è un numero (cifre o lettere) */
  n?: number;
  /** la parola è stata corretta per somiglianza con una parola chiave (errore tipico del riconoscimento) */
  fuzzy?: boolean;
}

export function tokenize(input: string): Tok[] {
  const R = lex(input).filter((t) => t.kind !== 'punct');
  const out: Tok[] = [];
  for (let i = 0; i < R.length; ) {
    const t = R[i];
    if (t.kind === 'digit') {
      out.push({ w: t.w, raw: t.raw, n: parseFloat(t.w) });
      i++;
      continue;
    }
    const m = /^([a-z]+)(\d+)$/.exec(t.w); // "ft12", "prev0008"
    if (m) {
      out.push({ w: m[1], raw: m[1] });
      out.push({ w: m[2], raw: m[2], n: parseInt(m[2], 10) });
      i++;
      continue;
    }
    const nr = readNumber(R, i);
    if (nr && !nr.art) {
      out.push({ w: String(nr.v), raw: R.slice(i, nr.next).map((x) => x.raw).join(' '), n: nr.v });
      i = nr.next;
      continue;
    }
    out.push({ w: t.w, raw: t.raw });
    i++;
  }
  return out;
}

/** Sostituisce con la parola chiave più vicina (distanza 1, stessa iniziale) i token non riconosciuti. */
export function canonicalize(toks: Tok[], keywords: ReadonlySet<string>): Tok[] {
  const list = [...keywords].filter((k) => k.length >= 5);
  return toks.map((t) => {
    if (t.n !== undefined || keywords.has(t.w) || t.w.length < 5 || /\d/.test(t.w)) return t;
    const max = 1;
    let best: string | null = null;
    let bestD = max + 1;
    let tie = false;
    for (const k of list) {
      if (k[0] !== t.w[0] || Math.abs(k.length - t.w.length) > max) continue;
      const d = levenshtein(t.w, k);
      if (d < bestD) { bestD = d; best = k; tie = false; }
      else if (d === bestD) tie = true;
    }
    if (!best || tie || bestD > max) return t;
    return { ...t, w: best, fuzzy: true };
  });
}
