# Revisione indipendente del cuore fiscale (fatture) — 2026-11-04

Revisore: agente indipendente (non ha scritto il codice). Perimetro modificabile: `shared/fatturapa/**`, `shared/fiscal/**`, `src/pdf/**`, `src/pages/invoice/**`, `src/storage/{invoices,invoiceTotals,creditResidual}.ts`. Il resto è solo letto e segnalato.
Fonti fiscali: secondarie, **DA VERIFICARE** (vedi FISCAL-SPEC §0). Nulla qui è consulenza fiscale.
Test di regressione: `shared/fatturapa/review.test.ts`, `src/storage/review.test.ts`, `src/pdf/review.test.ts`, `src/pdf/review.fuzz.test.ts` (fuzzer, 160 documenti), più aggiunte in `src/pages/invoice/register.test.ts` e `src/pages/DocumentView.test.tsx`.

## Riepilogo per gravità

| Gravità | Trovati | Corretti (con test) | Aperti |
|---|---|---|---|
| Alta | 2 | 1 | 1 (fuori perimetro) |
| Media | 9 | 8 | 1 (fuori perimetro) |
| Bassa | 14 | 13 | 1 (fuori perimetro) |

I 4 difetti del QA (BUG-03, 05, 06, 08) sono inclusi e corretti (ultime righe della tabella Bassa).

## Alta

