# Guida al deploy (VPS, senza Docker) — per chi non è DevOps

Questa guida porta online VocePreventivo su un tuo VPS **senza Docker**, nemmeno sul tuo PC. Docker resta solo come alternativa facoltativa (appendice A).

Cosa gira sul VPS (tutto come servizi di sistema, gestiti da `systemd`):
- **Caddy** (installato da apt): serve la PWA (cartella `dist`), fa da proxy per `/v1/*` e `/health`, ottiene da solo il certificato HTTPS.
- **server** (`vocepreventivo-server`): Node 22 che esegue `tsx src/index.ts` (nessuna build), database SQLite integrato in Node (`node:sqlite`, nessun pacchetto nativo), utente dedicato senza login.
- **Litestream** (`vocepreventivo-litestream`): copia continua del database su un bucket S3-compatibile (Backblaze B2, Hetzner Object Storage, Cloudflare R2).
- **timer**: backup giornaliero e prova di ripristino mensile.

> Fiscalità: l'app è uno strumento di supporto; la responsabilità fiscale resta dell'utente. Questo documento riguarda solo l'infrastruttura.

---

## COME FORNIRE LE CREDENZIALI IN MODO SICURO

**Non incollare mai password, chiavi SSH, token o chiavi del bucket in una chat (nemmeno con Claude), in un'issue, in un commit o nel repository.** Chi le legge può usarle; una volta finite in git o in chat vanno considerate compromesse e ruotate (`infra/scripts/rotate-secrets.md`).

Dove vanno invece:
1. **Sul server**, nel file `/etc/vocepreventivo/server.env` (permessi 600), che scrivi tu con un editor via SSH. Non è in git.
2. **Su GitHub**, in *Settings → Environments → production → Environment secrets*: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `DEPLOY_PATH` (e `VPS_PORT` se non usi la 22). Li inserisci tu dal sito di GitHub.
3. Chiave SSH di deploy **dedicata** (non la tua personale); credenziali del bucket con accesso **solo a quel bucket**.

Gli assistenti e gli sviluppatori lavorano solo con file di esempio con segnaposto (`CHANGE_ME`).

---

## 1. Requisiti
- VPS con Ubuntu **LTS** (22.04 o 24.04), **1–2 GB di RAM**, 20 GB di disco, IPv4 pubblico, in UE (es. Hetzner).
- Un **dominio** o sottodominio, es. `app.tuodominio.it`.
- Un **bucket S3-compatibile** privato in UE e una chiave di accesso limitata a quel bucket.
- Un account GitHub con il repository (per il deploy con un clic; in alternativa vedi 6.B).
- Sul tuo PC: **nessun Docker**. Serve solo un terminale con SSH.

## 2. Collegarsi al VPS dal PC (Windows, macOS, Linux)
**Windows 10/11 — PowerShell o Terminale Windows** (SSH è già incluso): apri *Terminale* o *PowerShell* e scrivi
```powershell
ssh nomeutente@IP_DEL_SERVER
```
Alla prima connessione conferma l'impronta del server (confrontala con quella nel pannello del provider). Per creare la chiave SSH:
```powershell
ssh-keygen -t ed25519 -C "il-mio-pc"
type $env:USERPROFILE\.ssh\id_ed25519.pub
```
Copia la riga stampata (è la chiave **pubblica**, si può condividere) e aggiungila sul server nel file `~/.ssh/authorized_keys`. La chiave **privata** (`id_ed25519`, senza `.pub`) non va mai condivisa.

**Alternativa PuTTY**: scarica PuTTY dal sito ufficiale, apri *PuTTYgen*, genera una chiave Ed25519, salva la privata (con passphrase) e copia il testo "Public key for pasting into OpenSSH authorized_keys file" sul server. In PuTTY: Host Name = IP, Connection → SSH → Auth → Credentials = file `.ppk`.

**macOS/Linux**: `ssh nomeutente@IP_DEL_SERVER` dal Terminale; chiave con `ssh-keygen -t ed25519` e `ssh-copy-id`.

