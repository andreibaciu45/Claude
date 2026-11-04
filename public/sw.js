/* Service worker VocePreventivo: app shell + pagine legali in cache, SWR per asset, network-first per navigazione, fallback offline. */
const VERSION = 'v2';
const CACHE = `voceprev-${VERSION}`;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'offline.html'];
const LEGAL = ['legal/privacy.html', 'legal/termini.html', 'legal/dpa.html', 'legal/cookie.html', 'legal/subprocessors.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(SHELL);
      // le pagine legali non devono bloccare l'installazione se una manca
      await Promise.all(LEGAL.map((u) => c.add(u).catch(() => {})));
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('voceprev-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const OFFLINE_HTML = '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sei offline</title><body style="font-family:system-ui,sans-serif;padding:24px;max-width:32rem;margin:auto"><h1>Sei offline</h1><p>Questa pagina non è ancora salvata sul dispositivo. Riconnettiti e riprova: i tuoi dati restano al sicuro su questo dispositivo.</p>';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    const scopePath = new URL(self.registration.scope).pathname;
    const isApp = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(isApp ? 'index.html' : req, copy));
        }
        return res;
      }).catch(async () => {
        const cache = await caches.open(CACHE);
        // pagina esatta (es. /legal/privacy.html) → shell dell'app (solo per rotte dell'app) → pagina offline
        const exact = await cache.match(req, { ignoreSearch: true });
        if (exact) return exact;
        if (isApp || !/\.\w+$/.test(url.pathname)) { const shell = (await cache.match('index.html')) || (await cache.match('./')); if (shell) return shell; }
        return (await cache.match('offline.html')) || new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }),
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
      return cached || network;
    }),
  );
});
