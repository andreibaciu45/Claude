# Revisione indipendente di secondo giro (codice scritto dopo le prime revisioni)

Perimetro: `src/storage/{db,health,hooks,backupValidation,customers,customerModel,index}`, migrazione v3, `src/pages/customers/**`, `src/sync/{conflictDiff,storageHooks,engine}`, `src/pwa/**` + `public/sw.js` v3, `src/voice/privacy`, `src/billing/**`, `NewQuotePage`/`CustomerPicker`/`draft.ts`, `NumberingCard`/`setInvoiceCounterStart`, `zip.ts`, registro attività.
Non ripete `CODE-REVIEW-CLIENT.md` e `CODE-REVIEW-FATTURE.md`. Test di regressione (prima falliscono, poi passano): `src/storage/review2.test.ts`, `src/billing/review2.test.ts`, `src/sync/review2.test.ts`, `src/pages/quote/review2.draft.test.ts`, `src/pages/customers/review2.csv.test.ts`.
Stato finale: `npm run typecheck` pulito; `npx vitest run` 80 file / 1226 test verdi.

## Riepilogo

| Gravità | Trovati | Corretti | Aperti |
|---|---|---|---|
| Alta | 0 | 0 | 0 |
| Media | 6 | 6 | 0 |
| Bassa | 7 | 5 | 2 |

## Media

**REV2-DB1 — connessione IndexedDB orfana (db.ts).** Con la migrazione v3 bloccata da una scheda ancora alla v2 l'apertura iniziale resta in attesa; tornando sulla scheda, `visibilitychange` chiamava `reopenNow()` che apriva una SECONDA connessione. Al rilascio entrambe riuscivano, `db` teneva solo l'ultima e l'altra restava aperta: `blocking` chiude solo `db`, quindi un futuro aggiornamento/eliminazione del database da un'altra scheda restava bloccato per sempre.
Riproduzione: `review2.test.ts` «REV2-DB1» (`deleteDatabase` non completa). Correzione: `reopenNow` attende l'apertura iniziale invece di lanciarne un'altra; `onOpened` chiude sempre la connessione sostituita.

**REV2-DB2 — emissione "in coda" durante l'attesa bloccata (db.ts).** Nello stesso scenario `requirePersistentStorage` attendeva `initialOpen`: un'emissione/contatore cliccato mentre l'archivio è bloccato restava appeso e partiva da sola minuti dopo (doppio tentativo, spinner infinito). Ora, se l'apertura è bloccata, lancia subito `StorageUnavailableError('blocked')` senza scrivere nulla. Test «REV2-DB2».

**REV2-C4 — `upsertCustomer` sovrascriveva un'altra scheda della rubrica (customers.ts).** Si sceglie «Rossi Srl» dall'autocompletamento, nel documento si cambia la P.IVA, si salva: P.IVA diversa = non duplicato, quindi "crea nuovo" con lo STESSO id → `put` sostituiva la scheda esistente (perdita silenziosa di dati della rubrica). Ora l'id già occupato viene sostituito da uno nuovo. Test «REV2-C4».

**REV2-C1 — omonimi fusi (customerModel.ts).** Due «Mario Rossi» senza P.IVA/CF erano lo stesso cliente per nome: nel salvataggio di un documento i campi vuoti dell'uno (telefono, email, indirizzo) completavano la scheda dell'altro e le statistiche si mescolavano. Ora, a parità di nome senza identificativi, comuni entrambi indicati e diversi = clienti diversi. Resta unito chi non ha comune (ambiguità inevitabile). Gli identificativi fiscali restano decisivi (un trasloco non separa). Test con seme fisso (120 casi: idempotenza, nessuna contaminazione di P.IVA/CF, omonimi di città diverse).

**REV2-D1 — bozza locale corrotta manda in errore `/nuovo` (draft.ts).** `parseDraft` controllava solo `lines` e `customer`: `{"lines":[],"customer":{}}` (bozza troncata, versione vecchia, localStorage modificato) dava `transcript`/`name` `undefined` e `text.trim()` lanciava a ogni visita finché non si svuotava il sito. Ora stage, tipo, testi, id e campi numerici delle righe vengono normalizzati (NaN, ±Infinity e -0 voluti si conservano; ordine delle chiavi invariato, serializzazione idempotente). Test `review2.draft.test.ts`.

