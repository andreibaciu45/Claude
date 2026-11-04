# VocePreventivo — Manuale d'uso

Per artigiani: idraulici, elettricisti, imbianchini, fabbri... Si legge in dieci minuti. Dove vedi **[SCREENSHOT: ...]** andrà inserita un'immagine dello schermo.

*Ultimo aggiornamento: 4 novembre 2026. Il manuale descrive l'app com'è oggi. L'app non è ancora stata provata su telefoni diversi da quelli di prova dei programmatori: se qualcosa sul tuo telefono si comporta in modo diverso da come è scritto qui, dillo a chi ti ha dato l'app.*

> **Una cosa importante prima di cominciare.** VocePreventivo ti aiuta a preparare preventivi e fatture, ma **non è un commercialista e non invia niente al Fisco al posto tuo**. La fattura elettronica la prepara l'app, **l'invio lo fai tu** (te lo spiego al capitolo 9). Per ogni dubbio fiscale chiedi al tuo commercialista. L'app è pensata per chi è in **regime forfettario**.

---

## 1. Che cosa fa l'app (e cosa no)

L'app **fa** questo:

- Tu **detti** a voce il lavoro fatto ("tre ore di manodopera e due metri di tubo rame") e l'app prepara il **preventivo**. Se non vuoi parlare, **scrivi** la frase.
- Usa il **tuo listino** (i tuoi prezzi) e la tua **rubrica clienti** per mettere le cifre e i dati giusti.
- Quando il lavoro è finito, trasforma il preventivo in **fattura** e prepara il **file XML** della fattura elettronica e una **copia PDF** da mandare al cliente.
- Se sbagli una fattura già emessa, prepara la **nota di credito** per annullarla. Se lo SDI rifiuta una fattura, ti aiuta a **correggerla e rinviarla**.
- Ti prepara il materiale per il commercialista: **registro delle fatture** (file per Excel), **tutti gli XML in un solo file**, **registro delle attività**.

L'app **non fa** questo:

- **Non invia la fattura all'Agenzia delle Entrate (SDI).** Scarichi il file e lo carichi tu. Nessun invio automatico, nemmeno a pagamento.
- **Non conserva le fatture "a norma di legge".** Il backup e l'archivio dell'app non sono conservazione sostitutiva (capitolo 15).
- Non paga tasse né bollo, e non fa il tuo F24.
- Non controlla in modo completo il limite di ricavi del forfettario: mostra solo un indicatore basato sugli **incassi che hai registrato nell'app** (capitolo 11).
- Non è per chi non è in regime forfettario, non fa fatture alla Pubblica Amministrazione, non gestisce ritenute, casse previdenziali, fatture differite.

---

## 2. Installare l'app sul telefono

L'app non è su Play Store né App Store: si apre dal browser e si mette sulla schermata Home come una normale app. È gratis e ci vogliono due minuti.

### Android (Chrome)

1. Apri l'indirizzo di VocePreventivo con **Chrome**.
2. Tocca i **tre puntini** in alto a destra.
3. Scegli **"Installa app"** oppure **"Aggiungi a schermata Home"**.
4. Conferma. Ora trovi l'icona di VocePreventivo tra le tue app.

**[SCREENSHOT: menu di Chrome con "Installa app"]**

### iPhone (Safari)

