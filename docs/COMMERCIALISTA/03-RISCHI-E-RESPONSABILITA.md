# Rischi e responsabilità: cosa succede se l'app sbaglia

**Ultimo aggiornamento: 4 novembre 2026 (seconda stesura, riallineata al codice attuale; sostituisce la prima, scritta mentre alcune funzioni erano ancora in lavorazione).**

Documento per il commercialista (e per chi decide sul lancio). Racconta con franchezza dove l'app può sbagliare, chi ne risponde oggi secondo le nostre bozze e cosa **non** abbiamo ancora deciso. Non è un parere legale: le parti contrattuali sono bozze non redatte da un avvocato (`public/legal/`, `docs/privacy/DA-FAR-VERIFICARE.md`).

## 1. Principio di base

L'app è uno **strumento di supporto**. Non trasmette fatture allo SDI, non conserva a norma, non è consulenza fiscale. L'artigiano resta responsabile di dati, numerazione, termini, invio e conservazione. Questo messaggio è ripetuto: nelle schermate (emissione, guida all'invio), nel PDF, nella pagina pubblica e nelle bozze dei Termini di servizio.

Il rischio vero nasce dal fatto che l'app **compila al posto dell'utente** campi che l'utente non guarda (codici, diciture, bollo, numero). Un errore di regola si ripete in ogni fattura.

## 2. Dove l'app può sbagliare, e con quali conseguenze

La colonna "Come ce ne accorgiamo" indica se il sistema dà un segnale; per le righe della checklist vedere `01-CHECKLIST-FISCALE.md`.

| # | Errore possibile | Esempio | Conseguenza per l'artigiano | Come ce ne accorgiamo | Mitigazione attuale | Rif. checklist |
|---|---|---|---|---|---|---|
| R1 | Regola fiscale implementata male (bollo, natura, dicitura) | Bollo calcolato sopra/sotto soglia sbagliata; natura non adatta al caso | Fattura da correggere con nota di credito e nuova fattura; possibili sanzioni (misura da verificare); lo SDI può accettare un file formalmente corretto ma sostanzialmente errato | Solo dalla revisione del commercialista o dallo scarto/contestazione | Questa revisione; avvisi in app | D, E |
| R2 | File XML non conforme allo schema ufficiale | Elemento in ordine sbagliato o troppo lungo | Lo SDI scarta il file (notifica di scarto): la fattura si considera non emessa; rinvio entro 5 giorni | Esito dello SDI, registrato a mano dall'utente | Controlli interni sull'ordine e la lunghezza degli elementi, ma **non è stata fatta la validazione contro l'XSD ufficiale né alcun invio reale** (H1). Dopo uno scarto l'app offre "Correggi e rinvia" con lo stesso numero e la stessa data (F2) | H1, H2, F2 |
| R3 | Numerazione con buchi o doppioni | Due telefoni che emettono offline lo stesso numero; ripristino di un backup vecchio; un numero di partenza digitato male da chi ha già emesso altrove | Sanzioni per irregolare numerazione (da verificare); difficoltà in caso di controllo | Per i doppioni sincronizzati, il server li rifiuta e l'app mostra un "conflitto"; il "Controllo dati" nella pagina Backup segnala buchi e doppioni; per un numero di partenza sbagliato, nessun segnale | Un contatore per anno aggiornato in un'unica operazione; il ripristino non abbassa mai i contatori; **ora esiste** il campo "ultimo numero usato" (con blocco sotto il già emesso e doppia conferma per abbassarlo). **Restano scoperti**: i doppioni emessi offline da due dispositivi (nessun percorso di risoluzione per una fattura già emessa) e l'assenza di un avviso in app "emetti da un solo dispositivo" | A2, A6, A7, K2 |
| R4 | Fattura mai trasmessa allo SDI | L'utente scarica l'XML, ma si dimentica di caricarlo; oppure il PDF viene consegnato al cliente come "fattura" | La fattura non è emessa a fini fiscali; ritardo oltre 12 giorni; il cliente non la ritrova nel proprio cassetto | L'app mostra "Emessa" (non "Inviata") finché l'utente non la segna, e avverte (in fase di emissione) se la data è di oltre 12 giorni fa. **Non sa** se il file è stato davvero caricato e non manda promemoria successivi | Messaggi chiari sul PDF ("copia di cortesia") e nella guida; avviso a 12 giorni | B1, F1 |
| R5 | Soglia dei ricavi del forfettario superata senza accorgersene | Ricavi per cassa che superano 85.000 € (o 100.000 € in corso d'anno) | Uscita dal regime, IVA dovuta, fatture emesse senza IVA illegittime (conseguenze da verificare) | **Avviso in app** (Documenti) dall'80% e al superamento degli 85.000 €, calcolato **solo sugli incassi registrati nell'app** (non sulla contabilità reale; ricavi non fatturati nell'app non inclusi; rimborsi per note di credito non sottratti). **Nessun controllo dei 100.000 €** né delle cause di esclusione | Lo dichiariamo come limite. La checkbox di emissione ricorda che l'utente conferma di essere forfettario. Il messaggio in app rimanda al commercialista | E9, E10, L4 |
| R6 | Uso dell'app da parte di chi non è forfettario | Un'impresa in regime ordinario | Fatture senza IVA illegittime | L'app blocca l'emissione se il regime forfettario non è attivo nel profilo, ma l'utente può spuntarlo senza esserlo | Dichiarazione esplicita all'emissione; Termini | E1, E8 |
| R7 | Dati sbagliati inseriti o capiti male dalla voce | "tre metri" riconosciuto come "tre euro"; cliente scambiato | Importi o righe errati in fattura | Le righe poco certe sono segnate "da verificare" e **bloccano l'emissione** finché non confermate; l'emissione richiede riepilogo, casella di conferma e pulsante premuto a lungo (1,2 s). Un comando vocale non emette né storna mai da solo: serve la pressione prolungata (1 s) oppure la frase "conferma emissione"/"conferma storno" entro 15 secondi con la scheda visibile; la conferma è legata alla versione del documento mostrata | Comandi vocali mai sufficienti a emettere da soli. L'interpretazione del testo è misurata solo su frasi scritte da noi; il microfono reale non è mai stato provato | (blocco emissione) |
| R8 | Perdita dei dati | Cancellazione dei dati del browser, telefono perso, nessun backup; spazio del telefono esaurito | Perdita dell'archivio locale (le fatture trasmesse restano comunque presso lo SDI e nell'area riservata) | La pagina Backup ricorda l'ultimo backup (dopo 14 giorni segnala "da fare"); un banner in tutte le schermate avvisa se l'archivio non salva più o lo spazio sta finendo, e permette un "backup di emergenza" | Backup manuale in un file (non automatico); account facoltativo con sincronizzazione su server UE; l'app blocca emissioni e altre scritture fiscali se l'archivio non è affidabile (A8). La rubrica clienti **non** si sincronizza con l'account: viaggia solo con il backup | G1, A8 |
| R9 | Conservazione non a norma presentata come tale | L'artigiano crede che l'app conservi le fatture per 10 anni | Violazione degli obblighi di conservazione (a carico dell'utente) | Nessuno | Dichiarazione esplicita nei Termini, nella pagina pubblica e nelle guide | G1 |
| R10 | Nota di credito/bollo gestiti in modo contestabile | Bollo sulla nota; storno totale con bollo già rimborsato | Imposta di bollo versata in più o in meno (importi piccoli) | Nessuno | Regola prudente descritta in D7 | D7 |
| R11 | Incasso registrato in modo impreciso | Importo digitato male, doppio tocco, incasso su una nota di credito | Dato di cassa e indicatore degli 85.000 € falsati | Visibile all'utente | **Corretto** (E11): l'app rifiuta un incasso oltre il residuo, su una nota di credito o con data non valida; il difetto del bollo a carico dell'artigiano non esiste più. Un incasso registrato non si modifica né si cancella da app | E10, E11 |
| R12 | Cambio normativo o delle specifiche tecniche | Nuova versione dello schema (la 1.9.1 sarebbe in vigore dal 15/05/2026; versioni successive: non verificate) | File scartati o non conformi | Scarti dello SDI | Nessun aggiornamento automatico garantito: serve manutenzione e un monitoraggio delle novità (da organizzare) | H1 |
| R13 | Protezione dei dati personali dei clienti dell'artigiano | Violazione dei dati sul server; audio inviato a terzi (il browser può inviare l'audio a Google o Apple; su iPhone con l'app installata la trascrizione può passare dai nostri server) | Sanzioni privacy; danni a terzi | Procedura di data breach | Hosting UE, DPA, procedure (`docs/privacy/`); cifratura dei dati sul server; l'app mostra **una volta, prima del primo uso del microfono**, un'informativa con scelta "Continua con il microfono" / "Preferisco scrivere". Bozze da far rivedere a un legale | — |
| R14 | Ripristino di un backup alterato o vecchio | Un file modificato a mano che sostituisce fatture emesse; un backup vecchio che fa sparire fatture recenti | Fatture emesse riscritte o perse; numeri riutilizzati | La pagina Backup mostra un'anteprima e, se un documento non supera i controlli, **rifiuta il ripristino** elencando i problemi | Verifica di impronta SHA-256, blocco, numerazione e note di credito prima di ripristinare; i contatori non scendono; avviso sulle fatture emesse che verrebbero sostituite (K1). Un backup *non alterato ma vecchio* è comunque accettato (con avviso) | K1 |
| R15 | Conflitti di sincronizzazione tra dispositivi | Una bozza modificata su due telefoni; un'emissione doppia | Bozze sovrascritte o duplicate; fatture con numero doppio | Elenco "Da controllare" nella pagina Account con confronto leggibile | Sulle bozze nessuna sovrascrittura silenziosa ("Usa quella del server", "Tieni la mia", "Tieni entrambe"); profilo e listino restano "vince l'ultimo" con registro; un circuito di sicurezza blocca le cancellazioni di massa sospette; cambio account con avviso. **Una fattura emessa non si modifica mai da sync**, ma un doppio numero resta senza soluzione (R3) | A7 |
| R16 | Fatti fiscali dichiarati dall'utente e non verificabili | L'utente registra "scartata" una fattura solo "inviata" per poterla riscrivere; digita una data di esito favorevole | Riscrittura di una fattura già accettata; finestra dei 5 giorni allungata | Registro delle attività e cronologia della fattura (con impronta dell'XML) | Il server non permette di passare a "scartata" da consegnata, stornata o pagata; l'XML scartato viene archiviato con la sua impronta. **Limite noto**: lo SDI è registrato a mano, quindi nessuno può sapere se uno scarto è vero (`CODE-REVIEW-SERVER` #5) | F2, F6 |
| R17 | Servizio e account | Abuso dell'accesso con codice email (indovinare il codice con molti tentativi); disco del server pieno; registro di audit che cresce senza fine | Accesso non autorizzato a un account (probabilità bassa, stimata ≈ 0,24% al giorno con attacco continuo); interruzione del servizio | Allarmi nei log; controllo di salute del server | Limiti sui tentativi; revisione indipendente del server con 16 difetti corretti e 26 test di regressione. **Aperti**: mancano retention dell'audit, notifica di nuovo accesso, hash a catena; vedi `docs/CODE-REVIEW-SERVER.md` | — |
| R18 | Mai provato in condizioni reali | Microfono in cantiere, iPhone/Android reali, installazione, pagamento Stripe reale, server di produzione, invio reale allo SDI | Difetti che nessun test automatico ha visto | Solo con la prova sul campo | Nulla fino alla prova: è il primo punto dei prossimi passi (`docs/STATO-PRODOTTO.md`) | H1 |

## 3. Chi risponde: la posizione delle nostre bozze

Dalle bozze dei Termini (`public/legal/termini.html`, §6, §8, §11):

- L'app **non** fornisce consulenza fiscale, contabile o legale e non garantisce che i documenti siano corretti o conformi, né ai cambiamenti futuri di norme e specifiche tecniche.
- La responsabilità fiscale, la correttezza dei dati, i termini di emissione, l'invio allo SDI e la conservazione sono **dell'utente**.
- Sanzioni, interessi e danni da dati errati, ritardi o mancato invio sono a carico dell'utente "nei limiti consentiti dalla legge".
- Esclusione dei danni indiretti, mancati guadagni, perdita di dati e **sanzioni fiscali**; per gli utenti professionisti, tetto alla responsabilità pari a quanto pagato negli ultimi 12 mesi (il testo è marcato **da verificare**).
- Per i consumatori la limitazione trova i limiti di legge (recesso 14 giorni e clausole vessatorie da far confermare a un legale).

**Cosa non sappiamo** (e che chiederemo a un legale, non a Lei): se queste clausole reggono davanti a un giudice, in particolare per l'esclusione delle sanzioni fiscali e verso consumatori e professionisti. Questa è la voce 12 della lista per il legale in `docs/privacy/DA-FAR-VERIFICARE.md`.

Dove il difetto è nostro (un bug che applica male una regola corretta), è ragionevole aspettarsi che una limitazione di responsabilità non sia l'unico argomento: per questo la sezione 5 sotto parla di assicurazione.

## 4. Disclaimer attualmente nel prodotto

Testi reali presenti nel programma (da far approvare):

| Dove | Testo |
|---|---|
| Schermata "Emetti fattura" (in fondo) | "Strumento di supporto: la responsabilità fiscale resta tua. Verifica i dati con il tuo commercialista." |
| Casella obbligatoria all'emissione | "Ho verificato i dati: dopo l'emissione non si può modificare né cancellare, solo stornare con nota di credito. Confermo di essere in regime forfettario." |
| Guida "Come inviarla allo SDI" | "L'invio allo SDI entro 12 giorni dalla data dell'operazione è una tua responsabilità: l'app non trasmette nulla per conto tuo. (Testo da far verificare dal commercialista.)" e "Una fattura non trasmessa allo SDI non risulta emessa. Il PDF è solo una copia di cortesia." |
| Indicatore degli 85.000 € (pagina Documenti) | "Hai incassato il N% della soglia di 85.000 € (...): parlane con il tuo commercialista [DA VERIFICARE]." e, al superamento, "contatta subito il tuo commercialista per capire le conseguenze sul regime forfettario [DA VERIFICARE]." |
| Riepilogo in Documenti | "Somme dei documenti presenti in app, non un calcolo fiscale: per tasse, soglie e bolli da versare chiedi al tuo commercialista." |
| Informativa sul microfono (prima del primo uso) | "Per riconoscere la tua voce, il browser può inviare l'audio al suo fornitore (ad esempio Google su Chrome, Apple su Safari)... VocePreventivo non conserva l'audio. Se preferisci, puoi scrivere il testo con la tastiera." |
| PDF della fattura emessa | "Copia di cortesia della fattura elettronica: l'originale è il file XML trasmesso tramite SDI." |
| PDF della bozza | "BOZZA - documento senza numero e senza valore fiscale. Non inviare al cliente." |
| Pagina pubblica (domande frequenti) | "VocePreventivo non trasmette nulla per te e non promette la conformità fiscale: è uno strumento di supporto, verifica sempre con il tuo commercialista." |

Una bozza più completa di disclaimer, con clausole proposte per i Termini, è in `docs/FISCAL-SPEC.md` §7.3.

## 5. Assicurazione

**Stato attuale: nessuna polizza risulta decisa o attivata.** Nel repository non c'è alcun riferimento a una assicurazione. È una decisione da prendere **prima della vendita**.

Da valutare con un consulente assicurativo (non abbiamo preventivi né cifre, quindi non ne scriviamo):

- Polizza di **responsabilità civile professionale / errors & omissions** (software house o fornitore di servizi IT), che copra i danni a terzi da errore del software.
- Polizza **cyber** per violazioni di dati.
- Se la polizza copre le **sanzioni fiscali** dell'utente (di norma le sanzioni amministrative non sono assicurabili: da verificare).
- Massimale adeguato e retroattività.

## 6. Limiti dichiarati del prodotto (da ripetere ovunque)

1. Solo regime forfettario RF19; non per altri regimi.
2. Solo fatture (TD01) e note di credito (TD04) verso privati e aziende italiane; non per la Pubblica Amministrazione; clienti esteri solo con avviso.
3. Nessuna trasmissione allo SDI e nessuna lettura automatica delle ricevute.
4. Nessuna conservazione a norma.
5. Nessun controllo completo delle soglie del forfettario: solo un avviso sugli 85.000 € calcolato sugli incassi registrati nell'app; nessun controllo dei 100.000 € né delle cause di esclusione.
6. Nessun calcolo né versamento di tasse, contributi, bollo (solo promemoria).
7. Non gestisce ritenute, casse previdenziali, reverse charge, autofatture, fatture differite, acconti.
8. Numerazione: affidabile su **un solo dispositivo**; con più dispositivi i doppioni possono verificarsi (il server rifiuta il secondo numero uguale, ma una fattura già emessa non si può rinumerare). Chi viene da un altro programma deve impostare il numero di partenza prima della prima emissione (nel formato `N/AAAA`).
9. Dopo uno scarto dello SDI "Correggi e rinvia" è possibile entro 5 giorni dalla data dell'esito (conteggio di 120 ore, ipotesi da confermare); oltre, l'app offre solo una nuova fattura collegata con numero nuovo. La data dell'esito la digita l'utente.
10. Le regole fiscali implementate si basano su fonti secondarie e non sono state ancora verificate da un professionista: esattamente lo scopo di questa revisione.
11. La rubrica clienti è solo sul dispositivo (e nel backup): non si sincronizza con l'account.
12. Nessun invio reale allo SDI, nessuna validazione XSD ufficiale e nessuna prova su telefoni reali sono mai state fatte.

## 7. Cosa faremo dopo la Sua revisione

1. Correggere ciò che indica come "Da modificare".
2. Far provare due o tre fatture vere (con importi simbolici) sul portale gratuito dell'Agenzia, prima di aprire alla vendita: tra queste un caso con sconto in euro, uno con bollo e una nota di credito (J1, D, C).
3. Far rivedere Termini e informative a un legale.
4. Scegliere se e quale assicurazione.
5. Organizzare un controllo periodico delle novità normative e delle specifiche tecniche.
