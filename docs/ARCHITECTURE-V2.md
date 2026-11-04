# VocePreventivo — Architettura v2 (backend, sync, mobile, voce, fatturazione SDI)

Autore: agente ARCHITETTO · data: 04/11/2026 · stato: PROPOSTA da approvare (nessun codice scritto)
Sostituisce le parti "Nessun backend nella v1" e "Fattura = PDF di cortesia" di `docs/ARCHITECTURE.md`.
Convenzioni: **DA VERIFICARE** = fatto non confermato da fonte primaria o dipendente da preventivi/test su dispositivo.
Le cifre di costo sono ordini di grandezza, non preventivi.

## 0. Sintesi delle decisioni

| # | Tema | Scelta | Alternativa scartata (perché) |
|---|---|---|---|
| 1 | Backend | **Sì**: un solo servizio Node/TypeScript (Hono) + **SQLite WAL + Litestream** su VPS UE, Caddy, Docker Compose | Postgres+RLS: più RAM, più operazioni, utile solo oltre qualche migliaio di tenant; si migra dopo |
| 2 | Offline | **Bozze offline illimitate; il numero ufficiale si assegna solo online, al momento dell'emissione** (server, transazione atomica). Preventivi: blocchi riservati, buchi tollerati | Blocchi di numeri fattura riservati al dispositivo: producono buchi e numeri fuori ordine cronologico, illegittimi |
| 3 | Mobile | **Fase A: PWA** (zero costi store). **Fase B: wrapper Capacitor** per App Store + Play, stesso codice | React Native: riscrittura totale UI + motore, costo token inaccettabile |
| 3b | Voce | Livello astratto `SpeechProvider`: Web Speech dove funziona (Android Chrome, Safari in tab) → **registrazione audio + trascrizione server** su iOS PWA standalone e browser senza supporto → plugin nativo nel wrapper Capacitor | Solo Web Speech: su iOS PWA installata è con ogni probabilità inutilizzabile |
| 4 | Comandi | Classificatore di intent **deterministico** (riusa `src/engine`), LLM economico solo come fallback non distruttivo; **emissione/annullo mai da un solo enunciato** | LLM per ogni comando: costo, latenza, non deterministico, rischio fiscale |
| 5 | SDI | XML FatturaPA generato **da noi** (modulo puro, testato con XSD) e inviato tramite **provider accreditato via API**; fallback "scarica XML" | Diventare intermediario accreditato SDI in proprio: procedura e costi sproporzionati |
| 6 | Auth | **Email + codice OTP a 6 cifre** (non link magico); passkey dopo | Magic link: su iOS apre Safari, non la PWA installata (storage separato) → login rotto |

Costo fisso stimato: **~7–10 €/mese** in fase PWA; **~16–19 €/mese** con Apple Developer. Variabile per cliente pagante: pochi centesimi (§1.9).

---

## 1. Backend: sì, e quale

### 1.1 Perché serve (e perché la v1 "senza backend" non basta più)
| Esigenza | Perché il solo client non basta |
|---|---|
| Numerazione fatture senza buchi e immutabile | Un contatore in IndexedDB si perde (cancella dati browser, cambio telefono, due dispositivi). Il numero fiscale deve essere un'unica fonte di verità. |
| Invio allo SDI | La chiave API del provider è un segreto: non può stare in una PWA/app. Servono anche webhook (esiti RC/NS/MC/NE/DT) e retry. |
| Licenze/abbonamenti | Stripe: webhook server-to-server, verifica firma, stato `entitlement` non falsificabile dal client. |
| Multi-dispositivo e perdita del telefono | Il backup JSON manuale non è accettabile per un archivio fiscale. |
| Conservazione/obblighi di legge | Le fatture emesse devono restare disponibili e non modificabili (10 anni, v. §1.8). |
| Trascrizione server e LLM | Chiavi API segrete, rate-limit, quote per utente. |

Alternativa scartata a livello di "quale backend": BaaS (Supabase/Firebase). Costa poco all'inizio, ma la logica critica (transazione di numerazione, XML, webhook, quote) finirebbe comunque in funzioni custom, con lock-in e dati in giurisdizione/gestione meno chiara. Un servizio da ~2.000 righe su VPS è più economico in token e più controllabile.

### 1.2 Stack
- **Runtime**: Node 22 LTS + TypeScript, **Hono** (leggero, tipi, middleware zod) con `@hono/node-server`. (Alternativa Fastify: equivalente, più pesante; nessun motivo per preferirla.)
- **DB**: **SQLite** (`better-sqlite3`, WAL, `foreign_keys=ON`), migrazioni SQL numerate in `server/migrations/`. Un solo processo scrittore → la numerazione gap-free è una semplice transazione `BEGIN IMMEDIATE`.
- **Backup continuo**: **Litestream** verso object storage UE (Hetzner Object Storage / Backblaze B2 UE) + snapshot VPS settimanale. Backup cifrati (age) prima dell'upload se il provider non cifra a riposo.
- **Reverse proxy/TLS**: **Caddy** (certificati automatici, HTTP/3, header di sicurezza).
- **Deploy**: `docker compose` con 3 servizi: `caddy`, `api`, `litestream`. CI GitHub Actions: test → build immagine → `ssh` + `docker compose pull && up -d`. Nessun Kubernetes.
- **Validazione**: schemi **zod condivisi** in `shared/` (stessi tipi client/server).
- **Job/code**: nessun broker. Tabella `jobs` in SQLite + loop in-process (invio SDI, email, retry con backoff).
- **Hosting**: VPS in UE (Hetzner Cloud CX/CPX 2 vCPU/4 GB, Germania o Finlandia; prezzo ~4–6 €/mese, **DA VERIFICARE** sul listino corrente). Basta anche 2 GB di RAM.
- **Email transazionali** (OTP, notifiche): provider con tier gratuito e regione UE (Brevo, Resend, Amazon SES eu-*; **DA VERIFICARE**). Servono SPF/DKIM/DMARC sul dominio.

Scartato: Postgres adesso. Si passa a Postgres (+ Row Level Security) se: scritture concorrenti >~50/s sostenute, oltre ~5.000 tenant attivi, o serve replica in lettura. Le query sono dietro un repository (`server/src/db/`) per rendere il cambio locale.

### 1.3 Schema DB di massima
Ogni tabella di dominio ha `tenant_id` (= azienda/artigiano) e `rev` (versione monotona per sync). ID = UUID v7 generati dal client dove possibile.

