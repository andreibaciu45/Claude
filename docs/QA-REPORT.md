# QA REPORT — VocePreventivo V2 (PWA + server locale)

Data: 2026-11-04. Agente QA + BUGFIX-QA (correzioni in `src/voice`, `NewQuotePage`, `quote/`, `LoginForm`, `ui`, `styles`).
Dati fiscali solo fittizi con checksum valido (cedente P.IVA 01234567897 / CF BNCMRA80A01H501A, cliente P.IVA 02345678904).
Le fonti fiscali restano DA VERIFICARE da un commercialista: questo report verifica il comportamento dell'app, non la correttezza fiscale.

## Come rilanciare

```
node e2e/run.cjs                  # build privata (e2e/tmp/dist) + server statico :4180 + server API :8798 + tutti gli scenari
node e2e/run.cjs --only 02,05     # solo alcuni scenari
node e2e/run.cjs --no-build       # senza ricostruire la PWA
node e2e/run.cjs --no-servers     # usa :4180 e :8798 gia' avviati
node e2e/scenarios/02-fattura-emissione-xml.cjs   # un singolo scenario (servono i server attivi)
```
Esito: codice 0 se tutti PASS. Screenshot di ogni passo e `result.json` in `e2e/out/<scenario>/`, riepilogo in `e2e/out/summary.json`.
Il server API gira con DB temporaneo in `e2e/tmp`, `AUTH_DEV_RETURN_CODE=1`, `AUTH_SECRET=test-secret-not-real`. La PWA e' raggiunta dal server API tramite un proxy di test in Playwright (`context.route('**/v1/**')`), perche' `vite preview` non ha il reverse proxy che in produzione fa Caddy.
La build e' privata (`e2e/tmp/dist`) per non toccare `dist/`, che altri agenti ricostruivano in parallelo (mi aveva causato 404 sui chunk).

## Esito dell'ultimo run completo (2026-11-04, `node e2e/run.cjs`, build privata): 11/11 scenari PASS

| Scenario | Esito |
|---|---|
| 01 onboarding, catalogo, dettatura, PDF | PASS 25/25 |
| 02 emissione, XML, invio, RC, incasso | PASS 31/31 |
| 03 note di credito | PASS 34/34 |
| 04 immutabilita' | PASS 24/24 |
| 05 numerazione, ricarica, backup/ripristino | PASS 21/21 |
| 06 fattura scartata (NS) | PASS 24/24 |
| 07 comandi vocali testuali | PASS 29/29 |
| 08 account, sync, conflitto, offline | PASS 31/31 |
| 09 accessibilita' | PASS 13/13 |
| 10 numero di partenza | PASS 10/10 |
| 11 regressioni BUG-01/02/04/07 (nuovo) | PASS 11/11 |

Contemporaneamente: `npm run typecheck` e `npm test` verdi (1147 test client, 184 server). Nessun errore console/`pageerror`.
Nota: un server API rimasto in ascolto su :8798 da una sessione precedente (DB persistente) faceva scattare il rate limit OTP (429) nello scenario 08; `run.cjs` lo riusa ("porta gia in uso"). Se succede, terminare quel processo e rilanciare.

## Stato dei BUG

| Bug | Stato | Note |
|---|---|---|
| BUG-01 media, conferma vocale con importo diverso | CORRETTO | `src/voice/executor.ts` usa `documentTotals` (come scheda/PDF/XML); la scheda dice se il bollo e' a carico dell'emittente (fuori dal totale) o del cliente (incluso). Test unitari + scenario 11 |
| BUG-02 bassa, edit inesistente dopo emessa | CORRETTO | `NewQuotePage` azzera `lockedDoc`/`original` a ogni cambio di `editId`. Scenari 04 e 11 |
| BUG-03 bassa, filigrana BOZZA oltre il viewport | CORRETTO da altri agenti (src/pages/invoice) | scenario 09 PASS |
| BUG-04 bassa, toast sopra il pulsante a pressione prolungata | CORRETTO | `.toast` con `pointer-events:none`; con una scheda aperta il contenitore passa in alto (z-index 60 sopra le schede, mai sui pulsanti). Scenario 11 verifica `elementFromPoint` sul pulsante di conferma |
| BUG-05 bassa, checkbox storno 28x28 | CORRETTO da altri agenti | scenario 09 PASS |
| BUG-06 bassa, bozza "Rifai" senza collegamento | CORRETTO da altri agenti | scenario 06 PASS |
| BUG-07 bassa, errore email nel login | CORRETTO | `LoginForm` azzera l'errore al cambio di email/codice. Scenari 08 e 11 |
| BUG-08 bassa, avviso IVA spurio in forfettario | CORRETTO | le righe libere/da catalogo nascono con vat 0 e natura N2.2 in forfettario (`QuoteEditor.newLine`), test `newLine.test.ts` |
| Extra | CORRETTO | autosalvataggio della bozza locale non riscrive piu' la bozza dopo il salvataggio (causava a volte la bozza "fantasma" in scenario 10) |

Lo scenario 05 usava un testo ormai superato del ripristino (ora serve la spunta "Ho capito" e il pulsante puo' chiamarsi "Ripristina i dati"): script corretto.

## Comportamento atteso (NON e' un bug)
- **Piano Free: il blocco locale del 4o documento del mese e' VOLUTO.** E' un limite morbido lato client; resta vincolante lato server per i dati sincronizzati (CONTRACT-V2: Free = 3 documenti/mese). Per l'E2E uso un orologio finto che avanza il mese (scenario 05).

## Bug rilevati durante la sessione e poi CORRETTI (verificati con rilancio)

Altri agenti hanno modificato l'app mentre la suite veniva scritta; questi difetti c'erano nelle prime build e nell'ultimo run non si riproducono piu'.
- **ALTA (sync multi-dispositivo)**: una fattura emessa non arrivava mai su un secondo dispositivo pulito ("1 modifiche arrivate dal server sono state ignorate"); `applyRemote` usava `saveDocument`, che rifiutava un documento gia' bloccato (`assertSaveAllowed`, `src/storage/invoices.ts`). Ora c'e' `saveSyncedDocument` e lo scenario 08 verifica che la fattura 1/2026 compaia su B e D2, bloccata e con XML.
- **MEDIA (numerazione)**: il campo profilo "Prossimo n. fattura" non influenzava la numerazione fiscale (restava 1 dopo 4 emissioni; impostarlo a 50 non cambiava nulla) e non esisteva modo di impostare il numero di partenza per chi proviene da un altro programma. Ora c'e' la scheda "Numerazione fatture elettroniche" (scenari 05 e 10).
- **MEDIA (NC)**: la UI permetteva di selezionare di nuovo una riga gia' stornata, con errore solo dal backend; ora il checkbox e' disabilitato, il residuo e' mostrato e c'e' "Storna il residuo".

## Cose che hanno funzionato (verificate)
- Emissione solo con casella + pressione >= 1,2 s: tocco breve, 0,5 s/0,6 s, rilascio anticipato da tastiera non emettono; alternativa "CONFERMO" presente.
- Numerazione senza buchi (1,2,3; cancellare una bozza non consuma numeri; sezionale NC separato); persiste a ricarica; import di un backup piu' vecchio NON fa regredire i contatori (avviso mostrato); wipe di IndexedDB + ripristino da backup ok; backup corrotto respinto.
- Immutabilita': nessun Modifica/Elimina su emessa, `/?edit=ID` mostra "non modificabile" (anche con `&focus=`), bozza modificabile/eliminabile, la bozza cancellata non consuma il numero.
- XML: nome `IT01234567897_xxxxx.xml`, `ProgressivoInvio` coerente, RF19, N2.2, TD01/TD04, DatiBollo solo > 77,47 €, `DatiFattureCollegate`, "Correggi e rinvia" mantiene numero e data con nuovo progressivo.
- Voce: "emetti la fattura" senza conferma non emette; "sì", "ok", "conferma" generico non bastano; pressione prolungata o frase "conferma emissione" si; la frase di emissione non conferma uno storno; "annulla la fattura 1 con nota di credito" richiede conferma esplicita; "elimina" su emessa rifiutato.
- Account: OTP con devCode, prima sincronizzazione con riepilogo, push/pull, secondo dispositivo pulito, offline con ripresa (coda, nessuna perdita), conflitto di numero duplicato segnalato con documento locale conservato e server che non accetta il duplicato.
- Accessibilita' di base: nessuno scroll orizzontale visibile su 11 rotte x 3 viewport (tranne BUG-03), target >= 44 px (tranne BUG-05), focus visibile, nomi accessibili, `lang="it"`, `role=dialog` + Esc.

## Osservazioni (non bug dell'app, o scelte di progetto da confermare)
- **Limite Free locale**: confermato come voluto (vedi "Comportamento atteso").
- **Emissione offline**: da offline si emette e si assegna un numero in locale (nessuno stato `da_emettere` come in ARCHITECTURE-V2 §2.4). Conforme al limite noto di CONTRACT-V2 (collisione di numero tra due dispositivi offline, segnalata come conflitto). Con un duplicato l'unica scelta offerta e' "Tieni solo la mia, non inviare": la fattura locale emessa non e' piu' sincronizzabile e non c'e' un percorso di risoluzione (rinumerazione impossibile per legge): da definire con il commercialista.
- Dopo un conflitto la scheda Account mostra "1 conflitto" e "Tutto aggiornato." insieme.
- XML non validato contro XSD (`docs/xsd/` non esiste nel repo): controllati solo well-formedness e gli elementi chiave.

## Errori dello SCRIPT (non bug dell'app) incontrati e corretti
- Il pulsante a pressione prolungata veniva premuto mentre un toast lo copriva (vedi BUG-04): ora `hold()` attende la scomparsa dei toast.
- Lo Skeleton di caricamento (`aria-busy`) e il banner della route (`role=status`) mi hanno fatto leggere pagine non ancora pronte o dare "strict mode violation": `go()` aspetta lo Skeleton, i test usano `getByRole('heading')`.
- La scheda "Prima sincronizzazione" compare in modo asincrono: il login helper la aspetta prima di decidere.
- Una build condivisa in `dist/` veniva sostituita da altri agenti (404 sui chunk): build privata in `e2e/tmp/dist`; `vite preview` si e' fermato due volte: sostituito da `scripts/qa/static-server.cjs`.
- Testi dell'app cambiati nel corso della sessione (consenso Termini nel login, nuova scheda numerazione, nuovo widget voce nascosto sulla schermata di dettatura): scenari aggiornati di conseguenza. Il FAB voce e' nascosto sulla schermata di dettatura: i comandi si provano da `#/documenti`.

## NON provato / limiti
- **Microfono reale e riconoscimento vocale** (Web Speech, registrazione + trascrizione server): provati solo i comandi testuali dal campo "Scrivi un comando". In Chromium headless il widget si apre in ascolto ma senza audio.
- **iOS/Safari, Android reale, PWA installata**, standby/schermo spento, tastiera virtuale: non provati (solo Chromium con emulazione 390x844 touch, 768x1024, 1280x800). Service worker disabilitato negli scenari (altrimenti memorizzerebbe le risposte API); l'avvio offline da cache non e' provato.
- Validazione XML contro XSD ufficiale e prova di invio reale allo SDI/provider: non possibili (nessun XSD, nessun provider). Solo `MockProvider`/registrazione manuale.
- Stripe/checkout, piano Pro, quota server oltre il Free, webhook SDI, trascrizione/LLM server (`/v1/voice/*`): non provati.
- Lettori di schermo, contrasto colori quantitativo (solo screenshot in tema scuro), `prefers-reduced-motion`.
- Scadenze temporali reali (12 giorni, 5 giorni dallo scarto): non simulate con l'orologio; solo i testi.
- Concorrenza di due schede dello stesso browser sulla stessa numerazione.
- Rate limit OTP (le email di prova sono uniche per run).