**REV-DB1 — APERTO (db.ts, fuori perimetro).** `getBackend().transact` ripiega silenziosamente su un archivio **in memoria vuoto** per qualunque errore IndexedDB che non venga dalla funzione di dominio (quota piena al commit, `tx.done` rifiutato, connessione chiusa da un upgrade in un'altra scheda). Da quel momento `broken=true` per sempre: la scheda mostra l'archivio vuoto e un'emissione riesce con numero `1/2026` e contatori azzerati, ma esiste solo in memoria. Rischio: numerazione duplicata e fatture "emesse" che spariscono alla ricarica. Correzione proposta: il ripiego su memoria solo se l'**apertura** del DB fallisce (mai dopo che ha funzionato); gli altri errori vanno rilanciati e mostrati ("spazio esaurito, libera memoria"). Non ho potuto testarlo senza toccare `db.ts`.

**REV-S1 — corretto.** `saveDocument` accettava una "fattura" non bloccata con `status` `emessa`/`inviata`/`stornata` o con `seq`/`number`/`xml` già valorizzati: restava modificabile, contava nei contatori (`maxIssued`) e nei registri, non era più emettibile né eliminabile. Ora `assertSaveAllowed` ammette per una fattura fiscale non bloccata solo bozza senza dati d'emissione. Test: `review.test.ts` (REV-S1).

## Media

- **REV-G3 — corretto.** `recordPayment` non limitava l'importo: un doppio click o un importo errato gonfiavano i ricavi per cassa e il controllo degli 85.000 €. Ora rifiuta oltre il residuo.
- **REV-G1 — corretto.** Si potevano registrare incassi su una **nota di credito** (contati nei ricavi). Ora rifiutato.
- **REV-G4 — corretto.** Dopo una nota di credito parziale (fattura 100, nota 40, cliente paga 60) la fattura restava "pagata in parte" per sempre. Ora il dovuto è totale meno note efficaci e lo stato si riallinea anche quando la nota arriva dopo l'incasso (`reconcileOriginal`).
- **REV-S2 — corretto.** Via `saveDocument` si potevano sostituire/cancellare `sdiEvents` e `payments` di una fattura emessa (es. togliere l'esito NS, aggirando i 5 giorni). Ora append-only (la sync, `allowLock`, è esclusa).
- **REV-E2 — corretto.** La finestra dei 5 giorni partiva dal momento in cui l'utente *registra* l'NS, non dalla data della notifica: registrando in ritardo si guadagnavano giorni. `SdiEventSheet` ha ora la data dell'invio/esito (default oggi, non nel futuro).
- **REV-F1 — corretto.** Il PDF mostrava prezzo unitario a 2 decimali, quantità a 3 e sconto a 1: `1000 × 0,125` appariva `1000 × 0,13 = 125,00`. Ora fino a 8 decimali come l'XML; sconto con 2 decimali come nel calcolo. (Anche nella scheda di storno.)
- **REV-X1 — corretto.** Nessun limite alle 11 cifre intere dello schema: qty `1e22` produceva `1e+21` nell'XML. Nuovo errore `amount_too_large` (riga e totali).
- **REV-X2 — corretto.** L'identificativo fiscale di un cliente estero arrivava nell'XML senza pulizia: un carattere di controllo rendeva il file **non ben formato**. Ora errore `invalid_chars`.
- **REV-S5 — corretto.** `invoice.stampDuty/stampAmount/stampDutyChargedToCustomer` congelati erano quelli della bozza, non quelli dell'XML (ricalcolato): registri e promemoria bolli potevano divergere. Ora normalizzati all'emissione.
- **REV-IMP1 — APERTO (index.ts, fuori perimetro).** `importBackup`/`parseBackup` non verifica che `xmlSha256` corrisponda all'XML né che un documento con status `emessa`+ abbia `lockedAt`: un backup modificato può sostituire fatture emesse o reintrodurre fatture "emesse" modificabili. `integrity.ts` lo rileva a posteriori, ma l'import non lo blocca. Proposta: in `parseBackup` rifiutare (o avvisare) hash non coerenti e status non-bozza senza `lockedAt`.

## Bassa

REV-X3 descrizione vuota dopo la pulizia (solo caratteri di controllo) → `<Descrizione/>` vuota: ora errore. REV-X4 quantità/prezzo oltre 8 decimali e Nome/Cognome oltre 60 caratteri arrotondati/troncati senza avviso: ora avvisi `precision_rounded`/`too_long`. REV-F2 nome cliente lungo troncato alla prima riga nel PDF. REV-S3 contatore/progressivo corrotto (NaN, stringa) → `NaN/2026` o progressivo `00NAN` (il `try/catch` in `progressivo()` mascherava il RangeError). REV-D2 soglia: a 85.000,00 esatti risultava "oltre"; ora oltre solo da 85.000,01. REV-D1 `cashCollectedCents` usava `Math.round(n*100)` invece di `toCents`. REV-H1 `xmlSha256` non protetto nel CSV del registro attività (arriva da backup/sync): possibile iniezione di formule. REV-H2 ZIP: lettere di unità (`C:`) nei nomi. REV-G2 data incasso non validata (`2026-13-45`) o nel futuro. REV-E1 esiti SDI nel futuro o precedenti all'evento già registrato. REV-S4/BUG-08 in forfettario l'IVA di riga viene congelata a 0 all'emissione (niente più "IVA 22% ignorata" nell'audit). BUG-03 filigrana BOZZA fuori viewport (`overflow:hidden`). BUG-05 casella "Storna riga" 44×44 px. BUG-06 la bozza "Rifai con un nuovo numero" mostra il link alla scartata.

**APERTO (fuori perimetro, bassa):** `DocumentsPage` "Da incassare" = totale − incassi senza sottrarre le note di credito parziali (con REV-G4 lo stato è giusto, la somma in testata no). **QuoteEditor** crea righe libere con `vat = defaultVat`: con REV-S4 non sporca più l'audit, ma l'avviso "IVA ignorata" compare ancora nell'anteprima di emissione; meglio che in forfettario le righe nascano con vat 0.

Nota test: `src/voice/executor.test.ts` (2 test: attesi 202,00 e 72,00 con "bollo") e `src/sync` (1 test termini) falliscono nel perimetro di altri agenti; i primi due attendono un bollo incluso nel totale anche se non addebitato, contro la regola E11 già implementata in `documentTotals`. Non toccati.

## Cosa ho controllato e NON ho trovato difetti

- **XML**: ordine e obbligatorietà degli elementi (header, DatiGenerali, DettaglioLinee, DatiRiepilogo, DatiPagamento) secondo la nostra lettura dello schema; nessun BOM; escape di `& < > " '` e `]]>` (nessun CDATA, quindi nessuna injection); caratteri fuori Latin-1 sostituiti con avviso; `ImportoTotaleDocumento` = somma imponibili = `ImportoPagamento`; `PrezzoTotale` = qty×prezzo×(1−sconto) entro 0,01; numerazione linee; TD04 con importi positivi, `DatiFattureCollegate`, nessun `DatiPagamento`; nome file e progressivo; cliente estero/PEC/consumatore. Fuzzer: 160 documenti con testi ostili, 150 emettibili, tutti coerenti (XML, scheda, PDF).
- **Numerazione**: l'emissione è atomica (profilo+documento+audit), con verifica a impronta e ripetizione tra schede; la seconda emissione della stessa bozza fallisce ("già emessa"); l'indice univoco IndexedDB chiude i duplicati residui; anno nuovo e sezionali separati; numero di partenza non abbassabile sotto l'emesso.
- **Immutabilità**: `lockedAt`, hash, cancellazione di emesse/note, duplica (azzera numero/XML/eventi), conversione da preventivo, modifica via URL (azioni per stato in `availableActions`).
- **Totali**: un solo calcolo in centesimi interi (`computeDocumentTotals`) per scheda, elenco, PDF, XML, CSV; bollo a 77,47 esatti non dovuto, 77,48 dovuto; sconti % e in euro; residuo stornabile e note parziali multiple.
- **Sicurezza client**: nessun `dangerouslySetInnerHTML`; nomi file PDF ripuliti (`fileNameFor`); CSV con protezione formule sui testi; ZIP senza `..` né percorsi assoluti.

## Ipotesi fiscali da far confermare al commercialista (senza inventare)

1. 5 giorni per il rinvio dopo NS: l'app usa 120 ore dall'evento registrato (con ora legale cambia di 1 ora sull'orologio a muro); la lettura "fine del quinto giorno" sarebbe più larga. Da chiarire anche da quale data decorrono (notifica SDI).
2. Anno di numerazione = anno della data operazione (checklist A3), anche se si emette a gennaio un documento di dicembre.
3. Bollo: soglia sull'importo dopo gli sconti; rimborso N1 fuori dalla base; bollo proprio sulle note di credito.
4. Ricavi per cassa: nel controllo degli 85.000 € gli incassi includono l'eventuale rimborso bollo e non sottraggono rimborsi per note di credito; manca il controllo dei 100.000 €.
5. Fatture scartate (NS) incluse nel CSV del registro con stato "Scartata" (non nei conteggi bolli/XML): corretto o da escludere?
6. Documento a importo zero (omaggio al 100%): oggi bloccato.
7. Formula `Percentuale`+`PrezzoTotale` per gli sconti e righe negative per sconti in euro: accettate dallo SDI? Serve prova sul portale AdE.
8. Identificativo di clienti esteri solo con CF e `CodiceDestinatario` `XXXXXXX`.