## 3. Hardening iniziale (una volta sola)
Collegati con l'utente amministratore fornito dal provider.
```bash
sudo apt update && sudo apt -y full-upgrade
sudo adduser deploy                 # password robusta, salvata nel gestore password
sudo usermod -aG sudo deploy
```
Dal PC copia la chiave pubblica per `deploy` (su Linux/macOS `ssh-copy-id deploy@IP`; su Windows incolla la riga pubblica in `/home/deploy/.ssh/authorized_keys`: `sudo mkdir -p /home/deploy/.ssh`, `sudo nano /home/deploy/.ssh/authorized_keys`, poi `sudo chown -R deploy:deploy /home/deploy/.ssh && sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys`).

**Prova** `ssh deploy@IP` in una seconda finestra. Solo se funziona, disattiva root e password:
```bash
sudo nano /etc/ssh/sshd_config.d/99-hardening.conf
```
```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```
```bash
sudo sshd -t && sudo systemctl restart ssh
```
Firewall (ufw), fail2ban e aggiornamenti automatici **li configura lo script del punto 5**. Se vuoi farlo a mano: `ufw allow OpenSSH; ufw allow 80,443/tcp; ufw allow 443/udp; ufw enable`, `apt install fail2ban unattended-upgrades`.

Con 1 GB di RAM aggiungi swap: `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`.

## 4. DNS e dominio
Dal registrar crea un record **A** (e **AAAA** se il VPS ha IPv6) per `app.tuodominio.it` verso l'IP del VPS. Verifica con `dig +short app.tuodominio.it`. Caddy ottiene il certificato solo se il DNS è già corretto e le porte 80/443 sono aperte.

## 5. Preparare il server (script `setup-vps.sh`)
Come `deploy` sul server, porta qui la cartella `infra/` del repository. Il modo più semplice (repository pubblico, oppure privato con una *deploy key* di sola lettura):
```bash
git clone https://github.com/TUO-ACCOUNT/IL-REPO.git ~/vocepreventivo-src
cd ~/vocepreventivo-src/infra
sudo DEPLOY_USER=deploy ./scripts/setup-vps.sh
```
(In alternativa copia solo la cartella `infra/` dal PC con `scp -r infra deploy@IP:~/`.)

Lo script è **idempotente** (puoi rilanciarlo): crea l'utente di servizio `vocepreventivo`, installa Node 22 (repository NodeSource), Caddy (repository ufficiale), Litestream (.deb ufficiale; facoltativo `LITESTREAM_DEB_SHA256` per verificarne l'hash), sqlite3, ufw, fail2ban, aggiornamenti di sicurezza automatici, unit e timer systemd. Alla prima esecuzione crea due file da compilare e **non avvia** i servizi finché contengono `CHANGE_ME`:
```bash
sudo nano /etc/vocepreventivo/server.env     # segreti e bucket: vedi infra/server.env.example
sudo nano /etc/vocepreventivo/caddy.env      # DOMAIN e ACME_EMAIL
sudo DEPLOY_USER=deploy ./scripts/setup-vps.sh   # rilancia: ora abilita e avvia i servizi
```
Segreti casuali: `openssl rand -base64 48`. Conserva una copia del `server.env` nel gestore password (soprattutto `APP_ENCRYPTION_KEY`: senza, i dati cifrati non si recuperano). Credenziali del bucket: creale nel pannello del provider e incollale **solo** in questo file.

## 6. Primo deploy

