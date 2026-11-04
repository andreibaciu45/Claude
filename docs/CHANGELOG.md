# Storia del progetto, per funzione

**Aggiornato il 4 novembre 2026.** Versione 0.1.0 (non ancora in vendita). La storia è raccontata **per funzione**, non per modifica: tutto il lavoro è stato svolto nello stesso giorno da più agenti in parallelo, quindi le date dei singoli passaggi non aggiungono informazione. L'ordine dentro ogni voce è cronologico. Per lo stato attuale e i rischi vedi `docs/STATO-PRODOTTO.md`.

## Preventivo a voce e interpretazione delle frasi

- Prima versione: dettatura o testo, riconoscimento di quantità, unità e prezzi, abbinamento alle voci del listino personale, righe "da verificare" quando la voce non si trova, totali, PDF del preventivo e invio su WhatsApp.
- **Motore di dettatura 2**: interpretazione molto più accurata (sconti in percentuale e in euro, IVA, unità, clienti dalla rubrica). Misurato su frasi scritte da noi: dal 72,7% al 100% sul banco cieco (non più indipendente dopo le correzioni) e 92,5% al primo passaggio su un set finale di 80 frasi nuove. Non misura il microfono reale.
- **Informativa sul microfono** da accettare la prima volta (anche sulla dettatura della schermata "Nuovo", prima aggirata), con scelta di scrivere invece di parlare.

## Comandi vocali

- Comandi dopo il preventivo: aprire, elencare, convertire, segnare un incasso, duplicare, cambiare stato, con annullamento per 6 secondi.
- **Politica di sicurezza**: emettere una fattura o fare una nota di credito non partono mai con la sola voce; servono riepilogo e conferma con pressione prolungata (circa 1 secondo) o la frase "conferma emissione/storno". Dopo la revisione del client la conferma è legata alla versione del documento mostrata e il doppio tocco non registra due incassi.
- Esempi "Cosa posso dire?" verificati contro il riconoscitore; campo "Scrivi un comando" sempre disponibile; app non aggiornata mentre un comando è in corso.

## Fattura elettronica (XML FatturaPA) e regole fiscali

- Generatore XML per forfettari (FPR12, TD01 e TD04, RF19, N2.2), validazione prima dell'emissione, bollo da 2 € (rimborso al cliente con natura N1), nome file e progressivo di invio, PDF "copia di cortesia".
- **Numerazione**: contatore per anno e sezionale (FT/NC), assegnazione solo all'emissione, in un'unica operazione con documento e registro; nessun numero consumato se qualcosa fallisce.
- **Immutabilità**: una fattura emessa non si modifica né si cancella (anche via sincronizzazione o backup); correzioni con **nota di credito** totale o parziale, più note fino all'importo originale, bollo proprio sulla nota.
- **Fattura scartata dallo SDI**: stato "scartata", **"Correggi e rinvia"** con stesso numero e data entro 5 giorni dalla data dell'esito (XML precedente archiviato con impronta), oppure nuova fattura collegata oltre i 5 giorni.
- **Numero di partenza** per chi ha già emesso altrove (ultimo numero già usato, con blocchi e doppia conferma se si abbassa).
- **Dicitura di legge unica**: lo stesso testo in XML, PDF e anteprima; il bollo compare ora anche nella Causale dell'XML.
- **Sconti**: in percentuale sulle righe e in euro come riga negativa (con modalità XML alternativa pronta ma spenta); bollo calcolato dopo lo sconto.
- **Incassi e ricavi per cassa**: registrazione degli incassi con controlli (non oltre il residuo, non su note di credito, date valide), indicatore degli incassi rispetto a 85.000 € con avvisi dall'80%.
- **Per il commercialista**: registro fatture in CSV, ZIP di tutti gli XML emessi, registro delle attività (esportabile), riepilogo dell'anno con fatturato, da incassare e bolli per trimestre.
- **Revisione indipendente del cuore fiscale**: 25 difetti trovati, tutti corretti dopo la revisione (immutabilità, incassi, finestra dei 5 giorni, formattazione del PDF, XML, bollo). Le 8 ipotesi fiscali restano da far confermare.

## Archivio sul telefono, backup e integrità

- Archivio nel browser (IndexedDB) con migrazione dalla prima versione, profilo, listino, documenti, **rubrica clienti** (con omonimi, unione, CSV).
- **Backup** in file con anteprima del contenuto e promemoria dopo 14 giorni; ripristino con verifica delle fatture emesse (impronta, numeri, note di credito) che **rifiuta i file alterati**.
- **Controllo dati** (numerazione, doppioni, XML, note orfane) e cancellazione dei dati locali con conferma e copia di sicurezza.
- **Banner di errore dell'archivio** e blocco delle scritture fiscali se il browser non salva (spazio finito, navigazione privata, connessione persa); corretto il difetto per cui si poteva emettere solo in memoria.

## Account, sincronizzazione, piani

