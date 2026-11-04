# VocePreventivo — Stato del prodotto (per il proprietario)

**Aggiornato il 4 novembre 2026.** Una pagina, senza gergo tecnico. Dettagli e fonti nei documenti indicati tra parentesi. Versione del programma: 0.1.0.

**In una frase:** l'app è completa e funziona nelle prove automatiche, ma **non è mai stata provata nel mondo reale** (telefoni veri, microfono vero, fatture vere sul portale dell'Agenzia, pagamenti veri, server vero) e le **regole fiscali non sono state controllate da un commercialista**. Non è pronta per vendere finché questi punti non sono chiusi.

## 1. Cosa è pronto

- **Per l'artigiano:** dettare o scrivere un preventivo, listino e rubrica clienti, PDF e invio su WhatsApp, conversione in fattura, fattura elettronica XML + copia PDF, nota di credito, fattura scartata con "Correggi e rinvia", numero di partenza per chi ha già emesso altrove, incassi, sconti, bollo, comandi vocali con conferma a pressione prolungata, backup e controllo dati, funzionamento senza internet, installazione dal browser.
- **Per il commercialista:** registro fatture in CSV, ZIP di tutti gli XML, registro delle attività, indicatore degli incassi rispetto agli 85.000 €.
- **Account facoltativo:** accesso con codice via email, sincronizzazione tra telefoni, gestione dei conflitti, piani Gratis (3 documenti al mese) e Pro (15 €/mese o 120 €/anno, prezzi provvisori), pagamento con carta, esportazione e cancellazione dei dati.
- **Server e gestione:** server con cifratura, strumenti di amministrazione, backup e ripristino, guida al deploy (`docs/DEPLOY.md`) e alle operazioni quotidiane (`docs/OPERAZIONI.md`).
- **Documenti:** manuale e FAQ per gli utenti, pacchetto per il commercialista, bozze legali e privacy, piano di lancio, posizionamento onesto (nessun "unico" o "primo").

## 2. Cosa è provato, e come

