# Revisione di sicurezza del server (SERVER-HARDENING)

Ambito: `server/src/**` (auth, sessioni, OTP, sync, trigger SQL, billing/Stripe, SDI, voce, CORS, header, log, errori, SQL injection, mass assignment, SSRF, confronti a tempo costante, limiti body/payload, bomb, path traversal). Metodo: lettura completa del codice, test di regressione per ogni correzione (`server/test/**`, 212 test), `npm audit --omit=dev`: 0 vulnerabilità note. Non è un penetration test né consulenza legale.

## Vulnerabilità trovate
| # | Gravità | Problema | Stato |
|---|---|---|---|
| 1 | Alta | `TRUST_PROXY` non impostato in infra: dietro Caddy tutti i client avevano lo stesso IP; il limite OTP per IP (20/h) bloccava l'intero servizio e ogni limite per IP era inutile (rischio c) | Corretto: default `auto` (XFF fidato solo da peer privato), N proxy da destra, /64 per IPv6 |
| 2 | Alta | DoS mirato sull'OTP: 5 richieste/ora bloccavano l'email della vittima, una richiesta annullava il codice appena inviato, 5 errori bruciavano il codice, 10 verifiche esaurivano il budget (rischio b) | Corretto: limiti per IP / coppia email+IP / email, coppia controllata prima del tetto per email, backoff esponenziale per coppia, 3 codici attivi, 10 tentativi per codice |
| 3 | Alta | `getPlan` ignorava grace e `currentPeriodEnd`; lo specchio billing forzava `active`: Pro indefinito se mancava un webhook (rischio g) | Corretto: `effectivePlan` (grace, scadenza con tolleranza), stato fedele in `entitlements`, stessa regola in `computeEntitlement`; `/v1/me` espone billingStatus/graceUntil/periodKey |
| 4 | Media | Nessun rate-limit generale sulle API autenticate (rischio a) | Corretto: per IP, per tenant (letture/scritture), budget ops sync |
| 5 | Media | Quota Free aggirabile cancellando e ricreando lo stesso id | Corretto |
| 6 | Media | Eventi Stripe fuori ordine potevano riattivare un abbonamento disdetto; doppio checkout possibile | Corretto (`created`, 409 `already_subscribed`) |
| 7 | Media | Quota minuti voce basata su `durationMs` dichiarato dal client; limiti di costo STT/LLM in memoria (azzerati a ogni deploy) | Corretto: addebito sul massimo con stima da byte; limiti su DB |
| 8 | Media | `INSERT OR REPLACE` aggira i trigger di DELETE (immutabilità fatture, append-only audit) | Corretto: `PRAGMA recursive_triggers=ON` + test |
| 9 | Media | Payload nidificato in profondità → RangeError/500; pull senza tetto di byte (memoria); righe enormi | Corretto: guardia di profondità/nodi iterativa, MAX_DOC_BYTES, catalogo max, pull con tetto di byte |
| 10 | Media | `updatedAt` dal client: un orologio in avanti bloccava per sempre le modifiche altrui (rischio d) | Corretto: clamp a now+10 min, `serverTime` nella risposta di push |
| 11 | Media | Contenuti di bozze cancellate e versioni vecchie nel log di sync restavano nel DB | Corretto: tombstone azzerato, log compattato, `secure_delete` |
| 12 | Media | SMTP: `AUTH PLAIN` in chiaro se STARTTLS assente (default non richiesto) | Corretto: TLS richiesto di default in produzione |
| 13 | Media | Adattatori HTTP (Stripe, SDI, STT, LLM) senza timeout, con redirect, URL non validati | Corretto: timeout, `redirect:'error'`, `safeBaseUrl` (https, no IP privati/metadata/credenziali). Nessun URL deriva da input utente: niente SSRF diretta |
| 14 | Media | Nessun timeout HTTP del server (slowloris), header illimitati; tabelle che crescono senza limite | Corretto: timeout/`maxHeaderSize`, housekeeping orario |
| 15 | Bassa | Email con caratteri di controllo verso comando SMTP; motivo della firma Stripe in chiaro; file DB 0644; flood di job SDI su scartate; tetto body audio incoerente col limite globale | Corretti |
| 16 | Bassa | Mancavano export/cancellazione account (GDPR), prova di accettazione Termini/DPA | Implementati (f, task 5) |

