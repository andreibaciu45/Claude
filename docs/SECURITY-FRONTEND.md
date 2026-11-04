# Sicurezza del frontend: CSP, header, service worker (SICUREZZA-FRONTEND)

Data: 2026-11-04. Ambito: `infra/Caddyfile`, `infra/Caddyfile.nodocker`, `public/sw.js`, strumenti di prova in `scripts/audit/`, e le note su dipendenze e licenze (`docs/DIPENDENZE.md`, `docs/LICENZE-TERZE-PARTI.md`). Metodo: build reale (`vite build`), servita con gli header **letti dai Caddyfile** (non copiati a mano), percorsa con Playwright/Chromium raccogliendo ogni evento `securitypolicyviolation`, e confronto finale con un **vero Caddy 2.8.4** avviato sul Caddyfile di produzione. Non è un penetration test.

## 1. Risultato in breve

| Area | Prima | Ora |
|---|---|---|
| CSP stili | `style-src 'self' 'unsafe-inline'` | **nessun `unsafe-inline`/`unsafe-eval`**: stili inline ammessi solo per hash (4 `<style>` + 1 `style=""`). 0 violazioni su tutto il percorso |
| 404 su `/assets/*` | `Cache-Control: immutable` di **1 anno** e senza header di sicurezza (verificato con Caddy reale) | `immutable` solo se il file esiste; errori con `no-store`, `nosniff` e CSP minima (`handle_errors`) |
| HTML senza cache esplicita | pagine legali, `offline.html`, guide e il fallback di `index.html` ereditavano la cache euristica del browser | `Cache-Control: no-cache` su tutto tranne icone/manifest (1 giorno) |
| Header | CSP, HSTS, XCTO, XFO, Referrer, Permissions-Policy (4 voci), COOP | + CORP `same-origin`, `X-Permitted-Cross-Domain-Policies: none`, Permissions-Policy a 15 voci (solo microfono su `self`), `base-uri 'none'`, `frame-src 'none'` |
| Service worker | metteva in cache **qualsiasi** GET same-origin con risposta 200, **API incluse** (verificato: `/health` finiva in cache; lo stesso vale per `GET /v1/...` autenticate), nessun controllo su `Authorization`/`Range`, risposta offline di emergenza senza CSP | v3 riscritto (vedi §3), 15 controlli automatici |
| Dipendenze | – | 0 vulnerabilità in produzione; 4 moderate solo in tool di sviluppo (`mobile/`), vedi `docs/DIPENDENZE.md` |
| Licenze | – | nessuna GPL/AGPL/LGPL in produzione; 1 MPL-2.0 e 1 licenza anomala da verificare, vedi `docs/LICENZE-TERZE-PARTI.md` |

## 2. CSP e header

### 2.1 Politica attuale (identica nei due Caddyfile, verificato dal test)