1. Apri l'indirizzo con **Safari** (non con altri browser).
2. Tocca il tasto **Condividi** (il quadrato con la freccia verso l'alto).
3. Scegli **"Aggiungi a Home"** e conferma.

**[SCREENSHOT: tasto Condividi di Safari e "Aggiungi a Home"]**

> **Attenzione iPhone:** quando l'app è installata sulla Home, il riconoscimento vocale del telefono a volte non è disponibile. In quel caso l'app può usare un servizio nostro per trascrivere la voce (l'audio serve solo per ottenere il testo e non viene conservato). Se la voce non funziona, **puoi sempre scrivere la frase** nel campo di testo.

> **Computer:** funziona anche dal computer, ma la dettatura vocale non c'è su tutti i browser (su Firefox no). Basta scrivere la frase.

### Gli aggiornamenti dell'app

Quando c'è una versione nuova, in basso compare un avviso: **"È disponibile una nuova versione"**, con due pulsanti.

- **Aggiorna ora**: l'app si ricarica con la versione nuova. Se in quel momento stai facendo qualcosa che non va interrotto (per esempio emettere una fattura, o una conferma a pressione prolungata) l'avviso dice che **l'aggiornamento partirà appena hai finito** e i tuoi dati non si perdono.
- **Più tardi**: l'avviso sparisce fino alla prossima versione.

L'app **non si ricarica mai da sola** mentre lavori. Nella versione per gli store (se un giorno ci sarà) gli aggiornamenti arrivano dallo store.

---

## 3. Il primo avvio: i tuoi dati (Profilo)

Prima di fare una fattura devi dire chi sei. Tocca **Profilo** (in basso). Finché mancano ragione sociale o partita IVA, nella schermata "Nuovo" compare un avviso con il collegamento "Completa il profilo".

**[SCREENSHOT: pagina Profilo "Dati azienda"]**

Compila e poi tocca **Salva dati azienda**:

| Campo | Cosa scrivere |
|---|---|
| Ragione sociale | Il nome con cui lavori (può essere il tuo nome e cognome) |
| Titolare / referente | Nome e cognome, **nell'ordine "Nome Cognome"** (es. Mario Rossi) |
| Partita IVA e Codice fiscale | I tuoi. L'app controlla che siano scritti correttamente |
| Indirizzo, CAP, Comune, Provincia | Della tua sede. La provincia è la sigla di 2 lettere (RM, MI...) |
| Telefono, Email, PEC | Facoltativi |
| IBAN | Il tuo conto per i bonifici. Comparirà nelle fatture |
| Regime forfettario | **Spunta la casella** se sei forfettario. Senza questa casella **non puoi emettere fatture elettroniche** |
| Condizioni di pagamento | Scrivi per esempio *"Bonifico entro 30 giorni"* oppure *"Contanti alla consegna"*. L'app capisce la parola (bonifico, contanti, carta, assegno) e i giorni, e li mette nella fattura |
| Validità preventivo (giorni) | Per quanti giorni vale il preventivo (es. 30) |
| Note a piè di pagina | Es. "Prezzi validi salvo imprevisti" |

### Il numero della prima fattura

L'app numera le fatture da sola: `1/2026`, `2/2026`, e così via; a gennaio riparte da 1. Le note di credito hanno una numerazione loro (`NC1/2026`).

**Se hai già fatto fatture quest'anno con un altro programma o a mano**, devi dire all'app da che numero continuare, **prima di emettere la prima fattura con l'app**:

1. Nel **Profilo** cerca la scheda **"Numerazione fatture elettroniche"**.
2. Scegli **fatture** (o note di credito) e l'anno.
3. Nel campo **"Ultimo numero già usato"** scrivi l'ultimo numero che hai usato: per esempio, se l'ultima fattura è la 14/2026, scrivi **14** (solo le cifre).
4. Tocca **Imposta numero di partenza** e conferma. L'app ti dice qual è la prossima: `15/2026`.

L'app **non ti lascia scendere sotto l'ultimo numero già emesso con l'app stessa** (creeresti numeri doppi). Se abbassi un numero rispetto a quello attuale ti chiede una seconda conferma, perché è un'operazione rischiosa. In caso di dubbio, **chiedi al tuo commercialista**: la numerazione deve essere continua. L'app supporta il formato `numero/anno`; se il tuo programma precedente usava un altro formato (con lettere o sezionali), parlane con il commercialista.

---

## 4. Il listino (Catalogo)

Il listino è l'elenco dei tuoi materiali e delle tue lavorazioni, con i tuoi prezzi. Più è completo, meno devi correggere a mano.

Tocca **Catalogo** (in basso).

**[SCREENSHOT: pagina "Il mio listino"]**

- **+ Nuova voce**: aggiungi una voce con nome, unità di misura (pz, m, h...), prezzo e, se vuoi, altri nomi con cui la chiami ("rubinetto", "miscelatore"). Gli altri nomi servono perché l'app ti capisca quando parli.
- **Aggiungi voci di esempio**: carica un listino di partenza per il tuo mestiere. Poi cambia i prezzi.
- **Importa CSV**: se hai già il listino in un foglio di calcolo, lo carichi da file. **Esporta CSV** per salvarlo.
- Per cancellare una voce: aprila e scegli elimina (te lo chiede due volte).

---

## 5. La rubrica clienti

Tocca **Clienti** (in basso). La rubrica è l'elenco dei tuoi clienti con i dati che servono per la fattura: nome, partita IVA o codice fiscale, indirizzo, codice destinatario o PEC, telefono.

**[SCREENSHOT: pagina Clienti]**

- **Nuovo cliente**: aggiungi un cliente a mano.
- **Aggiungi dai documenti**: crea la rubrica partendo dai clienti dei preventivi e delle fatture che hai già (utile se hai appena cambiato telefono, vedi capitolo 12).
- **Importa CSV** / **Esporta CSV**: per portare dentro o fuori la rubrica da un foglio di calcolo.
- Aprendo un cliente vedi i suoi documenti e quanto gli hai fatturato. Puoi **modificarlo**, **eliminarlo** o **unirlo** a un'altra scheda (se hai due schede dello stesso cliente).
- Se provi a creare un cliente che esiste già (stessa partita IVA, codice fiscale o nome) l'app te lo dice e ti propone di aprire o completare la scheda esistente.

Quando fai un preventivo, scrivendo il nome del cliente compaiono dei **suggerimenti dalla rubrica**: tocca quello giusto e i dati si compilano da soli. L'app riconosce anche un cliente già in rubrica se lo nomini a voce.

**Due cose da sapere.**

1. Ogni preventivo e ogni fattura conserva **una copia** dei dati del cliente di quel momento. Se poi modifichi o elimini il cliente in rubrica, **i documenti già fatti non cambiano**.
2. La rubrica sta **solo sul tuo telefono** e nel file di backup: **non** si sincronizza con l'account. Per portarla su un altro telefono usa il backup o l'esportazione CSV.

---

## 6. Fare un preventivo con la voce

1. Tocca **Nuovo** (in basso, icona del microfono).
2. Premi il microfono e **parla** con calma, per esempio: *"preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera"*.
   Non vuoi parlare? **Scrivi la stessa frase** nel campo di testo e tocca **Interpreta**.
3. L'app propone la scheda con le **righe**, le quantità e i prezzi.

**La prima volta che usi il microfono** compare un avviso sulla privacy: per riconoscere la voce il browser può inviare l'audio al suo fornitore (per esempio Google su Chrome, Apple su Safari); l'app **non registra né conserva l'audio**. Puoi scegliere **"Continua con il microfono"** oppure **"Preferisco scrivere"**: il resto dell'app funziona uguale. Se usi la registrazione con trascrizione (per esempio su iPhone), l'audio va ai nostri server solo per ottenere il testo e non viene conservato. L'avviso torna a comparire solo se il telefono non permette di ricordare la tua scelta.

**[SCREENSHOT: "Detta a voce o scrivi" con il microfono]**
**[SCREENSHOT: scheda del preventivo con le righe]**

### Controlla sempre le righe

- Le righe che l'app **non ha trovato nel listino** sono segnate **"da verificare"**. Controlla descrizione e prezzo e conferma. **Finché ci sono righe "da verificare" non puoi emettere la fattura.**
- Puoi cambiare quantità, prezzo, sconto in percentuale, aggiungere (anche con **+ Riga libera**) o togliere righe, scrivere il cliente (nome, indirizzo, partita IVA o codice fiscale).
- Puoi dettare anche uno **sconto**, in percentuale o in euro ("sconto venti euro"): in euro compare come una riga "Sconto" con importo negativo.
- Aggiungi eventuali note ("Il prezzo non comprende opere murarie").
- Quando sei pronto tocca **Genera preventivo**.
- Il preventivo **non è un documento fiscale**: non va mandato all'Agenzia delle Entrate e non porta il bollo.
- Se esci a metà, la bozza del preventivo resta salvata sul telefono.

### Mandare il preventivo al cliente

Apri il preventivo da **Documenti** e scegli **Scarica PDF**, poi invialo come vuoi. C'è anche il pulsante **Invia su WhatsApp**.

**[SCREENSHOT: pulsanti "Scarica PDF" e "Invia su WhatsApp"]**

Quando il cliente risponde, segna il preventivo come **accettato** o **rifiutato**.

---

## 7. I comandi vocali

C'è un pulsante **Parla** fisso sullo schermo (non compare mentre detti un preventivo). Toccalo e di' per esempio *"converti il preventivo 8 in fattura"*, *"segna come pagata la fattura 12"*, *"apri l'ultimo preventivo"*. Se non vuoi parlare c'è sempre il campo **"Scrivi un comando"**. Il pulsante **"Cosa posso dire?"** mostra gli esempi che l'app capisce davvero.

**[SCREENSHOT: pulsante Parla e "Cosa posso dire?"]**

Come si comporta l'app, a seconda di cosa chiedi:

- **Cose che guardano soltanto** (apri, mostra l'elenco, scarica): partono subito.
- **Cose che puoi disfare** (nuova bozza, aggiungere una riga, duplicare, cambiare lo stato di un preventivo): partono e per **6 secondi** compare **Annulla** per tornare indietro. Se nel frattempo hai modificato tu quel documento, l'annullamento ti dice che non può farlo, per non cancellare il tuo lavoro.
- **Cose da controllare** (segnare un incasso, convertire un preventivo in fattura): l'app mostra prima un **riepilogo** e aspetta un tuo tocco.
- **Cose che non si possono annullare** (**emettere una fattura**, **fare una nota di credito**): non partono **mai** con la sola voce. L'app mostra un riepilogo con documento, cliente e importo e devi **confermare davvero**:
  - **tenendo premuto** il pulsante (**"Tieni premuto per emettere"** / **"Tieni premuto per stornare"**) per circa **un secondo** senza rilasciare;
  - oppure dicendo, entro 15 secondi e con la scheda ancora aperta, **"conferma emissione"** (o **"conferma storno"**).
  Un semplice **"sì"**, **"ok"** o **"conferma"** **non basta**, apposta. La scheda si chiude da sola dopo un minuto, e se il documento cambia mentre la guardi l'app rifiuta di emettere: devi guardare il riepilogo aggiornato.

Se l'app non è sicura di aver capito, ti fa una domanda o ti chiede di scegliere tra più documenti, invece di indovinare.

---

## 8. Dal preventivo alla fattura

### 8.1 Creare la bozza

1. Da **Documenti** apri il preventivo accettato.
2. Tocca **Converti in fattura**. Si crea una **bozza di fattura**: ha le stesse righe e lo stesso cliente.

Una **bozza** è una fattura "in preparazione": non ha ancora il numero, puoi modificarla e anche eliminarla senza conseguenze.

**[SCREENSHOT: pulsante "Converti in fattura"]**

### 8.2 Completare i dati

Nella bozza trovi il riquadro **"Dati della fattura"**:

- **Data dell'operazione**: la data che comparirà in fattura (di solito oggi). Se la fattura è di oltre **12 giorni** fa, l'app ti avvisa: chiedi al tuo commercialista entro quando va inviata. Una data nel futuro non è ammessa.
- **Bollo**: se la fattura (dopo gli eventuali sconti) supera **77,47 €** (e non c'è IVA, come per i forfettari) c'è il **bollo da 2,00 €**. Puoi scegliere se **addebitarlo al cliente** (spunta la casella: compare una riga "Rimborso imposta di bollo") oppure tenerlo a tuo carico. Il bollo **lo paghi tu** all'Agenzia: l'app non lo paga al tuo posto.
- **Cliente**: servono indirizzo completo e **partita IVA oppure codice fiscale**. Per un privato basta il codice fiscale. Se il cliente ha un **codice destinatario** (7 caratteri) o una **PEC**, scrivili: servono perché la fattura gli arrivi.

Poi tocca **Salva bozza fattura**.

**[SCREENSHOT: riquadro "Dati della fattura" con la casella del bollo]**

### 8.3 Emettere la fattura

Quando è tutto giusto tocca **Emetti fattura**. Si apre un riepilogo con cliente, importi, bollo, numero previsto e le **diciture di legge** che compariranno in fattura.

**[SCREENSHOT: scheda "Emetti fattura"]**

- Gli avvisi in **rosso** ("Da correggere") ti impediscono di emettere: tocca il collegamento accanto per andare a sistemare il dato.
- Gli avvisi in giallo ("Attenzione") ti informano ma non bloccano.
- Spunta la casella di conferma (leggila!) e **tieni premuto** il pulsante **"Tieni premuto per emettere"**.

**L'emissione è definitiva.** Dopo non puoi più modificare né cancellare la fattura (capitolo 10). Il numero (per esempio `12/2026`) viene assegnato **solo in questo momento**.

Se il telefono non riesce a salvare i dati in modo sicuro (capitolo 14), l'app **non ti lascia emettere**: è voluto, per non "bruciare" un numero senza che la fattura sia salvata.

---

## 9. Mandare la fattura all'Agenzia delle Entrate (SDI)

**L'app non invia nulla.** Dopo l'emissione la fattura risulta **"Emessa"**, ma **non è ancora stata inviata**: finché non la carichi tu, per il Fisco non esiste. **Hai di norma 12 giorni dalla data dell'operazione** per inviarla (chiedi conferma al tuo commercialista).

Il modo gratuito è il portale **"Fatture e Corrispettivi"** dell'Agenzia delle Entrate. Nell'app, sulla fattura emessa, c'è il pulsante **Come inviarla allo SDI** con questi passi:

1. Tocca **Scarica XML** nella fattura emessa. Si scarica un file che si chiama tipo `IT01234567897_00001.xml`. **Non aprirlo e non modificarlo.**
2. Vai sul portale **Fatture e Corrispettivi** dell'Agenzia delle Entrate e accedi con **SPID, CIE o CNS**.
3. Entra nella parte di **Fatturazione elettronica** e **carica il file XML**. Il portale ti dice se l'ha accettato. (In alternativa, se sei già accreditato, puoi inviarlo via PEC allo SDI.)
4. Torna nell'app e tocca **Segna come inviata**.
5. Dopo un po', lo SDI risponde con un esito. Toccando **Registra esito SDI** scegli (e indica la **data** in cui hai ricevuto la notifica):
   - **Consegnata**: tutto a posto, la fattura è arrivata al cliente.
   - **Mancata consegna**: lo SDI non è riuscito a consegnarla (per esempio PEC piena), ma la fattura è comunque **emessa**. Avvisa il cliente e mandagli il PDF.
   - **Scartata**: lo SDI l'ha rifiutata, quindi **non è emessa**. Puoi scrivere i codici di scarto (facoltativi) che trovi nella notifica. Vedi qui sotto.

**[SCREENSHOT: scheda "Come inviarla allo SDI"]**
**[SCREENSHOT: scheda "Registra esito SDI"]**
**[SCREENSHOT: portale Fatture e Corrispettivi, caricamento file — da aggiungere a mano]**

Annotare gli stati nell'app non cambia nulla per il Fisco: serve solo a **ricordarti a che punto sei**. Se non segni l'invio, l'app continua a mostrare "Emessa". Le date degli esiti non possono essere nel futuro né precedenti all'esito già registrato.

### Se lo SDI scarta la fattura: Correggi e rinvia

Una fattura scartata si considera **non emessa**. In generale si corregge l'errore e si rinvia **con lo stesso numero e la stessa data entro 5 giorni dalla notifica di scarto** (regola da confermare con il tuo commercialista). L'app ti aiuta così:

1. Registra l'esito **Scartata** con la **data della notifica** e i codici di errore.
2. Sulla fattura compare **Correggi e rinvia** (con la scadenza dei 5 giorni). Puoi correggere i dati del **cliente**, le **righe**, le **note** e la scelta sul bollo. **Numero, data e sezionale restano gli stessi.** (Per una nota di credito scartata si corregge il cliente e le note, non le righe.)
3. Tocca **Rigenera il file XML**: l'app prepara un nuovo file con un nuovo nome e **conserva il vecchio** (puoi sempre scaricarlo).
4. Scarica il nuovo XML, caricalo sul portale e tocca **Segna come rinviata**.

**Se sono passati più di 5 giorni** l'app non ti lascia rinviare con lo stesso numero: propone **Rifai come nuova fattura**, che crea una **nuova bozza collegata** alla scartata (con righe e cliente copiati, data di oggi e numero nuovo all'emissione). In ogni caso, **senti il tuo commercialista**: è lui a dirti come comportarti.

### Il PDF per il cliente

Il PDF dell'app è una **copia di cortesia** (c'è scritto sopra). La fattura vera è il file XML inviato allo SDI. Al privato puoi dare il PDF; il cliente con partita IVA di solito la trova nel suo cassetto fiscale.

### Incassi

Quando il cliente paga, nella fattura tocca **Registra incasso**: data, importo, come ha pagato (bonifico, contanti, carta, assegno). Puoi registrare più incassi (acconti), ma **non più di quanto resta da incassare**; un incasso non si può cambiare né cancellare dopo averlo registrato, e non si registra su una nota di credito. Il pagamento **non cambia** niente per l'Agenzia: serve a te per sapere cosa è stato pagato e per l'indicatore del limite di ricavi (per un forfettario i ricavi si contano all'incasso: chiedi al commercialista).

---

## 10. Perché una fattura emessa non si cancella (e la nota di credito)

Una fattura emessa è un **documento fiscale**: i numeri devono essere uno dopo l'altro, senza "buchi", e ciò che hai emesso non si può riscrivere. Per questo l'app:

- **non ti fa modificare** una fattura emessa,
- **non ti fa cancellarla**,
- ti permette di cancellare solo **bozze** e **preventivi**.

Non è un limite dell'app: è la regola con cui funziona la fatturazione elettronica. Se hai fatto un errore, si fa una **nota di credito**.

### Come fare una nota di credito

1. Apri la fattura emessa e tocca **Annulla con nota di credito**.
2. Scegli se stornare **tutto** (**Storna il residuo**) o solo **alcune righe e quantità** (**Storno parziale**, per esempio il rubinetto che il cliente ha reso). Puoi fare più note parziali, ma mai oltre l'importo della fattura.
3. Scrivi il **motivo** (obbligatorio, finisce nel documento).
4. Conferma come per la fattura. La nota di credito ha una numerazione sua (`NC1/2026`) e richiama la fattura originale. Se la nota supera 77,47 € ha un suo bollo; la scheda te lo dice prima.
5. **Anche la nota di credito va inviata allo SDI**, con gli stessi passi del capitolo 9.

**[SCREENSHOT: scheda "Nota di credito" con scelta delle righe]**

Poi, se serve, rifai la fattura giusta con **Duplica come bozza** (si crea una bozza nuova, senza numero). Se la fattura è ancora una **bozza**, non serve la nota di credito: la modifichi o la elimini. Le note di credito non si possono fare su una fattura scartata (quella si corregge e si rinvia).

---

## 11. Documenti, stati, riepilogo e materiale per il commercialista

In **Documenti** vedi tutto: preventivi, fatture, note di credito. Puoi cercare per cliente o numero e filtrare per tipo, stato e anno.

**[SCREENSHOT: pagina Documenti con filtri]**

Stati di una fattura:

| Stato | Che cosa significa |
|---|---|
| Bozza | Non ha numero. Puoi modificarla o eliminarla |
| Emessa | Ha il numero ed è bloccata, ma non risulta ancora inviata allo SDI |
| Inviata allo SDI | Hai segnato di averla caricata. Aspetta l'esito |
| Consegnata | Arrivata al cliente |
| Mancata consegna | Non consegnata, ma emessa. Avvisa il cliente |
| Scartata dallo SDI | Rifiutata: non è emessa. Da correggere e rinviare |
| Stornata | Annullata da una nota di credito |

In cima trovi un **riepilogo** dell'anno: il **fatturato** (senza IVA, al netto delle note di credito), quanto resta **da incassare**, un promemoria dei **bolli** divisi per trimestre e l'indicatore del limite dei ricavi. Sono solo somme di controllo: **non sostituiscono il lavoro del tuo commercialista**.

**L'indicatore degli 85.000 €.** Una barra mostra quanto hai **incassato nell'anno secondo i pagamenti che hai registrato nell'app** rispetto a 85.000 €. Da circa l'80% compare un avviso giallo; se superi 85.000 € compare un avviso rosso che ti invita a sentire subito il commercialista. **Attenzione:** l'indicatore non conosce i ricavi che non hai registrato nell'app, non sottrae i rimborsi per note di credito, non controlla l'uscita dal regime a 100.000 € né le altre cause di esclusione. Il limite vero **va tenuto d'occhio con il tuo commercialista**.

**Per il commercialista** (pulsanti nella pagina Documenti, per l'anno scelto):

- **Esporta registro fatture (CSV)**: un elenco di fatture e note emesse (numero, data, cliente, imponibile, bollo, totale, stato SDI, incassato) che si apre in Excel.
- **Esporta tutti gli XML (ZIP)**: un unico file con gli XML di tutte le fatture e note emesse.
- **Registro attività**: l'elenco di tutto ciò che è successo (emissioni, scaricamenti, invii, incassi, correzioni, ripristini...), filtrabile e scaricabile in CSV. Su ogni fattura emessa c'è anche la sua **Cronologia**. Non si cancella.

Sono comodità per passare i dati: **non sono la conservazione a norma** (capitolo 15).

---

## 12. Backup, controllo dati e cambio telefono

Se **non usi l'account**, i tuoi dati stanno **solo nel telefono**. Se cancelli i dati del browser, perdi il telefono o lo cambi, **perdi tutto**. Quindi fai ogni tanto il backup.

### Fare il backup

1. In fondo a ogni pagina tocca **Backup**.
2. Tocca **Scarica backup (.json)**. Si salva un file con la data nel nome. La pagina ti ricorda quando l'hai fatto l'ultima volta e, dopo 14 giorni, ti dice che è ora di rifarlo.
3. **Conservalo in un posto sicuro** (email a te stesso, Google Drive, computer). Fallo ogni tanto, e **sempre prima di cambiare telefono o di cancellare i dati del browser**.

**[SCREENSHOT: pagina Backup]**

Il backup contiene profilo, listino, **rubrica clienti**, documenti e registro delle attività. **Non è la conservazione a norma delle fatture.**

### Ripristinare un backup

**Scegli file di backup...**, seleziona il file: l'app ti mostra un'**anteprima** di cosa contiene e cosa c'è ora sul telefono. Per confermare devi spuntare **"Ho capito"** (il ripristino **sostituisce** i dati che ci sono sul telefono) e toccare **Ripristina i dati**.

- L'app **controlla le fatture emesse** contenute nel file (che il file XML sia quello originale, i numeri, le note di credito collegate). Se qualcosa non torna, **rifiuta il ripristino** e ti elenca i problemi senza cambiare nulla; sei tu a poter scegliere, volendo, di ripristinare tutto tranne i documenti non validi.
- Se il backup è più vecchio dei dati attuali, **non tornano indietro i numeri già usati** (l'app tiene il numero più alto) e ti avvisa delle fatture emesse dopo il backup che verrebbero sostituite. Controlla comunque con il commercialista che la numerazione sia continua.

### Controllo dati

Il pulsante **Controlla i dati** (stessa pagina) verifica che l'archivio sia coerente: numerazione senza buchi, nessun numero doppio, file XML integri, note di credito collegate, registro completo. **Non modifica niente.** "Da controllare" non significa che c'è un errore fiscale: ti dice solo cosa non quadra nei dati dell'app, da far vedere al commercialista.

### Cambio telefono

- **Con l'account** (capitolo 13): sul telefono nuovo accedi con la tua email e ritrovi profilo, listino, preventivi e fatture. **La rubrica clienti non si sincronizza**: ricostruiscila da **Clienti → Aggiungi dai documenti** o importando il CSV. Poi controlla nel Profilo la scheda "Numerazione fatture elettroniche".
- **Senza account**: sul telefono vecchio fai il backup, sul nuovo usa **Ripristina da backup**. Senza backup e senza account i dati non si possono recuperare.
- **Non emettere fatture da due telefoni contemporaneamente.**

---

## 13. Account e sincronizzazione (facoltativo)

L'account **non è obbligatorio**. Serve se vuoi ritrovare i dati su un altro telefono o se vuoi il piano Pro.

1. Tocca **Account** (in fondo alla pagina).
2. Scrivi la tua **email** e tocca **Inviami il codice**. Se ti hanno dato un **codice invito**, c'è un campo apposta (serve solo per creare un nuovo account).
3. Ti arriva una email con un **codice di 6 cifre**: scrivilo e tocca **Accedi**. Niente password da ricordare. La prima volta devi accettare i Termini.
4. La prima volta l'app ti mostra cosa caricherà sul tuo account (listino, preventivi, fatture) e chiede conferma: **Carica e sincronizza**.

**[SCREENSHOT: pagina Account con login]**
**[SCREENSHOT: schermata di conferma "Carica e sincronizza"]**

Poi i dati si sincronizzano da soli quando c'è internet. Senza internet puoi continuare a lavorare: le modifiche partono appena torna la rete. Per forzare, tocca **Sincronizza ora**. Con **Esci** scolleghi l'account (i dati restano sul telefono).

### Cose da sapere

- Con l'account i tuoi dati e quelli dei tuoi clienti stanno anche sui nostri server in Europa. Leggi l'informativa **Privacy** in fondo alla pagina. La rubrica clienti resta solo sul telefono.
- **Emetti le fatture da un solo telefono.** Se due telefoni emettono nello stesso momento senza internet, potrebbero dare lo stesso numero a due fatture; l'app te lo segnala come "conflitto" e non carica il doppione, ma una fattura già emessa non si può rinumerare: meglio evitarlo.
- Le fatture **emesse** non si modificano nemmeno con la sincronizzazione.

### Se due telefoni hanno cambiato la stessa bozza

Nella pagina Account, sotto **"Da controllare"**, l'app non sovrascrive mai in silenzio una bozza. Ti mostra le due versioni (cliente, righe, totale, note, data) e ti fa scegliere:

- **Usa quella del server**: tieni la versione dell'altro telefono.
- **Tieni la mia**: la tua versione sostituisce l'altra.
- **Tieni entrambe**: la tua versione diventa una nuova bozza ("copia in conflitto", senza numero fiscale) e l'altra resta com'è.

Per il listino e i dati azienda vince l'ultima modifica; ogni sovrascrittura è annotata nel "Registro di sincronizzazione".

### Se l'app dice "Controlla prima di continuare"

Compare se, su questo telefono, sono spariti **molti** elementi che erano sincronizzati (per esempio dopo aver cancellato i dati del browser). L'app **non propaga la cancellazione** finché non decidi: **Ripristina dall'account** (consigliato: riprende i dati dal server) oppure **Conferma: cancella anche dall'account** (con una seconda conferma).

### Se cambi account sullo stesso telefono

L'app ti avvisa che i dati sul telefono "appartengono a un altro account" e puoi scegliere **Svuota i dati locali** (scarica prima una copia di sicurezza) oppure **Carica comunque sul mio account**. Non caricare dati che non sono tuoi.

### I tuoi dati e la cancellazione dell'account

In **Account → I tuoi dati**: **Scarica tutti i miei dati** e **Cancella il mio account**. Cancellare l'account toglie i tuoi dati dai nostri server; **le fatture già emesse restano conservate sui server per obbligo di legge** e tutto ciò che hai sul telefono resta lì. **Se hai un abbonamento attivo, cancellare l'account non lo disdice**: prima annullalo dal portale di fatturazione.

### Piani, limiti e prezzi

C'è un piano **Gratis** e un piano **Pro**.

- **Gratis: 3 documenti nuovi al mese.** Contano i **preventivi e le fatture che crei**, compresa la **bozza di fattura che nasce dalla conversione di un preventivo** e un documento **duplicato**: un preventivo convertito in fattura fa quindi 2 documenti. Non contano le **note di credito** (stornare è un obbligo) e **una bozza eliminata non "restituisce" il conteggio**. Il contatore riparte il 1° del mese. Nelle schermate vedi **"Documenti questo mese: 2/3"** e, quando ne resta uno, un avviso discreto.
- **Quando raggiungi il limite** compare un messaggio gentile: **non perdi niente**. Puoi sempre consultare, modificare e scaricare i tuoi documenti, fare il backup e stornare con una nota di credito anche oltre il limite. Per crearne di nuovi aspetti il mese dopo o passi a Pro.
- **Pro: documenti senza limite** e sincronizzazione su più dispositivi. Si attiva da **Account → Passa a Pro**, con pagamento a carta; puoi disdire in qualsiasi momento da **Gestisci abbonamento**. I prezzi e il fatto che comprendano o no l'IVA sono indicati nella pagina **Informazioni**.
- Se per qualche giorno l'app non riesce a verificare il tuo abbonamento (per esempio sei offline) il Pro resta valido fino a **14 giorni**; poi torna Gratis finché non si ricollega. I tuoi dati non si toccano mai.
- Senza account il conteggio è solo sul tuo telefono ed è un limite "morbido": il limite vero sui dati sincronizzati lo applica il server.

---

## 14. Se l'app dice che i dati non vengono salvati

In cima a tutte le pagine può comparire una striscia rossa o gialla:

- **"I dati non vengono salvati"**: il browser non permette all'app di salvare (per esempio navigazione privata, archivio disabilitato, spazio finito, un'altra scheda dell'app aperta). **Finché dura, l'app non ti lascia emettere fatture né registrare incassi o esiti**, per non perdere numeri e dati. Cosa fare: chiudi le altre schede dell'app, esci dalla navigazione privata, libera spazio sul telefono e tocca **Riprova**.
- **"Attenzione: i salvataggi potrebbero non andare a buon fine"** o **"spazio libero quasi finito"**: l'ultimo salvataggio non è riuscito, oppure restano meno di 50 MB. Libera spazio e riprova.
- In entrambi i casi puoi toccare **Scarica backup di emergenza**, che salva quello che c'è.

Non ignorare questo avviso: se l'app non riesce a salvare, le cose che fai non resteranno.

---

## 15. Conservare le fatture per legge

Le fatture elettroniche vanno **conservate per 10 anni** (da confermare con il tuo commercialista). **VocePreventivo non è un sistema di conservazione a norma**: il backup, lo ZIP degli XML e l'archivio sui nostri server non lo sono. Per essere in regola puoi:

- attivare il servizio **gratuito di conservazione dell'Agenzia delle Entrate** dal portale Fatture e Corrispettivi (non è automatico: lo devi accettare tu), oppure
- usare un conservatore a pagamento.

Chiedi al tuo commercialista quale scegliere.

---

## 16. Se qualcosa non va

- **La voce non parte:** scrivi la frase nel campo di testo. Controlla che il microfono sia consentito al browser (impostazioni del telefono). Serve internet per la dettatura.
- **Non riesco a emettere:** leggi gli avvisi in rosso nella scheda "Emetti fattura": ti dicono cosa manca (partita IVA, indirizzo del cliente, righe "da verificare"...). Se in cima alla pagina c'è la striscia sui dati non salvati, vedi il capitolo 14.
- **Lo SDI ha scartato la fattura:** non è emessa. Registra lo scarto e usa **Correggi e rinvia**: hai 5 giorni. Chiama subito il commercialista.
- **Ho cancellato per sbaglio una bozza:** non si recupera. Per questo i preventivi si conservano e le bozze si duplicano.
- **Ho cambiato telefono e non vedo i clienti:** la rubrica non si sincronizza; vedi il capitolo 12.
- **Ho raggiunto il limite dei 3 documenti:** vedi capitolo 13.
- **Altre domande:** vedi il file delle domande frequenti (`FAQ-SUPPORTO.md`).

*Aggiornato al 4 novembre 2026. Le regole fiscali citate sono quelle che l'app applica oggi e non sono ancora state verificate da un professionista: per qualsiasi dubbio fiscale rivolgiti al tuo commercialista.*
