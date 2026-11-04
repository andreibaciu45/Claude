# QA REPORT — VocePreventivo V2 (PWA + server locale)

Data: 2026-11-04. Agente QA. Ho toccato solo `e2e/**`, `scripts/qa/**` e questo file; nessuna modifica a `src/`, `shared/`, `server/`.
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

## Esito dell'ultimo run completo (build di fine sessione): 6/10 scenari PASS

| Scenario | Esito | Note |
|---|---|---|
| 01 onboarding, catalogo, dettatura testuale, PDF | PASS 25/25 | PDF controllato con `pdftotext` |
| 02 emissione, XML, invio, RC, incasso | PASS 31/31 | XML well-formed (`xmllint`), RF19, N2.2, TD01, DatiBollo, ProgressivoInvio = nome file |
| 03 note di credito totale/parziale/residuo | PASS 34/34 | TD04, DatiFattureCollegate, NC1..NC3 |
| 04 immutabilita' | FAIL 23/24 | BUG-02 |
| 05 numerazione, ricarica, backup/ripristino | PASS 21/21 | include limite Free con orologio finto |
| 06 fattura scartata (NS) | FAIL 23/24 | BUG-06 |
| 07 comandi vocali testuali | PASS 29/29 | |
| 08 account, sync, secondo dispositivo, conflitto, offline | FAIL 30/31 | BUG-07 |
| 09 accessibilita' | FAIL 11/13 | BUG-03, BUG-08 |
| 10 numero di partenza | PASS 10/10 | scenario aggiunto da un altro agente, non scritto da me |

Nessun errore in console / `pageerror` in nessuno scenario dell'ultimo run (controllo automatico a fine di ogni scenario).

## Bug dell'app APERTI (alla fine della sessione)

Nessun bloccante e nessuno di gravita' alta aperti. Sotto, per gravita'.

### BUG-01 — MEDIA — La conferma vocale mostra un importo diverso dal documento
- Passi: profilo forfettario, bozza fattura 1 riga da 80,00 (bollo 2 € a carico dell'emittente), pagina della bozza, widget voce, scrivere "emetti la fattura".
- Atteso: l'importo nella scheda coincide con il totale del documento (80,00 €, bollo a carico dell'emittente).
- Ottenuto: la scheda "Emettere questa fattura?" mostra "Importo 82,00 €" con nota "Include marca da bollo di 2,00 €", mentre il documento e la scheda di emissione manuale riportano 80,00 € e "bollo a tuo carico".
- Screenshot: `e2e/out/07-comandi-vocali/08-emetti-d1-scheda-conferma.png` (build intermedia; da riverificare dopo le ultime modifiche a `src/voice/describe.ts`).
- File sospetto: `src/voice/describe.ts` / `src/voice/resolve.ts` (somma bollo senza guardare `stampDutyChargedToCustomer`).
- Riproduzione automatica: scenario 07, controlli sulla scheda conferma (sono PASS perche' verificano il comportamento, non l'importo: l'importo e' solo visibile negli screenshot).

### BUG-02 — BASSA — `/?edit=ID` con id inesistente dopo aver aperto una fattura emessa mostra ancora "Documento emesso: non modificabile"
- Passi: aprire `#/?edit=<id di una fattura emessa>` (si vede "non modificabile"), poi navigare (senza ricaricare) a `#/?edit=non-esiste`.
- Atteso: "Documento non trovato".
- Ottenuto: resta il messaggio della fattura emessa precedente; dopo una ricarica e' corretto.
- Causa: `lockedDoc` non viene azzerato quando cambia `editId`. File: `src/pages/NewQuotePage.tsx` (effetto di caricamento, ~righe 80-95: manca `setLockedDoc(null)` / reset di `original`).
- Impatto: nessun rischio fiscale (la modifica resta comunque impossibile). Scenario 04, controllo "edit con id inesistente (navigazione interna)".

### BUG-03 — BASSA — La filigrana "BOZZA" allarga il contenuto oltre il viewport (scrollWidth 493 px su 390)
- Passi: viewport 390x844, aprire una bozza di fattura (`#/documenti/<id>`).
- Atteso: nessun contenuto oltre la larghezza dello schermo.
- Ottenuto: `body.scrollWidth` = 493 px; `html`/`body` hanno `overflow-x:hidden` quindi non c'e' scroll visibile, ma su browser mobile (iOS) il layout puo' risultare allargato/spostabile; gli screenshot a pagina intera escono larghi 493 px. Su tablet/desktop non si verifica.
- Causa: pseudo-elemento `.dv-paper[data-draft="true"]::after` (font 5rem, letter-spacing, `rotate(-24deg)`). File: `src/pages/invoice/invoice.css` righe ~37-38 (aggiungere `overflow:hidden` al `.dv-paper[data-draft]` o ridurre il font).
- Scenario 09: controlli "nessuno scroll orizzontale" e "sheet/widget".

