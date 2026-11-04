# VocePreventivo — server

Hono + `node:sqlite` (WAL) + zod. Avvio: `npm start` (tsx). Test: `npx vitest run`; tipi: `npx tsc -p server --noEmit` (dalla radice).
Variabili: vedi `.env.example` (tutte con segnaposto) e `src/billing/README.md` (Stripe/SDI/voce).

## Rate-limit (`src/db/ratelimit.ts`, `src/auth/limits.ts`)
Interfaccia `RateLimitStore { hit(key, limit, windowMs, cost?), peek(...) }`, finestra fissa, due implementazioni:
- `MemoryRateLimitStore`: per processo, nessun I/O. Default per il limite generale (`RATE_LIMIT_STORE=memory`). Si azzera al riavvio e non è condivisa tra istanze.
- `DbRateLimitStore`: tabella `rate_limits`, persistente. Usata per OTP, export/cancellazione account, limiti di costo della voce (STT/LLM) e con `RATE_LIMIT_STORE=db` anche per il limite generale.

Livelli: per IP (tutte le rotte tranne `/health`, `RL_IP_PER_MIN`), per tenant dopo il login (`RL_TENANT_PER_MIN`, `RL_TENANT_WRITES_PER_MIN`), budget operazioni di sync (`RL_SYNC_OPS_HOUR`). Superamento: `429` + `Retry-After` + `RateLimit-*`.
OTP: limiti per IP, per coppia email+IP e per email, più backoff esponenziale per coppia sulle verifiche errate. Un attaccante blocca solo se stesso; restano valide fino a 3 richieste di codice contemporaneamente (una nuova richiesta non annulla il codice appena inviato alla vittima).

## TRUST_PROXY
`auto` (default): `X-Forwarded-For` è fidato solo se il peer TCP è loopback/privato (Caddy locale o rete docker); `0` mai; `N` = N proxy davanti, si usa il valore N-esimo da destra. Dietro Caddy basta il default (o `1`). Se il proxy ha IP pubblico/CDN impostare il numero esatto. IPv6 è raggruppato per /64.

