# Operazioni — guida per chi gestisce VocePreventivo (senza essere DevOps)

Questa guida è per **una persona sola** che tiene in piedi il servizio. Non serve sapere programmare: servono un terminale con SSH sul VPS e un po' di abitudine. Per l'installazione iniziale vedi `docs/DEPLOY.md`; qui c'è la vita di tutti i giorni.

> Fiscalità e privacy: l'app è uno strumento di supporto; i tempi di conservazione e le risposte GDPR indicati qui sono **da verificare con il commercialista e con il consulente privacy**.

## 0. Cosa devi sapere in 2 minuti

| Cosa | Dove / comando |
|---|---|
| Collegarsi al server | `ssh deploy@IP_DEL_SERVER` (vedi DEPLOY.md §2) |
| Stato del servizio | `systemctl status vocepreventivo-server` |
| Log | `sudo journalctl -u vocepreventivo-server -n 100 -f` (JSON, senza email né token) |
| Configurazione e segreti | `/etc/vocepreventivo/server.env` (permessi 600, **non** nel repository) |
| Database | `/var/lib/vocepreventivo/vocepreventivo.sqlite` (+ `-wal`, `-shm`) |
| Backup giornalieri | `/var/lib/vocepreventivo/backups/` (14 giorni) + replica Litestream sul bucket |
| Strumento di amministrazione | `admin.sh` (sotto) |

### Lo strumento di amministrazione (`admin.sh`)
Tutto quello che serve all'operatore è un unico comando, da lanciare **sul VPS**:

```bash
sudo -u vocepreventivo /opt/vocepreventivo/current/server/scripts/admin.sh <comando> [opzioni]
```

(Per comodità: `alias vpadmin='sudo -u vocepreventivo /opt/vocepreventivo/current/server/scripts/admin.sh'` nel tuo `~/.bashrc`; negli esempi sotto scrivo `vpadmin`.)
Carica da solo `server.env`, quindi usa lo stesso database e le stesse chiavi del server. Sul tuo PC di sviluppo il comando equivalente è `npx tsx server/scripts/admin.ts <comando>` con `DB_PATH=...`.
`vpadmin help` elenca tutto. **Codici di uscita**: `0` tutto bene · `1` errore o problema grave · `2` solo avvisi · `64` comando scritto male. Se il database non esiste il comando si ferma con un messaggio chiaro (non ne crea uno nuovo per sbaglio).

| Comando | A cosa serve |
|---|---|
| `vpadmin tenants` | elenco clienti: piano, ultimo accesso, documenti del mese (`--cerca testo`, `--json`) |
| `vpadmin info mario@x.it` | dettaglio di un cliente e storico delle azioni amministrative |
| `vpadmin grant-pro <email> --giorni 30` o `--fino-al 2026-12-31` | regala/concede Pro a mano (`--nota "motivo"`) |
| `vpadmin revoke-pro <email>` | toglie la concessione manuale |
| `vpadmin export-tenant <email>` / `delete-tenant <email>` | richieste GDPR |
| `vpadmin stats` | numeri del servizio (utenti attivi, documenti, fatture, conflitti, errori) |
| `vpadmin integrity-check` | controlla il database (corruzione, trigger, numerazione fatture) |
| `vpadmin backup` / `restore-test` | backup a caldo / prova di ripristino |
| `vpadmin rotate-key` | cambio della chiave di cifratura (§9) |
| `vpadmin create-invite-code` | codici invito per il lancio privato (§4) |

---

## 1. Routine

