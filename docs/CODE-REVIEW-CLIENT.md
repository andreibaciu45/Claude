Ultimo allineamento al codice: 04/11/2026

# Revisione indipendente del codice client consegnato

Revisore: indipendente (non ha scritto il codice). Ambito: `src/sync/**`, `src/pages/account/**`, `src/billing/**`, `src/voice/**` (`src/voice/ui` solo in lettura), `src/hooks/**`.
Fonti: `docs/CONTRACT-V2.md`, `docs/ARCHITECTURE-V2.md` §2 e §4, `shared/api.ts`, `shared/types.ts`.
Metodo: lettura completa dei moduli, ricerca dei percorsi di perdita dati / duplicazione / sicurezza, poi per ogni difetto confermato un test di regressione che **fallisce sul codice precedente e passa dopo la correzione** (verificato rieseguendo i test sulle versioni precedenti dei file).

Test aggiunti: `src/sync/review.test.ts`, `src/billing/review.test.ts`, `src/voice/review.test.ts`, `src/hooks/useSpeech.test.tsx`, `src/pages/account/review.ui.test.tsx`.
Esito finale: 20 file / 234 test verdi sui moduli toccati; `tsc` pulito sui moduli revisionati (restano errori in `src/storage/customerModel.ts`, lavoro altrui in corso).

## Riepilogo

| Gravità | Trovati | Corretti | Aperti (decisione/altro modulo) |
|---|---|---|---|
| Alta | 4 | 4 | 0 |
| Media | 11 | 9 | 2 |
| Bassa | 9 | 7 | 2 |

## Difetti ALTI

**S1 (Alta) – Dopo "Esci" la coda dell'account A viene inviata all'account B.**
`verifyCode` azzerava lo stato di sync solo se `accountStore` conteneva un account diverso; `signOut` svuota `accountStore`, quindi al login successivo `prev` era `null`. Restavano outbox, cursor, hash "sincronizzati" e `migrated=true`: le modifiche in coda del tenant A partivano verso il tenant B (fuga di dati tra clienti su un dispositivo condiviso) e i documenti già "sincronizzati" non venivano mai caricati su B (cursor del vecchio tenant).
Riproduzione: login A, modifica offline, Esci, login B → `review.test.ts` "SYNC-1".
Correzione: il proprietario dello stato è persistito (`meta.tenant`); al login con un tenant diverso si azzera tutto; durante il cambio nessun ciclo può partire (`switching`) e i cicli in volo vengono abortiti (`epoch`). Dopo il cambio account i dati locali si caricano solo dopo la conferma della scheda "Prima sincronizzazione".

**S2 (Alta) – Cancellazione di massa propagata al server (storage vuoto = tutto cancellato).**
`diffSnapshot` trasforma ogni elemento "sincronizzato ma assente in locale" in `delete`. Con dati del browser cancellati, DB non ancora aperto o un bug di lettura, tutto il catalogo e tutti i documenti (bozze e preventivi) venivano cancellati dall'account e, con i tombstone, da tutti gli altri dispositivi.
Correzione: **circuit breaker** (`detectMassDelete`, `snapshot.ts`). Una cancellazione è sospetta se (≥5 elementi e ≥50% di quelli sincronizzati di quel tipo) oppure (spariti tutti, con almeno 3 sincronizzati) oppure (archivio locale totalmente vuoto mentre il server ne ha ≥2). Le cancellazioni sospette **non vengono accodate**; `status.massDelete` mostra la scheda "Controlla prima di continuare" (`MassDeleteCard`) con due scelte: **Ripristina dall'account** (predefinita: dimentica gli hash e riparte il pull da cursor 0) oppure **Conferma: cancella anche dall'account** (con seconda conferma). Le cancellazioni normali (1–4 elementi) passano senza attrito. API motore: `confirmMassDelete()`, `restoreFromServer()`. Test "SYNC-2".

**S3 (Alta) – Un profilo vuoto sovrascrive i dati azienda sul server.**
Se in storage esisteva già una voce `profile` sincronizzata, un profilo locale vuoto (default dopo reset) veniva caricato (last-write-wins) e propagato a tutti i dispositivi.
Correzione: un profilo senza ragione sociale né P.IVA non viene mai caricato. Test "SYNC-3". (I contatori di numerazione erano già protetti da `saveProfile` dello storage con il massimo: controllato, nessun difetto.)

