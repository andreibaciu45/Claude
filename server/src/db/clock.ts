// Orologio sostituibile nei test (scadenze OTP, sessioni, quote mensili).
let override: (() => number) | null = null;
export const now = (): number => (override ? override() : Date.now());
export const setClock = (fn: (() => number) | null): void => {
  override = fn;
};
/** Mese UTC 'YYYY-MM' per le quote. */
export const monthKey = (ts: number = now()): string => new Date(ts).toISOString().slice(0, 7);
