# Guida al deploy (VPS) — per chi non è DevOps

Questa guida porta online VocePreventivo su un tuo VPS con HTTPS automatico, backup continuo del database e aggiornamenti con ritorno alla versione precedente se qualcosa va storto.

Architettura (3 contenitori Docker, gestiti da `infra/docker-compose.yml`):
- **caddy**: sito web (la PWA) + HTTPS automatico + inoltra `/v1/*` e `/health` al server.
- **server**: l'API (Node 22), database SQLite nel volume `app-data`.
- **litestream**: copia continua del database su un bucket S3-compatibile (Backblaze B2, Hetzner Object Storage, Cloudflare R2).

> Fiscalità: l'app è uno strumento di supporto; la responsabilità fiscale resta dell'utente. Questo documento riguarda solo l'infrastruttura.

---

## COME FORNIRE LE CREDENZIALI IN MODO SICURO

**Non incollare mai password, chiavi SSH, token o chiavi di accesso del bucket in una chat (nemmeno con Claude), in un'issue, in un commit o nel repository.** Chi le legge può usarle; una volta in git o in chat vanno considerate compromesse e ruotate (vedi `infra/scripts/rotate-secrets.md`).

Dove vanno invece:
1. **Sul server**, nel file `infra/.env` (permessi 600), scritto da te con un editor via SSH. Non è in git (è ignorato).
2. **Su GitHub**, in *Settings → Environments → production → Environment secrets*: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `DEPLOY_PATH` (e `VPS_PORT` se non usi la 22). Li inserisci tu dal sito di GitHub; nessuno, nemmeno gli assistenti, ha bisogno di vederli.
3. La chiave SSH di deploy deve essere **dedicata** (non la tua personale), e le credenziali del bucket devono avere accesso **solo a quel bucket**.

Gli assistenti/sviluppatori lavorano solo con file di esempio con segnaposto (`CHANGE_ME`).

---

## 1. Requisiti del VPS
- Ubuntu **LTS** (22.04 o 24.04), **1–2 GB di RAM** (con 1 GB aggiungi 1 GB di swap, vedi sotto), 20 GB di disco, IPv4 pubblico.
- Provider consigliato in UE (es. Hetzner, località Germania/Finlandia).
- Un **dominio** (o sottodominio) di tua proprietà, per esempio `app.tuodominio.it`.
- Un **bucket S3-compatibile** in UE con una chiave di accesso limitata a quel bucket.
- Account GitHub con il repository (per il deploy automatico; in alternativa si può fare tutto a mano).

## 2. Hardening iniziale (una volta sola)
Accedi la prima volta come amministratore fornito dal provider (credenziali che gestisci solo tu).

```bash
# 2.1 aggiornamenti
sudo apt update && sudo apt -y full-upgrade

# 2.2 utente non-root per il deploy
sudo adduser deploy              # imposta una password robusta e conservala nel gestore password
sudo usermod -aG sudo deploy
```

**Chiave SSH** (sul TUO computer, non sul server):
```bash
ssh-keygen -t ed25519 -C "deploy-vocepreventivo"      # scegli una passphrase
ssh-copy-id deploy@IL_TUO_SERVER                       # copia la chiave PUBBLICA
```
Prova `ssh deploy@IL_TUO_SERVER`. Solo quando funziona, disattiva password e root:
```bash
sudo nano /etc/ssh/sshd_config.d/99-hardening.conf
```
contenuto:
```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```
```bash
sudo sshd -t && sudo systemctl restart ssh
```
(Tieni aperta una seconda sessione SSH mentre lo fai, per non chiuderti fuori.)

**Firewall ufw** (apri solo ciò che serve):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp      # HTTP/3
sudo ufw enable
sudo ufw status
```
> Nota: Docker pubblica le porte aggirando in parte ufw. Per questo il compose pubblica **solo** 80/443; il server (8787) non è mai esposto all'esterno.

**fail2ban** (blocca chi prova a indovinare l'accesso SSH):
```bash
sudo apt -y install fail2ban
printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\nfindtime = 10m\n' | sudo tee /etc/fail2ban/jail.d/sshd.local
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

**Aggiornamenti di sicurezza automatici**:
```bash
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # rispondi "Sì"
```

**Swap (solo se hai 1 GB di RAM)**:
```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. DNS e dominio
Nel pannello del tuo registrar crea un record **A** per `app.tuodominio.it` che punta all'IP pubblico del VPS (e, se il VPS ha IPv6, un record **AAAA**). Attendi la propagazione (da minuti a qualche ora): `dig +short app.tuodominio.it` deve restituire l'IP del server. Caddy ottiene il certificato HTTPS da solo, ma solo se il DNS è già corretto e le porte 80/443 sono aperte.

## 4. Installare Docker
Sul server, come utente `deploy`, segui le istruzioni ufficiali per Ubuntu: <https://docs.docker.com/engine/install/ubuntu/> (repository apt ufficiale di Docker, pacchetti `docker-ce docker-compose-plugin`). Poi:
```bash
sudo usermod -aG docker deploy     # esci e rientra via SSH
docker version && docker compose version
```
Configura la rotazione dei log una volta per tutte (evita che i log riempiano il disco):
```bash
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

