import { fmtNumRaw } from './util';
import { readNumber } from './numbers';
import { lex } from './text';
import { readUnit } from './units';

/**
 * Normalizza una dettatura: minuscolo, senza accenti/punteggiatura, numeri in lettere -> cifre
 * (punto decimale), sinonimi delle unità -> sigla ("metri quadri" -> "mq", "ore" -> "h").
 * Esempio: "Due virgola cinque metri quadri di Cavo" -> "2.5 mq di cavo".
 */
export function normalizeText(input: string): string {
  const R = lex(input);
  const out: string[] = [];
  for (let i = 0; i < R.length; ) {
    const t = R[i];
    if (t.kind === 'punct') {
      i++;
      continue;
    }
    const nr = readNumber(R, i);
    if (nr) {
      out.push(fmtNumRaw(nr.v));
      i = nr.next;
      const u = readUnit(R, i);
      if (u && u.kind === 'unit') {
        out.push(u.u);
        i = u.next;
      }
      continue;
    }
    out.push(t.w);
    i++;
  }
  return out.join(' ');
}
