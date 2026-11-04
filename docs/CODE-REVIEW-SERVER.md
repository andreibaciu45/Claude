# Revisione indipendente del server (CODE-REVIEW-SERVER)

Revisore: agente indipendente (non ha scritto il codice). Ambito: `server/src/**`, `server/scripts/**`, test esistenti. Punto di partenza: `docs/SECURITY-REVIEW.md` (quanto già controllato dall'autore, **non ripetuto**), CONTRACT-V2, ARCHITECTURE-V2 §1-2 e §6, OPERAZIONI, `server/README.md`.
Metodo: lettura completa del codice del server (circa 5.300 righe), sonde con test usa-e-getta, tentativi di aggiramento diretto in SQL dei trigger, simulazione di concorrenza **tra processi reali** sullo stesso file SQLite, confronto prima/dopo.
**Verifica prima/dopo**: i test di regressione sono in `server/test/review/**` (26 test, 2 file). Eseguiti sull'albero precedente alla revisione (commit `2511108`, estratto con `git archive` nello scratchpad, senza toccare il lavoro condiviso) **21 su 26 falliscono** (incluso il test a due processi, 3 volte su 3); i 5 che passano sono guardie di comportamenti già corretti (trigger SQL non aggirabili, annidamento di transazioni, idempotenza di opId in un solo processo, rimborso della quota voce su errore, controllo chiavi senza dati cifrati). Dopo le correzioni: `cd server && npx vitest run` = **311 passati, 1 saltato**; `npx tsc -p server --noEmit` pulito.

## Riepilogo per gravità

| Gravità | N. | Difetti |
|---|---|---|
| Alta | 1 | #1 riempimento del disco con audit non cancellabile |
| Media | 6 | #2 transazione rotta dopo un COMMIT fallito · #3 job SDI bloccati per sempre · #4 riabbonamento Stripe · #5 `scartata` come grimaldello dell'immutabilità · #6 numero fattura duplicato non rilevato · #7 documento «avvelenato» da `enc:v1:` |
| Bassa | 9 | #8 opId doppio → 500 · #9 limit/offset → 500 · #10 avvio con due processi · #11 quota voce in parallelo · #12 SDI: chiave di idempotenza, eventi duplicati, NS tardivo · #13 OTP: codici vecchi ancora validi · #14 avvio senza chiave di cifratura · #15 impronta email dopo cancellazione · #16 messaggio «in ascolto» prematuro |

Totale 16 difetti confermati e corretti. Nessuna vulnerabilità di tipo SQL injection, bypass dell'isolamento tra tenant, evasione della firma Stripe/SDI o XSS/stack trace.

## Difetti confermati

### #1 — ALTA — Audit del client: disco riempibile con dati non cancellabili
- **Dove**: `sync/service.ts` `applyAudit`, `documents/schema.ts` `auditSchema` (`looseObject`).
- **Problema**: una voce di audit accettava campi extra fino a 20.000 byte; il budget è 20.000 operazioni/ora per tenant. Un account Free (basta una email) poteva scrivere ~400 MB/ora in `audit_log` — append-only per trigger, quindi **mai eliminabile**, nemmeno dalla cancellazione dell'account (le voci restano) — più una copia in `changes`.
- **Riproduzione**: push di `{entity:'audit', payload:{id,at,docId,action,actor, junk:'x'.repeat(18000)}}` → accettata, 18 KB nel DB (test `audit del client…`).
- **Correzione**: si memorizzano solo i campi noti (`id, at, docId, action, actor, detail, xmlSha256, voiceTranscript`), tetto ~6 KB a voce e tetto giornaliero per tenant `RL_AUDIT_PER_DAY` (default 10.000, su DB: sopravvive ai riavvii). Il peggior caso scende a ~60 MB/giorno/tenant. Residuo: serve comunque una politica di retention/archiviazione dell'audit (vedi «Rischi residui»).

### #2 — MEDIA — Dopo un COMMIT fallito ogni transazione successiva fallisce fino al riavvio
- **Dove**: `db/index.ts` `transaction()`.
- **Problema**: `depth--` veniva eseguito nel `try` e di nuovo nel `catch`. Se `COMMIT` lancia (disco pieno, errore di I/O, vincolo FK differito) `depth` resta a -1 e la transazione successiva esegue `SAVEPOINT sp-1` (sintassi non valida): **tutte le scritture del processo falliscono anche dopo aver liberato il disco**, finché non si riavvia. È esattamente lo scenario «disco pieno» di OPERAZIONI §7.2.
- **Riproduzione**: `transaction(() => { PRAGMA defer_foreign_keys=ON; INSERT con FK inesistente })` → lancia; la `transaction` successiva fallisce con `near "-": syntax error`.
- **Correzione**: decremento unico e rollback esplicito anche quando il commit fallisce.

### #3 — MEDIA — Coda SDI: job `running` orfani e job `dead` che bloccano per sempre il rinvio
- **Dove**: `sdi/sqlite.ts` (`claimDue`, `enqueue`), `sdi/jobs.ts`.
- **Problema**: (a) `claimDue` marca `running` ma nulla lo riporta in coda se il processo muore (crash, `uncaughtException`, kill) → la fattura non parte mai e la chiave di deduplica (UNIQUE) impedisce di accodarla di nuovo; (b) un job `dead` (5 tentativi falliti) resta nella tabella con la sua `dedupe_key`: ogni nuovo `POST /v1/sdi/submit` (o nuova notifica del provider) trova il job morto e risponde `{status:'queued'}` **senza fare nulla** per 180 giorni.
- **Correzione**: migrazione 104 (`claimed_at`); i `running` più vecchi di `SDI_JOB_STALE_MS` (15 min) tornano in coda o, a tentativi esauriti, in `dead`; un `enqueue` con chiave di un job `dead` lo riattiva (SQLite e in memoria). Job in coda o completati non sono toccati.

### #4 — MEDIA — Stripe: chi si riabbona dopo una disdetta resta Free; eventi della vecchia sottoscrizione possono disdire la nuova
- **Dove**: `billing/webhook.ts`.
- **Problema**: `checkout.session.completed` riattivava lo stato ma lasciava `currentPeriodEnd` (scaduto) e `cancelAtPeriodEnd=true` del vecchio abbonamento: dopo la tolleranza di 3 giorni `getPlan` = **free per un cliente che ha appena pagato** e `/v1/me` mostra «disdetto». `customer.subscription.created` non era gestito, quindi il nuovo periodo arrivava solo con un eventuale `updated`. Un `deleted`/`canceled` della sottoscrizione precedente (stessa `customer`) poteva disdire quella nuova.
- **Riproduzione**: sub_1 attiva → disdetta (periodo -170 gg) → nuovo checkout sub_2 → `getPlan` = `free` (test `billing: nuovo abbonamento…`).
- **Correzione**: nuova sottoscrizione (precedente `canceled` o id diverso) azzera periodo e flag; gestito `customer.subscription.created`; eventi `deleted`/non attivi riferiti a una sottoscrizione diversa da quella attiva sono ignorati (`sottoscrizione precedente`).

### #5 — MEDIA — Immutabilità aggirabile dichiarando «scartata» una fattura consegnata
- **Dove**: `sync/service.ts` (percorso fattura bloccata + rinvio).
- **Problema**: per una fattura bloccata il server consente cambi di `status` verso qualunque stato tranne `bozza`; lo stato `scartata` apre la porta al «rinvio corretto» (contenuto riscrivibile con `xmlHistory` più lungo). Un client poteva quindi portare una fattura `consegnata` (accettata dallo SDI) a `scartata` e poi **riscriverne righe, cliente e XML**, contro CONTRACT-V2 («emessa = immutabile»). Il client onesto non lo fa (`SDI_STATUS_TRANSITIONS`: `scartata` solo da `inviata`), ma il server è il garante.
- **Correzione**: dal server non si raggiunge `scartata` da `consegnata`, `stornata`, `pagato`; il sink SDI registra un NS tardivo/duplicato su una fattura `consegnata` senza cambiarne lo stato. Il percorso legittimo (inviata → scartata → rinvio con xmlHistory) è coperto da test.
- **Limite noto** (non risolvibile lato server): lo SDI in v1 è registrato a mano, quindi il server non può verificare che un NS sia vero; chi dichiara `scartata` una fattura solo `inviata` può ancora riscriverla. Mitigazione futura: ammettere il rinvio solo con un evento NS ricevuto dal provider.

### #6 — MEDIA — Numero di fattura duplicato non rilevato
- **Dove**: `documents/schema.ts`, `documents/repo.ts`, `sync/service.ts`.
- **Problema**: l'unicità riguarda `(tenant, sezionale, anno, seq)` con confronto binario e sul solo `seq`. (a) Sezionale `ft` ≠ `FT`: stessa serie per il contribuente, due righe per l'indice; (b) due fatture con `seq` diversi ma lo **stesso numero mostrato** (`1/2026`) erano entrambe accettate, mentre `integrity-check` poi le segnala come errore: il difetto veniva scoperto dopo l'emissione. Riprodotto: `i1` FT/1 + `i2` ft/1 e `i3` seq 5 con numero «1/2026» accettate.
- **Correzione**: sezionale vincolato a `^[A-Z][A-Z0-9]{0,9}$` (`invalid` altrimenti); un secondo documento emesso della stessa serie con lo stesso numero (testo, `number` o `invoice.number`) è `duplicate_invoice_number`. Migrazione 5: indice parziale `(tenant_id, number) WHERE locked_at IS NOT NULL` (senza, ogni emissione scandiva tutte le emesse: il test da 1.000 emissioni concorrenti lo ha mostrato).

### #7 — MEDIA — Un testo «enc:v1:…» rende il documento illeggibile (GET, export GDPR, rotazione chiave)
- **Dove**: `db/seal.ts` `sealDocument` (salta i campi che «sembrano» già cifrati), `sync/service.ts`.
- **Problema**: `notes`, `transcript`, `invoice.xml` che iniziano con `enc:v1:` non venivano cifrati e in lettura `open()` lanciava → `GET /v1/documents/:id` e **`GET /v1/me/export` rispondevano 500 per sempre** (art. 20 GDPR non esercitabile), e `rotate-key` si interrompeva. Un client difettoso o un dettato maligno bastano.
- **Correzione**: rifiutati in ingresso (`invalid`, «prefisso riservato»). Righe già avvelenate in un DB esistente: le segnala `admin integrity-check` («righe cifrate NON leggibili»).

### #8 — BASSA — Stesso `opId` consegnato a due processi: 500 invece di conferma
- **Dove**: `sync/service.ts` `pushOps`.
- **Problema**: il controllo `sync_ops` era **fuori** dalla transazione. Con due processi sullo stesso DB (retry dopo timeout, deploy con due istanze) entrambi passavano il controllo; il secondo, dopo il lock, violava la PK di `sync_ops` → 500 (rollback pulito, nessun dato corrotto, ma il client riceve un errore).
- **Riproduzione**: `test/review/multiprocess.test.ts` (due processi `tsx` con barriera temporale, 40 operazioni identiche): sul vecchio codice 1 errore su 3 prove su 3.
- **Correzione**: controllo dentro `BEGIN IMMEDIATE`.

### #9 — BASSA — `limit`/`offset` non interi → 500
- `GET /v1/sync/pull?limit=1.5`, `GET /v1/documents?limit=1.5|offset=1.5|1e300|Infinity`: SQLite rifiuta `LIMIT 1.5`. Nuovo `intParam()` (troncamento, intervalli, non finiti → default).

### #10 — BASSA — Avvio con due processi
- (a) `runMigrations` leggeva l'elenco delle migrazioni fuori dal lock: se un altro processo ne applicava una nel frattempo, `CREATE TABLE` falliva («table already exists») e il servizio non partiva. Ora ricontrolla dentro `BEGIN IMMEDIATE`.
- (b) `PRAGMA journal_mode=WAL` era eseguito **prima** di `busy_timeout`: con un lock già preso (CLI/backup mentre il server parte) falliva subito con «database is locked». Riordinati.

### #11 — BASSA — Quota minuti di voce superabile con richieste parallele
- Il consumo era addebitato **dopo** la trascrizione (fino a 30 s): N richieste insieme passavano tutte il controllo. Ora il consumo è **prenotato** subito (controllo e addebito senza `await` in mezzo) e restituito se la trascrizione fallisce. Test: 6 richieste parallele con quota per 2 → 2×200, 4×429.

### #12 — BASSA — SDI: idempotenza e ordine degli eventi
- `Idempotency-Key` verso il provider = `tenant:doc` (uguale al primo invio): il **rinvio corretto** di una scartata, con XML diverso, poteva essere scambiato dal provider per un duplicato e non partire. Ora include l'impronta dell'XML (retry identico = stessa chiave).
- Webhook senza campo `at`: l'istante era l'ora di ricezione, quindi la chiave di deduplica cambiava a ogni ritrasmissione → eventi duplicati nella cronologia della fattura. Senza `at` la chiave usa l'impronta del corpo.
- NS tardivo su fattura consegnata: vedi #5.

### #13 — BASSA — OTP: dopo il login i codici precedenti restano spendibili
- `consumeOtp` consumava solo il codice usato; gli altri (fino a 2) restavano validi 10 minuti. Ora il login riuscito chiude tutti i codici attivi dell'email.

### #14 — BASSA — Chiave di cifratura sparita: downgrade silenzioso
- Se `APP_ENCRYPTION_KEY` manca (file di configurazione perso), il server partiva scrivendo i **nuovi** dati in chiaro e dando 500 su quelli cifrati; se la chiave cambia senza `OLD_KEYS`, nessun avviso all'avvio. Nuovo `db/seal-check.ts` (campione di profili, change, audit, documenti): `src/index.ts` rifiuta di partire con messaggio chiaro.

### #15 — BASSA — GDPR: impronta dell'email in `invite_codes`
- `email_hash` (sha256 senza sale, ricavabile con un dizionario) restava per 400 giorni dopo la cancellazione dell'account. Ora azzerato in `deleteAccount` (lo stato «usato» resta).

### #16 — BASSA — «server in ascolto» stampato prima di ascoltare
- Orchestratori e il test del SIGTERM (flaky, anche prima della revisione) potevano ricevere `ECONNREFUSED`. Il messaggio esce ora nel callback di `listen`.

Interventi minori sui test esistenti (solo `server/test/**`): `ops/grants.test.ts` confrontava due letture di `now()` con uguaglianza esatta (flaky di 1 ms); `ops/shutdown.test.ts` attende fino a 25 s l'avvio del processo (carico della macchina).

## Cosa ho controllato e NON ho trovato difetti

**Sync**
- Cursore: `seq AUTOINCREMENT` assegnato sotto lock di scrittura → visibile in ordine; la compattazione (`DELETE seq < nuovo`) più «ultima modifica per entità» non perde aggiornamenti nemmeno con scritture tra le due query di `pullPage` (la riga sostituita ricompare con seq maggiore). Cursore in 15 cifre: nessun overflow oltre 2^53. Il client usa solo il cursore del pull (non quello del push).
- Atomicità: ogni operazione è una transazione (documento + `changes` + `sync_ops` + audit); i conflitti non vengono memorizzati, quindi un retry di un batch parziale rivaluta solo le operazioni non accettate.
- Isolamento tra tenant: tutte le query hanno `tenant_id` dalla sessione; PK `(tenant_id, id)`; l'indice UNIQUE sui numeri è per tenant (stessi numeri in tenant diversi: nessun conflitto, testato). Export GDPR: tutte le query filtrano per tenant.
- Tombstone: contenuto azzerato, nessuna rivelazione nello `stale`; la quota Free conta il riuso dello stesso id. «Delete prima di create» non è raggiungibile da un client che cancella solo ciò che ha visto sul server.
- Clamp dell'orologio (`now + 10 min`), profondità/nodi del JSON iterativi, `__proto__` nei payload (zod `looseObject` non lo propaga: verificato che `lockedAt`/`seq` ereditati non aggirano la validazione).

**Trigger SQL** (testati direttamente in SQL, `test/review`): `INSERT OR REPLACE` sullo stesso id, `INSERT OR REPLACE` con altro id ma stesso `(sezionale, anno, seq)` (REPLACE cancellerebbe la emessa), `ON CONFLICT DO UPDATE`, DELETE+INSERT, `UPDATE OR REPLACE`, UPDATE parziali di colonne indicizzate (`inv_seq`, `locked_at`, `deleted_at`, `id`, `status='bozza'`) e di percorsi JSON (`seq`, `date`, `customer`, `lines`), chiavi JSON duplicate: **tutti bloccati**. Nessun termine NULL nella clausola WHEN (la negazione di un NULL avrebbe disattivato il trigger). Nota operativa: `recursive_triggers` è per connessione; chi apre il DB con `sqlite3` a mano deve eseguire `PRAGMA recursive_triggers=ON` prima di qualunque REPLACE.

**Cifratura AES-256-GCM**: IV deterministico = HMAC(sottochiave distinta, `aad|\0|testo`) → IV uguale ⇔ (campo, documento, testo) uguali, quindi nessun riuso con testi diversi; sottochiave separata dalla chiave di cifratura; IV casuale a 96 bit per payload di sync/profilo/audit; AAD lega tenant/entità/campo (un valore spostato su un altro documento o tenant non si decifra); tag di 16 byte verificato; chiavi vecchie solo in decifratura; `kid` non autenticato ma selezionare un'altra chiave fa fallire il tag. Un valore in chiaro in un campo atteso cifrato è accettato (necessario per la migrazione): chi ha scrittura sul DB può «declassare» un campo, ma lo stesso attore potrebbe riscrivere tutto.

**Autenticazione**: token 256 bit, solo hash nel DB, lookup per hash; sessione per dispositivo (login su un dispositivo revoca solo la sua sessione precedente); logout revoca la sessione corrente; scadenza scorrevole; nessuna fixation (token generato dal server); risposta identica per email nuove/esistenti; normalizzazione email (anche `K` Kelvin → `k`: l'OTP parte comunque verso l'indirizzo normalizzato, nessuna presa di controllo); regex email/Bearer senza backtracking catastrofico (massimo ~64k passi su 254 caratteri). Tempi: i confronti sono in tempo costante, le differenze residue (righe OTP presenti o no) riguardano solo «esiste un codice pendente».

**Billing**: firma HMAC sul corpo grezzo, tolleranza 5 minuti, confronto su tutte le firme, deduplica per `event.id` con rilascio in caso di errore; ordine per `created`; `price id`/importi non sono mai letti dai webhook (il piano dipende solo da stato e periodo); `tenantId` risolto da `client_reference_id`/metadata che imposta il server nel checkout oppure dal customer già noto.

**SDI**: stato della fattura derivato da una mappa fissa evento→stato (nessun mass-assignment dal payload); firma HMAC obbligatoria per il provider HTTP (senza segreto: rifiuto); il mock non parte in produzione; deduplica per chiave; il sink modifica solo i campi ammessi dal trigger e conserva i campi cifrati byte per byte.

**Voce**: limite di corpo sul flusso reale, `durationMs` non fa fede (addebito sul massimo con stima da byte), nessun audio su disco, output LLM vincolato a un elenco chiuso (gli intent irreversibili non ci sono), contesto ridotto a tre chiavi scalari.

**GDPR**: l'export non include dati di altri tenant; la cancellazione rimuove sessioni, dispositivi, profilo, catalogo, bozze, tombstone, `changes`, `sync_ops`, OTP, utente (e tenant/abbonamento/consumi se non restano fatture); restano per progetto audit e accettazioni. Nessun contenuto di documenti in log/metriche.

**CLI admin**: nessuna SQL injection (tabelle/colonne solo da costanti; `LIKE` parametrizzato; `VACUUM INTO` con escape); `delete-tenant` richiede conferma dell'email e blocca con abbonamento attivo; `rotate-key` fa prima il backup; `backup` rifiuta una destinazione esistente e crea file 0600 in cartella 0700; `integrity-check` apre in sola lettura.

**/metrics e /health/deep**: token ≥16 caratteri con confronto a tempo costante, 404 se disabilitato; etichette solo costanti (rotta = pattern, metodo = verbi HTTP ammessi da Node); senza token `/health/deep` espone solo gli stati. **CORS** per allow-list (con `*` riflette l'origine ma senza credenziali: i token sono Bearer). **Errori**: `onError` generico, nome dell'errore solo in log/`ops_errors`. **Limiti**: body sul flusso, 100 operazioni/push, payload ≤ 1,5 MB, pull con tetto di byte.

**Migrazioni**: ciascuna in `BEGIN IMMEDIATE…COMMIT` (DDL transazionale) con rollback; ordine per versione indipendente dall'ordine di registrazione; `schema_migrations` controllata da `/health/deep`.

## Rischi residui (non risolti, con motivazione)
1. **OTP distribuito**: con 6 cifre, 10 tentativi per codice e al massimo 10 richieste/ora per email, un attaccante con molti IP e pazienza ha ≈ 10×(10 richieste/ora ×24)/10⁶ ≈ **0,24 % al giorno** di indovinare un codice (≈ 7 % in un mese di attacco continuo; la vittima riceve ~240 email al giorno). L'autore lo classifica come DoS; è anche un rischio di presa di controllo a bassa probabilità. Mitigazioni suggerite (cambiano il comportamento, quindi non applicate): `RL_OTP_REQUEST_EMAIL_HOUR=4`, `OTP_MAX_ATTEMPTS=5`, notifica «nuovo accesso» via email, passkey.
2. **Audit senza retention**: anche con #1 il registro cresce per sempre (resta dopo la cancellazione dell'account). Servono una politica di archiviazione (es. export annuale + prune con trigger sospeso, come già previsto per le fatture) e crypto-shredding per tenant.
3. **Fatti fiscali dichiarati dal client**: il server non può sapere se una fattura `emessa` senza `lockedAt` (o con `invoice.legacy`) sia davvero tale; un client che non invia `lockedAt` mantiene il documento modificabile. Stessa cosa per gli esiti SDI registrati a mano (#5, limite noto). Numerazione senza buchi: solo controllo a posteriori (`integrity-check`).
4. **`/health/deep` non autenticato esegue una scrittura** a ogni chiamata (limitata dal rate-limit per IP 600/min). Se esposto su Internet, restringerlo a rete interna in Caddy o far leggere solo lo stato in cache.
5. **`server/.env.example` ha `SMTP_REQUIRE_TLS=0`**: copiato in produzione disattiva il requisito STARTTLS (il codice default è `1` solo se la variabile non è impostata). Fuori dal mio perimetro: da correggere nel file o in INFRA.
6. Con `NODE_ENV` non impostato (già noto) `SDI_PROVIDER=mock` senza segreto accetta webhook non firmati; `AUTH_DEV_RETURN_CODE=1` restituisce i codici OTP.
7. Un dispositivo offline per più di `TOMBSTONE_RETENTION_DAYS` (180) può «resuscitare» una bozza cancellata (la tombstone non c'è più). Compromesso accettato dall'autore.
8. Le righe già cifrate male in un DB esistente (#7) non vengono riparate automaticamente: usare `integrity-check`.
9. Un singolo `changes.payload` non decifrabile (chiave persa o riga manomessa) blocca il pull di quel tenant (500): scelta prudente (nessuna perdita silenziosa), ma l'operatore deve intervenire.

## Come rieseguire
```
cd server && npx vitest run test/review        # 26 test di regressione (~5 s, di cui 1 con due processi)
cd server && npx vitest run                    # tutta la suite: 311 passati, 1 saltato
npx tsc -p server --noEmit
```
Nota: nella suite esistono alcuni test sensibili al carico della macchina (1.000 emissioni concorrenti, avvio di processi reali); durante la revisione l'albero originale ne mostrava già 1 instabile su 3 esecuzioni. Con le correzioni sopra (#16 e i due ritocchi ai test) 8 esecuzioni consecutive sono state tutte verdi.
