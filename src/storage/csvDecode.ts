/**
 * Decodifica comune dei file CSV importati (rubrica clienti e listino). Excel italiano salva "CSV (delimitato dal separatore di elenco)"
 * in Windows-1252, non in UTF-8: `File.text()` lo leggeva sempre come UTF-8 e ogni lettera accentata diventava U+FFFD («Caff�»).
 * Si prova UTF-8 (anche con BOM, che viene tolto) rigoroso e, se i byte non lo sono, Windows-1252.
 */

/** Oltre questa dimensione un file non è un CSV di rubrica/listino: si rifiuta prima di leggerlo (evita di bloccare la scheda). */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function decodeCsvBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/**
 * Neutralizza un valore di testo per l'esportazione CSV: `\r`, `\n` e `\t` (all'inizio e dentro il campo) diventano uno spazio
 * (un `\r` isolato rompe la riga in Excel) e una cella che comincia con = + - @ viene preceduta da un apostrofo (niente formule).
 */
export function neutralizeCsvText(v: unknown): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ');
  return /^ *[=+\-@]/.test(s) ? `'${s.replace(/^ +/, '')}` : s;
}

/** Inverso di `neutralizeCsvText` sul solo apostrofo di protezione (usato in importazione per il round trip). */
export const restoreCsvText = (v: string): string => v.replace(/^'(?=[=+\-@])/, '');
