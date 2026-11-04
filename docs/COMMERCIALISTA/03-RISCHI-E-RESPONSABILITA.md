# Rischi e responsabilità: cosa succede se l'app sbaglia

Documento per il commercialista (e per chi decide sul lancio). Racconta con franchezza dove l'app può sbagliare, chi ne risponde oggi secondo le nostre bozze e cosa **non** abbiamo ancora deciso. Non è un parere legale: le parti contrattuali sono bozze non redatte da un avvocato (`public/legal/`, `docs/privacy/DA-FAR-VERIFICARE.md`).

## 1. Principio di base

L'app è uno **strumento di supporto**. Non trasmette fatture allo SDI, non conserva a norma, non è consulenza fiscale. L'artigiano resta responsabile di dati, numerazione, termini, invio e conservazione. Questo messaggio è ripetuto: nelle schermate (emissione, guida all'invio), nel PDF, nella pagina pubblica e nelle bozze dei Termini di servizio.

Il rischio vero nasce dal fatto che l'app **compila al posto dell'utente** campi che l'utente non guarda (codici, diciture, bollo, numero). Un errore di regola si ripete in ogni fattura.

## 2. Dove l'app può sbagliare, e con quali conseguenze

La colonna "Come ce ne accorgiamo" indica se il sistema dà un segnale; per le righe della checklist vedere `01-CHECKLIST-FISCALE.md`.

| # | Errore possibile | Esempio | Conseguenza per l'artigiano | Come ce ne accorgiamo | Mitigazione attuale | Rif. checklist |
|---|---|---|---|---|---|---|
| R1 | Regola fiscale implementata male (bollo, natura, dicitura) | Bollo calcolato sopra/sotto soglia sbagliata; natura non adatta al caso | Fattura da correggere con nota di credito e nuova fattura; possibili sanzioni (misura da verificare); lo SDI può accettare un file formalmente corretto ma sostanzialmente errato | Solo dalla revisione del commercialista o dallo scarto/contestazione | Questa revisione; avvisi in app | D, E |
| R2 | File XML non conforme allo schema ufficiale | Elemento in ordine sbagliato o troppo lungo | Lo SDI scarta il file (notifica di scarto): la fattura si considera non emessa; rinvio entro 5 giorni | Esito dello SDI, registrato a mano dall'utente | Controlli interni, ma **non è stata fatta la validazione contro l'XSD ufficiale** (H1) | H1, H2, F2 |
| R3 | Numerazione con buchi o doppioni | Due telefoni che emettono offline; ripristino di un backup vecchio; chi ha già emesso fatture con un altro programma e ripartisce da 1 | Sanzioni per irregolare numerazione (da verificare); difficoltà in caso di controllo | Per i doppioni, l'avviso di conflitto nella sincronizzazione; per il resto, nessuno | Un contatore per anno aggiornato in un'unica operazione; il ripristino non abbassa mai i contatori. **Manca** il campo "ultimo numero usato" e il blocco a monte dei doppioni tra dispositivi | A2, A6, A7 |
| R4 | Fattura mai trasmessa allo SDI | L'utente scarica l'XML, ma si dimentica di caricarlo; oppure il PDF viene consegnato al cliente come "fattura" | La fattura non è emessa a fini fiscali; ritardo oltre 12 giorni; il cliente non la ritrova nel proprio cassetto | L'app mostra "Emessa" (non "Inviata") finché l'utente non la segna, e avverte dopo 12 giorni. **Non sa** se il file è stato davvero caricato | Messaggi chiari sul PDF ("copia di cortesia") e nella guida; avviso a 12 giorni | B1, F1 |
| R5 | Soglia dei ricavi del forfettario superata senza accorgersene | Ricavi per cassa che superano 85.000 € (o 100.000 € in corso d'anno) | Uscita dal regime, IVA dovuta, fatture emesse senza IVA illegittime (conseguenze da verificare) | **Nessun segnale nella versione base**; in lavorazione un avviso sugli 85.000 € calcolato sugli incassi registrati nell'app (non sulla contabilità reale, note di credito non sottratte) | Lo dichiariamo come limite. La checkbox di emissione ricorda che l'utente conferma di essere forfettario | E9, E10 |
| R6 | Uso dell'app da parte di chi non è forfettario | Un'impresa in regime ordinario | Fatture senza IVA illegittime | L'app blocca l'emissione se il regime forfettario non è attivo nel profilo, ma l'utente può spuntarlo senza esserlo | Dichiarazione esplicita all'emissione; Termini | E1, E8 |
| R7 | Dati sbagliati inseriti o capiti male dalla voce | "tre metri" riconosciuto come "tre euro"; cliente scambiato | Importi o righe errati in fattura | Le righe poco certe sono segnate "da verificare" e **bloccano l'emissione** finché non confermate; l'emissione richiede riepilogo, casella di conferma e pulsante premuto a lungo | Comandi vocali mai sufficienti a emettere da soli | (blocco emissione) |
| R8 | Perdita dei dati | Cancellazione dei dati del browser, telefono perso, nessun backup | Perdita dell'archivio locale (le fatture trasmesse restano comunque presso lo SDI e nell'area riservata) | L'app propone il backup; nessun controllo automatico | Backup manuale in un file; account facoltativo con sincronizzazione su server UE | G1 |
| R9 | Conservazione non a norma presentata come tale | L'artigiano crede che l'app conservi le fatture per 10 anni | Violazione degli obblighi di conservazione (a carico dell'utente) | Nessuno | Dichiarazione esplicita nei Termini, nella pagina pubblica e nelle guide | G1 |
| R10 | Nota di credito/bollo gestiti in modo contestabile | Bollo sulla nota; storno totale con bollo già rimborsato | Imposta di bollo versata in più o in meno (importi piccoli) | Nessuno | Regola prudente descritta in D7 | D7 |
| R11 | Incasso registrato in modo impreciso | Fattura con bollo a carico dell'artigiano che resta "pagata in parte" per 2 € | Dato di cassa non allineato; nessun effetto fiscale diretto ma inesattezza | Visibile all'utente | Difetto noto (E11), corretto nel codice in lavorazione: da riverificare | E10, E11 |
| R12 | Cambio normativo o delle specifiche tecniche | Nuova versione dello schema (la 1.9.1 sarebbe in vigore dal 15/05/2026; versioni successive: non verificate) | File scartati o non conformi | Scarti dello SDI | Nessun aggiornamento automatico garantito: serve manutenzione e un monitoraggio delle novità (da organizzare) | H1 |
| R13 | Protezione dei dati personali dei clienti dell'artigiano | Violazione dei dati sul server; audio inviato a terzi | Sanzioni privacy; danni a terzi | Procedura di data breach | Hosting UE, DPA, procedure (`docs/privacy/`). Bozze da far rivedere a un legale | — |

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
5. Nessun controllo completo delle soglie del forfettario (in lavorazione solo un avviso sugli 85.000 €, calcolato sugli incassi registrati nell'app; nessun controllo dei 100.000 €).
6. Nessun calcolo né versamento di tasse, contributi, bollo (solo promemoria).
7. Non gestisce ritenute, casse previdenziali, reverse charge, autofatture, fatture differite, acconti.
8. Numerazione: affidabile su **un solo dispositivo**; con più dispositivi i doppioni possono verificarsi.
9. Dopo uno scarto dello SDI la correzione e il rinvio sono in lavorazione ("Correggi e rinvia"); fino alla versione finale vanno gestiti con il commercialista.
10. Le regole fiscali implementate si basano su fonti secondarie e non sono state ancora verificate da un professionista: esattamente lo scopo di questa revisione.

## 7. Cosa faremo dopo la Sua revisione

1. Correggere ciò che indica come "Da modificare".
2. Far provare due o tre fatture vere (con importi simbolici) sul portale gratuito dell'Agenzia, prima di aprire alla vendita.
3. Far rivedere Termini e informative a un legale.
4. Scegliere se e quale assicurazione.
5. Organizzare un controllo periodico delle novità normative e delle specifiche tecniche.
