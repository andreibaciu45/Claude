# Rotazione dei segreti (note operative)

Principio: i segreti stanno SOLO in `infra/.env` sul server (permessi 600) e nei
Secrets di GitHub. Mai nel repository, mai in chat, mai in screenshot.
Ruotali subito se sospetti una fuga, e comunque ogni 6-12 mesi.

## Procedura generale
1. Genera il nuovo valore nel pannello del provider (o con `openssl rand -base64 48`).
2. Sul server: `nano infra/.env`, sostituisci il valore, salva.
3. `cd infra && docker compose up -d` (ricrea i container con la nuova configurazione).
4. Verifica: `docker compose ps` (healthy) e `curl -fsS https://IL-TUO-DOMINIO/health`.
5. Revoca il vecchio valore nel pannello del provider.

## Per tipo di segreto
- **Chiave SSH di deploy** (GitHub `VPS_SSH_KEY`): crea una nuova coppia (`ssh-keygen -t ed25519`),
  aggiungi la pubblica in `~/.ssh/authorized_keys` del server, aggiorna il Secret su GitHub, prova un deploy,
  poi rimuovi la vecchia riga da `authorized_keys`.
- **Credenziali bucket Litestream**: crea una nuova coppia chiave/segreto nel provider con accesso al solo
  bucket, aggiorna `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`, riavvia `litestream`,
  controlla nei log `docker compose logs litestream`, poi revoca la vecchia chiave.
- **AUTH_SECRET**: la rotazione invalida tutte le sessioni (gli utenti dovranno rientrare). Pianificala.
- **APP_ENCRYPTION_KEY**: NON si cambia a caldo: i campi cifrati con la vecchia chiave diventano illeggibili.
  Serve una migrazione di ri-cifratura (decifra con la vecchia, cifra con la nuova). Conserva sempre una copia
  della chiave in un gestore di password: senza, i dati cifrati e i backup non si recuperano.
- **Stripe / SDI / SMTP / STT / LLM**: genera una nuova chiave nel pannello del servizio, aggiorna `.env`,
  riavvia, verifica un'operazione di prova, revoca la vecchia.
- **Chiave age (backup cifrati)**: genera una nuova coppia con `age-keygen`, aggiorna `AGE_RECIPIENT`
  (pubblica). Conserva TUTTE le vecchie chiavi private finche' esistono backup cifrati con esse.

## Se un segreto e' finito in git o in chat
Considera il segreto COMPROMESSO: ruotalo subito (anche se cancelli il messaggio o il commit,
resta nella cronologia). Poi, per git, valuta la riscrittura della cronologia.