**S4 (Alta) – Le fatture emesse su un altro dispositivo non arrivavano mai.**
`defaultLocalStore.saveDocument = storage.saveDocument`, che rifiuta di creare un documento con `lockedAt` ("si blocca solo emettendo"). Il pull lo contava come "ignorato" e avanzava il cursor: la fattura emessa sul telefono non compariva mai sul tablet. Lo storage espone `saveSyncedDocument` proprio per questo, ma non era usato.
Correzione: `LocalStore.saveRemoteDocument` opzionale (agganciato a `storage.saveSyncedDocument`) usato da `applyRemote`; l'immutabilità dei documenti già bloccati in locale resta intatta. Test "SYNC-4".

## Difetti MEDI

**S5 (Media) – Un'operazione rifiutata (400/413/422) blocca per sempre tutta la coda.** Un lotto di 50 operazioni con un documento enorme (XML) restituiva 413 a ogni tentativo, con backoff infinito e nessun'altra modifica sincronizzata. Correzione: il lotto si dimezza; se una singola operazione viene rifiutata diventa "non valida" (resta sul dispositivo, visibile in "Da controllare"). Test "SYNC-5".

**S6 (Media) – Due schede aperte sincronizzano insieme.** Ogni scheda ha il proprio motore ma condivide outbox/cursor in IndexedDB: scansioni duplicate (il coalescing è serializzato solo per scheda), possibile eco di dati remoti appena applicati dall'altra scheda come nuova scrittura. Correzione: un solo ciclo/scansione alla volta tra le schede con Web Locks (`vp-sync-cycle`, `ifAvailable`); senza Web Locks il comportamento resta quello di prima. Test "SYNC-6".

**B1 (Media) – Errore di fuso/cambio mese: conteggio del server confrontato col mese locale.** `checkAllowanceNow` usava `monthKey(cache.verifiedAt)` locale, ma il server conta per mese UTC (`quota.periodKey`). A cavallo del mese un utente Free in Italia con 3/3 a ottobre veniva bloccato per ore a novembre (o il contrario). Correzione: `periodKey` salvato in cache; confronto in UTC (`serverUsedFor`). Test "BILL-1".

**B2 (Media) – `openUrl` (checkout/portale): `javascript://localhost/%0Aalert(1)` passava il controllo.** La condizione `protocol !== 'https:' && hostname !== 'localhost'` lasciava passare qualunque schema con host `localhost` (XSS via `location.assign`) e `http://localhost` in produzione; nessun limite sull'host (open redirect/phishing se la risposta del server è alterata). Correzione: `billing/safeUrl.ts` (usata da `AccountView` e `DataPrivacyCard`): solo URL assoluto https (http solo su localhost in dev), niente credenziali nell'URL, host ammessi = `stripe.com` e sottodomini + host dell'app (`VITE_PAYMENT_HOSTS` per cambiarli). Test "BILL-2". Nota operativa: se si usa un dominio personalizzato per Checkout/Portale va aggiunto in `VITE_PAYMENT_HOSTS`.

**B3 (Media) – Il piano Pro scade silenziosamente in una scheda aperta a lungo.** `/me` veniva richiesto solo all'avvio, al login, dal pulsante e una volta quando `needsRefresh` passava a true; il sync periodico non lo rinnovava. Un'app PWA lasciata aperta oltre 14 giorni (anche online e con abbonamento pagato) tornava a Free. Correzione: dopo un sync riuscito `/me` si rilegge se più vecchio di 1 ora (`ME_REFRESH_MS`). Test "SYNC-7".

**V1 (Media) – "Annulla" ripristina uno stato vecchio sopra le modifiche successive.** Gli undo di `add_line`, `quote_status`, `mark_sent`, `delete_draft`, `convert_quote`, `duplicate`, `new_document` riscrivevano uno snapshot (`before`) o cancellavano il documento senza controllare che fosse ancora come lo aveva lasciato il comando: una modifica a mano (o un sync) nei 6 secondi dell'undo andava persa. Correzione: l'undo confronta `updatedAt`; se il documento è cambiato rifiuta con messaggio chiaro. Test "VOICE-1".

**V2 (Media) – La conferma non è legata alla versione del documento mostrata.** Il gettone vincolava solo il comando (`ref` per id): tra la scheda di riepilogo (importo X) e l'emissione (fino a 60 s) il documento poteva cambiare (altra scheda, sync, modifica) e veniva emessa/stornata una versione diversa da quella vista. Correzione: `ConfirmSummary.docVersion` (id + `updatedAt`) viaggia nel gettone; `executeCommand` rifiuta se il documento è cambiato. Nessuna modifica al widget necessaria. Test "VOICE-2".

