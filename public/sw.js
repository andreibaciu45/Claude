/*
 * Service worker VocePreventivo.
 *
 * Cosa mette in cache (SOLO file statici dell'app, stessa origine, GET):
 *   - app shell + pagine legali: precache all'installazione (cache versionata `voceprev-shell-<VERSION>`);
 *   - asset con hash di Vite (/assets/*): cache-first in una cache separata e NON versionata (`voceprev-assets`),
 *     tagliata a MAX_ASSETS voci: cosi' una sessione rimasta aperta durante un aggiornamento trova ancora i suoi chunk;
 *   - altri file statici (icone, guide, pagine legali): stale-while-revalidate;
 *   - navigazioni: network-first (con timeout) e fallback alla shell SOLO per le rotte dell'app, altrimenti pagina offline.
 *
 * Cosa NON mette MAI in cache e NON intercetta:
 *   - qualunque richiesta all'API (/v1/*, /health), richieste con Authorization, Range, cache:'no-store';
 *   - richieste cross-origin (nessun respondWith);
 *   - risposte non-200, non "basic", con Cache-Control no-store/private, Vary: *;
 *   - metodi diversi da GET.
 * Il vecchio v2 metteva in cache anche le GET verso /v1/* (risposte autenticate, servite poi "stale" e senza distinguere
 * l'utente): alla prima attivazione di questa versione quelle cache vengono cancellate.
 *
 * Aggiornamenti: skipWaiting + clients.claim (le correzioni di sicurezza arrivano subito). Non ricarica le pagine aperte:
 * i dati dell'utente stanno in IndexedDB e non vengono toccati. Per cambiare versione bastano nuovi byte in questo file:
 * incrementare VERSION quando cambia la lista SHELL/LEGAL o la logica.
 */
const VERSION = 'v3';
const SHELL_CACHE = `voceprev-shell-${VERSION}`;
const ASSET_CACHE = 'voceprev-assets';
const MAX_ASSETS = 150;
const NAV_TIMEOUT_MS = 4000;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'offline.html'];
const LEGAL = ['legal/privacy.html', 'legal/termini.html', 'legal/dpa.html', 'legal/cookie.html', 'legal/subprocessors.html'];

// Pagina di emergenza se manca anche offline.html: nessuno stile inline (la CSP lo vieta) e CSP restrittiva propria,
// perche' una risposta sintetica non riceve gli header di Caddy.
const OFFLINE_HTML = '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sei offline</title><body><h1>Sei offline</h1><p>Questa pagina non è ancora salvata sul dispositivo. Riconnettiti e riprova: i tuoi dati restano al sicuro su questo dispositivo.</p>';
const OFFLINE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

const scopePath = () => new URL(self.registration.scope).pathname;
// API: sia /v1/... alla radice sia sotto un eventuale sottopercorso; /health e' il controllo di salute del server.
const isApiPath = (p) => /(^|\/)v1(\/|$)/.test(p) || /(^|\/)health$/.test(p);

/** Una risposta e' memorizzabile solo se e' un 200 "basic" senza direttive di non-memorizzazione. */
function cacheable(res) {
  if (!res || res.status !== 200 || res.type !== 'basic' || res.redirected) return false; // redirected: non servibile a una navigazione
  const cc = res.headers.get('Cache-Control') || '';
  if (/no-store|private/i.test(cc)) return false;
  if ((res.headers.get('Vary') || '').includes('*')) return false;
  return true;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]); // in ordine di inserimento: via i piu' vecchi
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(async (c) => {
      // cache:'reload' = salta la cache HTTP del browser, cosi' la shell nuova e' coerente con il server
      await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
      // le pagine legali non devono bloccare l'installazione se una manca
      await Promise.all(LEGAL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // via TUTTE le cache `voceprev-*` tranne shell corrente e asset (incluse le v1/v2 che potevano contenere risposte /v1)
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('voceprev-') && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// La pagina puo' chiedere l'attivazione immediata (es. banner "nuova versione").
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function handleNavigation(e, req, url) {
  const isApp = url.pathname === scopePath() || url.pathname === `${scopePath()}index.html`;
  const fromCache = async () => {
    const cache = await caches.open(SHELL_CACHE);
    // pagina esatta (es. /legal/privacy.html) -> shell dell'app (SOLO rotte dell'app) -> pagina offline
    const exact = await cache.match(req, { ignoreSearch: true });
    if (exact) return exact;
    if (isApp) { const shell = (await cache.match('index.html')) || (await cache.match('./')); if (shell) return shell; }
    return (await cache.match('offline.html')) || new Response(OFFLINE_HTML, { status: 503, headers: OFFLINE_HEADERS });
  };
  const network = fetch(req).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      // waitUntil: il worker non deve essere chiuso prima che la copia sia scritta
      e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(isApp ? 'index.html' : req, copy)).catch(() => {}));
    }
    return res;
  });
  if (!isApp) return network.catch(fromCache);
  // rotta dell'app: rete lenta (lie-fi) -> dopo NAV_TIMEOUT_MS si apre la shell salvata, che e' comunque l'app completa
  network.catch(() => {}); // evita 'unhandled rejection' se perde la gara col timeout
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const cached = await (await caches.open(SHELL_CACHE)).match('index.html');
    return cached || network;
  } catch {
    return fromCache();
  }
}

async function handleAsset(e, req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit; // file con hash nel nome: immutabile
  try {
    const res = await fetch(req);
    if (cacheable(res)) e.waitUntil(cache.put(req, res.clone()).then(() => trim(cache, MAX_ASSETS)).catch(() => {}));
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function handleStatic(e, req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (cacheable(res)) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    return res;
  }).catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
  return cached || network;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // mai intercettare il cross-origin
  if (isApiPath(url.pathname)) return;                          // mai API: ne' cache ne' respondWith
  if (req.headers.has('Authorization') || req.headers.has('Range') || req.cache === 'no-store') return;
  if (!url.pathname.startsWith(scopePath())) return;
  if (url.pathname === `${scopePath()}sw.js`) return;           // lo script del worker lo gestisce il browser

  if (req.mode === 'navigate') { e.respondWith(handleNavigation(e, req, url)); return; }
  if (url.pathname.startsWith(`${scopePath()}assets/`)) { e.respondWith(handleAsset(e, req)); return; }
  e.respondWith(handleStatic(e, req));
});