```sql
tenants(id, name, vat_number, fiscal_code, regime, created_at, plan, status)          -- profilo fiscale in JSON validato
users(id, email UNIQUE, tenant_id, role, created_at, last_login_at)
otp_codes(email, code_hash, expires_at, attempts)                                      -- 10 min, max 5 tentativi
sessions(id, user_id, token_hash, device_label, created_at, last_seen_at, revoked_at)
devices(id, tenant_id, user_id, quote_block_start, quote_block_end)                   -- blocchi numerazione preventivi
customers(id, tenant_id, data JSON, rev, updated_at, deleted_at)
catalog_items(id, tenant_id, data JSON, rev, updated_at, deleted_at)
documents(id, tenant_id, type TEXT,            -- preventivo | fattura | nota_credito
          status TEXT,                         -- bozza | emesso | inviato | consegnato | scartato | annullato_da_nc ...
          series TEXT, year INT, number INT,   -- NULL finché bozza
          number_label TEXT,                   -- "FT-2026-0012"
          issue_date TEXT, customer_id, data JSON,   -- righe, totali, note
          related_document_id,                 -- NC -> fattura originale
          content_hash TEXT, prev_hash TEXT,   -- catena di integrità (solo emessi)
          xml TEXT, xml_hash TEXT,
          rev INT, created_at, updated_at,
          UNIQUE(tenant_id, type, series, year, number))
doc_counters(tenant_id, series, year, last_number, last_issue_date, PRIMARY KEY(tenant_id, series, year))
sdi_submissions(id, tenant_id, document_id, provider, provider_ref, state, last_event_at, raw_events JSON)
audit_log(id, tenant_id, user_id, at, action, entity, entity_id, payload JSON)         -- append-only
subscriptions(tenant_id, stripe_customer_id, stripe_sub_id, plan, status, current_period_end, usage JSON)
usage_counters(tenant_id, month, docs_emitted, stt_seconds, llm_calls)
jobs(id, kind, payload JSON, run_at, attempts, state)
```
**Immutabilità**: trigger SQL che vietano `UPDATE/DELETE` su `documents` quando `status != 'bozza'` (eccetto i campi di stato SDI) e su `audit_log`. `content_hash = sha256(JSON canonico del documento)`, `prev_hash` = hash del documento emesso precedente del tenant → catena che rende evidente qualsiasi manomissione.

### 1.4 API REST principali (prefisso `/v1`, JSON, auth Bearer)
| Area | Endpoint |
|---|---|
| Auth | `POST /auth/otp/request {email}` · `POST /auth/otp/verify {email,code,deviceLabel}` → `{token}` · `POST /auth/logout` · `GET /me` |
| Sync | `POST /sync/push {ops[]}` · `GET /sync/pull?cursor=` (v. §2) |
| Documenti | `POST /documents/:id/emit` (numera + congela + genera XML) · `POST /documents/:id/credit-note` · `GET /documents/:id/xml` · `GET /documents/:id/pdf-data` |
| SDI | `POST /documents/:id/send` · `GET /documents/:id/sdi-status` · `POST /webhooks/sdi` (firma HMAC del provider) |
| Numerazione | `POST /devices/quote-block` (riserva blocco preventivi) |
| Billing | `POST /billing/checkout` · `POST /billing/portal` · `POST /webhooks/stripe` · `GET /billing/entitlements` |
| Voce | `POST /voice/transcribe` (audio, max 30 s) · `POST /voice/interpret` (fallback LLM) |
| Dati personali | `GET /account/export` (zip JSON+XML+PDF) · `DELETE /account` (v. §1.8) |
| Ops | `GET /healthz` (non autenticato, solo `ok`) |

Errori in formato uniforme `{code, message, retryable}`. Idempotenza: header `Idempotency-Key` obbligatorio su `emit`, `send`, `credit-note`.

### 1.5 Autenticazione
- **Email + OTP a 6 cifre** (scadenza 10 min, 5 tentativi, rate-limit per email e IP). Nessuna password da gestire/resettare, un artigiano la ricorda al volo dal telefono.
- Sessione = **token opaco** (256 bit) salvato come hash in `sessions`, durata 90 giorni sliding, revocabile per dispositivo. Niente JWT (revoca impossibile senza lista).
- Client: token in IndexedDB (PWA) / Keychain-Keystore via plugin nel wrapper.
- Fase successiva (taglio consigliato ora): **passkey (WebAuthn)**. Su iOS standalone funziona ma aggiunge complessità; l'OTP è sufficiente per l'MVP.
- Ruoli: nel MVP un utente per tenant (`owner`). Il modello `users.role` consente il commercialista in sola lettura più avanti.

### 1.6 Isolamento tra tenant
1. Il `tenant_id` si ricava **solo** dalla sessione, mai dal body/URL.
2. Tutte le query passano da repository che richiedono `tenantId` (tipo `TenantCtx`) come primo argomento; è vietato `db.prepare` fuori da `server/src/db/`. Regola ESLint + test.
3. Test automatico di **leakage**: due tenant, ogni endpoint, ID dell'altro tenant → sempre 404.
4. Alternativa scartata: un file SQLite per tenant (isolamento e cancellazione perfetti, ma Litestream su migliaia di file e query trasversali di ops diventano scomode).

### 1.7 Crittografia e segreti
- Trasporto: TLS 1.2+ (Caddy), HSTS. Dati a riposo: disco VPS (cifratura a livello provider, **DA VERIFICARE**) + backup cifrati con `age`.
- Campi particolarmente sensibili (IBAN, chiavi API provider per-tenant se servono): cifrati a livello applicativo con AES-256-GCM, chiave master in variabile d'ambiente (`sops`/file con permessi 600, mai nel repo).
- Segreti: Stripe, provider SDI, STT/LLM, SMTP, HMAC webhook → solo `.env` sul server.
- Log: mai audio, mai contenuto documenti, mai token; solo ID e codici.
- Non si implementa crittografia end-to-end: renderebbe impossibile generare XML/SDI lato server.

### 1.8 Impatto GDPR (da "zero dati sui nostri server" a titolare/responsabile)
| Dato | Ruolo nostro | Note |
|---|---|---|
| Account artigiano (email, P.IVA, dati azienda), fatturazione abbonamento | **Titolare** (art. 4 GDPR) | Base giuridica: contratto. |
| Dati dei **clienti dell'artigiano** (nome, indirizzo, CF/P.IVA, email, tel., contenuto documenti) | **Responsabile del trattamento** (art. 28) per conto dell'artigiano (titolare) | Dati personali comuni, non sanitari; molti sono ditte individuali/privati. |
| Audio vocale | Responsabile; **non conservato** | Trasmesso al provider STT solo per la trascrizione; zero retention richiesta contrattualmente. |

