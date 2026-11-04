/**
 * Apertura sicura degli indirizzi di pagamento (checkout / portale) restituiti dal server.
 *
 * Il server è fidato, ma una risposta alterata (proxy, bug, compromissione) non deve poter eseguire codice né portare
 * l'utente su un sito di phishing: si accetta SOLO un URL assoluto https (http solo su localhost in sviluppo), senza
 * credenziali incorporate, il cui host sia nell'elenco ammesso (default: stripe.com e sottodomini, più l'host dell'app;
 * personalizzabile con VITE_PAYMENT_HOSTS="host1,host2").
 * `javascript:`, `data:`, `blob:`, URL relativi e `//host` sono sempre rifiutati.
 */
const DEFAULT_HOSTS = ['stripe.com'];

export class UnsafeUrlError extends Error { constructor(m = 'URL non sicuro') { super(m); this.name = 'UnsafeUrlError'; } }

export interface SafeUrlOptions { allowedHosts?: string[]; appHost?: string; allowInsecureLocalhost?: boolean }

export function parseSafePaymentUrl(raw: string, opts: SafeUrlOptions = {}): URL {
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw.trim())) throw new UnsafeUrlError();
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new UnsafeUrlError(); }
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const insecureOk = opts.allowInsecureLocalhost ?? !!import.meta.env?.DEV;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local && insecureOk)) throw new UnsafeUrlError();
  if (u.username || u.password) throw new UnsafeUrlError();
  const envHosts = ((import.meta.env?.VITE_PAYMENT_HOSTS as string | undefined) ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowed = [...(opts.allowedHosts ?? (envHosts.length ? envHosts : DEFAULT_HOSTS))];
  const appHost = (opts.appHost ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase();
  if (appHost) allowed.push(appHost);
  if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) throw new UnsafeUrlError('Host di pagamento non ammesso');
  return u;
}

/** Naviga verso l'URL di pagamento dopo i controlli. Lancia un errore in italiano se non è sicuro. */
export function openPaymentUrl(raw: string, what = 'pagamento'): void {
  let u: URL;
  try { u = parseSafePaymentUrl(raw); } catch { throw new Error(`Indirizzo di ${what} non valido.`); }
  window.location.assign(u.toString());
}
