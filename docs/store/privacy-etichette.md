# Dichiarazioni privacy per gli store — BOZZA coerente con docs/privacy

> Da allineare con `public/legal/privacy.html` e `docs/privacy/REGISTRO-TRATTAMENTI.md` prima dell'invio, e da far rivedere a un consulente. Le risposte esatte dipendono da scelte non ancora prese (fornitore di trascrizione vocale, analytics): **[DA VERIFICARE]**. Dichiarare il falso nei moduli è causa di rimozione.

## Ipotesi di fondo
- Senza account: tutti i dati restano sul telefono; nulla è inviato al nostro server.
- Con account: sincronizzazione di documenti, catalogo e clienti verso il server (UE); email e dati azienda per l'account; Stripe per il pagamento (fuori dall'app nel caso "solo accesso").
- Voce nativa: l'audio è elaborato dal riconoscimento di sistema (Apple/Google; per Google/Apple può passare dai loro server) — non da noi, non conservato da noi. Se si usa la trascrizione su server (fallback): audio inviato al fornitore STT [DA DEFINIRE], non conservato.
- Nessuna pubblicità, nessun SDK di tracciamento, nessuna vendita di dati.

## Apple — "Etichette di privacy" (App Privacy)
| Tipo di dato | Raccolto? | Collegato all'identità? | Usato per tracciamento? | Finalità |
|---|---|---|---|---|
| Contatti → Indirizzo e-mail | Sì (solo con account) | Sì | No | Funzionalità dell'app |
| Contatti → Nome/Telefono/Indirizzo | Sì (solo con account: dati azienda e clienti sincronizzati) | Sì | No | Funzionalità dell'app |
| Contenuti utente → Altri contenuti (documenti, listino) | Sì (solo con sync) | Sì | No | Funzionalità dell'app |
| Contenuti utente → Dati audio | **Da verificare**: se il riconoscimento è solo di sistema, non raccolto da noi; se si usa STT su server, dichiarare "Sì, non collegato, non conservato" | — | No | Funzionalità dell'app |
| Identificatori → ID utente | Sì (con account) | Sì | No | Funzionalità dell'app |
| Dati di utilizzo / Diagnostica | No (finché non si aggiungono analytics/crash report) | — | No | — |
| Acquisti | Non dall'app (opzione "solo accesso") | — | — | — |
| Posizione, Contatti rubrica, Foto, Salute, Cronologia navigazione | No | — | — | — |
Tracciamento (ATT): **no** → non serve la finestra ATT.
Motivazioni permessi (già nell'Info.plist): microfono e riconoscimento vocale.

## Google Play — "Sicurezza dei dati" (Data safety)
- Raccoglie o condivide dati? **Sì** (solo con account/sync).
- Dati raccolti: Informazioni personali (nome, e-mail, indirizzo, telefono, ID utente) · File e documenti/Contenuti dell'app (documenti dell'utente) · Audio **[solo se STT su server, DA VERIFICARE]**.
- Condivisi con terzi: **No** (i fornitori che trattano i dati per nostro conto sono "responsabili" e non contano come condivisione; Stripe per pagamenti fuori app) **[DA VERIFICARE con il consulente]**.
- Crittografia in transito: **Sì** (HTTPS). Cancellazione dati: **Sì**, l'utente può chiederla (indicare URL/procedura: `docs/privacy/PROCEDURA-DIRITTI.md`) e dall'app.
- Finalità: funzionalità dell'app, gestione account. Nessuna pubblicità/analisi/marketing.
- Permessi Android dichiarati: `RECORD_AUDIO` (dettatura), `INTERNET`, `MODIFY_AUDIO_SETTINGS`. Dichiarazioni aggiuntive (autorizzazioni sensibili): nessuna.
- Rapporto con il GDPR: informativa e ruoli (titolare per l'account; responsabile per i dati dei clienti dell'artigiano) vedi `docs/privacy/`.