**REV2-B1 — abbonato Pro bloccato su Free da una verifica "nel futuro" (billing).** Se `/me` veniva registrato con l'orologio del telefono avanti, `verifiedAt` restava nel futuro: `resolvePlan` lo ritiene non attendibile (Free) e `usePlan` non poteva riscriverlo (`cur.verifiedAt <= at` falso) finché non si usciva dall'account. Nuova `canReplacePlanCache`: una cache oltre la tolleranza di sfasamento si sostituisce sempre. Test `billing/review2.test.ts`.

## Bassa

- **REV2-C2 (corretto) — importazione CSV quadratica.** `upsertCustomers` rileggeva tutta la rubrica e confrontava tutte le coppie a ogni riga: 2000 righe = 16 s di interfaccia ferma. Ora un indice per P.IVA/CF/nome (stesso risultato: test differenziale con seme fisso contro il confronto completo) = 0,1 s.
- **REV2-C3 (corretto) — CSV di Excel in Windows-1252.** `File.text()` leggeva sempre UTF-8: «Caffè» diventava «Caff�» nella rubrica. `decodeCsvBytes` prova UTF-8 rigoroso e ripiega su Windows-1252; limite 5 MB; il campo file si azzera anche dopo un errore (prima non si poteva riselezionare lo stesso file).
- **REV2-B2 (corretto) — cache del piano/limite con valori assurdi.** `docsThisMonth: 1e999` (Infinity) o frazionari/negativi nella cache locale finivano nei contatori. `computeAllowance` accetta solo interi finiti >= 0; `readPlanCache` scarta i non finiti. (Aggirare il limite Free resta possibile ed è dichiarato.)
- **REV2-B3 (corretto) — backup con contatori non numerici.** `nextQuoteNumber: "abc"` dava NaN dopo `Math.max` e la numerazione dei preventivi ripartiva da 1; `nextProgressivoInvio` non finito faceva ripartire da `00001`. `parseBackup` normalizza i tre contatori (interi >= 1; l'import prende comunque il massimo col dispositivo).
- **REV2-S1 (corretto) — «Tieni entrambe» duplicava la copia a ogni tentativo (engine.ts).** La copia veniva salvata prima di adottare la versione del server: se questa falliva (o l'app si chiudeva) la scelta ripetuta creava un'altra bozza ogni volta. Id della copia deterministico dall'`opId` e mai sovrascritto. Test `sync/review2.test.ts`.

## Aperti (bassi, decisione/design)

- **A1 — scritture in memoria dopo apertura iniziale fallita.** Se l'apertura iniziale fallisce l'app lavora in memoria (dichiarato nel banner); la riapertura automatica successiva passa all'archivio vero e le bozze scritte in memoria spariscono senza avviso. Suggerimento: copiare lo store in memoria nel DB alla prima riapertura riuscita.
- **A2 — chiavi CSV.** Una lettera `\r` isolata in un valore non viene neutralizzata da `csvText` (registro/attività); le celle che iniziano con spazio + `=` non sono protette (Excel le tratta come testo: nessun rischio noto). Correzione banale ma fuori dai difetti confermati con effetto reale.
- Nota: `CatalogPage` usa lo stesso `parseCsv` ma `File.text()` (stesso problema di REV2-C3, fuori perimetro).

## Cosa ho controllato senza trovare difetti

- **Transazioni IndexedDB:** nessun `await` di fetch/`crypto.subtle` dentro `transact` (l'hash dell'emissione e di `hashAll` è fuori dalla transazione; l'emissione verifica l'impronta e ripete); `importBackup` valida e calcola gli hash PRIMA della transazione; rollback su errore di dominio; classificazione errori (quota, abort, versionchange) senza ripiego in memoria.
- **Migrazione v3:** `upgrade` usa solo operazioni IDB, nessun documento viene toccato, nuova installazione = rubrica vuota; con scheda alla v2 aperta l'apertura attende e riprende (test), nessuna perdita.
- **Backup:** verifica hash/lockedAt/numerazione/note di credito (limite noto: chi ricalcola XML e hash e l'audit insieme non è rilevabile); import non riduce i contatori; `clearLocalData` atomico, backup letto nella stessa transazione, cancella anche la bozza locale; `importAuditEntries` idempotente e append-only.
- **Emissione vs `setInvoiceCounterStart`:** serializzati da IndexedDB e dall'impronta (contatori inclusi) → `RetryEmit`; nessun numero duplicato.
- **ZIP:** CRC32 (vettore noto), nomi duplicati e `..`/percorsi assoluti/`C:\`, nomi UTF-8, data DOS; verificato con `unzip -t` e `zipfile` di Python. Residuo: nomi che differiscono solo per maiuscole/minuscole (Windows) non sono deduplicati; i nomi reali sono generati e non collidono.
- **PWA:** registro `busy` conteggiato con `finally` (nessun conteggio che non torna a zero: `HoldButton` rilascia in un solo punto, incluso lo smontaggio); `controllerchange` da `skipWaiting` di sw.js v3 durante un'emissione NON ricarica (solo avviso); un'altra scheda non viene mai ricaricata d'ufficio. Residuo: la cache asset non versionata può conservare una risposta HTML per un chunk vecchio scomparso (innocuo, il chunk è morto).
- **Informativa microfono:** tutti i punti d'ingresso (home e widget) passano da `hasVoicePrivacyAck`; focus trap, ESC, listener rimossi allo smontaggio, focus restituito.
- **Free/Pro:** note di credito escluse, registro locale con voci non valide ignorate, nessuna eccezione con cache corrotta (JSON rotto, tipi sbagliati).
- **Conflitti bozze:** nessun ciclo di sync da conflitti ripetuti (aggiornamento in-place), nessun duplicato infinito dopo REV2-S1; la copia non porta numero fiscale né eventi SDI.
- Nessun uso di `BroadcastChannel`/evento `storage` nel codice: la coerenza tra schede si affida a IndexedDB, Web Locks (sync) e impronta (emissione).

## Dopo la convergenza del server

Implementato in `src/sync/engine.ts` (+ `snapshot.ts`, `testing/fakes.ts` con `strictTombstones` e `resyncRequired`, `ConflictList.tsx` per i testi):

1. **`resync_required`**: la voce rifiutata viene dimenticata come "sincronizzata", il cursor riparte da 0, messaggio chiaro nel registro («Questo dispositivo non si sincronizzava da molto tempo…»); dopo il pull un secondo giro (una volta per ciclo, nessun loop) ricrea le voci come NUOVE (nuova operazione, nessuna base, nuovo `clientTs`). Nessun dato locale viene toccato; le bozze con versioni diverse sul server diventano conflitti (`noteDirtyRemote`).
2. **`stale` senza `serverVersion` = cancellata altrove**: catalogo → cancellazione locale con voce di registro; operazioni locali di cancellazione → semplicemente chiuse; BOZZE → conflitto con `draft.serverDeleted` e scelte «Ripristina la mia» (ricreata come nuova, senza base) ed «Elimina anche qui» (solo su scelta esplicita); «Tieni entrambe» non è offerta. **Profilo**: non si azzera mai da un tombstone (dati fiscali e contatori): resta e viene ricaricato, con voce di registro (scelta mia, da confermare).
3. **Circuit breaker anche in ingresso** (`isMassRemoteDelete`, stessa soglia di `detectMassDelete`): i tombstone del pull si applicano come cancellazioni normali, ma se superano la soglia (conteggio su tutto il pull) non si applicano più, le copie locali restano e il motivo è nel registro (`remoteIgnored`); lo stesso vale per le voci di catalogo "cancellate altrove" nel push. Chiude S11 di `CODE-REVIEW-CLIENT.md`. Limite: le cancellazioni già applicate nelle pagine precedenti al superamento della soglia (< soglia) non si ripristinano.
Test: `src/sync/review2.test.ts` (tombstone catalogo/bozza, pull con breaker, push con breaker, resync completo, nessun loop).
