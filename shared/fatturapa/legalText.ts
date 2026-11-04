/**
 * UNICA fonte delle diciture di legge che compaiono sul documento: XML (Causale), PDF, anteprima/scheda "Emetti".
 * Solo caratteri ASCII: il testo è identico ovunque e non viene alterato dalla pulizia dei caratteri dell'XML.
 * [DA VERIFICARE] col commercialista: formulazione esatta delle due diciture.
 */

/** Dicitura del regime forfettario [DA VERIFICARE: testo esatto]. */
export const FORFETTARIO_LEGAL_TEXT =
  "Operazione effettuata ai sensi dell'articolo 1, commi da 54 a 89, della Legge n. 190/2014 - Regime forfettario.";

/** Dicitura del bollo, da riportare quando l'imposta di bollo è dovuta (importo > 77,47 EUR) [DA VERIFICARE: testo esatto]. */
export const BOLLO_LEGAL_TEXT = 'Imposta di bollo assolta in modo virtuale (DPR 642/72).';

/** Dicitura "nessuna ritenuta" (solo XML delle fatture TD01) [DA VERIFICARE]. */
export const NO_RITENUTA_LEGAL_TEXT =
  "Compenso non assoggettato a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014.";

/** Le diciture da mostrare per un documento, nell'ordine in cui compaiono ovunque. */
export const legalNotesFor = (o: { forfettario: boolean; stampDue: boolean }): string[] => [
  ...(o.forfettario ? [FORFETTARIO_LEGAL_TEXT] : []),
  ...(o.forfettario && o.stampDue ? [BOLLO_LEGAL_TEXT] : []),
];