**V3 (Media) – Doppio tocco / doppio enunciato = doppio incasso.** Il gettone di conferma "a tocco" non veniva consumato (solo gli irreversibili) e `mark_paid` con importo esplicito non ha altra idempotenza: due "Conferma" ravvicinati registravano due pagamenti, non annullabili. Correzione: qualunque gettone presentato si consuma (una volta sola); stesso comando già in esecuzione → rifiutato; `mark_paid` rilegge il residuo al momento dell'esecuzione (già pagata → errore) e rifiuta importi non finiti. Test "VOICE-3".

**V4 (Media) – Registrazione "fantasma" del microfono (privacy).** `RecorderProvider.stop()` ignorava la chiamata se il permesso del microfono era ancora in attesa: rilasciando subito il push-to-talk (o alla prima richiesta di permesso) la registrazione partiva comunque, al buio, fino a 30 s. Correzione: `stopRequested`; al rilascio del permesso lo stream viene chiuso senza registrare. Test "VOICE-5".

### Aperti (Medi)

> **Aggiornamento 04/11/2026 (verifica sul codice):** S7 e S8 risultano **CHIUSI** (dettagli nei paragrafi "Stato" qui sotto). I titoli "aperto" sono conservati per storia.

**S7 (Media, aperto – decisione di prodotto) – Last-write-wins silenzioso sulle bozze.** ARCHITECTURE §2.3 dice che su conflitto di una bozza si avvisa e si conserva la copia locale come nuova bozza ("nessuna perdita silenziosa"); il motore (`handleConflict`, `stale`) ritenta con la base aggiornata e sovrascrive la versione dell'altro dispositivo senza avviso. È coerente con l'intestazione di `engine.ts` (LWW) ma non con il documento. Suggerimento: su `stale` per un documento, offrire "Tieni entrambe" (la UI esiste già) invece del retry automatico, oppure aggiornare ARCHITECTURE-V2.

**Stato: CORRETTO (SYNC-3).** Su `stale` di una bozza (e quando il pull porta una versione più recente di una bozza con modifiche locali non inviate) il motore non sovrascrive più: crea un conflitto con le due versioni e un confronto leggibile (cliente, righe, totale, note, data, stato) in «Da controllare». Scelte: «Usa quella del server», «Tieni la mia» (sostituisce il server solo per scelta esplicita), «Tieni entrambe» (la copia locale diventa una nuova bozza «copia in conflitto», nuovo id, senza numero fiscale). Bozza eliminata qui e modificata altrove: «Usa quella del server» / «Elimina comunque». Profilo e catalogo restano last-write-wins ma ogni sovrascrittura è annotata nel «Registro di sincronizzazione» (`status.log`). Codice: `src/sync/engine.ts` (`handleConflict`, `noteDirtyRemote`, `resolveConflict`), `src/sync/conflictDiff.ts`, `src/pages/account/ConflictList.tsx`. Test: `src/sync/conflicts.test.ts`, `src/pages/account/invite.ui.test.tsx`.

> **CHIUSO il 04/11/2026 (S7).** Verificato in `src/sync/engine.ts` (`handleConflict`, `noteDirtyRemote`, `resolveConflict`), `src/sync/conflictDiff.ts` e `src/pages/account/ConflictList.tsx`. Test `src/sync/conflicts.test.ts`: verde alla verifica del 04/11/2026. Profilo e catalogo restano last-write-wins, con registro delle sovrascritture.

**S8 (Media, aperto – design) – Cambio account su dispositivo condiviso.** Dopo il cambio account i dati locali dell'utente precedente vengono offerti per il caricamento sul nuovo account (con anteprima e conferma). Non si può cancellare lo storage da questo modulo. Suggerimento: alla conferma di cambio account mostrare un avviso esplicito ("questi dati appartengono a un altro account") ed eventualmente offrire "Svuota i dati locali" (richiede una funzione in `src/storage`).

**Stato: CORRETTO lato sync/UI (SYNC-3), cablato su `clearLocalData` dello storage.** Dopo il cambio account lo stato `foreignData` (persistito in `meta`) fa mostrare nella scheda «Prima sincronizzazione» l'avviso «questi dati appartengono a un altro account» e il pulsante «Svuota i dati locali» (con conferma; scarica la copia di sicurezza restituita dallo storage). Interfaccia `StorageHooks` (`src/sync/storageHooks.ts`): senza la funzione di storage il pulsante non compare e `discardLocalData()` rifiuta senza toccare nulla.

