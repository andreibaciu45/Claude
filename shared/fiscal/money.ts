/**
 * Aritmetica fiscale in CENTESIMI INTERI. Nessuna somma in virgola mobile.
 * Funzioni pure, utilizzabili in browser e Node (usa BigInt solo per i prodotti intermedi).
 *
 * Fonti [DA VERIFICARE]: arrotondamento commerciale half-up al centesimo (prassi);
 * bollo 2,00 € oltre 77,47 € per operazioni senza IVA (DPR 642/1972, Tariffa Parte I art. 13).
 */
import type { NaturaIva } from '../types';

export const STAMP_DUTY_AMOUNT_CENTS = 200;
/** Il bollo è dovuto se l'importo SUPERA questa soglia (77,47 € esatti: non dovuto). */
export const STAMP_DUTY_THRESHOLD_CENTS = 7747;

/** Euro (number) -> centesimi interi, half-up (lontano da zero), neutralizzando il rumore binario. */
export const toCents = (euro: number): number => {
  if (!Number.isFinite(euro)) throw new RangeError('Importo non finito');
  const sign = euro < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(euro) * 100 + 1e-6);
  return cents === 0 ? 0 : sign * cents;
};

/** Centesimi interi -> euro (number). Solo per presentazione/interfacce, non per sommare. */
export const fromCents = (cents: number): number => {
  if (!Number.isInteger(cents)) throw new RangeError('I centesimi devono essere un intero');
  return cents / 100;
};

/** Formatta centesimi come decimale XML con 2 cifre ('37200' -> '372.00'). Solo aritmetica intera. */
export const formatCents = (cents: number): string => {
  if (!Number.isInteger(cents)) throw new RangeError('I centesimi devono essere un intero');
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};

/**
 * Formatta un decimale con un numero di cifre decimali compreso tra min e max
 * (FatturaPA: Quantita e PrezzoUnitario hanno da 2 a 8 decimali). Toglie gli zeri finali oltre `min`.
 */
export const formatDecimal = (n: number, minDecimals = 2, maxDecimals = 8): string => {
  if (!Number.isFinite(n)) throw new RangeError('Valore non finito');
  let s = n.toFixed(maxDecimals);
  if (s.startsWith('-') && Number(s) === 0) s = s.slice(1);
  const [int, decRaw = ''] = s.split('.');
  let dec = decRaw;
  while (dec.length > minDecimals && dec.endsWith('0')) dec = dec.slice(0, -1);
  while (dec.length < minDecimals) dec += '0';
  return dec ? `${int}.${dec}` : int;
};

/** Divisione intera BigInt con arrotondamento half-up (lontano da zero). den > 0. */
export const divRoundHalfUp = (num: bigint, den: bigint): bigint => {
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return neg ? -q : q;
};

const SCALE = 1e8;
const toScaled = (n: number): bigint => BigInt(Math.round(n * SCALE));

export interface LineAmountInput {
  qty: number;
  unitPrice: number; // euro, netto
  discountPct?: number; // 0-100, max 2 decimali significativi
}

/** Sconto % normalizzato in centesimi di punto percentuale (10,5% -> 1050), limitato a 0..10000. */
export const discountBasisPoints = (discountPct: number | undefined): number => {
  const d = typeof discountPct === 'number' && Number.isFinite(discountPct) ? discountPct : 0;
  return Math.min(10000, Math.max(0, Math.round(d * 100)));
};

/**
 * Totale riga in centesimi: qty × prezzo × (1 − sconto%), un solo arrotondamento half-up al centesimo.
 * Non lancia: valori non finiti valgono 0 (la validazione li segnala a parte).
 */
export const lineTotalCents = (line: LineAmountInput): number => {
  const q = Number.isFinite(line.qty) ? line.qty : 0;
  const p = Number.isFinite(line.unitPrice) ? line.unitPrice : 0;
  const disc = BigInt(10000 - discountBasisPoints(line.discountPct));
  // euro = (P/1e8)(Q/1e8)(disc/1e4)  ->  centesimi = P*Q*disc*100 / 1e20 = P*Q*disc / 1e18
  const numerator = toScaled(p) * toScaled(q) * disc;
  return Number(divRoundHalfUp(numerator, 10n ** 18n));
};

