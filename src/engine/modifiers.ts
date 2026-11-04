/**
 * Modificatori "di documento" estratti PRIMA della segmentazione in righe:
 *   sconti    "con sconto del dieci per cento", "sconto venti euro", "venti euro di sconto"
 *   IVA       "più IVA", "IVA al dieci", "IVA agevolata al 10", "IVA compresa", "IVA esclusa"
 *   rimandi   "come da preventivo precedente", "idem preventivo di prima"
 * I token consumati vengono tolti dal flusso, così non diventano righe né "frammenti non capiti".
 */
import { readNumber } from './numbers';
import type { RawTok } from './text';

export interface Discount {
  pct?: number;
  amount?: number;
  /** l'unità (% o €) non è stata detta: scelta euristica, da confermare */
  uncertain?: boolean;
}
export interface Modifiers {
  rest: RawTok[];
  discount?: Discount;
  vatRate?: number;
  vatMode?: 'plus' | 'included';
  referencesPrevious: boolean;
}

const SCONTO = new Set(['sconto', 'sconti', 'scontato', 'scontata', 'scontati', 'scontate', 'ribasso']);
const DISC_LEAD = new Set(['con', 'lo', 'uno', 'un', 'applica', 'applicare', 'applichiamo', 'fai', 'facciamo', 'metti', 'mettici', 'fammi']);
const DISC_PREP = new Set(['del', 'dell', 'dello', 'di', 'al', 'pari', 'a', 'dellimporto']);
const EURO = new Set(['euro', 'eur', 'euri']);
const VAT_SKIP = new Set(['agevolata', 'ridotta', 'ordinaria', 'standard', 'al', 'del', 'di', 'a', 'pari', 'dell', 'aliquota', 'agevolato']);
const VAT_LEAD = new Set(['con', 'aliquota', 'piu']);
const DOC_WORDS = new Set(['preventivo', 'fattura', 'offerta', 'ordine', 'stima', 'computo']);
const PREV_AFTER = new Set(['precedente', 'scorso', 'scorsa', 'ultimo', 'ultima', 'prima', 'vecchio', 'vecchia']);
const PREV_LEAD = new Set(['come', 'da', 'uguale', 'identico', 'identica', 'stesso', 'stessa', 'idem', 'copia', 'copiare', 'ripeti', 'ripetere', 'riprendi', 'al', 'allo', 'alla', 'del', 'dello', 'di', 'su', 'partendo', 'base', 'un', 'il']);

const wd = (R: RawTok[], i: number): string => (R[i] && R[i].kind === 'word' ? R[i].w : '');