> **CHIUSO il 04/11/2026 (S8).** Il wiring esiste: `clearLocalData` in `src/storage/index.ts` (esportato come `storageHooks`), `foreignData` e `discardLocalData` in `src/sync/engine.ts`. Il pulsante «Svuota i dati locali» dipende dalla disponibilità della funzione, come descritto sopra.

## Difetti BASSI

- **V5 (corretto)** `RecorderProvider`: `cancel()` seguita subito da `start()` lasciava aperto lo stream della prima richiesta (microfono acceso). Contatore di generazione. Test "VOICE-5".
- **V6 (corretto)** `NativeSpeechProvider.start()` poteva avviare il riconoscimento dopo una `cancel()` (attese di permessi/listener). Stesso contatore.
- **V7 (corretto)** Testo libero (motivo nota di credito, trascrizione salvata nel documento, descrizioni righe, nome cliente) senza limiti né pulizia: caratteri di controllo/bidi/invisibili e lunghezza arbitraria finivano nei documenti e nell'XML (Causale ≤200). `cleanFreeText` + tetti (motivo 200, nome 80, righe 1000, trascrizione 2000). Il rendering resta sempre via React (nessun `dangerouslySetInnerHTML` nei moduli). Test "VOICE-4".
- **H1 (corretto, da verificare su browser)** `useSpeech`: dopo `stop()` il parziale viene consolidato e il risultato finale consegnato subito dopo dal browser veniva accodato di nuovo ("tre metri tre metri"). Test con riconoscitore finto; il comportamento reale dipende dal browser.
- **B4 (corretto)** `usePlan` ringiovaniva la verifica della cache Pro con `Date.now()` al montaggio del componente invece dell'istante in cui il server ha risposto (`meAt`), estendendo la tolleranza offline di 14 giorni con dati vecchi; ora usa `meAt` e non sovrascrive mai una verifica più recente (altra scheda).
- **S9 (corretto)** Cicli di sync in volo durante `signOut` / `deleteAccount` / cambio account potevano scrivere hash e cursor dopo l'azzeramento dello stato. `epoch` + controlli prima di ogni scrittura.
- **V8 (corretto)** `mark_paid` accettava importi `Infinity` (vedi V3).
- **S10 (aperto, storage)** Le voci di audit create da altri dispositivi non vengono importate: `defaultLocalStore` non ha `saveAudit` e lo storage espone solo `appendAudit` (nuovo id). Il registro di un dispositivo non contiene quello degli altri. Serve una funzione `importAuditEntry` in `src/storage`.
- **S11 (aperto, informativo)** I tombstone remoti si applicano senza circuit breaker: un server che cancellasse in blocco svuoterebbe il locale. Le fatture emesse sono comunque protette (ImmutableDocumentError). Suggerimento: stessa soglia di `detectMassDelete` sul pull.

  **Stato: CORRETTO (SYNC-3), cablato su `importAuditEntries` dello storage.** `applyRemote` importa le voci di audit di altri dispositivi tramite `StorageHooks.importAuditEntries`; alla prima sincronizzazione con la funzione disponibile il cursor riparte da 0 una volta sola (`meta.auditBackfill`) per recuperare le voci saltate in passato. Senza la funzione: comportamento invariato (voci non importate, nessun errore).

## Cosa ho controllato e NON ho trovato

**Sync**
- Idempotenza per `opId`: push ripetuto non duplica; coalescing delle operazioni in coda conserva il `baseUpdatedAt` più vecchio; l'audit non viene mai fuso (append-only).
- Cursor: avanza solo dopo l'applicazione della pagina; pagina interrotta = si riprende dallo stesso punto; `!advanced` evita il ciclo infinito; più operazioni sulla stessa entità in una pagina contano solo l'ultima.
- Eco: le scritture remote appena applicate non vengono rimandate (hash reale riletto dallo storage); modifiche locali non sincronizzate non sono sovrascritte dal pull.
- Immutabilità: `ImmutableDocumentError` da pull → ignorata e contata; i documenti bloccati non entrano in "Tieni entrambe".
- Contatori di numerazione: `saveProfile` dello storage usa il massimo, un profilo remoto più vecchio non li riduce.
- Offline/errore di rete a metà push: coda intatta, ritentativo con backoff; 401 → uscita pulita senza toccare i dati locali; 429 con `Retry-After`.
- Logout con coda non vuota: la coda resta (conferma in UI con `window.confirm`), riprende solo con lo stesso account (dopo S1).
- Token: solo in `localStorage` (try/catch ovunque), mai in URL né nei log (nessun `console.*` nei moduli), inviato solo a `API_BASE_URL`; rischio residuo inevitabile = XSS legge `localStorage` (CSP e assenza di HTML iniettato sono la difesa).
- Messaggi del server mostrati come testo React (escape automatico); nessun `dangerouslySetInnerHTML`, `innerHTML`, `eval`.
- Listener/timer: `start()` rimuove tutti i listener e gli intervalli; `useSyncStatus` usa `useSyncExternalStore`.