### BUG-04 — BASSA — Il toast copre il pulsante a pressione prolungata
- Osservato nel primo run (build iniziale): subito dopo un'emissione, aprendo la scheda "Annulla con nota di credito" in modalita' parziale, il toast "Fattura emessa" (3,5 s) si trovava sopra il pulsante di conferma e intercettava il puntatore (`document.elementFromPoint` sul centro del pulsante restituiva `.toast`): la pressione prolungata non partiva.
- Atteso: i toast non devono intercettare i tocchi sulle schede di conferma (es. `pointer-events:none` o posizione sopra la scheda).
- Ottenuto: la pressione cade sul toast.
- File sospetto: `src/styles/*.css` (`.toast-region`, z-index sopra `.sheet`).
- NON rivalidato sulla build finale (il layout e' cambiato); la suite aspetta che i toast spariscano prima di ogni pressione prolungata (`hold()` in `e2e/lib.cjs`), quindi il difetto non farebbe fallire gli scenari. Da riverificare a mano.

### BUG-05 — BASSA — Casella "Storna riga N" di 28x28 px nel storno parziale
- Passi: fattura emessa con 2 righe, "Annulla con nota di credito", "Storno parziale", 390 px.
- Atteso: target touch >= 44x44 px.
- Ottenuto: l'`input[type=checkbox]` misura 28x28 px e non e' avvolto in una `label` cliccabile da 44 px.
- File: `src/pages/invoice/CreditNoteSheet.tsx` (`.iv-credit-line`), stile in `src/pages/invoice/invoice.css`.
- Misurato in un run intermedio (scenario 09); nell'ultimo run il controllo "sheet/widget" fallisce gia' per BUG-03 e riporta anche questo se presente.

### BUG-06 — BASSA — La bozza creata con "Rifai con un nuovo numero" non mostra il collegamento alla fattura scartata
- Passi: fattura scartata (NS) entro 5 giorni, "Rifai con un nuovo numero", "Crea la bozza collegata".
- Atteso: sulla bozza compare "Rifa' la fattura scartata n. 2/2026" (come avviene sulla fattura emessa dopo l'emissione).
- Ottenuto: la bozza non mostra nessun collegamento; il link compare solo dopo l'emissione e, sulla scartata, "Rifatta come nuova fattura n. 3/2026".
- File: `src/pages/DocumentView.tsx` (i link `resubmissionOf` stanno solo in `InvoicePanel`, mostrato solo per le emesse). Scenario 06.

### BUG-07 — BASSA — Login: l'errore "Inserisci un indirizzo email valido" resta visibile anche dopo aver corretto l'email
- Passi: `#/account`, scrivere "non-una-email", "Inviami il codice" (errore), poi scrivere un'email valida.
- Atteso: l'errore sparisce quando il valore diventa valido (o al successivo invio).
- Ottenuto: resta visibile (screenshot `e2e/out/08-account-sync/07-eccezione.png` della build intermedia). Poi, con la casella dei Termini non spuntata, l'utente vede insieme due errori di cui il primo e' obsoleto.
- File: `src/pages/account/LoginForm.tsx` (lo stato `error` non viene azzerato in `onChange`). Scenario 08.

### BUG-08 — BASSA — Avviso spurio sulle righe manuali nel regime forfettario
- Passi: profilo forfettario, bozza fattura con "+ Riga libera" (IVA di default 22%), emettere.
- Ottenuto: nel registro attivita' e nella cronologia compare "Avvisi: Riga 1: nel regime forfettario l'IVA e' sempre 0: l'aliquota 22% verra' ignorata", anche se l'utente non ha mai visto/scelto un'aliquota (in forfettario il campo IVA non e' mostrato).
- Atteso: nessun avviso, oppure la riga nasce con IVA 0 in forfettario.
- File: `src/pages/quote/QuoteEditor.tsx` (`newLine(p.defaultVat)`) e `src/storage/invoices.ts` (warning al momento dell'emissione). Rumore nell'audit di ogni fattura.

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
- **Limite Free locale (3 documenti/mese)**: il piano Free blocca il 4o documento anche senza account (`src/billing`, "limite morbido" dichiarato nel codice). Per l'E2E uso un orologio finto che avanza il mese (solo scenario 05); gli altri scenari restano sotto i 3 documenti. CONTRACT-V2 attribuisce il limite al server: confermare che il blocco locale e' voluto.
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