- **Accesso con codice via email**, senza password; termini da accettare; codici invito per il lancio riservato; il codice è passato a 8 cifre con difese contro i tentativi distribuiti.
- **Sincronizzazione** tra dispositivi con coda offline, ripresa dopo errori di rete, conflitti sulle bozze mai sovrascritti in silenzio ("Usa quella del server / Tieni la mia / Tieni entrambe"), registro di sincronizzazione, protezione dalle cancellazioni di massa, gestione del cambio account su un telefono condiviso.
- **Revisione indipendente dell'app** (account, piani, voce): 24 difetti trovati, 20 corretti subito e gli altri chiusi dopo (tra cui fatture emesse su un altro telefono che non arrivavano, coda dell'account A inviata all'account B, cancellazioni di massa).
- **Piani Gratis/Pro**: 3 documenti nuovi al mese nel Gratis (contano anche conversioni e duplicati; non le note di credito), contatore e schermata gentile al limite, Pro illimitato con sincronizzazione, pagamento con Stripe e portale di disdetta, tolleranza di 14 giorni offline, nessun prezzo nell'app nativa.
- **Account e dati**: esportazione di tutti i dati, cancellazione dell'account con le fatture emesse conservate per obbligo di legge, avviso sull'orologio sballato.

## Server e operazioni

- Server con autenticazione, sincronizzazione, trigger che impediscono di modificare le fatture emesse, cifratura dei campi sensibili, coda e worker per un futuro invio SDI (oggi solo un finto provider), voce (trascrizione), abbonamenti Stripe.
- **Strumenti per chi gestisce il servizio**: comando di amministrazione (clienti, licenze Pro a mano, codici invito, statistiche, controllo integrità, backup e prova di ripristino, cambio chiave), metriche, controllo di salute, manutenzione automatica, arresto ordinato.
- **Revisione indipendente del server**: 16 difetti trovati e corretti con 26 test di regressione (tra cui disco riempibile dall'audit, coda SDI bloccata, riabbonamento Stripe, numeri doppi). Poi: difese contro l'indovinare il codice di accesso, archiviazione dell'audit non fiscale, catena di controllo sulle emissioni con "sigillo" da conservare fuori dal server, controllo di salute di sola lettura.
- **Infrastruttura** (`infra/`, `docs/DEPLOY.md`, `docs/OPERAZIONI.md`): installazione senza Docker su un VPS (Caddy, server, Litestream, timer di backup e prova di ripristino), deploy manuale con ritorno automatico alla versione precedente, variante Docker facoltativa, workflow GitHub solo manuali. Mai eseguita su un server vero.

## App installabile (PWA) e app per gli store

- Installabile dal browser, funziona senza rete (service worker), avviso "È disponibile una nuova versione" non invasivo (non ricarica mai da solo e aspetta la fine di emissioni e conferme in corso).
- **Sicurezza del sito**: regole del contenuto (CSP) senza `unsafe-inline`/`unsafe-eval`, intestazioni di sicurezza, service worker che non conserva mai le chiamate all'API; audit delle dipendenze (0 vulnerabilità in produzione) e delle licenze.
- **App Android/iOS** (wrapper Capacitor in `mobile/`): voce nativa, salvataggio/condivisione file, regole per gli store in `docs/MOBILE.md`. Cartelle generate ma **mai costruite né provate su un telefono**.

## Aspetto, accessibilità, velocità

- Design system, tema chiaro/scuro, contrasti AA, aree toccabili da 44 px, focus visibile, collegamento "Vai al contenuto", titolo e annuncio a ogni cambio pagina, pila inferiore microfono/avvisi.
- Caricamento a pezzi per rotta (da 1.083 a 429 kB il pacchetto iniziale).

## Documentazione e materiali di lancio

- Specifica fiscale con il grado di certezza di ogni affermazione, architettura, contratto dati.
- **Pacchetto per il commercialista** (leggimi, checklist fiscale con colonna "Esito", esempi XML, rischi e responsabilità), manuale d'uso, FAQ per l'assistenza, prezzi e costi.
- Pagine legali e privacy in bozza (`public/legal/`, `docs/privacy/`).
- Ricerca di mercato (con concorrente diretto individuato), posizionamento onesto, guida alle interviste, piano di go-to-market, checklist di lancio, 11 guide SEO in italiano, landing statica, piano di contenuti social.
- Tutti i documenti per utenti e commercialista sono stati **riallineati al codice attuale il 4 novembre 2026** (seconda stesura).

## Collaudo

- **Test automatici**: 1.758 al 4 novembre 2026 (1.190 app, 184 condivisi, 384 server), con test sui totali (anche su documenti casuali), sulle bozze, sulla numerazione con operazioni casuali e sulla convergenza della sincronizzazione; comando unico `scripts/test/all.sh`; test instabili e legati alla data corretti (`docs/TEST-REPORT.md`).
- **Suite E2E** in browser reale (`node e2e/run.cjs`): 11 scenari, 11/11 verdi; hanno trovato e fatto correggere difetti reali (fatture emesse che non arrivavano su un secondo telefono, numero di partenza ignorato, conferma vocale con totale diverso, avvisi spuri in forfettario).
- **Non provato**: microfono vero, telefoni veri, schema XSD ufficiale, SDI vero, Stripe vero, server vero (vedi `docs/STATO-PRODOTTO.md`).