| Cosa | Come | Dove |
|---|---|---|
| Calcoli, XML, numerazione, immutabilità, sync, server | **1.758 test automatici** (1.190 app, 184 condivisi, 384 server) e controllo dei tipi, tutti verdi il 4/11/2026 (un test dell'app, "Backup", può fallire una volta sotto carico e passa riprovando) | `docs/TEST-REPORT.md`, `scripts/test/all.sh` |
| Percorsi completi dell'utente | **11 scenari** in un browser reale (Chromium) che simula un telefono: onboarding, emissione, nota di credito, scarto, backup, account, accessibilità. 11/11 verdi, ultimo esito registrato | `docs/QA-REPORT.md`, `e2e/run.cjs` |
| Qualità del codice | 3 revisioni indipendenti (fatture: 25 difetti; app: 24; server: 16), difetti corretti con test | `docs/CODE-REVIEW-*.md` |
| Sicurezza del sito | Controlli con un server Caddy vero: intestazioni, service worker, nessuna violazione di sicurezza nel percorso completo; nessuna vulnerabilità nelle dipendenze di produzione | `docs/SECURITY-FRONTEND.md`, `docs/DIPENDENZE.md` |
| Interpretazione delle frasi | 74 frasi su 80 interpretate giuste al primo passaggio (92,5%), su frasi **scritte da noi, non da artigiani** | `src/engine/bench/` |

## 3. Cosa NON è provato

- **Microfono vero e riconoscimento vocale**, in cantiere e con rumore: provati solo i comandi scritti.
- **iPhone e Android veri**, installazione dalla schermata Home, avvio senza rete, aggiornamento dell'app (`docs/MOBILE.md`: nemmeno le app per gli store sono mai state costruite o aperte).
- **Schema XSD ufficiale** dell'Agenzia delle Entrate: non scaricato; l'XML non è mai stato validato contro di esso.
- **SDI reale**: nessuna fattura è mai stata caricata sul portale. Nessun provider di invio scelto.
- **Stripe reale**: checkout, webhook, disdetta e rimborso mai provati con pagamenti veri.
- **VPS reale**: il deploy, i backup su bucket, le email di accesso e il monitoraggio non sono mai stati eseguiti su un server vero.
- **Utenti reali**: nessun artigiano ha usato l'app; nessuna intervista fatta.

## 4. Rischi aperti, dal più grave

**Alta**
1. **Regole fiscali non verificate.** Bollo, numerazione, diciture, termini (12 giorni, 5 giorni dallo scarto), sconti come righe negative, soglia dei ricavi: tutto basato su siti di consulenza, non su fonti ufficiali. Le 8 ipotesi più delicate sono in `docs/COMMERCIALISTA/01-CHECKLIST-FISCALE.md` sezione L. Un errore si ripete in tutte le fatture.
2. **XML mai accettato da un SDI vero.** Se lo schema non è rispettato, le fatture vengono scartate (`docs/QA-REPORT.md`, checklist riga H1).
3. **Responsabilità e testi legali.** Termini, privacy e limitazioni di responsabilità sono bozze non riviste da un legale; nessuna assicurazione decisa (`docs/COMMERCIALISTA/03-RISCHI-E-RESPONSABILITA.md`).
4. **Nessuna prova su dispositivi reali** (in particolare microfono su iPhone e in cantiere): è il motivo principale per cui un artigiano potrebbe lasciare l'app.
5. **Numerazione con due telefoni.** Se due telefoni emettono insieme senza internet possono dare lo stesso numero; il server rifiuta il doppione ma una fattura già emessa non si può rinumerare e non c'è un percorso di risoluzione. Il manuale dice di emettere da un solo telefono (`docs/QA-REPORT.md`, `docs/CODE-REVIEW-SERVER.md`).

**Media**
6. L'app **non controlla davvero i limiti del forfettario**: solo un avviso sugli incassi registrati nell'app (85.000 €); nessun controllo dei 100.000 € né delle cause di esclusione.
7. **L'invio allo SDI è manuale**: l'artigiano può dimenticarlo; l'app segna "Emessa" ma non sa se è stato inviato, e non manda promemoria. Gli esiti SDI li digita l'utente, quindi il server non può verificare che siano veri (`docs/CODE-REVIEW-SERVER.md` #5).
8. **Privacy della voce:** il browser può inviare l'audio a Google o Apple, su iPhone anche ai nostri server per la trascrizione. C'è un avviso al primo uso; il testo va fatto rivedere dal legale.
9. **La rubrica clienti non si sincronizza** con l'account (solo backup): chi cambia telefono deve ricostruirla.
10. **Mercato:** il vero concorrente è lo status quo gratuito; il prezzo (120 €/anno senza invio SDI) è alto rispetto ai gestionali italiani (`docs/MARKET-2.md`).
11. **Regole degli store** (Apple 3.1.1) se si farà l'app per gli store (`docs/MOBILE.md`).

**Bassa**
12. Sincronizzazione del listino: l'esito dipendeva dall'ordine con cui arrivano le cancellazioni (`docs/TEST-REPORT.md` §3). Una correzione era in lavorazione il 4/11/2026 e non è ancora consolidata: da ricontrollare. Un telefono rimasto offline oltre 180 giorni può far riapparire una bozza cancellata.
13. Sul server le voci di registro legate alle fatture non si cancellano mai da sole: l'eliminazione dopo 10 anni è una procedura manuale da definire. Quelle non fiscali si archiviano da sole dopo 365 giorni.
14. Una licenza (MPL-2.0) del riconoscimento vocale nativo e alcune dipendenze di sviluppo da far vedere a un legale (`docs/LICENZE-TERZE-PARTI.md`); chi riavvolge l'orologio del telefono allunga la tolleranza del Pro offline.

*Chiusi o ridotti dopo le revisioni (non più rischi principali):* archivio che passa in silenzio alla memoria, ripristino di un backup alterato, sovrascrittura silenziosa delle bozze in conflitto, "Da incassare" errato; ridotto di molto il rischio di indovinare il codice di accesso (codice a 8 cifre e blocchi progressivi).

## 5. Decisioni che spettano a te

- **Prezzi:** 15 €/mese e 120 €/anno vanno bene? Con IVA inclusa o esclusa? Il Gratis a 3 documenti (un preventivo convertito in fattura ne usa 2) o altro? Offerta "primi 20" e cosa succede dopo (`docs/PRICING.md`, `docs/GO-TO-MARKET.md`).
- **Posizionamento:** "preventivo veloce complementare al gestionale" oppure "gestionale con invio SDI" (cambia prezzo e lavoro da fare).
- **Invio SDI automatico:** restare con il caricamento manuale o scegliere un provider (servono 2-3 preventivi, nessun listino trovato).
- **Dominio e nome:** acquistare il dominio; verificare il marchio "VocePreventivo"; ragione sociale, partita IVA, sede, email di assistenza da inserire nei testi legali.
- **Revisione del commercialista** (checklist fiscale + prova di 2-3 fatture simboliche sul portale) e **revisione del legale** (Termini, Privacy, DPA, avviso microfono).
- **Assicurazione:** RC professionale / cyber, sì o no, e quale.
- **Scelte di prodotto aperte:** blocco o solo avviso per clienti esteri; fatture a importo zero; come risolvere un numero doppio tra due telefoni; aggiungere i 100.000 € e i requisiti di esclusione; sincronizzare la rubrica clienti; app negli store (e come vendere il Pro dentro).
- **Lancio riservato con codici invito** o aperto a tutti.

## 6. Prossimi passi, in ordine

1. **Far compilare la checklist fiscale** al commercialista e **provare 2-3 fatture simboliche sul portale dell'Agenzia** (scaricando anche lo schema ufficiale per la validazione automatica).
2. **Provare l'app su 2 iPhone e 2 Android veri**, con microfono, in condizioni di cantiere (`docs/LANCIO-CHECKLIST.md` Blocco 4).
3. **Fare 10 interviste** con artigiani (`docs/INTERVISTE.md`) e decidere GO / GO con cambiamenti / NO-GO, posizionamento e prezzo.
4. **Revisione legale** dei testi e scelta dell'assicurazione.
5. **Dominio, segnaposto e infrastruttura:** server, email, Stripe, backup con prova di ripristino (`docs/DEPLOY.md`, `docs/OPERAZIONI.md`).
6. **Lancio ristretto** ai primi 20 artigiani, con codici invito, misurando i 6 numeri settimanali (`docs/LANCIO-CHECKLIST.md`).

## 7. Attenzione ai documenti tecnici più vecchi

Alcuni documenti tecnici riportano ancora come "aperte" cose già risolte nel codice (per esempio `docs/CODE-REVIEW-FATTURE.md`: archivio in memoria e backup alterato; `docs/PWA.md`: avviso di aggiornamento non collegato; `docs/MOBILE.md`: prezzi nascosti nell'app nativa; `docs/QA-REPORT.md`: numeri dei test). Per lo stato attuale fa fede questa pagina e `docs/CHANGELOG.md`.