## Termini e DPA
`POST /v1/auth/verify` accetta `acceptedTerms?: { termsVersion, dpaVersion?, acceptedAt? }`. Si registrano (tabella `legal_acceptances`, append-only, + `audit_log`) versione e data/ora del server (+ HMAC dell'IP se `TERMS_STORE_IP_HASH=1`). Con `REQUIRE_TERMS=1` il primo accesso senza Termini+DPA risponde `400 terms_required` e il codice non viene consumato. Proposta per `shared/api.ts`: `AuthVerifyBody.acceptedTerms?: { termsVersion: string; dpaVersion?: string; acceptedAt?: number }`.

## Cifratura applicativa (`src/db/seal.ts`)
Con `APP_ENCRYPTION_KEY` (32 byte) i campi sensibili — `customer`, `notes`, `transcript`, `invoice.xml` dei documenti; profilo (IBAN); payload del log di sync; audit del client — sono AES-256-GCM (`enc:v1:<kid>:...`). Colonne indicizzate, `lines`, stato, numerazione e `sdiEvents` restano in chiaro (servono a indici e trigger). Nei documenti l'IV è deterministico (altrimenti i trigger delle fatture emesse vedrebbero una modifica a ogni riscrittura); altrove è casuale. Senza chiave tutto resta in chiaro e i dati misti sono letti normalmente. Rotazione: nuova chiave + `APP_ENCRYPTION_OLD_KEYS`, poi `DB_PATH=... npx tsx scripts/rotate-encryption-key.ts [--include-locked] [--report]`. La chiave va conservata fuori dal repository e dai backup del DB: senza di essa i dati cifrati sono persi.

## GDPR
- `GET /v1/me/export`: tutti i dati dell'utente in JSON (account, profilo, catalogo, documenti, dispositivi, consumi, accettazioni, audit).
- `DELETE /v1/me` con `{ confirmEmail, acknowledgeSubscription? }`: rimuove sessioni, dispositivi, profilo, catalogo, bozze/preventivi, log di sync, utente. Le fatture emesse restano (conservazione fiscale; trigger SQL; tenant `deleted`, nessun login); senza fatture emesse il tenant è eliminato del tutto. Restano audit e prove di accettazione. Con abbonamento attivo: `409` finché non si annulla dal portale o si conferma. I backup contengono i dati fino alla scadenza della retention (Litestream: 14 giorni).

## Backup e ripristino
Il DB è in WAL, `synchronous=NORMAL`, `busy_timeout=5000`, nessun locking esclusivo: compatibile con **Litestream** (`infra/litestream.yml`; non cambiare `journal_mode`; l'applicazione fa solo `wal_checkpoint(PASSIVE)` e mai `TRUNCATE`; il `VACUUM` automatico è opt-in, vedi «Manutenzione») e con **`sqlite3 db ".backup 'dest'"`** (CLI presente nell'immagine Docker). Gli script `scripts/backup.ts backup <db> <dest>` (API backup di SQLite, ripiego `VACUUM INTO`) e `scripts/backup.ts verify <file>` (integrity_check, foreign_key_check, trigger di immutabilità presenti) coprono il ripristino mensile da automatizzare. Ripristino: fermare il server, copiare il file su `DB_PATH` (rimuovendo `-wal`/`-shm` residui), avviare. Verificato dai test in `test/core/backup.test.ts`.

## Carico e concorrenza
`npx tsx scripts/loadtest.ts --duration=30 --concurrency=50 --tenants=10` (in-process, DB temporaneo; oppure `BASE_URL=... TOKENS=a,b`). Riferimento locale: ~500 richieste/s, p95 ≈ 50 ms a 20 connessioni. Concorrenza del sync (due dispositivi con gli stessi numeri, 1.000 emissioni parallele): `test/core/concurrency.test.ts`.

Revisione di sicurezza completa: `docs/SECURITY-REVIEW.md`.

## Operazioni (SERVER-OPS) — guida per chi gestisce il servizio: `docs/OPERAZIONI.md`
- **CLI amministrativa** `npx tsx server/scripts/admin.ts <comando>` (sul VPS: `sudo -u vocepreventivo /opt/vocepreventivo/current/server/scripts/admin.sh <comando>`, carica da solo `server.env`). Comandi: `tenants`, `info`, `grant-pro`, `revoke-pro`, `export-tenant`, `delete-tenant`, `stats`, `integrity-check`, `backup`, `restore-test`, `rotate-key`, `create-invite-code`, `invite-codes`, `revoke-invite`. Codici di uscita: 0 ok, 1 errore, 2 solo avvisi, 64 uso errato.
- **Licenza Pro a mano** (`db/grants.ts`, tabella append-only `admin_actions`): piano effettivo = *massimo* tra stato Stripe e concessione manuale non scaduta. Gli eventi Stripe non toccano mai `admin_actions` e la CLI non tocca mai `entitlements`; `revoke-pro` toglie solo la concessione manuale (chi paga resta Pro). Rispettata da `getPlan`/`getEntitlement`/`effectivePlan`, da `/v1/me` (`billingStatus: 'none'` se Pro solo per concessione), dalla quota di sync e da `billingService` (voce). `GET /v1/me` non espone la scadenza della concessione (nessun campo in `shared/api.ts`).
- **Lancio privato**: `INVITE_ONLY=1` richiede `inviteCode` (campo opzionale di `POST /v1/auth/verify`) solo per creare un account; errori `403 invite_required` / `invite_invalid`, l'OTP non viene consumato. Codici monouso (60 bit, nel DB solo l'hash), con scadenza e vincolo opzionale a un'email.
- **`GET /metrics`** (Prometheus, `Authorization: Bearer $METRICS_TOKEN`, 404 se `METRICS_TOKEN` manca o è < 16 caratteri): richieste per rotta (pattern) e stato, latenza (istogramma), sync push/pull, conflitti per motivo, quota, job SDI, accessi/registrazioni, errori, utenti attivi 1/7/30 giorni, dimensione DB/WAL, età dell'ultimo backup. Solo etichette costanti: mai email, token, OTP, IP, id di tenant/documento.
- **`GET /health/deep`**: scrittura sul DB, migrazioni applicate, spazio su disco, età dell'ultimo backup (`BACKUP_DIR`), ultima manutenzione. `200` ok/degraded, `503` fail (o durante l'arresto). Senza token solo gli stati; con `METRICS_TOKEN` anche i numeri. `/health` e `/healthz` restano leggeri (nessun I/O).
- **Manutenzione** (`ops/maintenance.ts`, ogni ora, primo ciclo dopo 30 s): pulizia a blocchi di sessioni, OTP, rate-limit, billing_events, job SDI vecchi, tombstone di bozze/preventivi/catalogo eliminati (`TOMBSTONE_RETENTION_DAYS`, mai le fatture emesse), errori, inviti scaduti; `wal_checkpoint(PASSIVE)`; `PRAGMA optimize` giornaliero; `VACUUM` solo con `MAINTENANCE_VACUUM=1`, nella finestra oraria, al massimo ogni 7 giorni, con DB ≤ 500 MB, ≥ 20% di spazio libero e disco ≥ 2× il DB.
- **Arresto ordinato** (`ops/shutdown.ts`): su SIGTERM/SIGINT le nuove richieste ricevono `503`, le in corso finiscono, si fermano SDI e manutenzione, si chiude il DB ed `exit 0` entro `SHUTDOWN_TIMEOUT_MS` (10 s); oltre il limite chiude a forza ed esce con 1. `uncaughtException` → arresto ordinato con codice 1 (systemd riavvia).
- **Log**: JSON su stdout, solo metadati (id richiesta, tenant pseudonimo, metodo, rotta, stato, ms). Verificato da test che non compaiano email, token, OTP, IP, contenuti. Le 500 sono registrate in `ops_errors` (solo rotta e nome dell'errore).
- Test: `test/ops/**` (CLI, grants, metriche/salute/log, manutenzione, arresto con processo reale, inviti, migrazioni da DB vecchi, end-to-end e concorrenza multi-processo).
- Migrazioni 200–201 (`db/ops-schema.ts`): `admin_actions`, `ops_state`, `ops_daily`, `ops_errors`, `invite_codes`.

## Revisione indipendente (docs/CODE-REVIEW-SERVER.md)
Correzioni e variabili introdotte dalla seconda revisione (test: `test/review/**`, compresa una prova con due processi sullo stesso file DB):
- `RL_AUDIT_PER_DAY` (default 10000): tetto giornaliero di voci di audit del client per tenant. Il registro è append-only (nemmeno la cancellazione dell'account lo svuota), quindi si limita all'ingresso: si memorizzano solo i campi noti e al massimo ~6 KB a voce.
- `SDI_JOB_STALE_MS` (default 900000): un job SDI rimasto `running` oltre questo tempo (processo morto a metà) torna in coda, o va in `dead` se ha esaurito i tentativi. Un job `dead` viene riattivato se arriva di nuovo la stessa richiesta (nuovo invio / nuova notifica del provider).
- Avvio (`src/index.ts`): il server rifiuta di partire se il DB contiene dati cifrati e `APP_ENCRYPTION_KEY` manca o non copre le chiavi usate (`APP_ENCRYPTION_OLD_KEYS`), invece di scrivere in chiaro i nuovi dati.
- Numerazione: oltre all'indice UNIQUE (tenant, sezionale, anno, seq), il server rifiuta un secondo numero identico (testo) nella stessa serie e confronta il sezionale senza distinguere maiuscole/minuscole.
- Una fattura già `consegnata`, `stornata` o `pagato` non può essere dichiarata `scartata` dal client (lo stato `scartata` apre il rinvio con contenuto corretto); un NS tardivo del provider si registra ma non cambia lo stato di una fattura consegnata.
- Testi (`notes`, `transcript`, `invoice.xml`) che iniziano con `enc:v1:` sono rifiutati (`invalid`): verrebbero scambiati per valori già cifrati.

## Rischi residui della revisione: cosa è stato fatto (SERVER-FIX)
Test in `test/fix/**` (compresi tre scenari con DUE processi sullo stesso file DB). Dettagli, calcoli e trade-off in `docs/OPERAZIONI.md` §7bis.
- **OTP distribuito** (`auth/guard.ts`): codice a `OTP_DIGITS` cifre (default 8), `OTP_MAX_ATTEMPTS` (5) per codice su tutti gli IP, cooldown crescente globale per email solo sulle verifiche (mai sull'invio), reti note esenti, email di avviso a soglia (`Mailer.sendSecurityAlert`, opzionale), comando `admin.ts otp-unlock`. Probabilità di successo in 30 giorni: ~7 % → 0,11 % con 6 cifre, 0,0011 % con 8. La verifica accetta 6-10 cifre (un client a 6 cifre funziona con `OTP_DIGITS=6`).
- **Audit** (`db/audit.ts`, migrazione 6): classe fiscale/non fiscale decisa dal server, potatura delle sole non fiscali dopo `AUDIT_RETENTION_DAYS` con aggregazione in `audit_daily`, tetto per tenant, trigger append-only con permesso di cancellazione che esiste solo dentro la transazione di potatura.
- **`/health/deep`**: senza token sola lettura (`db_read`, nessuna scrittura), con token sonda di scrittura in cache (`HEALTH_CACHE_MS`), rate-limit per IP in memoria.
- **Catena fiscale** (`db/chain.ts`, migrazione 7): hash chain per tenant sulle emissioni, verificata da `integrity-check` (che stampa il sigillo da conservare fuori dal server); una fattura in stato emesso senza `lockedAt` è rifiutata.
- **Configurazione sicura**: `SMTP_REQUIRE_TLS=1` in `.env.example`; con `NODE_ENV` non impostato `AUTH_DEV_RETURN_CODE` e i provider mock (SDI/STT/LLM) restano spenti (servono `development` o `test` espliciti).
- Migrazioni 6-8: `audit_retention`, `fiscal_chain`, `otp_guard`.