## 5. Preparare la cartella e il file `.env` sul server
Il file `.env` contiene i segreti: lo crei **tu sul server**, non è in git.

```bash
mkdir -p ~/vocepreventivo/infra && cd ~/vocepreventivo/infra
```
Ci sono due modi per portare qui i file di `infra/`:
- **Con la GitHub Action** (consigliato, sezione 6.A): il primo deploy copia da solo `infra/` (ma non tocca mai il tuo `.env`).
- **A mano**: scarica il repository (`git clone` con una *deploy key* di sola lettura, oppure copia la cartella `infra/` e `server/`, `shared/`, ecc. con `scp`).

Crea il file di configurazione partendo dall'esempio e compilalo con un editor:
```bash
cp .env.example .env        # se manca, copia prima .env.example dal repository
chmod 600 .env
nano .env
```
Sostituisci **ogni** `CHANGE_ME`. Per i segreti casuali: `openssl rand -base64 48`. Se un valore ha spazi o simboli (`& $ #`) mettilo tra apici singoli. Conserva una copia di `.env` (soprattutto `APP_ENCRYPTION_KEY`) nel tuo gestore password: senza quella chiave i dati cifrati non sono recuperabili.

Per `LITESTREAM_*`: crea nel pannello del provider un bucket privato e una chiave con accesso solo a quel bucket; copia endpoint, regione, nome bucket e coppia di chiavi **direttamente nel `.env`** (non altrove).

## 6. Primo deploy

### A) Con GitHub Actions (consigliato)
1. Sul tuo computer crea una coppia di chiavi **solo per il deploy**: `ssh-keygen -t ed25519 -f deploy_key -N ""`. Aggiungi `deploy_key.pub` a `~/.ssh/authorized_keys` dell'utente `deploy` sul server. Poi **incolla la privata direttamente nel Secret di GitHub** e cancella il file locale (`shred -u deploy_key`).
2. Ottieni la riga `known_hosts` del server e **verificane l'impronta** con quella mostrata dal pannello del provider: `ssh-keyscan -t ed25519 IL_TUO_SERVER`.
3. In GitHub: *Settings → Environments → New environment → `production`* → abilita **Required reviewers** (tu stesso) e aggiungi gli Environment secrets: `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `DEPLOY_PATH` (es. `/home/deploy/vocepreventivo`), eventuale `VPS_PORT`.
4. Prima esecuzione: *Actions → "Deploy produzione" → Run workflow* (scegli il ramo). Il workflow copia `infra/`, costruisce le immagini, le invia al server e lancia `deploy.sh`. **Non parte mai da solo.**
5. Se è davvero il primo deploy, `infra/.env` deve già esistere sul server (sezione 5): crealo prima e rilancia, se il workflow ti avvisa che manca.

### B) A mano sul server
```bash
cd ~/vocepreventivo/infra
./scripts/deploy.sh            # costruisce le immagini dal codice presente e avvia tutto
```

### Verifica
```bash
cd ~/vocepreventivo/infra
docker compose ps                         # server "healthy", caddy e litestream "running"
curl -fsS https://app.tuodominio.it/health     # {"ok":true}
docker compose logs --tail 30 litestream  # deve indicare la replica verso il bucket
```
Apri `https://app.tuodominio.it` dal telefono e installa la PWA.

## 7. Aggiornamenti
Esegui di nuovo il workflow "Deploy produzione" (o `./scripts/deploy.sh` a mano dopo aver aggiornato il codice). `deploy.sh`:
1. fa un backup di sicurezza del database,
2. avvia la nuova versione,
3. controlla `/health`,
4. **se fallisce, torna da solo alla versione precedente.**

Rollback manuale a una versione precedente ancora presente: `cat infra/.deploy/previous` mostra l'etichetta; poi `./scripts/deploy.sh <etichetta>`.
Le migrazioni del database sono "solo in avanti" (nessun ritorno indietro dei dati): per questo il backup pre-deploy è obbligatorio e il rollback ripristina il **codice**, non lo schema.