export function extractModifiers(R: RawTok[]): Modifiers {
  const drop = new Array<boolean>(R.length).fill(false);
  const out: Modifiers = { rest: R, referencesPrevious: false };

  /* ---- sconto ---- */
  for (let i = 0; i < R.length && !out.discount; i++) {
    if (!SCONTO.has(wd(R, i))) continue;
    // forma "venti euro di sconto" / "il 10 per cento di sconto"
    if (wd(R, i - 1) === 'di' && (wd(R, i - 2) === 'percento' || EURO.has(wd(R, i - 2)))) {
      const isPct = wd(R, i - 2) === 'percento';
      for (let s = i - 3; s >= Math.max(0, i - 6); s--) {
        const nr = readNumber(R, s);
        if (nr && nr.next === i - 2 && nr.v >= 0) {
          out.discount = isPct ? { pct: Math.min(100, nr.v) } : { amount: nr.v };
          let st = s;
          while (st > 0 && ['il', 'lo', 'un', 'uno', 'con', 'del', 'di'].includes(wd(R, st - 1))) st--;
          for (let d = st; d <= i; d++) drop[d] = true;
          break;
        }
      }
      if (out.discount) continue;
    }
    let st = i;
    while (st > 0 && i - st < 3 && DISC_LEAD.has(wd(R, st - 1))) st--;
    let k = i + 1;
    let sawDel = false;
    while (k < R.length && DISC_PREP.has(wd(R, k))) {
      if (['del', 'dell', 'dello', 'al', 'pari', 'dellimporto'].includes(wd(R, k))) sawDel = true;
      k++;
    }
    const nr = R[k] ? readNumber(R, k) : null;
    if (!nr || nr.art) {
      // "con sconto" senza cifra: toglie la parola ma non inventa nulla
      for (let d = st; d <= i; d++) drop[d] = true;
      continue;
    }
    let end = nr.next;
    const unitW = wd(R, end);
    const v = nr.v;
    if (unitW === 'percento') {
      out.discount = { pct: Math.min(100, v) };
      end++;
    } else if (EURO.has(unitW)) {
      out.discount = { amount: v };
      end++;
    } else if (sawDel || v <= 30) {
      out.discount = sawDel ? { pct: Math.min(100, v) } : { pct: Math.min(100, v), uncertain: true };
    } else {
      out.discount = { amount: v, uncertain: true };
    }
    for (let d = st; d < end; d++) drop[d] = true;
  }

  /* ---- IVA ---- */
  for (let i = 0; i < R.length && out.vatRate === undefined && !out.vatMode; i++) {
    if (wd(R, i) !== 'iva') continue;
    let st = i;
    let plus = false;
    while (st > 0 && VAT_LEAD.has(wd(R, st - 1))) {
      if (wd(R, st - 1) === 'piu') plus = true;
      st--;
    }
    let included = false;
    if (wd(R, st - 1) === 'di' && /^compres[oai]|^comprensiv|^inclus[oai]/.test(wd(R, st - 2))) {
      included = true;
      st -= 2;
    }
    let k = i + 1;
    while (k < R.length && VAT_SKIP.has(wd(R, k))) k++;
    const nr = R[k] ? readNumber(R, k) : null;
    let end = i + 1;
    if (nr && !nr.art && nr.v >= 0 && nr.v <= 100) {
      out.vatRate = nr.v;
      end = nr.next;
      if (wd(R, end) === 'percento') end++;
      if (!included) out.vatMode = out.vatMode ?? 'plus';
    } else {
      const a = wd(R, i + 1);
      const b = wd(R, i + 2);
      if (/^compres[oai]$|^inclus[oai]$/.test(a)) {
        included = true;
        end = i + 2;
      } else if (/^esclus[oai]$/.test(a)) {
        plus = true;
        end = i + 2;
      } else if (a === 'non' && /^compres[oai]$|^inclus[oai]$/.test(b)) {
        plus = true;
        end = i + 3;
      } else if (a === 'in' && b === 'piu') {
        plus = true;
        end = i + 3;
      } else if (a === 'a' && b === 'parte') {
        plus = true;
        end = i + 3;
      }
    }
    if (included) out.vatMode = 'included';
    else if (plus) out.vatMode = 'plus';
    for (let d = st; d < end; d++) drop[d] = true;
  }

  /* ---- "come da preventivo precedente" ---- */
  for (let i = 0; i < R.length && !out.referencesPrevious; i++) {
    if (!DOC_WORDS.has(wd(R, i))) continue;
    let end = i + 1;
    if (PREV_AFTER.has(wd(R, end))) end++;
    else if (wd(R, end) === 'di' && wd(R, end + 1) === 'prima') end += 2;
    else if (!PREV_AFTER.has(wd(R, i - 1))) continue;
    let st = i;
    while (st > 0 && PREV_AFTER.has(wd(R, st - 1))) st--;
    let back = 0;
    while (st > 0 && back < 4 && PREV_LEAD.has(wd(R, st - 1))) {
      st--;
      back++;
    }
    // serve almeno un segnale di rimando oltre alla parola "preventivo"
    const sig = [...Array(end - st).keys()].some((o) => {
      const x = wd(R, st + o);
      return PREV_AFTER.has(x) || ['idem', 'uguale', 'stesso', 'stessa', 'identico', 'identica', 'copia', 'ripeti', 'riprendi'].includes(x);
    });
    if (!sig) continue;
    out.referencesPrevious = true;
    for (let d = st; d < end; d++) drop[d] = true;
  }

  out.rest = R.filter((_, i) => !drop[i]);
  return out;
}
