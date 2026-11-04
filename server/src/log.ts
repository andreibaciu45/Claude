// Log JSON su stdout/stderr. Mai dati personali, token, codici, contenuto di documenti: solo ID, codici evento e hash tronchi.
export function logEvent(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  if (process.env.LOG_LEVEL === 'silent' || process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'info') console.log(line); else console.error(line);
}
const once = new Set<string>();
/** Come logEvent ma una sola volta per processo (avvisi di configurazione). */
export function logOnce(level: 'warn' | 'error', event: string, fields?: Record<string, string | number | boolean | null | undefined>): void {
  if (once.has(event)) return;
  once.add(event);
  logEvent(level, event, fields);
}