### Ogni giorno (5 minuti, meglio se al mattino)
1. **Servizio vivo**: apri `https://app.tuodominio.it/health/deep` (o guarda l'avviso del monitor, §6). Deve dire `"status":"ok"`. `degraded` = qualcosa da guardare oggi; `fail` (HTTP 503) = intervieni subito (§7).
2. **Numeri**: `vpadmin stats`. Guarda la riga *Errori* (idealmente 0 nelle ultime 24 ore) e *Job SDI* (se compare `dead`, una fattura non è stata inviata: guarda §7.6).
3. **Posta di supporto**: rispondi alle richieste (vedi `docs/FAQ-SUPPORTO.md`). Una richiesta GDPR ha una scadenza (§5).

### Ogni settimana (15 minuti)
1. `vpadmin integrity-check` → deve finire con «Tutto in ordine». Un **AVVISO** sui buchi nella numerazione può essere solo un dispositivo che non ha ancora sincronizzato: se dopo qualche giorno c'è ancora, scrivi al cliente (la numerazione è assegnata dal suo dispositivo; non si "ripara" a mano).
2. **Backup**: `ls -lh /var/lib/vocepreventivo/backups | tail -3` (file di ieri e di oggi) e, nel pannello del bucket, file Litestream recenti.
3. **Disco**: `df -h /var/lib/vocepreventivo` (sotto l'80%).
4. **Aggiornamenti di sicurezza**: se esiste `/var/run/reboot-required`, pianifica un riavvio in un orario tranquillo (`sudo reboot`; il servizio riparte da solo e chiude il database in modo ordinato).
5. Licenze regalate in scadenza: `vpadmin tenants | grep manuale`.

### Ogni mese (30 minuti)
1. **Prova di ripristino vera**: `vpadmin restore-test` (copia fresca) e `vpadmin restore-test /var/lib/vocepreventivo/backups/vocepreventivo-XXXX.sqlite.gz` (l'ultimo backup giornaliero). Deve finire con «ESITO: OK». Il timer mensile di DEPLOY.md §8 fa lo stesso sul bucket: controlla `systemctl --failed`. *Un backup mai provato non è un backup.*
2. **Copia fuori sede**: scarica l'ultimo backup sul tuo PC (cifrato o su disco cifrato) o verifica lo snapshot del VPS dal pannello del provider.
3. **Segreti e accessi**: nessun `CHANGE_ME` in `server.env`; chiavi SSH ancora solo le tue; revisione di chi ha accesso al bucket.
4. **Aggiornamenti**: applica gli aggiornamenti del repository (§8).
5. **Costi** (VPS, bucket, SMTP, Stripe) e **piano** degli utenti: `vpadmin stats` (Pro Stripe / Pro manuale / Free).

---

## 2. Cosa vedere guardando `vpadmin stats`
```
Clienti:     42 attivi (3 cancellati) · Pro Stripe 5 · Pro manuale 2 · Free 35
Utenti:      45 registrati · attivi 7 giorni 18 · attivi 30 giorni 31 · nuovi 7g 4 / 30g 12
Documenti:   310 totali · creati questo mese 66 · preventivi 190 · bozze fattura 12
Fatture:     108 emesse (23 negli ultimi 30 giorni) · 2 scartate dallo SDI
Conflitti sync 7g:  quota_exceeded: 9, stale: 2
Job SDI:     done: 40, dead: 1
Errori:      0 nelle ultime 24 ore · 1 negli ultimi 7 giorni
```
- **quota_exceeded** alto = clienti Free che toccano il limite di 3 documenti al mese: sono i candidati naturali all'abbonamento (o a una prova regalata).
- **stale / locked_document** occasionali sono normali (due dispositivi che modificano la stessa cosa). Se aumentano all'improvviso, c'è un client con l'orologio sballato o un bug: segnalalo agli sviluppatori.
- **duplicate_invoice_number**: due dispositivi hanno emesso lo stesso numero offline. Il secondo è stato rifiutato e il cliente vede il conflitto nell'app. Non toccare il database.
- **Errori**: ogni riga mostra data, rotta e nome dell'errore (mai dati dei clienti). Con il nome e la rotta, gli sviluppatori trovano la causa nei log (`journalctl`, cerca l'ora indicata).

---

## 3. Concedere una licenza Pro a mano (prova, regalo, assistenza, pagamento fuori Stripe)

```bash
vpadmin grant-pro mario@example.it --giorni 30 --nota "prova per Mario, concordata via mail"
vpadmin grant-pro mario@example.it --fino-al 2026-12-31 --nota "bonifico ricevuto 04/11"
vpadmin info mario@example.it        # vedi piano e storico
vpadmin revoke-pro mario@example.it  # annulla prima della scadenza
```
- Il cliente deve **aver già fatto il primo accesso** (altrimenti: «Nessun utente con email …»). Chiedigli di registrarsi, poi concedi.
- `--fino-al AAAA-MM-GG` è **inclusivo**: la licenza vale per tutto quel giorno (UTC). Massimo 10 anni. Una nuova concessione **sostituisce** la precedente (anche accorciandola).
- Scade **da sola**: non devi ricordarti di toglierla. Non serve riavviare nulla, il cliente la vede al successivo refresh dell'app.
- Ogni concessione/revoca è scritta in un registro **che non si può modificare né cancellare** (`admin_actions`) con data, chi l'ha fatta (utente di sistema), scadenza e nota. Nel registro non c'è l'email del cliente, solo l'identificativo interno.

**Precedenza tra licenza manuale e abbonamento Stripe** (regola unica): il piano effettivo è il **più favorevole** dei due.
- Un evento Stripe (disdetta, pagamento fallito, rinnovo…) **non cancella né accorcia** la concessione manuale; la concessione manuale **non tocca** lo stato di Stripe.
- `revoke-pro` toglie **solo** la concessione manuale: se il cliente paga con Stripe resta Pro (il comando te lo dice).
- Esempio: Mario ha una concessione fino al 31/12 e disdice Stripe a ottobre → resta Pro fino al 31/12. Se invece la concessione scade a ottobre ma Stripe è attivo → resta Pro per Stripe.
- Un cliente con sola concessione manuale non ha un «abbonamento da gestire»: l'app mostra Pro senza portale di pagamento, e può comunque abbonarsi in qualsiasi momento.

---

## 4. Lancio privato con codici invito (facoltativo)
Per aprire il servizio a poche persone invitate:
1. In `/etc/vocepreventivo/server.env` aggiungi `INVITE_ONLY=1`, poi `sudo systemctl restart vocepreventivo-server`.
2. Crea i codici: `vpadmin create-invite-code --quanti 5 --giorni 14 --nota "beta artigiani"` (oppure `--email lei@x.it` per un codice valido solo per quell'indirizzo).
3. Mandali alle persone (vedi i codici **una sola volta**: nel database resta solo l'impronta).
4. Controllo: `vpadmin invite-codes` (disponibile / usato / scaduto); `vpadmin revoke-invite VP-XXXX-XXXX-XXXX` per annullarne uno non usato.

Il codice serve **solo per creare un account**; chi ha già un account accede come sempre. Ogni codice si usa una volta. Per riaprire a tutti: togli `INVITE_ONLY=1` e riavvia. *Nota per i client*: la schermata di accesso deve mostrare un campo «codice invito» e inviarlo come `inviteCode` a `POST /v1/auth/verify` (il server risponde `403 invite_required` / `invite_invalid` senza consumare il codice OTP).

---

## 5. Richieste GDPR (accesso, portabilità, cancellazione)
**Prima di tutto**: verifica che la richiesta arrivi dall'indirizzo email dell'account (o dall'app, dopo il login). Il termine di risposta è in genere **un mese** (da verificare con il consulente privacy). Annota data e esito.

### Export («dammi i miei dati»)
Il cliente può farlo da solo (l'API `GET /v1/me/export` esiste; la pagina Account dell'app la usa se la funzione è esposta). Se chiede a te:
```bash
cd /tmp && vpadmin export-tenant mario@example.it --out /tmp/export-mario.json
```
Il file (JSON, permessi 600) contiene account, profilo, catalogo, documenti, dispositivi, consumi, accettazioni, registro. Invialo **con un canale sicuro** (link protetto, file cifrato; mai allegato in chiaro) e **cancellalo subito** (`shred -u /tmp/export-mario.json`).

### Cancellazione («cancella il mio account»)
```bash
vpadmin delete-tenant mario@example.it
```
Il comando riassume cosa succederà e chiede di **riscrivere l'email** per confermare. Regole (identiche a quelle del pulsante nell'app):
- **Sempre eliminati**: sessioni, dispositivi, profilo, catalogo, **bozze e preventivi**, log di sincronizzazione, utente (l'email torna libera).
- **Fatture emesse**: per obbligo di conservazione (10 anni, **da verificare col commercialista**) **restano**. In quel caso l'account viene *anonimizzato* (nessun nome, nessun login possibile, nessun utente). Se non ce ne sono, il cliente viene **eliminato del tutto**.
- **Restano sempre** (pseudonimi): il registro audit e la prova di accettazione di Termini/DPA.
- **Abbonamento Stripe attivo**: il comando si rifiuta. Annullalo prima dal pannello Stripe (o chiedi al cliente di farlo dal portale), oppure usa `--ack-subscription` e **poi annulla a mano** su Stripe, altrimenti continua ad addebitare.
- **Backup**: contengono i dati fino alla scadenza della retention (14 giorni per i backup locali e Litestream). Va scritto nell'informativa e comunicato al cliente. Non si modificano i backup a mano.
- Per script e automazioni esiste `--conferma <email>` al posto della domanda interattiva.
Ogni cancellazione ed export è registrata in `admin_actions`. Ricordati di rispondere al cliente.

---

## 6. Monitoraggio: `/metrics`, `/health/deep`, uptime

### Avviso «è giù» (obbligatorio, gratuito)
Su UptimeRobot / Better Stack crea un monitor **HTTPS ogni 5 minuti** su `https://app.tuodominio.it/health/deep` con controllo della parola chiave `"status":"ok"` (così ti avvisa anche per `degraded`/`fail`) e un secondo, più semplice, su `/health`. Avviso email/Telegram se giù da più di 2 minuti.

`/health/deep` controlla: **db_write** (il database accetta scritture; solo con token, vedi sotto), **migrations** (schema aggiornato), **disk** (spazio libero: `degraded` sotto 1 GB o 10%, `fail`/503 sotto 200 MB o 3%), **backup** (età dell'ultimo file in `BACKUP_DIR`; `degraded` oltre 36 ore), **maintenance** (pulizia periodica in corso). Senza token mostra solo ok/warn/fail; con `Authorization: Bearer $METRICS_TOKEN` anche i numeri:
```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://app.tuodominio.it/health/deep
```
**Senza token l'endpoint è di sola lettura** (nessuna scrittura sul database: al posto di `db_write` c'è `db_read`) e ha un rate-limit per IP in memoria (`RL_HEALTH_DEEP_PER_MIN`, default 30/min): non può essere usato per consumare disco o I/O. **Con token valido** esegue anche la scrittura di prova, ma il risultato resta in cache `HEALTH_CACHE_MS` (default 5 secondi, 0 = nessuna cache) e c'è un limite per IP (`RL_HEALTH_DEEP_AUTH_PER_MIN`, default 120/min): al massimo una scrittura ogni 5 secondi, qualunque sia il traffico. Per il monitor esterno scegli: *senza token* (basta a vedere giù/migrazioni/disco/backup/manutenzione; il DB «pieno» emerge comunque dalla manutenzione oraria che scrive, `maintenance` diventa `warn` dopo 3 ore) oppure *con token* per la prova di scrittura completa (consigliato se il monitor non è pubblico). Durante l'arresto risponde sempre 503 subito (la cache non lo nasconde).

### Metriche (facoltative, per chi vuole i grafici)
1. Genera un token: `openssl rand -hex 24` e mettilo in `server.env` come `METRICS_TOKEN=...`; riavvia. **Senza token (o con meno di 16 caratteri) `/metrics` non esiste** (risponde 404).
2. Provalo: `curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://app.tuodominio.it/metrics | head -40`.
3. Collega Grafana Cloud (gratuito) o un Prometheus: target `app.tuodominio.it`, `scheme: https`, `metrics_path: /metrics`, `authorization: { type: Bearer, credentials: <token> }`.
4. Il token è un segreto: non metterlo in chat, in git o in URL (in query string **non** funziona, di proposito).

Le metriche **non contengono dati personali** (nessuna email, token, codice OTP, indirizzo IP, id di cliente o documento): solo conteggi per rotta, stato e motivo.

| Metrica | Come leggerla | Quando preoccuparsi |
|---|---|---|
| `vp_db_up` | 1 = il DB risponde | `0` |
| `vp_http_requests_total{route,method,status}` | richieste per rotta | molti `status="5xx"`; salto di `429` (limiti di frequenza: attacco o client impazzito) |
| `vp_http_request_duration_seconds` | latenza per rotta (istogramma) | p95 > 1 s costante |
| `vp_errors_total{kind}` | errori interni (500) | `> 0` ripetuto: guarda `vpadmin stats` e i log |
| `vp_sync_push_ops_total{result}`, `vp_sync_conflicts_total{reason}` | operazioni accettate/in conflitto | `stale`/`locked_document` in crescita improvvisa |
| `vp_quota_exceeded_total` | rifiuti per quota Free | alto = opportunità commerciale |
| `vp_sdi_jobs{status}`, `vp_sdi_jobs_processed_total` | coda SDI | `dead > 0`, `queued` che cresce |
| `vp_active_users{window}`, `vp_users`, `vp_tenants` | utenti attivi 1/7/30 giorni | andamento |
| `vp_tenants_by_stripe_plan`, `vp_manual_grants_active` | piani | — |
| `vp_signups_total`, `vp_logins_total`, `vp_otp_requests_total` | accessi | molte richieste OTP e pochi login = problema email (SMTP) |
| `vp_db_size_bytes`, `vp_db_free_bytes`, `vp_db_wal_bytes` | dimensioni | WAL che cresce senza fermarsi (> 500 MB): vedi §7.3 |
| `vp_last_backup_age_seconds` | età dell'ultimo backup | > 129600 (36 ore) |
| `vp_last_housekeeping_timestamp_seconds` | ultima pulizia automatica | più di 3 ore fa |
| `vp_process_resident_memory_bytes` | memoria | vicino al limite di 768 MB del servizio |

I contatori ripartono da zero a ogni riavvio (normale: Prometheus lo gestisce).

### Cosa fa il server da solo (manutenzione)
Ogni ora: elimina sessioni scadute, codici OTP, contatori dei limiti, eventi di fatturazione e job SDI completati vecchi, bozze/preventivi/voci di catalogo già eliminati (dopo 180 giorni), errori vecchi, inviti scaduti; fa un `wal_checkpoint(PASSIVE)` (non blocca nessuno). Una volta al giorno `PRAGMA optimize`. **Mai** tocca le fatture emesse. Pota anche l'audit non fiscale (§7bis), toglie le righe scadute di difesa OTP e aggancia alla catena fiscale le fatture emesse non ancora presenti. Il `VACUUM` (compattazione del database) è **spento** di default perché riscrive tutto il file e Litestream deve ricopiarlo; accendilo solo se il database ha molto spazio inutilizzato (`vp_db_free_bytes`): `MAINTENANCE_VACUUM=1` in `server.env` (agisce alle 03:00 UTC, al massimo ogni 7 giorni, solo se serve e c'è spazio su disco).

---

## 7. Quando qualcosa va storto

**Regola d'oro**: prima di toccare qualunque cosa, `vpadmin backup` (se il server è su) oppure copia il file del database a servizio fermo. Poi un cambiamento alla volta.

### 7.1 Il server è giù (il monitor ti ha avvisato)
1. `curl -i https://app.tuodominio.it/health`: se risponde ma il sito no → problema Caddy (`systemctl status caddy`, `journalctl -u caddy -n 50`; spesso certificato o DNS).
2. `systemctl status vocepreventivo-server` e `sudo journalctl -u vocepreventivo-server -n 100`.
3. Fermato per errore? `sudo systemctl restart vocepreventivo-server`, poi `curl -s http://127.0.0.1:8787/health/deep`.
4. Si riavvia in loop? Cerca nel log la riga `"event":"uncaught_exception"` o un errore di configurazione (`AUTH_SECRET`, `SMTP_URL`, `APP_ENCRYPTION_KEY`: il server rifiuta di partire se mancano o sono invalide). Se hai appena modificato `server.env`, annulla la modifica.
5. Se è dopo un aggiornamento: rollback (§8).
6. VPS non risponde del tutto → pannello del provider, riavvio dal pannello; se persiste, ripristino su nuovo VPS (DEPLOY.md §8, «Se il server è perso»).
7. Intanto l'app **continua a funzionare** sui dispositivi (i dati sono locali): solo la sincronizzazione aspetta. Puoi scrivere agli utenti che non perdono nulla.

### 7.2 Disco pieno
Sintomi: `/health/deep` → `disk` in `fail`/`warn` oppure `db_write` in `fail`; errori «disk full» nei log.
1. `df -h` e `sudo du -xh /var/lib/vocepreventivo /var/log --max-depth=1 | sort -h | tail`.
2. Libera spazio **senza toccare il database**: `sudo journalctl --vacuum-size=200M`; vecchi backup oltre 14 giorni in `/var/lib/vocepreventivo/backups` (`sudo find /var/lib/vocepreventivo/backups -type f -mtime +14 -print -delete`); `sudo apt clean`.
3. **Non** cancellare `*.sqlite-wal` / `*.sqlite-shm` a mano a server acceso (contengono scritture non ancora integrate).
4. Se la causa è il WAL enorme: `sudo systemctl restart vocepreventivo-server` (la chiusura ordinata integra il WAL) e controlla che Litestream sia attivo (`systemctl status vocepreventivo-litestream`): se la replica è ferma, il WAL non si può ridurre.
5. Se serve più spazio: ingrandisci il disco dal pannello del provider.
6. Dopo: `vpadmin integrity-check`.
Evita di lanciare `VACUUM` con il disco quasi pieno (serve fino al doppio dello spazio del database).

### 7.3 Database corrotto o dati strani
Sintomi: errori «database disk image is malformed», `integrity-check` con `ERRORE`, `/health/deep` → `db_write` fail con disco libero.
1. **Non cancellare niente.** `sudo systemctl stop vocepreventivo-server` (e `vocepreventivo-litestream`, per non replicare un file rovinato).
2. Metti da parte il file: `sudo cp -a /var/lib/vocepreventivo/vocepreventivo.sqlite* /root/db-corrotto-$(date +%F)/` (serve a capire cos'è successo).
3. Prova prima di tutto che sia davvero corrotto: `vpadmin integrity-check --file /root/db-corrotto-.../vocepreventivo.sqlite`.
4. **Ripristino**, sempre prima in prova (DEPLOY.md §8):
   ```bash
   cd /opt/vocepreventivo/current/infra/scripts
   sudo -u vocepreventivo ./restore.sh litestream --test                 # ultimo stato replicato
   sudo -u vocepreventivo ./restore.sh litestream --at 2026-11-04T08:00:00Z --test   # un momento PRIMA del guasto
   sudo ./restore.sh litestream --live --yes                             # sostituisce il DB (il vecchio resta come .before-restore-...)
   ```
   In alternativa dal backup giornaliero: `restore.sh snapshot /var/lib/vocepreventivo/backups/vocepreventivo-XXXX.sqlite.gz --live --yes`.
5. Riavvia (`systemctl start vocepreventivo-server vocepreventivo-litestream`) e verifica: `vpadmin integrity-check`, `curl -s http://127.0.0.1:8787/health/deep`, `vpadmin stats`.
6. **Cosa si è perso**: le modifiche fatte tra il momento del ripristino e il guasto. L'app è *local-first*: i dispositivi dei clienti hanno ancora i loro dati e li rimandano alla sincronizzazione successiva. Le fatture emesse in quell'intervallo tornano tramite sync; se due dispositivi avevano riusato numeri, il server segnala conflitto di numerazione (`duplicate_invoice_number`) e il cliente lo vede nell'app. Avvisa i clienti più attivi e controlla `vpadmin integrity-check` nei giorni seguenti (buchi nella numerazione). *(Procedura da verificare con una simulazione prima del lancio.)*
7. Se anche i backup sono inutilizzabili: `restore-test` sui file più vecchi per trovare l'ultimo buono, e chiedi aiuto agli sviluppatori **prima** di qualsiasi azione distruttiva.

### 7.4 Le email di accesso non arrivano
Sintomo: `vp_otp_requests_total` sale ma `vp_logins_total` no; i clienti scrivono «non mi arriva il codice». Nei log compare `"error":"mail_failed"`. Controlla `SMTP_URL`/credenziali del fornitore, la quota giornaliera, lo spam. Il server non registra mai il codice né l'indirizzo.

### 7.4b Un cliente «non riesce ad entrare» e ci sono molti `429` sul login (difesa OTP)
Sintomo: `vp_otp_cooldowns_total` / `vp_otp_locked_total` salgono, un cliente scrive che il codice «non funziona» o che deve aspettare. Significa che l'indirizzo è sotto un tentativo di indovinare il codice da molti IP (o che il cliente ha sbagliato più di 10 volte in 24 ore). Il cliente continua a **ricevere** i codici (l'invio non è mai bloccato), le sue sessioni già aperte restano valide, e dalle reti da cui ha già fatto un accesso (casa, ufficio, ultimi 30 giorni, max 5) entra normalmente. Se è bloccato da una rete nuova e vuoi sbloccarlo subito: `vpadmin otp-unlock cliente@example.it` (se l'attacco continua il blocco si riattiva da solo). Vedi «Difesa OTP» sotto.

### 7.5 Molti errori `429` (troppe richieste)
Un indirizzo o un client sta superando i limiti. Se è un attacco, i limiti già proteggono; se invece **tutti** i clienti ricevono 429, probabilmente `TRUST_PROXY` non è corretto e tutti sembrano lo stesso IP (nei log: `xff_ignored_public_peer`). Vedi `server/README.md` (TRUST_PROXY).

### 7.6 Fatture bloccate sullo SDI (`dead`)
`vpadmin stats` mostra `dead: N`. Significa che l'invio automatico è fallito più volte. Se il provider SDI non è attivo (versione attuale: invio manuale dal portale dell'Agenzia delle Entrate) non dovrebbero esserci job. Altrimenti: controlla le credenziali del provider e avvisa il cliente di scaricare l'XML e inviarlo a mano dal portale gratuito.

### 7.7 Chiave di cifratura persa
Senza `APP_ENCRYPTION_KEY` i campi cifrati (anagrafica clienti, note, XML) **non si recuperano**. Per questo: copia in un gestore password, mai solo sul server. `vpadmin integrity-check` segnala «righe cifrate NON leggibili» se la chiave configurata è sbagliata: **non** riavviare con una chiave nuova senza averla prima impostata come descritto in §9.

### 7.8 Sospetta violazione di dati
Isola (ferma il servizio se serve), conserva i log (`sudo journalctl -u vocepreventivo-server --since "7 days ago" > /root/log.txt`), ruota i segreti (`infra/scripts/rotate-secrets.md`) e contatta il consulente privacy: una violazione di dati personali va notificata al Garante **entro 72 ore** dalla scoperta (da verificare con il consulente).

---

## 7bis. Difesa dall'attacco OTP distribuito, retention dell'audit, catena fiscale (riferimento)

### Difesa OTP (`src/auth/guard.ts`, `src/auth/service.ts`)
**Minaccia**: un attaccante con molti indirizzi IP chiede codici per l'email della vittima e prova a indovinarli. I limiti per IP e per coppia email+IP non lo fermano (ogni IP sbaglia poco), e il vecchio tetto globale (15 verifiche ogni 10 minuti) si azzerava continuamente.

**Difese combinate** (tutte attive di default, parametri in `server/.env.example`):
1. **Codice a 8 cifre** (`OTP_DIGITS`, default 8; 6 per compatibilità con i client che inseriscono solo 6 cifre).
2. **Tetto di tentativi per codice** (`OTP_MAX_ATTEMPTS`, default 5), somma di tutti gli IP: al sesto il codice è invalidato anche se poi arriva quello giusto (la vittima ne richiede un altro: l'invio non è bloccato).
3. **Cooldown crescente globale per email** sulle sole *verifiche*: dopo `OTP_GUARD_FREE_FAILS` (10) errori in 24 ore, da qualunque IP, ogni nuovo errore blocca le verifiche per 2, 4, 8 ... fino a 120 minuti (`OTP_GUARD_BASE_MIN`, `OTP_GUARD_MAX_MIN`). Durante il blocco il codice **non viene valutato** (nessun tentativo regalato). 24 ore senza errori azzerano il contatore; un login riuscito *non* lo azzera (altrimenti ogni accesso legittimo regalerebbe una finestra nuova).
4. **Corsia delle reti note**: chi ha già completato un accesso da una rete (HMAC di email e rete, max 5 per email, 30 giorni) non subisce il cooldown globale né il tetto dei 10 minuti. Così un attacco distribuito **non può chiudere fuori il proprietario** che accede da casa o dall'ufficio. Restano per lui il backoff per coppia email+IP e il tetto per codice. Le righe contengono solo HMAC (mai email o IP in chiaro) e si cancellano con l'account.
5. **Avviso al proprietario**: a `OTP_ALERT_FAILS` (8) errori l'account riceve una email «qualcuno sta tentando di accedere» (senza codici, al massimo una ogni 24 ore, solo per account esistenti: il servizio non manda email a indirizzi inventati; fallimenti SMTP ignorati).
6. Invariato: il tetto di richieste di codice per email/coppia/IP e i 3 codici attivi in contemporanea.

**Calcolo della probabilità di successo** (una verifica valutata confronta il tentativo con al più 3 codici attivi: P per tentativo ≤ 3/10^cifre):

| Scenario | Tentativi valutati | Successo/giorno | Successo in 30 giorni |
|---|---|---|---|
| Prima: 6 cifre, 10 tentativi/codice, 10 richieste/ora (2.400 coppie codice-tentativo/giorno) | ~2.400/giorno | ~0,24 % | ~7 % |
| Ora, `OTP_DIGITS=6` (compatibilità) | primo giorno ≤ 27, poi 12/giorno → ≈ 375 in 30 giorni | 8,1·10⁻⁵ (0,008 %) il primo giorno, 3,6·10⁻⁵ poi | ≈ 1,1·10⁻³ (**0,11 %**) |
| Ora, `OTP_DIGITS=8` (default) | come sopra | 8,1·10⁻⁷ il primo giorno, 3,6·10⁻⁷ poi | ≈ 1,1·10⁻⁵ (**0,0011 %**) |

Come si ottiene: i primi 10 errori sono gratuiti; poi i blocchi 2+4+8+16+32+64 minuti = 126 minuti consentono 6 tentativi, e da lì ogni 120 minuti un tentativo (12 al giorno a regime, il contatore non si azzera finché l'attacco continua): 10 + 6 + ⌊(1440−126)/120⌋ ≈ 27 il primo giorno (verificato dal test `otp-distributed`: ≤ 30 contro ~2.000 senza la difesa), 12 al giorno poi; in 30 giorni 27 + 29·12 = 375; × 3 codici attivi = 1.125 coppie su 10⁶ (6 cifre) o 10⁸ (8 cifre). Riduzione rispetto a prima: ~60× con 6 cifre, ~6.000× con 8 cifre.

**Trade-off (da sapere)**: un cooldown per email è anche una leva di DoS sul *login da reti nuove*: durante un attacco distribuito *continuo* il proprietario che accede da una rete mai usata riesce a farlo solo nelle finestre in cui il cooldown scade (e l'attaccante le consuma per prime). Lo limitano: l'invio dei codici non è mai bloccato; le sessioni aperte restano valide; le reti note sono esenti; l'avviso email lo informa; `vpadmin otp-unlock` sblocca l'assistenza. Il costo per l'attaccante è alto (molti IP per un guadagno quasi nullo); il rischio opposto (presa di controllo) è ridotto di 3-4 ordini di grandezza. Alternative scartate: bloccare anche l'invio (DoS puro sulla vittima), bloccare per sempre dopo N errori (DoS permanente), CAPTCHA (dipendenza esterna). Il vero rimedio definitivo sono le passkey (futuro). **Per il client**: con `OTP_DIGITS=8` serve che `src/pages/account/LoginForm.tsx` accetti 8 cifre; fino ad allora impostare `OTP_DIGITS=6`.

### Audit: retention (`src/db/audit.ts`)
- Ogni voce ha una **classe** decisa dal server (`audit_log.retain`): **1 = fiscale** (voci su una fattura *davvero emessa* — verificato lato server, non basta dichiararlo —, eventi SDI, accettazione Termini/DPA, cancellazione/esportazione account) e **0 = non fiscale** (`voice_command`, bozze e preventivi, catalogo, profilo, accessi, voci del client non collegate a una fattura emessa).
- Le **fiscali non si eliminano mai** (conservazione per obbligo, 10 anni da verificare col commercialista). Per evitare che diventino un modo di riempire il disco, le voci fiscali per singolo documento hanno un tetto (`AUDIT_MAX_FISCAL_PER_DOC`, 200): oltre, le nuove sono potabili.
- Le **non fiscali** dopo `AUDIT_RETENTION_DAYS` (default 365; orologio del *server*, non la data dichiarata dal client) sono **aggregate** in `audit_daily` (tenant, giorno, azione, conteggio: nessun contenuto) e **cancellate**, dalla manutenzione oraria, a blocchi. In più c'è un **tetto per tenant** (`AUDIT_MAX_ROWS_PER_TENANT`, default 50.000, ~10 MB): le voci non fiscali più vecchie in eccesso vengono potate anche se recenti. Insieme al tetto giornaliero di ingresso (`RL_AUDIT_PER_DAY`), la crescita per tenant è limitata.
- **Append-only intatto**: `UPDATE` resta vietato; `DELETE` è ammesso dal trigger *solo* per righe non fiscali più vecchie del limite scritto in `audit_prune_ctl`, riga che esiste soltanto dentro la transazione di potatura (se la transazione fallisce sparisce con lei). Una riga fiscale non si cancella nemmeno con quel permesso aperto (test).
- Chi ha accesso diretto al file DB può comunque aggirare qualunque trigger: la difesa è la catena fiscale (sotto) e i backup.
- Cancellazione dell'account: l'audit resta (pseudonimo) con la stessa regola; il crypto-shredding per tenant (chiavi per tenant) resta una proposta futura.

### Fatti fiscali dichiarati dal client: proposta di mitigazione e catena di hash (`src/db/chain.ts`)
**Limite**: il server non può sapere se una fattura è davvero stata emessa o se un esito SDI registrato a mano è vero (`lockedAt`, `sdiEvents` li dichiara il client; lo SDI in v1 non è collegato).
**Proposta realistica (in ordine di costo)**:
1. *(fatto)* Stato successivo all'emissione senza `invoice.lockedAt` (e non `legacy`) → rifiutato (`invalid`): il server non tiene mai una fattura «emessa» modificabile.
2. *(fatto)* **Catena di hash per tenant sulle emissioni**: alla prima ricezione di una fattura emessa il server aggiunge una riga (`fiscal_chain`: n progressivo senza buchi, documento, serie/anno/numero, `lockedAt` dichiarato, **orario di ricezione del server**, hash precedente, hash = SHA-256 dei campi). Append-only per trigger. `vpadmin integrity-check` verifica continuità, hash e corrispondenza con le fatture presenti (una fattura cancellata, rinumerata o riordinata a DB spento dà ERRORE) e stampa il **SIGILLO** (digest di tutte le teste di catena).
3. *(procedura)* **Sigillo periodico fuori dal server**: ogni settimana/mese copia la riga «SIGILLO» di `integrity-check` (o `--json`, campo `chain.digest`) in un posto che il server non può modificare (email a te stesso, nota nel gestionale, repository privato). Una catena riscritta per intero si smaschera confrontandola con un sigillo esterno più vecchio. Il backup mensile può includerlo.
4. *(futuro)* Ammettere il rinvio dopo «scartata» solo con un NS ricevuto dal provider SDI; numerazione assegnata dal server (CONTRACT-V2: futuro).
La catena **non dimostra che l'emissione sia fiscalmente vera**: attesta *cosa* il server ha ricevuto e *quando*. Le fatture emesse prima dell'introduzione della catena vengono agganciate all'avvio e dalla manutenzione, marcate `legacy`. Per la procedura manuale di purge decennale delle fatture (sospendere i trigger) vanno sospesi anche `trg_fiscal_chain_*` e la riga di catena va rimossa nella stessa operazione; poi `integrity-check` deve tornare pulito.

### SMTP
`SMTP_REQUIRE_TLS=1` è il valore consigliato e quello di `.env.example`: se il server di posta non offre STARTTLS il server **non invia** (né password SMTP né codici OTP in chiaro). In produzione, se la variabile manca, il default del codice è già 1. Usare 0 solo per un SMTP di prova locale.

---

## 8. Aggiornare il servizio
1. **Prima** un backup e una prova: `vpadmin backup` e `vpadmin restore-test`.
2. Esegui il deploy come da DEPLOY.md (§6/§7): workflow «Deploy produzione» su GitHub oppure `deploy-nodocker.sh`. Il deploy fa un backup di sicurezza, cambia il link `current`, riavvia e controlla `/health`; se il controllo fallisce **torna da solo** alla versione precedente.
3. All'avvio il server applica le **migrazioni** del database (solo «in avanti»). Dopo l'aggiornamento verifica:
   ```bash
   curl -s http://127.0.0.1:8787/health/deep     # "migrations": "ok"
   vpadmin integrity-check
   vpadmin stats
   ```
4. Rollback manuale del codice: DEPLOY.md §7. **Attenzione**: tornare alla versione precedente non annulla le migrazioni; se una migrazione ha dato problemi, ripristina il backup pre-deploy (§7.3) e chiedi agli sviluppatori.
5. Durante il riavvio il server chiude **in modo ordinato** (entro 10 secondi): nuove richieste ricevono 503 per un istante, quelle in corso finiscono, il database viene chiuso. Con systemd lascia `TimeoutStopSec=20`.
6. Nuove variabili d'ambiente: leggi `server/.env.example` (ogni variabile è commentata) e aggiungi a `server.env` solo quelle che ti servono.

---

## 9. Chiavi e segreti
- **`APP_ENCRYPTION_KEY`** (cifratura dei dati sensibili). Rotazione, **con un backup prima**:
  1. `openssl rand -base64 32` → nuova chiave.
  2. In `server.env`: `APP_ENCRYPTION_KEY=<nuova>`, `APP_ENCRYPTION_KEY_ID=k2`, `APP_ENCRYPTION_OLD_KEYS="k1:<vecchia>"`. Riavvia (nessun fermo: le nuove scritture usano `k2`, le vecchie si leggono ancora).
  3. Simulazione: `vpadmin rotate-key --report`. Poi `vpadmin rotate-key` (fa da solo un backup, poi ricifra bozze, preventivi, profili e log di sync). Le **fatture emesse** si ricifrano solo con `--include-locked` (sospende per un attimo la protezione di immutabilità, in transazione: farlo solo se serve, con un backup).
  4. Quando il comando dice che nessun dato usa più le chiavi vecchie, e hai archiviato o scaduto i backup che ne dipendono, togli la vecchia chiave da `OLD_KEYS`. Il registro audit (non modificabile) resta con la chiave originale: **conservala**.
- **`AUTH_SECRET`**: cambiarlo invalida i codici OTP in corso (nessun danno: se ne richiede un altro).
- **`METRICS_TOKEN`**: cambia quando vuoi; aggiorna il collettore.
- Rotazione di tutti i segreti: `infra/scripts/rotate-secrets.md`. Mai segreti in chat o nel repository.

---

## 10. Riferimento rapido

| Voglio… | Comando |
|---|---|
| Vedere i clienti | `vpadmin tenants` |
| Regalare 30 giorni di Pro | `vpadmin grant-pro <email> --giorni 30 --nota "..."` |
| Sapere se il database è sano | `vpadmin integrity-check` |
| Fare un backup ora | `vpadmin backup` |
| Provare che i backup funzionano | `vpadmin restore-test` |
| Rispondere a una richiesta GDPR | `vpadmin export-tenant <email>` / `vpadmin delete-tenant <email>` |
| Stato del servizio | `curl -s http://127.0.0.1:8787/health/deep` |
| Riavviare | `sudo systemctl restart vocepreventivo-server` |
| Leggere i log | `sudo journalctl -u vocepreventivo-server -n 100 -f` |

Variabili d'ambiente delle operazioni (tutte opzionali, commentate in `server/.env.example`): `METRICS_TOKEN`, `INVITE_ONLY`, `BACKUP_DIR`, `BACKUP_MAX_AGE_HOURS`, `DISK_WARN_FREE_MB`, `DISK_CRIT_FREE_MB`, `MAINTENANCE_VACUUM` (+ `MAINTENANCE_HOUR_UTC`, `MAINTENANCE_VACUUM_MIN_DAYS`, `MAINTENANCE_VACUUM_MIN_FREE_MB`, `MAINTENANCE_VACUUM_MAX_MB`), `MAINTENANCE_CHECKPOINT`, `TOMBSTONE_RETENTION_DAYS`, `SHUTDOWN_TIMEOUT_MS`.