Verificati senza difetti: SQL sempre parametrizzato (interpolazioni solo di costanti), `tenantId` solo da sessione e isolamento tra tenant, token sessione 256 bit salvati come hash, OTP con CSPRNG + HMAC e confronto a tempo costante (anche firme Stripe/SDI), nessuna enumerazione utenti, CORS per allow-list, header di sicurezza, log senza dati personali, errori generici, nessun parsing XML lato server (niente XXE), nessun path da input (niente traversal), body limit sul flusso reale, `__proto__` nel payload innocuo, mock vietati in produzione.

## Rischi residui (non risolti)
1. **Botnet su ≥15 IP** può esaurire il tetto di verifiche OTP per email (finestra 10 min, nessun blocco permanente) e rallentare la vittima. Allarme `otp_verify_email_budget_exhausted` nei log; mitigazione futura: passkey / notifica nuova sessione.
2. **Hash chain** (e): non implementata. Piano: colonne `prev_hash`/`hash` in `audit_log` (SHA-256 sulla riga canonica + hash precedente, calcolati in `audit()`), script di verifica; i trigger append-only e la cifratura non rilevano manomissioni a DB spento.
3. **Cifratura**: IV deterministico sui campi dei documenti (rivela solo l'uguaglianza di valori nello stesso documento e campo); chiave persa = dati persi; le righe di `audit_log` (append-only) restano con la chiave originale, che va conservata in `APP_ENCRYPTION_OLD_KEYS`. Le fatture emesse si ricifrano solo con `--include-locked` (sospende il trigger in transazione).
4. `audit_log` con testo libero del client (`detail`) non è cancellabile (append-only): il client non deve metterci dati personali; piano: chiavi per tenant (crypto-shredding).
5. Cancellazione account: i backup tengono i dati fino a fine retention (14 gg); l'abbonamento Stripe va annullato dall'utente/operatore; purge delle fatture dopo 10 anni è una procedura manuale (richiede sospendere il trigger).
6. Rate-limit generale in memoria: per processo; con più istanze usare `RATE_LIMIT_STORE=db`. DNS rebinding verso IP interni dei provider non è coperto: serve egress firewall.
7. `NODE_ENV` non impostato disattiva i controlli di produzione (solo avviso nel log). La numerazione fatture resta assegnata dal client (nessun controllo di buchi lato server, per contratto).
8. Mancano elenco/revoca dispositivi e notifica di nuova sessione (ARCH §6.1).

## Cosa serve in `shared/api.ts` (non modificato)
- `AuthVerifyBody.acceptedTerms?: { termsVersion: string; dpaVersion?: string; acceptedAt?: number }`; errori `terms_required`, `terms_version_mismatch` (400).
- `SyncPushResponse.serverTime?: number` (già restituito) per stimare lo sfasamento dell'orologio.
- Tipi per `GET /v1/me/export` e `DELETE /v1/me` (`{ confirmEmail, acknowledgeSubscription? }` → `{ deleted, mode: 'purged'|'anonymized', retainedInvoices }`; errori `confirmation_mismatch`, `active_subscription`).
- `MeResponse` già esteso: il server ora valorizza tutti i campi opzionali.

## Per INFRA (non toccato)
`TRUST_PROXY=auto` (default) va bene con Caddy in docker/locale; aggiungere a `infra/server.env.example`: `REQUIRE_TERMS`, `APP_ENCRYPTION_KEY`, `TERMS_*`, `RATE_LIMIT_STORE`. Il backup mensile può usare `scripts/backup.ts verify`.
