/** Logica PURA della scheda "Numerazione fatture elettroniche" (nessun accesso allo storage). */
import { MAX_COUNTER_VALUE } from '../../storage/invoices';

export type NumberingSectional = 'FT' | 'NC';

export const sectionalLabel = (s: NumberingSectional, plural = true): string =>
  s === 'NC' ? (plural ? 'note di credito' : 'nota di credito') : (plural ? 'fatture' : 'fattura');

export const numberText = (sectional: NumberingSectional, seq: number, year: number): string => `${sectional === 'NC' ? 'NC' : ''}${seq}/${year}`;

export interface CounterEvaluation {
  /** valore valido e intero, se l'input lo è */
  value?: number;
  /** messaggio da mostrare sotto il campo (blocca il pulsante) */
  error?: string;
  /** il valore è più basso di quello attuale (ma non sotto l'emesso): serve la doppia conferma */
  lowering: boolean;
  /** il valore non cambia nulla */
  unchanged: boolean;
  /** numero della prossima emissione, se il valore è valido */
  nextNumber?: string;
}

/**
 * Valuta quanto scritto nel campo "ultimo numero già usato".
 * `maxIssued` = massimo già emesso con questa app; `current` = ultimo numero usato attuale (max tra contatore ed emesso).
 */
export function evaluateCounterInput(o: { input: string; sectional: NumberingSectional; year: number; maxIssued: number; current: number }): CounterEvaluation {
  const raw = o.input.trim();
  const base = { lowering: false, unchanged: false };
  if (!raw) return { ...base, error: 'Scrivi l’ultimo numero che hai usato (0 se non hai ancora emesso nulla quest’anno).' };
  if (!/^\d+$/.test(raw)) return { ...base, error: 'Scrivi solo cifre, senza “/” né anno: per la fattura 14/2026 scrivi 14.' };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_COUNTER_VALUE) return { ...base, error: 'Numero troppo grande.' };
  if (value < o.maxIssued) {
    return { ...base, value, error: `Con questa app hai già emesso fino al n. ${numberText(o.sectional, o.maxIssued, o.year)}: non puoi scendere sotto, creeresti numeri duplicati.` };
  }
  return { value, lowering: value < o.current, unchanged: value === o.current, nextNumber: numberText(o.sectional, value + 1, o.year) };
}
