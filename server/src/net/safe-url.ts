// Validazione degli URL di base dei provider esterni (STT, LLM, SDI). Sono configurati dall'operatore via variabili d'ambiente
// (nessun URL arriva dagli utenti: non c'è SSRF diretta), ma un errore di configurazione non deve poter puntare ai servizi interni.
// Regole: https obbligatorio in produzione (http solo fuori produzione), nessuna credenziale nell'URL, in produzione niente
// localhost / indirizzi privati / link-local / metadata cloud (169.254.169.254) scritti come IP letterale.
// NON protegge da un DNS che risolve verso un IP interno (rebinding): per quello servono regole di egress firewall (vedi docs/SECURITY-REVIEW.md).
import { isIP } from 'node:net';
import { isPrivateAddress } from '../auth/ip';
import { logOnce } from '../log';

export function safeBaseUrl(raw: string | undefined, label: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!raw) return null;
  const prod = env.NODE_ENV === 'production';
  let u: URL;
  try { u = new URL(raw); } catch { logOnce('error', `bad_url_${label}`); return null; }
  const fail = (why: string) => { logOnce('error', `unsafe_url_${label}`, { why }); return null; };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !prod)) return fail('protocollo');
  if (u.username || u.password) return fail('credenziali nell\'URL');
  if (u.search || u.hash) return fail('query/fragment non ammessi');
  if (prod) {
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return fail('host interno');
    if (isIP(host) && (isPrivateAddress(host) || host === '0.0.0.0' || host === '::')) return fail('IP privato');
  }
  return u.toString().replace(/\/+$/, '');
}
