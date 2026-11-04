/**
 * Livello testo del motore voce: pre-elaborazione, tokenizzazione, stemming leggero, stopword.
 * Tutto puro e deterministico.
 */

export type RawKind = 'word' | 'digit' | 'punct';
export interface RawTok {
  /** testo originale (con maiuscole/accenti) */
  raw: string;
  /** minuscolo senza accenti (per le parole) */
  w: string;
  kind: RawKind;
  /** la parola era seguita da un apostrofo attaccato alla successiva (d'Angelo, dell'Orto, l'uno) */
  apo?: boolean;
}

export const stripAccents = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Pulisce il testo grezzo del riconoscimento vocale prima di tokenizzare. */
export function preprocess(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[’‘`´]/g, "'");
  // "sig." "dott." -> senza punto, per non spezzare il nome del cliente
  s = s.replace(/\b(sig|sigra|dott|dr|ing|geom|avv|prof|arch|ecc)\./gi, '$1');
  // mezz'ora / mezzora
  s = s.replace(/\bmezz['\s]?ora\b/gi, 'mezza ora');
  // m², mm2, m3...
  s = s.replace(/(?<![\p{L}])mm[²2](?![\d\p{L}])/giu, ' mmq ');
  s = s.replace(/(?<![\p{L}])m[²2](?![\d\p{L}])/giu, ' mq ');
  s = s.replace(/(?<![\p{L}])m[³3](?![\d\p{L}])/giu, ' mc ');
  s = s.replace(/€/g, ' euro ').replace(/&/g, ' e ');
  // percentuali: "10%", "10 per cento", "dieci percento" -> "percento" (evita che "cento" diventi 100)
  s = s.replace(/%/g, ' percento ');
  s = s.replace(/\bper\s+cento\b/gi, ' percento ');
  s = s.replace(/\+/g, ' piu ');
  // apostrofo tra lettere: segnaposto (la parola prima riceve il flag `apo`), così "Dell'Orto" si ricompone
  s = s.replace(/(\p{L})'(?=\p{L})/gu, `$1${APO}`);
  s = s.replace(/'/g, ' ');
  // separatore migliaia all'italiana: 1.500 -> 1500 (ma non 0.500 e non 2.5)
  s = s.replace(/(?<![\d.,])(\d{1,3})((?:\.\d{3})+)(?!\d)/g, (m, a: string, rest: string) =>
    a === '0' ? m : a + rest.replace(/\./g, ''),
  );
  // virgola decimale: 2,5 -> 2.5
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  // 3 x 2,5 -> 3x2.5 (notazione cavi)
  s = s.replace(/(\d)\s*[x×]\s*(?=\d)/gi, '$1x');
  return s;
}

const APO = '\uE000';
const TOKEN_RE = /\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)*|\p{L}+\d*|[,;:.!?\n]/gu;

export function tokenize(s: string): RawTok[] {
  const out: RawTok[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const c = raw[0];
    const apo = s[(m.index ?? 0) + raw.length] === APO;
    if (/\d/.test(c)) out.push({ raw, w: raw, kind: 'digit' });
    else if (/\p{L}/u.test(c)) out.push({ raw, w: raw.toLowerCase() === 'è' ? 'è' : stripAccents(raw).toLowerCase(), kind: 'word', ...(apo ? { apo: true } : {}) });
    else out.push({ raw, w: raw, kind: 'punct' });
  }
  return out;
}

export const lex = (s: string): RawTok[] => tokenize(preprocess(s));

/** Stemming leggero italiano: toglie la vocale finale (singolare/plurale/genere). */
export function stem(w: string): string {
  if (w.length < 4 || /\d/.test(w)) return w;
  let s = w;
  if (/[aeio]$/.test(s)) s = s.slice(0, -1);
  if (s.length >= 5 && /i$/.test(s)) s = s.slice(0, -1); // caldaia/caldaie -> calda
  if (/ch$/.test(s)) s = s.slice(0, -1);
  else if (/gh$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Parole vuote per il matching (articoli, preposizioni, unità di misura "di specifica"). */
export const MATCH_STOP = new Set([
  'di', 'd', 'da', 'a', 'ad', 'il', 'lo', 'la', 'le', 'i', 'gli', 'l', 'un', 'uno', 'una', 'del', 'dello',
  'della', 'dei', 'degli', 'delle', 'dell', 'dal', 'dalla', 'dai', 'dalle', 'dall', 'nel', 'nella', 'nei',
  'nello', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all', 'con', 'per', 'su', 'sul', 'sulla', 'in', 'e',
  'ed', 'o', 'tra', 'fra', 'mm', 'cm', 'mmq', 'euro', 'tipo', 'modello', 'misura', 'circa', 'n', 'numero',
  'che', 'ci', 'si', 'mi', 'ti', 'sono', 'ho', 'x',
]);

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