### A) Con GitHub Actions (consigliato, un clic)
1. Sul tuo PC crea una chiave **solo per il deploy**: `ssh-keygen -t ed25519 -f deploy_key -N ""`. Aggiungi `deploy_key.pub` agli `authorized_keys` dell'utente `deploy`. Incolla la **privata** direttamente nel Secret GitHub `VPS_SSH_KEY`, poi cancella i file locali.
2. Riga `known_hosts`: `ssh-keyscan -t ed25519 IP_DEL_SERVER` (verifica l'impronta con quella del provider) → Secret `VPS_KNOWN_HOSTS`.
3. *Settings → Environments → New environment → `production`* con **Required reviewers** (te stesso). Secrets: `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `DEPLOY_PATH` = `/opt/vocepreventivo`, eventuale `VPS_PORT`.
4. *Actions → "Deploy produzione" → Run workflow*. GitHub compila il frontend, carica la release sul server e lancia `deploy-nodocker.sh`. **Non parte mai da solo.**

### B) A mano dal server (senza GitHub Actions)
```bash
cd ~/vocepreventivo-src
SOURCE_DIR=~/vocepreventivo-src ./infra/scripts/deploy-nodocker.sh
```
Fa `git pull`, copia il codice in una nuova release, installa le dipendenze di produzione e compila il frontend con Vite (servono circa 1 GB di RAM liberi: con poca RAM usa il metodo A).

### Cosa fa il deploy
Crea `/opt/vocepreventivo/releases/<etichetta>/`, esegue `npm ci --omit=dev` in `server/`, fa un backup di sicurezza, sposta il link `current`, riavvia il servizio e controlla `http://127.0.0.1:8787/health`. **Se il controllo fallisce torna da solo alla release precedente.** Restano le ultime 5 release. Le migrazioni del database sono solo "in avanti": il rollback ripristina il codice, non lo schema (per questo c'è il backup pre-deploy).

### Verifica
```bash
systemctl status vocepreventivo-server vocepreventivo-litestream caddy
curl -fsS https://app.tuodominio.it/health          # {"ok":true}
sudo journalctl -u vocepreventivo-litestream -n 30   # replica verso il bucket
```
Apri `https://app.tuodominio.it` dal telefono e installa la PWA.

## 7. Aggiornamenti
Rilancia il workflow "Deploy produzione" (o il comando 6.B). Se cambi file in `infra/` (Caddyfile, unit systemd), esegui di nuovo `sudo DEPLOY_USER=deploy ./scripts/setup-vps.sh` dalla copia aggiornata del repository.
Rollback manuale: `ls /opt/vocepreventivo/releases`, poi `ln -sfn /opt/vocepreventivo/releases/<vecchia> /opt/vocepreventivo/current && sudo systemctl restart vocepreventivo-server`.

## 8. Backup e ripristino
Tre livelli:
1. **Litestream**: replica continua (circa 10 s di ritardo, 14 giorni di storia nel bucket).
2. **Snapshot giornaliero** (timer `vocepreventivo-backup.timer`, 03:30) in `/var/lib/vocepreventivo/backups`, 14 giorni. Con `AGE_RECIPIENT` (chiave pubblica `age`) gli snapshot sono cifrati; la chiave privata tienila **fuori** dal server. Copia ogni tanto la cartella anche altrove.
3. **Snapshot settimanale del VPS** dal pannello del provider (pochi euro/mese).

```bash
systemctl list-timers 'vocepreventivo-*'        # quando partono
sudo systemctl start vocepreventivo-backup      # backup subito
```
**Ripristino — prima sempre in PROVA** (ripristina in una cartella temporanea, verifica `integrity_check` e conteggi, poi cancella; non tocca la produzione):
```bash
cd /opt/vocepreventivo/current/infra/scripts
sudo -u vocepreventivo ./restore.sh litestream --test
sudo -u vocepreventivo ./restore.sh litestream --at 2026-01-31T10:00:00Z --test
sudo -u vocepreventivo ./restore.sh snapshot /var/lib/vocepreventivo/backups/vocepreventivo-XXXX.sqlite.gz --test
```
**Emergenza** (sostituisce il database di produzione; il vecchio file resta come `.before-restore-<data>`):
```bash
sudo ./restore.sh litestream --live --yes
```
Se il server è perso: nuovo VPS, punti 3-5, rimetti `server.env` dal gestore password, poi `restore.sh --live --yes` e un deploy.

**Prova mensile**: il timer `vocepreventivo-restore-drill.timer` (giorno 1, 04:15) esegue `restore-drill.sh`: ripristina l'ultima replica, esegue `PRAGMA integrity_check`, confronta i conteggi con il DB vivo (tolleranza 5%, `DRILL_TOLERANCE_PCT`). Esito: `sudo journalctl -u vocepreventivo-restore-drill` e `/var/lib/vocepreventivo/backups/drill.log`; `systemctl --failed` mostra se è fallita. Lanciala anche a mano la prima volta: `sudo systemctl start vocepreventivo-restore-drill`. Un backup mai provato non è un backup.

## 9. Monitoraggio minimo
- **Uptime esterno gratuito** (UptimeRobot / Better Stack): controllo `https://app.tuodominio.it/health` ogni 5 minuti, avviso email/Telegram se giù da più di 2 minuti.
- **Log**: `sudo journalctl -u vocepreventivo-server -n 100 -f` (e `caddy`, `vocepreventivo-litestream`). Il server non deve loggare contenuti dei documenti né token.
- **Replica ferma**: errori in `journalctl -u vocepreventivo-litestream --since "1 hour ago"`; controlla ogni tanto che nel bucket ci siano file recenti.
- **Disco**: `df -h /`; allarme oltre l'80%. Il journal si limita con `sudo journalctl --vacuum-size=200M`.
- **Aggiornamenti OS**: automatici per la sicurezza; riavvia se esiste `/var/run/reboot-required`. I servizi ripartono da soli.

## 10. Checklist di sicurezza
- [ ] SSH solo con chiave; root e password disattivati
- [ ] ufw attivo (SSH, 80, 443/tcp, 443/udp); fail2ban attivo
- [ ] Aggiornamenti automatici attivi
- [ ] `/etc/vocepreventivo/server.env` proprietà `vocepreventivo`, permessi 600; copia nel gestore password
- [ ] Nessun `CHANGE_ME` rimasto; segreti casuali lunghi
- [ ] Chiave del bucket limitata a quel bucket; bucket privato
- [ ] Environment `production` con approvazione obbligatoria; deploy solo manuale
- [ ] Chiave SSH di deploy dedicata; `VPS_KNOWN_HOSTS` verificato
- [ ] Prova di ripristino eseguita almeno una volta, poi ogni mese
- [ ] Monitor uptime con avviso; snapshot VPS settimanale
- [ ] Rotazione segreti pianificata (`infra/scripts/rotate-secrets.md`)
- [ ] DPA con fornitori (VPS, bucket, email) in regola per il GDPR; dati in UE

## 11. Sviluppo locale (nessun Docker)
Sul tuo PC servono solo Node 22 e `npm`:
```bash
npm ci && npm run dev                    # frontend (Vite)
cd server && npm ci && npm run dev       # API in un secondo terminale
```
Per provare la sincronizzazione, il server locale usa un DB di sviluppo e variabili d'ambiente tue (mai nel repository).

## 12. Stima dei costi mensili (indicativa, DA VERIFICARE sui listini)
| Voce | Costo |
|---|---|
| VPS UE 2 vCPU / 2–4 GB | 4–6 € |
| Storage bucket + snapshot VPS | 1–3 € |
| Dominio (~12 €/anno) | ~1 € |
| Email transazionali e monitoraggio (tier gratuiti) | 0 € |
| **Totale fisso** | **~7–10 €** |

Costi variabili (Stripe, provider SDI, trascrizione): `docs/ARCHITECTURE-V2.md` §1.9.

## 13. Comandi utili
```bash
systemctl status vocepreventivo-server
sudo systemctl restart vocepreventivo-server
sudo journalctl -u vocepreventivo-server -f
curl -fsS http://127.0.0.1:8787/health
```

---

## Appendice A — Variante con Docker (facoltativa)
Non necessaria. Se in futuro la preferisci: `infra/docker-compose.yml` (server, caddy, litestream), `infra/.env.example` → `infra/.env` sul server (permessi 600), Docker da <https://docs.docker.com/engine/install/ubuntu/>, poi `infra/scripts/deploy.sh` (build o immagini caricate, backup pre-deploy, healthcheck, rollback). Workflow manuali: `deploy-docker.yml` (deploy via SSH) e `ci-docker.yml` (solo build delle immagini). Gli script `backup.sh`, `restore.sh`, `restore-drill.sh` riconoscono da soli la modalità (Docker se esiste `infra/.env` e non `/etc/vocepreventivo/server.env`). Non usare le due varianti insieme sullo stesso server (entrambe usano le porte 80/443).
