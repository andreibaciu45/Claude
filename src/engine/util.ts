/** Numero -> stringa canonica con punto decimale (per il matching): 16 -> "16", 2.5 -> "2.5". */
export const fmtNumRaw = (n: number): string => String(Math.round(n * 1000) / 1000);