## 8. Backup e ripristino
Due livelli:
1. **Litestream** (continuo, ~10 secondi di ritardo, 14 giorni di storia nel bucket).
2. **Snapshot** giornaliero con `scripts/backup.sh` (cartella `infra/backups`, 14 giorni). Se imposti `AGE_RECIPIENT` (chiave pubblica `age`, con `sudo apt install age`) gli snapshot sono cifrati; la chiave privata tienila **fuori** dal server. Copia periodicamente `infra/backups` anche altrove (il tuo computer, o ulteriore bucket).
   Pianificazione (come `deploy`, `crontab -e`):
   ```
   30 3 * * * cd /home/deploy/vocepreventivo/infra && ./scripts/backup.sh >> backups/backup.log 2>&1
   15 4 1 * * cd /home/deploy/vocepreventivo/infra && ./scripts/restore-drill.sh >> backups/drill.log 2>&1
   ```
3. Consigliato: **snapshot settimanale del VPS** dal pannello del provider (pochi euro/mese).

**Ripristino** (`scripts/restore.sh`), sempre prima in modalità PROVA:
```bash
./scripts/restore.sh litestream --test                         # ultima replica, in cartella temporanea
./scripts/restore.sh litestream --at 2026-01-31T10:00:00Z --test   # a un istante preciso
./scripts/restore.sh snapshot backups/vocepreventivo-XXXX.sqlite.gz --test
```
Stampa `integrity_check: ok` e il conteggio righe per tabella, poi cancella tutto. Per **sostituire davvero** il database di produzione (emergenza):
```bash
./scripts/restore.sh litestream --live --yes
```
Il vecchio file viene conservato nel volume come `.before-restore-<data>`. Se il server è perso del tutto: reinstalla Docker, ricrea `.env` dal tuo gestore password, avvia lo stack una volta, poi esegui il ripristino `--live --yes`.

**Prova mensile (obbligatoria)**: `./scripts/restore-drill.sh` ripristina l'ultima replica, esegue `PRAGMA integrity_check` e confronta i conteggi con il DB vivo (tolleranza 5%, `DRILL_TOLERANCE_PCT`). Esito in `infra/backups/drill.log`; codice di uscita ≠ 0 se qualcosa non torna. Un backup mai provato non è un backup.

## 9. Monitoraggio minimo
- **Uptime esterno gratuito**: UptimeRobot o Better Stack, controllo `https://app.tuodominio.it/health` ogni 5 minuti, avviso email/Telegram se giù da più di 2 minuti.
- **Log**: `docker compose logs --tail 100 server` (e `caddy`, `litestream`). Ruotano da soli (10 MB × 5). Il server non deve loggare contenuti dei documenti né token.
- **Replica ferma**: cerca errori in `docker compose logs --since 1h litestream`; controlla ogni tanto che nel bucket compaiano file recenti.
- **Spazio disco**: `df -h /` e `docker system df`; allarme oltre l'80%. Pulizia sicura: `docker image prune -f`.
- **Aggiornamenti OS**: ogni tanto `sudo apt update && sudo apt list --upgradable`; riavvia se richiesto (`/var/run/reboot-required`). I contenitori ripartono da soli (`restart: unless-stopped`).

## 10. Checklist di sicurezza
- [ ] Login SSH solo con chiave; root e password disattivati
- [ ] ufw attivo (22, 80, 443/tcp, 443/udp); fail2ban attivo
- [ ] Aggiornamenti automatici attivi
- [ ] `infra/.env` con permessi 600, mai in git, copia nel gestore password
- [ ] Nessun `CHANGE_ME` rimasto; segreti casuali lunghi
- [ ] Chiave del bucket limitata a quel solo bucket; bucket privato
- [ ] Environment `production` con approvazione obbligatoria; deploy solo manuale
- [ ] Chiave SSH di deploy dedicata; `VPS_KNOWN_HOSTS` verificato
- [ ] Prova di ripristino eseguita almeno una volta, poi ogni mese
- [ ] Monitor uptime attivo con avviso
- [ ] Snapshot VPS settimanale attivo
- [ ] Rotazione segreti pianificata (`infra/scripts/rotate-secrets.md`)
- [ ] Contratti/DPA con i fornitori (VPS, bucket, email) in regola per il GDPR; dati in UE

## 11. Stima dei costi mensili (indicativa, DA VERIFICARE sui listini attuali)
| Voce | Costo |
|---|---|
| VPS UE 2 vCPU / 2–4 GB | 4–6 € |
| Storage bucket + snapshot VPS | 1–3 € |
| Dominio (~12 €/anno) | ~1 € |
| Email transazionali (tier gratuito) | 0 € |
| Monitoraggio uptime (tier gratuito) | 0 € |
| **Totale fisso** | **~7–10 €** |

Costi variabili (Stripe, provider SDI, trascrizione) sono descritti in `docs/ARCHITECTURE-V2.md` §1.9.

## 12. Riferimento rapido
Variabili d'ambiente: tutte in `infra/.env.example`. Comandi utili (da `infra/`):
```bash
docker compose ps
docker compose logs -f server
docker compose restart server
./scripts/deploy.sh [etichetta]
./scripts/backup.sh
./scripts/restore.sh litestream --test
./scripts/restore-drill.sh
```
