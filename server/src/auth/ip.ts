// IP del client e chiave di rate-limit.
//
// TRUST_PROXY (variabile d'ambiente):
//   unset / "auto" (default) : X-Forwarded-For è considerato SOLO se la connessione TCP arriva da un indirizzo loopback/privato
//                              (cioè dal reverse proxy sulla stessa macchina o sulla rete docker); da un indirizzo pubblico viene ignorato.
//   "0" / "false"            : X-Forwarded-For è sempre ignorato (server esposto direttamente a Internet).
//   "1", "2", ...            : numero di proxy fidati davanti al server; si usa il valore N-esimo da DESTRA di X-Forwarded-For.
//                              Usare "1" con Caddy; aumentare solo se si aggiungono altri proxy/CDN (es. Cloudflare + Caddy = 2).
// Un valore sbagliato fa apparire tutti i client con lo stesso IP (rate-limit per IP inutile/dannoso) oppure permette di falsificarlo.
import { getConnInfo } from '@hono/node-server/conninfo';
import { isIP } from 'node:net';
import type { Context } from 'hono';
import { logOnce } from '../log';

export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || /^f[cd][0-9a-f]{2}:/.test(l) || /^fe[89ab][0-9a-f]:/.test(l);
}

/** Chiave stabile: IPv4 mappato → IPv4; IPv6 → prefisso /64 (un attaccante controlla un'intera /64). */
export function ipKey(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1]!;
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return full.slice(0, 4).map((x) => x.padStart(4, '0')).join(':') + '::/64';
}

export function peerAddress(c: Context): string {
  try { return getConnInfo(c).remote.address ?? 'unknown'; } catch { return 'unknown'; }
}

function trustedHops(peer: string, hasXff: boolean): number {
  const v = (process.env.TRUST_PROXY ?? 'auto').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return 0;
  if (v === 'auto' || v === '') {
    if (!hasXff) return 0;
    if (isPrivateAddress(peer)) return 1;
    logOnce('warn', 'xff_ignored_public_peer', { hint: 'X-Forwarded-For ricevuto da un peer pubblico e ignorato: se il server sta dietro un proxy con IP pubblico/CDN imposta TRUST_PROXY=<numero di proxy>' });
    return 0;
  }
  if (v === 'true' || v === 'on' || v === 'yes') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 5 ? n : 0;
}

/** IP del client (testo, non normalizzato per il rate-limit: usare ipKey). */
export function clientIp(c: Context): string {
  const peer = peerAddress(c);
  const xff = c.req.header('x-forwarded-for');
  const hops = trustedHops(peer, !!xff);
  if (hops > 0 && xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const cand = parts.length >= hops ? parts[parts.length - hops] : undefined;
    if (cand && isIP(cand)) return cand;
  }
  return peer;
}