Cosa serve (checklist, tutto realizzabile con documenti, non codice):
1. **Informativa privacy** (titolare, per gli artigiani) in `public/legal/privacy.html` aggiornata: cosa raccogliamo, sub-responsabili, trasferimenti extra-UE, conservazione, diritti. Vale anche per l'uso della voce (audio inviato a terzi: già un rischio annotato in MARKET.md).
2. **DPA / nomina a responsabile (art. 28)** accettata al signup (clic con versione e timestamp salvati in `audit_log`) e inclusa nei Termini: finalità, istruzioni, misure di sicurezza, sub-responsabili, assistenza per diritti degli interessati, cancellazione/restituzione a fine contratto, audit.
3. **Elenco sub-responsabili** pubblico: hosting UE (Hetzner), storage backup, email transazionali, provider SDI, provider STT/LLM (se extra-UE: SCC/Data Privacy Framework — **DA VERIFICARE** lo stato attuale del DPF e l'eventuale opzione di data residency UE offerta dal provider), Stripe (titolare autonomo per i pagamenti).
4. **Registro dei trattamenti** (art. 30, anche per il responsabile): un file in `docs/` aggiornato a mano. Misure di sicurezza descritte (§1.7, §6).
5. **Hosting UE** e backup UE; nessun analytics di terze parti (niente banner cookie necessario se si usa solo storage tecnico; **DA VERIFICARE** con un consulente).
6. **Data breach**: procedura di notifica ai titolari "senza ingiustificato ritardo" (e dai titolari al Garante entro 72 h). Una pagina di runbook.
7. **Conservazione vs cancellazione**: le fatture vanno conservate 10 anni (art. 2220 c.c.; **DA VERIFICARE** con commercialista). Alla chiusura account: export completo all'utente, cancellazione di catalogo/clienti non fiscali/bozze/audio; le fatture emesse restano in archivio fiscale ristretto fino a scadenza, o si riconsegna l'archivio e si cancella (decisione contrattuale). La conservazione sostitutiva a norma è meglio demandarla al provider SDI (molti la includono; **DA VERIFICARE**) o al servizio gratuito dell'Agenzia delle Entrate.
8. **DPIA**: probabile non obbligatoria (non è trattamento su larga scala di dati particolari); documentare la valutazione in una pagina.
9. **Impatto prodotto**: l'app resta usabile senza account (modalità locale gratuita come oggi)? Raccomandato **sì** per il piano Free (preventivi locali) → riduce attrito e dati trattati; account obbligatorio solo per fatture/sync.

Nota: questa sezione non è consulenza legale. Prima del lancio a pagamento, 1–2 ore di revisione di un avvocato/DPO sono il miglior investimento (costo reale ~150–300 €, fuori budget token).

### 1.9 Costi mensili stimati
| Voce | Fase PWA | Con store |
|---|---|---|
| VPS UE 2 vCPU/2–4 GB | 4–6 € | 4–6 € |
| Snapshot/backup VPS + object storage | 1–3 € | 1–3 € |
| Dominio (~12 €/anno) | 1 € | 1 € |
| Email transazionali (tier gratuito) | 0 € | 0 € |
| Apple Developer (99 $/anno) | – | ~8 € |
| Google Play (25 $ **una tantum**) | – | ~0 (ammortizzato) |
| Monitoraggio (UptimeRobot/Better Stack free tier) | 0 € | 0 € |
| **Totale fisso** | **~7–10 €** | **~16–19 €** |

Variabili (per cliente pagante/mese, ipotesi 12–19 € di prezzo):
- Stripe: ~1,5% + 0,25 € per carta UE standard (**DA VERIFICARE**) ≈ 0,5 € su 15 €.
- Provider SDI: **DA VERIFICARE, richiedere preventivi**. Ipotesi di lavoro 0,05–0,30 € per fattura inviata o pacchetto a canone; con un artigiano forfettario tipico di 10–30 fatture/mese ≈ 1–5 €. È la voce più incerta del margine → decisione prima della scrittura del codice reale (§1.10).
- Trascrizione server: **solo fallback** (§3.3), ≈ 0,2–0,4 $ per utente/mese.
- LLM fallback: <0,05 €/utente/mese (§4.4).
Margine lordo atteso a 15 €: ~8–12 € per cliente, dopo i costi variabili. Con 10 clienti i costi fissi non vengono coperti dalla sola fattura SDI: tenere chiaro che resta una validazione.

### 1.10 Provider SDI: criteri di scelta (decisione da prendere con preventivi)
Candidati da confrontare (nessun prezzo verificato in questa ricerca; la ricerca web non ha restituito listini API): Invoicetronic, Openapi, A-Cube, Aruba (API/PEC), Fattura Elettronica API di altri. **Evitare** provider che richiedono all'artigiano un proprio account esterno (es. OAuth su Fatture in Cloud): rompe l'esperienza e raddoppia i costi.
Criteri: API per **multi-azienda** (un'unica chiave nostra, N partite IVA); webhook di esito; sandbox gratuita; conservazione inclusa; prezzo per documento o a scaglioni; sede/dati in UE; gestione "delega" dell'artigiano (ogni P.IVA deve autorizzare/registrare il canale con il provider — verificare come funziona l'onboarding; è un passo fiscale-amministrativo che incide sulla UX).
Si definisce l'interfaccia `SdiProvider { submit(xml, tenant), getStatus(ref), parseWebhook(req) }` con un **MockProvider** (usato nei test e in sviluppo) e un adattatore reale scelto dopo i preventivi. Fallback sempre disponibile: scaricare l'XML e caricarlo sul portale gratuito "Fatture e Corrispettivi" dell'Agenzia delle Entrate.

### 1.11 Osservabilità minima
- Log JSON su stdout (pino) con `request_id`, `tenant_id`, route, ms, status; rotazione Docker.
- `/healthz` + monitor esterno gratuito (UptimeRobot/Better Stack): alert email/Telegram su down >2 min.
- Errori: Sentry free tier **oppure** solo log + alert su `status>=500` (taglio possibile).
- Metriche in tabella `usage_counters` + un comando `npm run report` (documenti emessi, scarti SDI, iscritti, costi STT).
- Allarmi specifici: scarto SDI, webhook Stripe fallito, backup Litestream fermo (>1 h senza replica), disco >80%.
- Prova di ripristino backup **ogni mese** (script che ripristina in una cartella temporanea e confronta i conteggi).

---

## 2. Modello offline-first

### 2.1 Principi
1. L'app funziona **sempre** offline per: creare/modificare preventivi e **bozze** di fattura, usare catalogo, clienti, voce (dove disponibile), PDF di anteprima.
2. Un'azione è "fiscale" se crea un effetto non reversibile: **emettere fattura**, **nota di credito**, **invio SDI**. Queste richiedono rete e passano dal server.
3. Il server è l'unica fonte di verità per: numeri, documenti emessi, XML, stato SDI, entitlement.

### 2.2 Client
- IndexedDB (già presente via `idb`) con due store nuovi: `outbox` (coda di operazioni) e `syncMeta` (cursore, id dispositivo). Il layer `src/storage/` ha già un'interfaccia `Backend` interna: il livello sync si appoggia a quella senza cambiare le firme pubbliche.
- Ogni scrittura locale (cliente, voce di catalogo, documento in bozza, profilo) genera un'operazione `{opId (UUID), entity, id, baseRev, data, ts}` nell'outbox, applicata subito alla UI (ottimistica).
- Un worker (`src/sync/`) fa push/pull quando c'è rete (`online`, `visibilitychange`, timer, Background Sync dove supportato) con backoff esponenziale.

### 2.3 Protocollo sync
- `POST /sync/push {ops:[…]}`: server applica in ordine, **idempotente per `opId`**, risponde per ogni op `{ok, rev}` o `{conflict, serverVersion}`.
- `GET /sync/pull?cursor=N`: restituisce tutte le entità con `rev > N` (cursore globale per tenant, intero crescente), inclusi i `deleted_at` (tombstone).
- **Conflitti**: per cliente, voce di catalogo, profilo e bozze vale **last-write-wins per campo/record** usando `rev` server (l'ultimo push vince; il perdente riceve la versione server al pull successivo). L'artigiano è quasi sempre un solo utente su 1–2 dispositivi: non servono CRDT. In caso di conflitto su una bozza, il client mostra un avviso "versione aggiornata da un altro dispositivo" e conserva la copia locale come nuova bozza (nessuna perdita silenziosa).
- Documenti **emessi**: sola lettura sul client; arrivano solo via pull; il server rifiuta qualsiasi scrittura (409).
- Dimensioni: nessun upload di loghi grandi nel sync dati; logo come blob separato (`PUT /tenant/logo`, ≤200 KB).

### 2.4 Numerazione: la soluzione
**Regola: la numerazione ufficiale della fattura avviene solo online, nell'istante dell'emissione, ed è assegnata dal server.**

Flusso:
1. Offline: l'artigiano crea e modifica la fattura come **bozza** (nessun numero; l'interfaccia mostra "Bozza — numero assegnato all'emissione"). Può mostrare al cliente una **anteprima PDF** con filigrana "BOZZA — non valida ai fini fiscali".
2. Tocca "Emetti" (o comando vocale confermato): se è offline, il documento passa a stato locale `da_emettere` in coda con avviso chiaro "verrà emessa appena c'è rete"; **non** si consegna nessun PDF come fattura definitiva.
3. Online: `POST /documents/:id/emit` esegue in **una transazione**: validazione (dati cliente, forfettario, bollo) → `doc_counters` +1 → assegna `number`, `issue_date` (rispetta la regola "data ≥ ultima data emessa della serie" per mantenere numeri e date cronologici) → congela documento (`content_hash`, `prev_hash`) → genera XML → registra in `audit_log` → accoda invio SDI. Se qualcosa fallisce, la transazione annulla tutto e **il contatore non avanza** → nessun buco.
4. Il client riceve numero e PDF finale (copia di cortesia dell'XML).

Perché non blocchi riservati per fattura: un dispositivo con numeri 41–50 riservati, l'altro che emette 41…; le date arrivano fuori ordine, i blocchi non usati lasciano buchi che poi vanno giustificati. La numerazione progressiva continua (art. 21 DPR 633/1972, **DA VERIFICARE** con commercialista) è incompatibile con quel schema. L'emissione online è quasi gratuita in termini di UX: per inviare allo SDI serve comunque la rete.

**Casi particolari**
- *Scarto SDI* (notifica NS): il documento non si considera emesso; si corregge e si **ritrasmette con lo stesso numero** (modalità gestita dal provider/regole SDI, **DA VERIFICARE** i termini). Il server tiene lo stesso `number` e crea una nuova `sdi_submission`.
- *Errore dopo l'emissione*: **mai modificare né cancellare**. Si emette una **nota di credito (TD04)** che richiama la fattura originale (sua numerazione separata, es. serie `NC`; **DA VERIFICARE** se serie separata o unica con il commercialista), eventualmente seguita da nuova fattura.
- *Numerazione per anno*: contatore per `(tenant, serie, anno)`, ripartenza a 1 il primo gennaio; `number_label` configurabile (es. `FT-2026-0012`; il campo `Numero` dell'XML ammette ≤20 caratteri e deve contenere almeno una cifra).
- *Preventivi*: non hanno rilevanza fiscale. Il dispositivo riserva un **blocco di 20 numeri** via `POST /devices/quote-block` (anche offline usa il blocco già in mano); buchi tollerati. Gli ID restano UUID.
- *Importazione di numerazione esistente*: l'artigiano che ha già fatture emesse in altri sistemi imposta "ultimo numero usato" una sola volta alla configurazione (registrato in audit_log).

---

## 3. Mobile Android + iOS

### 3.1 Confronto
| Aspetto | PWA pura | Capacitor (WebView nativa + store) | React Native |
|---|---|---|---|
| Riuso codice attuale (React+Vite) | 100% | ~100% | ~30% (motore sì, UI no) |
| Costi store | 0 | 99 $/anno Apple + 25 $ una tantum Google | idem |
| Speech nativo | No (dipende dal browser) | Sì (plugin) | Sì |
| Installazione | iOS: Condividi → Aggiungi a Home (barriera); Android: banner | Store, come ogni app | Store |
| Push, biometria, file | Limitato su iOS | Plugin nativi | Nativi |
| Rischio revisione Apple | Nessuno | Medio (linea guida 4.2 "web wrapper", 3.1.1 acquisti, v. 3.6) | Medio |
| Costo token | ~0 | S/M | XL |

**Scelta**: PWA subito (vendibile in pochi giorni, zero costi), **Capacitor** come fase B quando almeno una di queste è vera: (a) la voce su iOS PWA non è abbastanza affidabile sul campo; (b) i potenziali clienti chiedono "dov'è l'app?" / mancanza di fiducia senza store; (c) si vogliono notifiche push affidabili su iOS. React Native scartato: il valore del prodotto è nel motore TypeScript e nella UI già scritti.

### 3.2 Stato reale di SpeechRecognition (verificato dove possibile)
- **Android Chrome** (tab e PWA installata/WebAPK): `webkitSpeechRecognition` funziona; usa i server Google; richiede rete (comportamento già gestito in `useSpeech.ts` con messaggio `network`).
- **iOS Safari (scheda normale)**: `webkitSpeechRecognition` esiste da iOS 14.5; richiede che Siri/Dettatura siano attivi; qualità buona su `it-IT`; audio elaborato dai server Apple. 
- **iOS PWA installata (standalone, "Aggiungi a Home")**: le fonti trovate (WebKit Bugzilla 225298, thread Apple Developer Forums 748048, articolo di M. Firtman su iOS 14.5; anni 2021–2023) indicano che l'API **non è disponibile** nelle web app dalla Home Screen. Non ho trovato conferme di cambiamento per iOS 18/19/26 → **DA VERIFICARE su iPhone reale con l'ultimo iOS prima di impegnarsi**; nel dubbio si assume "non funziona" e si usa il percorso server.
  Fonti: <https://bugs.webkit.org/show_bug.cgi?id=225298> · <https://developer.apple.com/forums/thread/748048> · <https://firt.dev/ios-14.5/>
- **Firefox**: non supportato (già annotato).
- Anche in Safari: bug segnalati di blocco del microfono dopo riproduzione audio (fonte secondaria, bassa affidabilità).

### 3.3 Alternative per la voce, confrontate
| Soluzione | Affidabilità iOS PWA | Costo | Privacy | Complessità |
|---|---|---|---|---|
| Web Speech (attuale) | Bassa/nulla in standalone | 0 | Audio ai server Google/Apple | Già fatto |
| **Registrazione (`MediaRecorder`/`getUserMedia`) + trascrizione server** | Alta (richiede solo microfono; **DA VERIFICARE** persistenza permesso in standalone, in passato chiedeva a ogni avvio) | OpenAI `gpt-4o-mini-transcribe` ≈ **0,003 $/min**; `whisper-1`/`gpt-4o-transcribe` ≈ 0,006 $/min (fonti aggregatori; **DA VERIFICARE** su platform.openai.com/pricing) | Audio a un provider terzo (extra-UE se OpenAI standard): DPA + zero retention, preferire regione UE se offerta | M |
| Plugin nativo Capacitor (iOS `SFSpeechRecognizer`, Android `SpeechRecognizer`) | Alta, può funzionare on-device per alcune lingue (**DA VERIFICARE** `it-IT` offline) | 0 | Audio verso Apple/Google o on-device | M; richiede store |
| On-device WASM (whisper.cpp, Transformers.js) | Media: modelli 40–150 MB, lento su telefoni medi | 0 | Migliore | L, inaffidabile; **scartato per ora** |

Plugin: `@capacitor-community/speech-recognition` (ultimo rilascio visto 5.1.0, **non confermata** la compatibilità con la versione corrente di Capacitor) oppure fork mantenuti (`@forgr/speech-recognition`, `@dustin-h/speech-recognition`) o il plugin a pagamento Capawesome. Fonte: <https://github.com/capacitor-community/speech-recognition>. Rischio manutenzione: scrivere un **plugin interno minimo** (~150 righe Swift + ~100 Kotlin) è un'opzione se i community non reggono (costo M).

Costo trascrizione server per utente: dettatura media 30 s × 5/giorno × 22 giorni ≈ 55 min/mese → **0,17–0,33 $** a utente attivo. Accettabile ma da limitare: tetto 30 s per richiesta, quota (es. 120 min/mese Pro, 20 min Free), rate-limit, niente conservazione dell'audio.

### 3.4 Raccomandazione (affidabile al minor costo)
`SpeechProvider` con selezione automatica, nell'ordine:
1. **Web Speech** se disponibile *e* non standalone-iOS (Android Chrome, Safari in scheda) → costo 0.
2. **Registrazione + `/v1/voice/transcribe`** se (iOS standalone) o (Web Speech assente) o (l'utente lo sceglie perché in cantiere rumoroso); si passa nel prompt del modello il **vocabolario del catalogo** (nomi/alias) per migliorare il riconoscimento, il vero vantaggio rispetto a Web Speech.
3. **Plugin nativo** nel wrapper Capacitor (fase B), con fallback al punto 2.
Il campo di testo resta sempre il paracadute (già presente).
Adottare subito (2): rende la voce uniforme, testabile e misurabile; costo marginale.

### 3.5 Store: costi, requisiti, piano
- **Apple Developer Program**: 99 $/anno; revisione app tipicamente 1–3 giorni, con rischio di respingimento. Linea guida **4.2 (funzionalità minime)** per web wrapper: serve valore nativo (voce, file, notifiche). Linea **3.1.1/3.1.3**: gli abbonamenti venduti *dentro* l'app possono richiedere In-App Purchase (commissione 15–30%); regole su link esterni cambiate di recente tra USA/UE — **DA VERIFICARE**. Mitigazione: l'app iOS non vende nulla; abbonamento acquistato solo sul web, login con l'account esistente (rispettare le condizioni per "servizi multipiattaforma", **DA VERIFICARE** il testo attuale).
- **Google Play Console**: 25 $ una tantum. Account personali nuovi hanno requisiti di test chiuso (numero minimo di tester per ~14 giorni — **DA VERIFICARE** valori attuali); account da organizzazione richiede D-U-N-S. L'APK/AAB si può distribuire anche fuori Play (download diretto) per i primi beta tester Android.
- **Build iOS senza Mac**: runner macOS in cloud. Opzioni: **GitHub Actions** (runner `macos-*`; minuti macOS a moltiplicatore più alto sui repo privati, **DA VERIFICARE**), **Codemagic** (piano gratuito con minuti macOS limitati, **DA VERIFICARE**), Bitrise. Firma tramite certificati/provisioning profile in secret + `fastlane match` o API key App Store Connect; upload con `fastlane pilot` → TestFlight. Evitare Ionic Appflow (servizio in dismissione, **DA VERIFICARE**). Servono comunque un iPhone di test e, una tantum, accesso a Apple Developer account (D-U-N-S non necessario per account individuale).
- **Distribuzione**:
  - *Fase A (settimane 1–N)*: solo PWA. iOS: guida illustrata "Aggiungi a Home" nell'onboarding; Android: prompt di installazione. Zero costo.
  - *Fase B*: Android su Play (Capacitor o TWA), iOS su TestFlight → App Store. Solo dopo i primi 10 clienti paganti e dopo aver confermato che la voce su iOS PWA è un ostacolo reale.

---

## 4. Comandi vocali avanzati

### 4.1 Architettura
```
audio → [SpeechProvider] → transcript (+ n-best)
      → normalizzazione (src/engine/normalize, numeri in lettere)
      → IntentClassifier deterministico (grammatica + punteggio per parole chiave)
            ├─ conf ≥ 0.8  → Command (zod) → Policy → Esecuzione
            ├─ 0.5–0.8     → UI "Intendevi…?" (2 chip max)
            └─ < 0.5       → (opz.) /voice/interpret LLM → stesso schema Command → stessa Policy
```
- Modulo nuovo **`src/voice/`** (non tocca `src/engine/`: lo importa). `Command` è un'unione discriminata definita in `shared/`.
- Il dettato "libero" (descrizione lavori → righe) resta nel flusso attuale `parseDictation`. Il classificatore decide prima se l'enunciato è **comando** (inizia con verbo di azione riconosciuto) o **dettatura di contenuto**.

### 4.2 Intent
| Gruppo | Intent | Esempio | Rischio |
|---|---|---|---|
| Creazione | `nuovo_preventivo`, `nuova_fattura`, `nuova_nota_credito(da fattura)` | "nuova fattura per Rossi" | basso (crea bozza) |
| Contenuto | `aggiungi_righe` (dettatura), `rimuovi_riga(n/nome)`, `modifica_quantita`, `modifica_prezzo`, `sconto(%)`, `imposta_cliente`, `aggiungi_nota` | "togli l'ultima riga", "sconto dieci per cento" | basso/medio (bozza, undo) |
| Navigazione/lettura | `apri_documento(numero/cliente)`, `leggi_totale`, `mostra_documenti(filtro)`, `cerca_catalogo` | "apri la fattura dodici" | nessuno |
| Trasformazione | `trasforma_preventivo_in_fattura`, `duplica` | "fai la fattura da questo preventivo" | medio |
| **Fiscali** | **`emetti_fattura`**, **`annulla_fattura` (= nota di credito)**, `invia_sdi` | "emetti la fattura" | **alto, irreversibile** |
| Comunicazione | `invia_pdf(email/whatsapp)`, `segna_pagato` | "segna pagata la fattura a Bianchi" | medio |
| Controllo | `annulla_ultima_azione` (undo), `conferma`, `rifiuta`, `ripeti`, `aiuto` | "annulla", "no" | basso |

### 4.3 Sicurezza e conferma
Politica a tre classi, decisa dal codice (non dal modello):
1. **Sicuri** (lettura/navigazione): esecuzione immediata.
2. **Reversibili** (modifiche a bozze): esecuzione immediata con **toast "Annulla" (5 s)** e pila di undo per bozza (≥20 passi, persistita).
3. **Irreversibili** (`emetti_fattura`, `annulla_fattura`, `invia_sdi`):
   - Mai eseguiti dal solo enunciato. L'app mostra una **scheda di conferma bloccante** con cliente, importo, tipo, data, "il numero verrà assegnato dal server".
   - Conferma ammessa con **pressione prolungata sul pulsante (≥1 s)** oppure con comando vocale esplicito e distinto ("**conferma emissione**" / "**conferma annullamento**"; le parole "sì"/"ok" da sole non bastano), entro 15 s, solo con scheda a schermo e schermo acceso.
   - L'emissione è legata a `Idempotency-Key` generata sulla scheda: doppio comando/doppio tap = una sola fattura.
   - Dopo l'emissione non c'è undo: l'"annulla" è la **nota di credito**, con avviso esplicito.
   - Se `conf < 0.8` o la trascrizione ha alternative con intent diverso (es. "emetti" vs "metti"), l'intent distruttivo è **scartato** e si chiede conferma di intento.
   - Se il documento ha `needsReview` o campi mancanti (cliente, P.IVA/CF per fattura), l'emissione è bloccata con elenco errori.
4. Il fallback LLM può **proporre** un `Command` ma non è mai autorizzato a bypassare le conferme; per intent di classe 3 viene ignorato: servono comandi deterministici.

### 4.4 LLM economico (fallback)
- Endpoint `/v1/voice/interpret`: input = trascrizione + elenco dei comandi ammessi + riassunto minimo dello stato (tipo documento, numero righe; **non** invia dati cliente completi), output vincolato a JSON schema (`Command | null`).
- Costo per comando: ~400 token input + ~80 output; con un modello piccolo (famiglia Haiku, circa 1 $/M input e 5 $/M output al mio ultimo dato; **DA VERIFICARE** listino corrente) ≈ **0,0005–0,001 $**. Con 5% di comandi che arrivano al fallback: trascurabile (<0,05 €/utente/mese). Rate-limit 30 chiamate/giorno/utente.
- È un componente **tagliabile**: l'MVP funziona senza (se il classificatore non capisce, mostra le due ipotesi migliori o il campo testo).

### 4.5 Errori di riconoscimento
- Chiedere `maxAlternatives` (n-best) a Web Speech; per server STT confrontare con il vocabolario del catalogo e dei clienti (fuzzy esistente) per correggere nomi.
- Numeri: normalizzazione già presente (`numbers.ts`); per importi/numeri documento **ripetere a voce/in grande a schermo** prima della conferma ("Rossi Mario, milleduecentoventi euro").
- Tre errori consecutivi → proposta automatica di passare al campo testo o alla sintesi vocale di verifica.
- Log locale (senza audio) dei comandi falliti con opt-in per migliorare la grammatica; set di test "frasi reali" cresce nel tempo (`src/voice/cases.ts`).
- Rumore: pulsante "tieni premuto per parlare" (push-to-talk) per ridurre falsi attivi; mai "sempre in ascolto" (privacy + falsi positivi).

---

## 5. Divisione in moduli e ordine di sviluppo

### 5.1 Struttura cartelle (una cartella = un proprietario)
```
shared/            contratto v2: tipi, schemi zod, regole fiscali pure, Command (src/types.ts diventa re-export)
server/            API Hono, db, auth, documenti, fatturapa, sdi, billing, voice
  src/db/  src/auth/  src/documents/  src/fatturapa/  src/sdi/  src/billing/  src/voice/  src/sync/
  migrations/  test/
infra/             docker-compose.yml, Caddyfile, litestream.yml, script deploy/backup/restore
src/sync/          outbox + sync engine + client API (NUOVO)
src/voice/         SpeechProvider, intent classifier, policy, UI conferma (NUOVO)
src/pages/invoice/ emissione, nota di credito, stato SDI (NUOVO)
src/pages/account/ login OTP, abbonamento, dispositivi (NUOVO)
mobile/            progetto Capacitor, CI iOS/Android (fase B)
.github/workflows/ CI
docs/              documentazione
```
Servono modifiche a `package.json` (workspaces/dipendenze server): **un solo agente "INTEGRATORE"** le fa all'inizio di Wave 1, poi nessun altro tocca la root.

Taglia token (indicativa): **S** ≈ <1 $, **M** ≈ 1–3 $, **L** ≈ 3–8 $.

### Wave 0 — Fondamenta (sequenziale, piccola)
| ID | Task | Cartella | Dip. | Costo |
|---|---|---|---|---|
| W0.1 | Workspaces npm, `shared/`, tipi v2 (`Document` con fattura/NC/stato SDI, `Command`, `Entitlement`), regole fiscali pure (totali forfettari, bollo, validazioni), contratto API come schemi zod; `src/types.ts` re-export | `shared/`, root config | – | M |
| W0.2 | Decisione provider SDI + richiesta preventivi (umano) | – | – | 0 (tempo utente) |

### Wave 1 — MVP-fatturazione (parallela; obiettivo: prodotto vendibile)
| ID | Task | Cartella | Dip. | Costo |
|---|---|---|---|---|
| W1.1 | Server base: Hono, SQLite, migrazioni, OTP login, sessioni, middleware tenant, audit, rate-limit, test leakage | `server/src/{db,auth}` | W0.1 | L |
| W1.2 | **Generatore XML FatturaPA** (funzione pura): TD01 e TD04, RF19, natura N2.2, bollo virtuale, dicitura forfettaria, codice destinatario/PEC, validazione XSD ufficiale nei test, golden file | `server/src/fatturapa/` | W0.1 | L |
| W1.3 | Documenti: emissione transazionale, contatori gap-free, immutabilità (trigger), hash chain, nota di credito, regole data cronologica, test di concorrenza | `server/src/documents/` | W1.1 | L |
| W1.4 | Adattatore SDI: interfaccia + MockProvider + adattatore reale, coda `jobs`, webhook esiti, retry | `server/src/sdi/` | W1.2, W1.3 (mock subito) | M |
| W1.5 | Billing: Stripe Checkout/Portal, webhook, `entitlements`, quote (Free: 3 doc/mese, Pro) | `server/src/billing/` | W1.1 | M |
| W1.6 | Infra: Compose, Caddyfile, Litestream, script backup/restore, deploy GitHub Actions, CI test | `infra/`, `.github/` | – | S |
| W1.7 | Client sync: login OTP, outbox, push/pull, indicatore stato sync, migrazione dati locali esistenti verso account | `src/sync/`, `src/pages/account/` | W0.1, W1.1 (contratto; mock server locale) | L |
| W1.8 | Client fattura: emissione con scheda di conferma, filigrana bozza, copia di cortesia PDF da XML, nota di credito, stato SDI, scarica XML | `src/pages/invoice/`, estensione `src/pdf/` | W0.1, W1.7 | M |
| W1.9 | Legale: informativa, Termini, DPA, elenco sub-responsabili, registro trattamenti | `public/legal/`, `docs/privacy/` | – | S |
| W1.10 | SpeechProvider + percorso server STT (iOS PWA) | `src/voice/provider/`, `server/src/voice/` | W1.1 | M |

Gate Wave 1: una fattura TD01 forfettaria da sandbox del provider → consegnata, con NC TD04; ripristino backup riuscito; test leakage verdi.

### Wave 2 — Voce avanzata e rifinitura
| ID | Task | Cartella | Dip. | Costo |
|---|---|---|---|---|
| W2.1 | Intent classifier deterministico + `Command` + corpus di frasi + test | `src/voice/intents/` | W0.1 (indipendente dal server; può iniziare in Wave 1) | M |
| W2.2 | Policy, conferma, undo, UI scheda di conferma | `src/voice/policy/`, `src/voice/ui/` | W2.1, W1.8 | M |
| W2.3 | Fallback LLM `/voice/interpret` | `server/src/voice/` | W2.1, W1.5 (quote) | S |
| W2.4 | Onboarding, empty states, guida "Aggiungi a Home", riepilogo bolli trimestrale | `src/pages/` | W1.8 | S |
| W2.5 | E2E (Playwright) emissione completa + offline | `e2e/` | W1.8 | M |

### Wave 3 — App store (solo dopo validazione)
| ID | Task | Cartella | Dip. | Costo |
|---|---|---|---|---|
| W3.1 | Capacitor: progetto, icone, splash, plugin voce nativo, secure storage | `mobile/` | W1.10 | M |
| W3.2 | CI build iOS (macOS runner) + Android, firma, TestFlight/Play internal | `mobile/`, `.github/` | W3.1 | M |
| W3.3 | Schede store, screenshot, privacy nutrition labels, gestione revisione | `docs/store/` | W3.2 | S |

### Wave 4 — Opzionali (tagliabili)
Passkey; magazzino con giacenze sincronizzate; fatture passive; ritenuta/cassa previdenziale/TD06; multi-utente (commercialista); statistiche; Postgres.

### 5.2 Cosa tagliare per restare nel budget
In ordine di taglio, dal meno doloroso: Wave 4 intera; Sentry; passkey; fallback LLM (W2.3); E2E completi (tenere solo i test di numerazione/XML/leakage); onboarding avanzato; store (W3) finché non c'è domanda; nota di credito da voce (tenerla da UI); trascrizione server solo su iOS (non sostituire Web Speech su Android). **Non tagliare mai**: test di numerazione e XML, backup/restore, leakage tra tenant, conferma emissioni.
Stima totale: Wave 0–1 ≈ **20–32 $** di token; Wave 2 ≈ 6–10 $; Wave 3 ≈ 5–9 $. Se il budget è ~30 $, completare Wave 1 *con* W1.10 ridotto a "solo Web Speech già presente" e rinviare il resto.

### 5.3 Regole per agenti paralleli
- Il contratto sta in `shared/` (proprietà di W0.1); altri agenti lo importano, non lo modificano: segnalano le richieste nel report.
- Server e client si sviluppano contro lo stesso schema zod; il client usa un **mock server** (MSW o `server` avviato in memoria) finché W1.1 non è pronto.
- Ogni task consegna i propri test; la CI blocca i merge senza test verdi.
- Nessun agente tocca `package.json` root: richiede all'INTEGRATORE.

---

## 6. Sicurezza e affidabilità

### 6.1 Rischi principali
| Rischio | Gravità | Mitigazione |
|---|---|---|
| Buco/doppione di numerazione, fattura modificata dopo l'emissione | Altissima (fiscale) | Transazione unica, UNIQUE, trigger anti-update, hash chain, test di concorrenza |
| XML non valido / dati forfettari errati (RF19, N2.2, bollo) → scarti SDI | Alta | Validazione XSD nei test, golden file, revisione di un commercialista sui 3 casi tipici (**DA VERIFICARE** versione schema/specifiche in vigore: fonti discordanti 1.9 / 1.9.1) |
| Perdita dati | Alta | Litestream + snapshot, restore testato mensilmente |
| Leakage tra tenant | Alta | Repository con `TenantCtx`, test automatici, `tenant_id` solo da sessione |
| Comando vocale che emette/annulla per errore | Alta | §4.3 |
| Violazione GDPR (audio a terzi, responsabile senza DPA) | Alta | §1.8 |
| Costi che sfuggono (STT/LLM abusati) | Media | Quote, rate-limit, tetto 30 s, alert su `usage_counters` |
| Dipendenza da un solo provider SDI | Media | Interfaccia `SdiProvider`, fallback "scarica XML" |
| Rifiuto Apple/regole IAP | Media | PWA prima; app iOS senza acquisti in-app |
| Voce iOS standalone non funzionante | Media | Percorso server STT |
| Account takeover (OTP) | Media | Rate-limit, codici monouso, notifica nuova sessione, revoca dispositivi |
| Single point of failure (un VPS) | Media | Backup, runbook di ripristino, RTO dichiarato di ore, non minuti |
| Responsabilità professionale: l'app non è consulenza fiscale | Media | Termini chiari, avvisi nel prodotto, nessuna promessa di correttezza fiscale |

### 6.2 Test da automatizzare (ordine di priorità)
1. **Numerazione**: 1.000 emissioni concorrenti → sequenza 1..N senza buchi/doppi; fallimento a metà transazione → contatore invariato; cambio anno; data cronologica.
2. **Immutabilità**: UPDATE/DELETE su documenti emessi falliscono; catena hash verificabile da script.
3. **XML**: golden file per TD01 forfettario con/senza bollo, TD04, cliente privato/azienda/estero; validazione XSD; arrotondamenti (`roundMoney`).
4. **Isolamento tenant**: matrice endpoint × tenant esterno.
5. **Sync**: idempotenza per `opId`, offline→online, conflitti, tombstone.
6. **Policy comandi**: nessun percorso porta a `emetti`/`annulla` senza conferma (test su tabella di tutte le frasi del corpus); fuzz su trascrizioni rumorose.
7. **Stripe/SDI webhook**: firma errata → 401; replay → idempotente; esito NS → stato `scartato`.
8. **Backup/restore** automatico mensile.
9. **E2E minimo** (Playwright): login → fattura → emissione → stato inviato (provider mock).
10. Sicurezza: dipendenze (`npm audit`), secret scanning, header di sicurezza, rate-limit.

### 6.3 Strategia di rilascio
1. **Staging**: secondo piccolo ambiente (stessa VPS, porta/dominio diversi, DB separato) + provider SDI in **sandbox**.
2. **Beta chiusa**: 5–10 artigiani amici, invio SDI reale solo dopo che il commercialista di riferimento ha visto 3 fatture di prova; flag `sdi_live` per tenant.
3. **Feature flag** per voce server, fallback LLM, store.
4. **Rilascio**: migrazioni SQL in avanti, backup immediato pre-deploy, deploy con rollback (immagine precedente), service worker con versionamento e schermata "aggiornamento disponibile" (nessuna PWA incompatibile con API: `X-Client-Version` e `426` per client obsoleti).
5. **Migrazione dei dati locali esistenti**: al primo login l'app propone di caricare catalogo, clienti e preventivi; le "fatture di cortesia" storiche restano proforma e non vengono numerate come fiscali.
6. **Kill-switch** lato server per emissione/invio SDI in caso di bug fiscale.
7. Dopo il lancio: report settimanale (`npm run report`) con scarti SDI, errori 5xx, costi variabili.

---

## 7. Impatto sul codice esistente (osservazioni)
- `src/types.ts`: va esteso (non rotto). `QuoteDocument.number` e `DocType` restano per i preventivi; nuovi tipi per fattura emessa (immutabile), nota di credito, stato SDI, Command. Mantenere `src/types.ts` come re-export di `shared/`.
- `src/storage/index.ts`: ha già un'astrazione `Backend`. `nextDocumentNumber('fattura')` locale va **disattivata** per le fatture (resta per i preventivi).
- `src/pdf/`: per le fatture il PDF diventa **copia di cortesia dell'XML emesso** (stessi dati, mai ricalcolati); per le bozze filigrana.
- `src/hooks/useSpeech.ts`: diventa un'implementazione di `SpeechProvider` (Web Speech); l'interfaccia pubblica attuale rimane.
- Disallineamento documentale: `ARCHITECTURE.md` indica React 18, `package.json` ha React 19 → aggiornare in documentazione.
- Dalla landing e dai Termini va rimossa la frase "i dati restano sul telefono" per i piani con account (comunicazione veritiera).

## 8. Fatti fiscali da far validare (checklist per il commercialista)
- Dicitura obbligatoria in fattura forfettaria e riferimento normativo (art. 1, commi 54–89, L. 190/2014) e non applicazione della ritenuta (comma 67).
- Codice natura **N2.2**, regime fiscale **RF19**, tipo documento **TD01/TD04** (confermati da più siti di consulenza; **DA VERIFICARE** su fonti AdE).
- Bollo da 2 € oltre 77,47 €, bollo virtuale nell'XML e versamento trimestrale a carico dell'artigiano.
- Numerazione: sezionale per anno, serie separata per note di credito, ritrasmissione con stesso numero dopo scarto.
- Termini di emissione (immediata entro 12 giorni dall'operazione) e obbligo di fattura elettronica per tutti i forfettari (stato attuale esoneri, **DA VERIFICARE**).
- Conservazione 10 anni: soluzione (provider vs servizio AdE).
- Versione corrente di schema e specifiche tecniche (fonti discordanti: 1.9 da aprile 2025; 1.9.1 citata per maggio 2026).

Fonti consultate in questa fase (indicative, secondarie): bugs.webkit.org #225298; developer.apple.com/forums/thread/748048; firt.dev/ios-14.5; github.com/capacitor-community/speech-recognition; aggregatori di prezzi OpenAI (costbench, diyai.io, neowin); siti di consulenza fiscale (centrofiscale.com, fiskaly.com, ecnews.it) per codici RF19/N2.2/TD04. Nessuno è fonte primaria.