/** Bollo: dovuto se forfettario (nessuna IVA) e importo complessivo > 77,47 €. */
export const isStampDutyDue = (opts: { regimeForfettario: boolean; amountCents: number }): boolean =>
  opts.regimeForfettario && opts.amountCents > STAMP_DUTY_THRESHOLD_CENTS;

export interface RateLineInput {
  totalCents: number;
  vatRate: number; // %
  natura?: NaturaIva;
}

export interface RateSummary {
  vatRate: number;
  natura?: NaturaIva;
  taxableCents: number;
  taxCents: number;
}

/** Imposta = imponibile × aliquota%, half-up. Aliquota con max 2 decimali. */
export const taxCents = (taxableCents: number, vatRate: number): number =>
  Number(divRoundHalfUp(BigInt(taxableCents) * BigInt(Math.round(vatRate * 100)), 10000n));

/** Riepilogo per coppia aliquota/natura, nell'ordine di prima comparsa. */
export const summarizeByRate = (lines: RateLineInput[]): RateSummary[] => {
  const groups = new Map<string, RateSummary>();
  for (const l of lines) {
    const key = `${l.vatRate}|${l.natura ?? ''}`;
    const g = groups.get(key) ?? { vatRate: l.vatRate, natura: l.natura, taxableCents: 0, taxCents: 0 };
    g.taxableCents += l.totalCents;
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.taxCents = taxCents(g.taxableCents, g.vatRate);
  return out;
};

export interface DocumentLineInput extends LineAmountInput {
  vatRate: number;
  natura?: NaturaIva;
}

export interface DocumentTotalsOptions {
  regimeForfettario: boolean;
  /** Se true e il bollo è dovuto, si aggiunge la riga di rimborso (Natura N1) al totale. */
  stampDutyChargedToCustomer: boolean;
}

export interface DocumentTotalsCents {
  lineTotals: number[];
  /** Somma delle righe (esclusa l'eventuale riga di rimborso bollo). */
  linesNetCents: number;
  stampDue: boolean;
  /** 200 se dovuto, altrimenti 0 (bollo a carico del cedente o del cliente). */
  stampCents: number;
  /** Riga di rimborso bollo N1 effettivamente aggiunta (200 o 0). */
  stampReimbursementCents: number;
  summary: RateSummary[];
  taxCents: number;
  /** ImportoTotaleDocumento = imponibili + imposte (+ rimborso bollo). Il bollo a carico del cedente NON si somma. */
  totalCents: number;
}

/**
 * Totali documento in centesimi. La soglia del bollo si valuta sul totale delle righe PRIMA del
 * rimborso bollo [DA VERIFICARE: se il rimborso N1 faccia parte della base di calcolo].
 */
export const computeDocumentTotals = (
  lines: DocumentLineInput[],
  opts: DocumentTotalsOptions,
): DocumentTotalsCents => {
  const lineTotals = lines.map(lineTotalCents);
  const linesNetCents = lineTotals.reduce((s, c) => s + c, 0);
  const stampDue = isStampDutyDue({ regimeForfettario: opts.regimeForfettario, amountCents: linesNetCents });
  const stampCents = stampDue ? STAMP_DUTY_AMOUNT_CENTS : 0;
  const stampReimbursementCents = stampDue && opts.stampDutyChargedToCustomer ? stampCents : 0;
  const rateLines: RateLineInput[] = lines.map((l, i) => ({
    totalCents: lineTotals[i],
    vatRate: l.vatRate,
    natura: l.natura,
  }));
  if (stampReimbursementCents > 0) {
    rateLines.push({ totalCents: stampReimbursementCents, vatRate: 0, natura: 'N1' });
  }
  const summary = summarizeByRate(rateLines);
  const tax = summary.reduce((s, g) => s + g.taxCents, 0);
  const totalCents = summary.reduce((s, g) => s + g.taxableCents + g.taxCents, 0);
  return { lineTotals, linesNetCents, stampDue, stampCents, stampReimbursementCents, summary, taxCents: tax, totalCents };
};