**Limiti Free/Pro**
- Le note di credito non contano né sono bloccate; le bozze eliminate non rimborsano (registro); nessun doppio conteggio dello stesso id; Pro mai bloccato; messaggi onesti sul fatto che il limite locale è "morbido" (il vincolo reale è del server).
- Il parametro `?checkout=success` non attiva mai il Pro (conta solo `/me`); il polling si ferma allo smontaggio.
- Cache Pro scaduta: dopo 14 giorni senza verifica → Free, dati intatti; verifica "nel futuro" oltre 5 minuti non attendibile; cambio email invalida la cache.
- Limite noto, non risolvibile lato client: riavvolgere l'orologio del dispositivo prolunga la tolleranza Pro offline e il contatore mensile locale (dichiarato nei commenti; enforcement = server).

**Voce**
- Azioni irreversibili: mai senza gettone valido (`WeakSet` privato, legato al comando, monouso, riepilogo con Documento/Cliente/Importo obbligatori); "sì/ok/conferma" da soli non bastano; conferma vocale solo con scheda visibile, entro 15 s, confidenza ≥ 0,9 e senza alternative; intent distruttivo con alternative → disambiguazione; verbo "indovinato", domanda, negazione o frase lunga abbassano la confidenza.
- Riverifica dello stato dentro `run` prima di emettere/stornare (bozza, non bloccata); l'emissione non ha undo (corretto).
- XSS/injection dalla trascrizione: le stringhe pronunciate compaiono nel widget solo come testo React; audit (`detail`, `voiceTranscript`) tagliato a 2000 caratteri dallo storage; escape XML delegato a `shared/fatturapa` (fuori ambito).
- Listener/memoria: `useVoiceInput` distrugge il provider allo smontaggio; `Emitter.clearListeners`; `HoldButton` cancella `requestAnimationFrame`; pagina nascosta → `cancel()` e chiusura della scheda irreversibile; timer dell'undo ripulito.
- Race fra due enunciati sulla stessa scheda: l'`idempotencyKey` impedisce la doppia emissione (verificato prima e dopo le correzioni).
- Permessi microfono: negato → messaggio in italiano e campo di testo sempre disponibile; `getUserMedia` solo su gesto dell'utente; nessun "sempre in ascolto".
- Trascrizione server: il token viene inviato solo a `/voice/transcribe` sulla base configurata. Nota privacy: il vocabolario inviato contiene nomi di clienti (dati personali di terzi): verificare che l'informativa lo dichiari.

**Hook**
- `usePlan`, `useAllowance`, `useCheckoutReturn`, `useSyncStatus`, `useVoiceInput`, `useSpeech`: effetti con cleanup (listener, intervalli, timeout); protezione `alive` sulle promesse dopo lo smontaggio; `useSpeech` ha limite anti-loop sui riavvii.

## Note sul codice non modificabile da me

- `src/voice/ui/VoiceCommandWidget.tsx` (sola lettura): nessun difetto di sicurezza trovato; il widget gestisce correttamente gettoni, scadenza scheda e visibilità. Le correzioni V1–V3 funzionano senza toccarlo (il gettone porta `docVersion`; l'executor consuma/serializza).
- `src/pages/AccountPage.tsx` (fuori ambito): il badge "Da confermare" e la scheda di cancellazione di massa sono montati da `AccountView`, quindi compaiono nella pagina senza modifiche.
- Prestazioni (informativo): ogni scansione (15 s con scheda visibile) ricalcola l'hash di tutti i documenti, XML compresi; con migliaia di documenti conviene limitarsi a `updatedAt`/`STORAGE_CHANGED_EVENT` (già emesso da `storage/db.ts`).
