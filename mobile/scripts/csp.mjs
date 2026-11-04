// CSP per l'app nativa (Capacitor): la WebView carica i file da disco e NON riceve gli header di Caddy,
// quindi la CSP va incorporata come <meta http-equiv="Content-Security-Policy"> nell'index.html copiato nelle cartelle native.
// Deve restare coerente con la CSP di infra/Caddyfile: stessi default, NESSUN 'unsafe-inline'/'unsafe-eval';
// differenze volute: connect-src include l'API assoluta; frame-ancestors non e' supportata nei <meta> (omessa).
import { createHash } from 'node:crypto';

export const CSP_MARK = 'data-vp-csp';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

/** Valida l'URL dell'API: assoluto https (o http solo per localhost in prova). Restituisce l'origine. */
export function apiOrigin(apiUrl) {
  if (!apiUrl) throw new Error('VITE_API_URL assoluto richiesto (es. https://app.tuodominio.it/v1): la build nativa non puo\' usare "/v1".');
  let u;
  try { u = new URL(apiUrl); } catch { throw new Error(`VITE_API_URL non e' un URL assoluto: ${apiUrl}`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) {
    throw new Error(`VITE_API_URL deve essere https://… (ricevuto ${u.protocol}//)`);
  }
  if (/[\s;,'"]/.test(u.origin)) throw new Error('VITE_API_URL contiene caratteri non ammessi');
  return u.origin;
}

/** Hash degli <style> inline e degli attributi style="" presenti nell'HTML (esclusa la nostra meta). */
export function inlineHashes(html) {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => sha(m[1]));
  const attrs = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => sha(m[1]));
  return { styles: [...new Set(styles)], attrs: [...new Set(attrs)] };
}

export function buildCsp(html, apiUrl) {
  const origin = apiOrigin(apiUrl);
  const { styles, attrs } = inlineHashes(html);
  const parts = [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self'${styles.map((h) => ` ${h}`).join('')}`,
    ...(attrs.length ? [`style-src-attr 'unsafe-hashes'${attrs.map((h) => ` ${h}`).join('')}`] : []),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${origin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  return parts.join('; ');
}

/** Inserisce (o sostituisce) la meta CSP come primo elemento di <head>. Idempotente. */
export function injectCsp(html, apiUrl) {
  const stripped = html.replace(new RegExp(`\\s*<meta\\b[^>]*${CSP_MARK}[^>]*>`, 'gi'), '');
  const csp = buildCsp(stripped, apiUrl);
  const meta = `<meta http-equiv="Content-Security-Policy" ${CSP_MARK} content="${csp}" />`;
  if (!/<head\b[^>]*>/i.test(stripped)) throw new Error('index.html senza <head>');
  return stripped.replace(/<head\b[^>]*>/i, (m) => `${m}\n    ${meta}`);
}
