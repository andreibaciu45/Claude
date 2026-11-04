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
Il DB è in WAL, `synchronous=NORMAL`, `busy_timeout=5000`, nessun locking esclusivo: compatibile con **Litestream** (`infra/litestream.yml`; non cambiare `journal_mode`, non eseguire `wal_checkpoint(TRUNCATE)`/`VACUUM` dall'applicazione) e con **`sqlite3 db ".backup 'dest'"`** (CLI presente nell'immagine Docker). Gli script `scripts/backup.ts backup <db> <dest>` (API backup di SQLite, ripiego `VACUUM INTO`) e `scripts/backup.ts verify <file>` (integrity_check, foreign_key_check, trigger di immutabilità presenti) coprono il ripristino mensile da automatizzare. Ripristino: fermare il server, copiare il file su `DB_PATH` (rimuovendo `-wal`/`-shm` residui), avviare. Verificato dai test in `test/core/backup.test.ts`.

## Carico e concorrenza
`npx tsx scripts/loadtest.ts --duration=30 --concurrency=50 --tenants=10` (in-process, DB temporaneo; oppure `BASE_URL=... TOKENS=a,b`). Riferimento locale: ~500 richieste/s, p95 ≈ 50 ms a 20 connessioni. Concorrenza del sync (due dispositivi con gli stessi numeri, 1.000 emissioni parallele): `test/core/concurrency.test.ts`.

Revisione di sicurezza completa: `docs/SECURITY-REVIEW.md`.