```
default-src 'self'; script-src 'self';
style-src 'self' 'sha256-4MWPxY0b…' 'sha256-anX6GAZG…' 'sha256-897EOE4P…' 'sha256-n0oMAZ1c…';
style-src-attr 'unsafe-hashes' 'sha256-oJJaKPCj…';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self';
frame-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- **Script**: solo file same-origin (Vite emette moduli esterni; nessuno script inline eseguibile). I blocchi `<script type="application/ld+json">` di `prodotto.html` e delle guide sono dati, non codice: la CSP non li tocca.
- **Stili**: gli `<style>` inline sono quelli di `index.html` (riga 18), `offline.html`, pagine legali (stesso blocco) e `prodotto.html`; l'unico `style=""` è in `public/guide/index.html` (riga 49, `margin-top:0`). Gli stili impostati da React via JavaScript (`element.style.x`) non sono soggetti a CSP: è per questo che l'app non genera violazioni.
- **Se si modifica uno di quei file l'hash cambia e lo stile smette di applicarsi**: rigenerare con `node scripts/audit/csp-hashes.cjs dist --print` e controllare con `node scripts/audit/csp-hashes.cjs dist` (esce con 1 se la CSP non è allineata alla build). Conviene metterlo in CI dopo `vite build`.
- **Rimosso rispetto a prima**: `data:` da `font-src` (nessun font incorporato), `blob:` da `frame-src` (nessun iframe/anteprima PDF in pagina: i PDF si scaricano), `base-uri 'self'` → `'none'` (l'app non usa `<base>`).
- **`connect-src 'self'`**: l'API è sullo stesso dominio (`/v1` dietro Caddy; `src/sync/api.ts:18` e `src/voice/provider/transcribe.ts:25` usano `/v1` relativo). Verificato: login OTP, sync e trascrizione passano.
- **`worker-src 'self'`**: basta per `sw.js`. Nessun worker `blob:` (jsPDF non ne usa).
- **`media-src 'self' blob:`**: serve alla registrazione/riproduzione audio locale della dettatura; se il codice non crea mai un `blob:` audio si può restringere a `'self'`.

### 2.2 Altri header

| Header | Valore | Note |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **Senza `preload` di proposito.** Aggiungere `preload` e iscriversi su hstspreload.org è di fatto irreversibile (mesi per uscirne) e vale per TUTTI i sottodomini: farlo solo quando dominio e sottodomini sono certamente solo HTTPS. `includeSubDomains` rompe eventuali sottodomini solo-HTTP (es. un vecchio `www`/staging): controllare prima. Nota: su `http://127.0.0.1` il browser lo ignora. |
| `Permissions-Policy` | `microphone=(self)` + 14 funzioni vuote (camera, geolocation, payment, usb, serial, bluetooth, hid, midi, display-capture, accelerometer, gyroscope, magnetometer, interest-cohort) | verificato in Chromium con `document.featurePolicy`: microfono sì, camera/geolocalizzazione no |
| `Cross-Origin-Opener-Policy` | `same-origin` | isola la finestra dagli `opener` esterni. Non rompe il checkout di pagamento se avviene per redirect (l'app usa `window.open` solo verso `wa.me` con `noopener`, `DocumentView.tsx:172`) |
| `Cross-Origin-Resource-Policy` | `same-origin` | nessun altro sito può incorporare immagini/script del dominio in modalità `no-cors`. Le richieste CORS dell'app nativa non sono toccate. I crawler social leggono le immagini `og/` lato server e non sono toccati, ma un sito terzo che incorporasse `/og/*` in una propria pagina non le vedrebbe |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | invariato; il frammento `#/documenti/ID` dell'HashRouter non viene mai inviato nel `Referer` |
| `X-Content-Type-Options` | `nosniff` | invariato, ripetuto anche sulle risposte d'errore |
| `X-Frame-Options` | `DENY` | ridondante con `frame-ancestors 'none'` ma copre i browser vecchi |
| `Server` | rimosso | |
| COEP | **non impostato** | non serve (nessun `SharedArrayBuffer`) e romperebbe risorse cross-origin future |

### 2.3 Cache (verificata sul Caddy reale)

| Percorso | `Cache-Control` |
|---|---|
| `/v1/*`, `/health` | `no-store` (Caddy aggiunge il proprio valore a quello del server: nelle risposte compare `no-store, no-store`, innocuo) |
| `/assets/*` (esistenti) | `public, max-age=31536000, immutable` |
| `/assets/*` mancanti | 404, `no-store` |
| `/sw.js` | `no-cache` |
| `/`, `index.html`, `offline.html`, `legal/*`, `guide/*`, fallback | `no-cache` |
| icone, `manifest.webmanifest` | `public, max-age=86400` |

**Trappola Caddy trovata**: un `header` senza matcher e un `header @matcher` sullo stesso campo NON hanno un ordine garantito (il secondo veniva sovrascritto da `no-cache` nel mio primo tentativo, e icone/manifest non avevano più la cache di un giorno). Per questo ora i due casi hanno matcher espliciti e opposti (`@static` / `@dynamic`). Un'altra: il blocco `header` del sito **non si applica alle risposte d'errore** di Caddy: servono `handle_errors` o i 404/502 escono senza header.

### 2.4 App native (Capacitor)

- L'app nativa **non riceve gli header di Caddy**: carica i file da disco (`webDir: ../dist`), quindi la CSP web non la protegge. Origini della WebView: `capacitor://localhost` (iOS) e `https://localhost` (Android, `androidScheme: 'https'` in `mobile/capacitor.config.ts`).
- Per avere una CSP anche nell'app nativa va iniettata una `<meta http-equiv="Content-Security-Policy">` nel `index.html` della build nativa (ad esempio da `mobile/scripts/patch-native.mjs`, dopo `cap sync`), con `connect-src 'self' https://<DOMINIO-API>` al posto di `'self'` (la WebView non ha `/v1` same-origin) e gli stessi hash degli stili. `frame-ancestors` non funziona in `<meta>`. **Non provato** (non ho gli SDK nativi).
- **Lato server**: l'API deve ammettere quelle due origini via CORS. `server/src/auth/security.ts:30` abilita il CORS solo se `CORS_ORIGINS` è valorizzata, e `infra/server.env.example` e `infra/docker-compose.yml` **non la contengono**: senza `CORS_ORIGINS=capacitor://localhost,https://localhost` l'app nativa non riesce a chiamare l'API. Il client nativo deve usare un `VITE_API_URL` assoluto `https://…` (il default `/v1` non funziona dentro la WebView). Proprietà INFRA/SERVER.

## 3. Service worker (`public/sw.js`, v2 → v3)

### 3.1 Cosa non andava (v2)

1. **Cache di risposte API/autenticate**: il ramo "asset" intercettava ogni GET same-origin e metteva in cache ogni 200 (`/health` verificato in cache). Un `GET /v1/...` autenticato (sync pull, `/v1/me`, export) veniva salvato in Cache Storage e poi servito *stale* senza distinguere l'utente: dati personali leggibili da Cache Storage dopo il logout e risposte vecchie al sync.
2. Nessuna esclusione per `Authorization`, `Range` (le 206 fanno fallire `cache.put`), `no-store`/`private`, risposte non "basic" o redirect.
3. Le navigazioni a qualunque URL con risposta 200 venivano salvate, anche non legate all'app.
4. Fallback alla shell per qualunque percorso senza estensione, non solo per le rotte dell'app.
5. Scritture in cache senza `waitUntil` (il worker può essere terminato prima).
6. Precache da cache HTTP (`addAll` senza `reload`): shell vecchia dopo un deploy.
7. Asset hashati con "stale-while-revalidate" nella stessa cache versionata: ogni deploy cancellava le cache vecchie, quindi una sessione aperta durante l'aggiornamento perdeva i propri chunk `lazy`; e dentro la stessa versione gli asset si accumulavano senza limite.
8. La risposta offline di emergenza (`OFFLINE_HTML`) aveva uno stile inline e nessuna CSP (le risposte sintetiche non ricevono gli header di Caddy).
9. Rete lenta ("lie-fi"): la navigazione restava appesa invece di aprire la shell salvata.

### 3.2 Cosa fa ora

- **Non intercetta mai**: richieste cross-origin, metodi non GET, qualunque percorso `v1`/`health` (nessun `respondWith`, nemmeno in rete), richieste con `Authorization`, `Range` o `cache: 'no-store'`, `sw.js` stesso, percorsi fuori scope.
- **Cache**: `voceprev-shell-<VERSION>` (shell + legali, precache con `cache: 'reload'`, stale-while-revalidate per statici) e `voceprev-assets` (cache-first per `/assets/*`, non versionata, max 150 voci, più vecchie eliminate). Una risposta è memorizzabile solo se è un 200 "basic", non rediretta, senza `no-store`/`private`/`Vary: *`.
- **Navigazione**: rete con timeout 4 s per le rotte dell'app (poi shell salvata); fallback alla shell **solo** per `/` e `/index.html`; altre pagine: copia esatta se salvata, altrimenti `offline.html`, altrimenti risposta sintetica con CSP `default-src 'none'`.
- **Aggiornamenti**: `skipWaiting` + `clients.claim`, nessun ricaricamento forzato delle pagine aperte. Alla attivazione si cancellano **tutte** le cache `voceprev-*` tranne shell corrente e asset: ripulisce anche le cache v1/v2 che potevano contenere risposte API. I dati dell'utente (IndexedDB, localStorage) non sono toccati dal worker. Messaggio `{type:'SKIP_WAITING'}` supportato per un futuro banner "nuova versione".
- **Scope**: `/sw.js` alla radice → scope `/` (manifest `scope: "./"`); `Cache-Control: no-cache` su `sw.js`.

### 3.3 Prove (`scripts/audit/sw-audit.cjs`, Chromium reale, header dei Caddyfile)

Superate: installazione e attivazione; nessuna risposta `/v1` o `/health` in cache (con e senza `Authorization`); shell e asset in cache; offline: shell dell'app, pagina legale già visitata, rotta sconosciuta → `offline.html` (non la shell), API → errore di rete (non servita dalla cache); **aggiornamento di versione** (cambio di `VERSION` in `sw.js` servito dal server): nuova shell creata, vecchia e finta `voceprev-v2` con una risposta `/v1` cancellate, cache asset mantenuta, localStorage e IndexedDB intatti; nessuna violazione CSP. Lo stesso script contro la build col SW v2 fallisce 6 controlli.

## 4. Come si prova (riproducibile)

```
npx vite build --outDir /tmp/dist
node scripts/audit/serve-with-headers.cjs --check                 # i due Caddyfile coincidono
node --test scripts/audit/headers.test.cjs                        # (DIST=/tmp/dist per anche gli hash)
node scripts/audit/csp-hashes.cjs /tmp/dist                       # hash stili inline allineati
node scripts/audit/serve-with-headers.cjs --dist /tmp/dist --port 4190 &    # header di produzione
E2E_BASE=http://127.0.0.1:4190 node scripts/audit/csp-walk.cjs    # percorso completo + violazioni CSP (API locale :8798, vedi scripts/qa/env.cjs)
node scripts/audit/sw-audit.cjs --dist /tmp/dist                  # service worker
CADDY_BIN=/percorso/caddy node scripts/audit/compare-with-caddy.cjs --dist /tmp/dist   # fedeltà al Caddy vero
```

Playwright non è nelle dipendenze del repository (è in `/opt/node-tools`): servono `NODE_PATH` o un'installazione dedicata.

Esiti ottenuti il 2026-11-04: `csp-walk` 26/26 con Caddy vero (24/24 prima di aggiungere i 2 controlli sulle policy, con il server di prova) (home, dettatura testuale, profilo con P.IVA 01234567897 / CF BNCMRA80A01H501A, listino, clienti, info, preventivo + PDF, fattura cliente 02345678904 con emissione + XML + PDF, documenti, backup, account con login OTP reale via `/v1`, pagine legali/guide/prodotto/offline) **sia dietro il server di prova sia dietro il Caddy vero**; controllo negativo: togliendo gli hash dalla CSP lo stesso percorso produce violazioni (il rilevatore funziona). `sw-audit` 15/15. `compare-with-caddy` coincide su 14 URL. `caddy validate` OK su entrambi i file. Suite `e2e/` completa dietro gli header: 5/10 PASS, **nessun errore CSP in nessuno scenario**; i 5 scenari che falliscono (04, 05, 06, 08, 09: messaggio di documento inesistente, dialogo "Sì, sostituisci i dati" dell'importazione, collegamento a fattura scartata, validazione email in `/account`, overflow orizzontale di 103 px nella bozza fattura a 390 px) falliscono allo stesso modo anche con un server statico senza header (verificato per 04 e 05; 08 già col vecchio CSP) quindi **non dipendono da CSP/header**: sono difetti dell'app o del test, da passare a QA.

## 5. Cosa richiede modifiche al codice (non mio)

| Dove | Cosa | Perché |
|---|---|---|
| `src/main.tsx:7-11` | dopo `register`, chiamare `registration.update()` al ritorno in primo piano (`visibilitychange`) e mostrare un avviso "Nuova versione disponibile" con `postMessage({type:'SKIP_WAITING'})`/ricarica; oggi l'aggiornamento arriva solo alla navigazione successiva e il `.catch(() => {})` nasconde gli errori di registrazione | aggiornamenti più rapidi, errori visibili |
| `index.html:18`, `public/offline.html`, `public/legal/*.html`, `public/prodotto.html` | ogni modifica ai blocchi `<style>` cambia l'hash: eseguire `csp-hashes.cjs` e aggiornare i due Caddyfile (altrimenti lo stile sparisce solo in produzione). Soluzione definitiva: spostare quegli stili in un file `.css` esterno e togliere gli hash | manutenzione |
| `public/guide/index.html:49` | sostituire `style="margin-top:0"` con una classe CSS | elimina `style-src-attr 'unsafe-hashes'` |
| `infra/server.env.example`, `infra/docker-compose.yml` (INFRA) | aggiungere `CORS_ORIGINS=capacitor://localhost,https://localhost` (e l'eventuale origine web se diversa dal dominio) | app native |
| `mobile/scripts/patch-native.mjs` (mobile) | iniettare la `<meta>` CSP nella build nativa (§2.4) e impostare `VITE_API_URL` assoluto | l'app nativa non ha CSP |
| `src/hooks/useSpeech.ts`, `src/voice/provider/env.ts` | la Web Speech API del browser invia l'audio al fornitore del browser (es. Google in Chrome): la CSP non può impedirlo né vederlo. Va dichiarato nell'informativa privacy e nel consenso del microfono, oppure preferire la trascrizione server `/v1/voice/transcribe` | trasparenza GDPR |
| server (SERVER-CORE) | le risposte API portano già i propri header di sicurezza (Hono `secureHeaders`), ma con CSP/CORP del server: valutare una CSP API dedicata `default-src 'none'; frame-ancestors 'none'` | difesa in profondità, rischio basso |

## 6. Cosa non ho potuto provare

- Safari/WebKit e Firefox: solo Chromium. Differenze note: Safari ignora `Permissions-Policy` per alcune funzioni e gestisce diversamente il service worker in modalità privata.
- HTTPS reale e HSTS (prova su `http://127.0.0.1`), certificati automatici di Caddy e redirect HTTP→HTTPS; il comportamento di `includeSubDomains` sul dominio vero.
- La CSP dentro la WebView Android/iOS e la `<meta>` proposta (nessuno SDK nativo).
- Il microfono reale (`getUserMedia`) e la trascrizione server con un provider: nei test la dettatura è testuale; la Permissions-Policy è stata verificata solo in teoria con `featurePolicy`.
- Il checkout di pagamento (Stripe) con COOP `same-origin`: nessuna sessione di pagamento disponibile; il codice usa redirect/`wa.me` con `noopener`, quindi il rischio è basso.
- Comportamento con CDN davanti a Caddy (cache di `Cache-Control` e `Vary`).
- Aggiornamento di versione con una vera seconda release (simulato cambiando `VERSION` e rimettendo `sw.js` sul server).
- Il peso del file `sw.js` e la compatibilità con browser molto vecchi (usa `async/await` e `Cache API`).

## 7. File creati o modificati

`infra/Caddyfile`, `infra/Caddyfile.nodocker`, `public/sw.js`, `docs/SECURITY-FRONTEND.md`, `docs/DIPENDENZE.md`, `docs/LICENZE-TERZE-PARTI.md`, `scripts/audit/{serve-with-headers,csp-hashes,csp-walk,sw-audit,compare-with-caddy,gen-licenses}.cjs`, `scripts/audit/headers.test.cjs`. Non creato `public/_headers` (non c'è un hosting statico che lo usi: gli header stanno in Caddy). Nessun file in `src/`, `shared/`, `server/`, `package.json` toccato; nessun `git add/commit`.
