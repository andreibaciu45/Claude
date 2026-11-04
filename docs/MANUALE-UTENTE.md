# VocePreventivo — Manuale d'uso

Per artigiani: idraulici, elettricisti, imbianchini, fabbri... Si legge in dieci minuti. Dove vedi **[SCREENSHOT: ...]** andrà inserita un'immagine dello schermo.

> **Una cosa importante prima di cominciare.** VocePreventivo ti aiuta a preparare preventivi e fatture, ma **non è un commercialista e non invia niente al Fisco al posto tuo**. La fattura elettronica la prepara l'app, **l'invio lo fai tu** (te lo spiego al capitolo 7). Per ogni dubbio fiscale chiedi al tuo commercialista. L'app è pensata per chi è in **regime forfettario**.

---

## 1. Che cosa fa l'app

- Tu **detti** a voce il lavoro fatto ("tre ore di manodopera e due metri di tubo rame") e l'app prepara il **preventivo**.
- Usa il **tuo listino** (i tuoi prezzi) per mettere le cifre giuste.
- Quando il lavoro è finito, trasforma il preventivo in **fattura** e prepara il **file XML** della fattura elettronica e una **copia PDF** da mandare al cliente.
- Se sbagli una fattura già emessa, prepara la **nota di credito** per annullarla.

Cosa **non** fa: non invia la fattura all'Agenzia delle Entrate, non conserva le fatture "a norma di legge", non paga tasse né bollo, non ti avvisa se superi il limite di ricavi del forfettario.

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

> **Attenzione iPhone:** quando l'app è installata sulla Home, il riconoscimento vocale del telefono a volte non è disponibile. In quel caso l'app può usare un servizio nostro per trascrivere la voce (l'audio non viene conservato). Se la voce non funziona, **puoi sempre scrivere la frase** nel campo di testo.

> **Computer:** funziona anche dal computer, ma la dettatura vocale non c'è su tutti i browser (su Firefox no). Basta scrivere la frase.

---

## 3. Il primo avvio: i tuoi dati (Profilo)

Prima di fare una fattura devi dire chi sei. Tocca **Profilo** (in basso).

**[SCREENSHOT: pagina Profilo "Dati azienda"]**

Compila:

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

**Il numero della prima fattura.** L'app numera le fatture da sola: `1/2026`, `2/2026`, e così via; a gennaio riparte da 1. **Attenzione:** se nell'anno hai già fatto fatture con un altro programma o a mano, **l'app oggi non ti permette di dirle da quale numero partire**: la prima sarebbe `1/2026`. In questo caso parlane prima con il tuo commercialista.

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

## 5. Fare un preventivo con la voce

1. Tocca **Nuovo** (in basso, icona del microfono).
2. Premi il microfono e **parla** con calma, per esempio: *"preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera"*.
   Non vuoi parlare? **Scrivi la stessa frase** nel campo di testo.
3. L'app propone la scheda con le **righe**, le quantità e i prezzi.

**[SCREENSHOT: "Detta a voce o scrivi" con il microfono]**
**[SCREENSHOT: scheda del preventivo con le righe]**

### Controlla sempre le righe

- Le righe che l'app **non ha trovato nel listino** sono segnate **"da verificare"**. Controlla descrizione e prezzo e conferma. **Finché ci sono righe "da verificare" non puoi emettere la fattura.**
- Puoi cambiare quantità, prezzo, sconto in percentuale, aggiungere o togliere righe, scrivere il cliente (nome, indirizzo, partita IVA o codice fiscale).
- Aggiungi eventuali note ("Il prezzo non comprende opere murarie").
- Il preventivo **non è un documento fiscale**: non va mandato all'Agenzia delle Entrate e non porta il bollo.

### Mandare il preventivo al cliente

Apri il preventivo da **Documenti** e scegli **Scarica PDF**, poi invialo come vuoi. C'è anche il pulsante **Invia su WhatsApp**.

**[SCREENSHOT: pulsanti "Scarica PDF" e "Invia su WhatsApp"]**

Quando il cliente risponde, segna il preventivo come **accettato** o **rifiutato**.

### Comandi vocali dopo il preventivo

C'è un pulsante microfono fisso sullo schermo: toccalo (o tienilo premuto) e puoi dire per esempio *"converti il preventivo 8 in fattura"*, *"segna come pagata la fattura 12"*. **Le azioni che non si possono annullare** (emettere una fattura, fare una nota di credito) **non partono mai con la sola voce**: l'app ti mostra un riepilogo e devi confermare toccando.

---

## 6. Dal preventivo alla fattura

### 6.1 Creare la bozza

1. Da **Documenti** apri il preventivo accettato.
2. Tocca **Converti in fattura**. Si crea una **bozza di fattura**: ha le stesse righe e lo stesso cliente.

Una **bozza** è una fattura "in preparazione": non ha ancora il numero, puoi modificarla e anche eliminarla senza conseguenze.

**[SCREENSHOT: pulsante "Converti in fattura"]**

### 6.2 Completare i dati

Nella bozza trovi il riquadro **"Dati della fattura"**:

- **Data dell'operazione**: la data che comparirà in fattura (di solito oggi). Se la fattura è di oltre **12 giorni** fa, l'app ti avvisa: chiedi al tuo commercialista entro quando va inviata.
- **Bollo**: se la fattura supera **77,47 €** (e non c'è IVA, come per i forfettari) c'è il **bollo da 2,00 €**. Puoi scegliere se **addebitarlo al cliente** (spunta la casella: compare una riga "Rimborso imposta di bollo") oppure tenerlo a tuo carico. Il bollo **lo paghi tu** all'Agenzia: l'app non lo paga al tuo posto.
- **Cliente**: servono indirizzo completo e **partita IVA oppure codice fiscale**. Per un privato basta il codice fiscale. Se il cliente ha un **codice destinatario** (7 caratteri) o una **PEC**, scrivili: servono perché la fattura gli arrivi.

**[SCREENSHOT: riquadro "Dati della fattura" con la casella del bollo]**

### 6.3 Emettere la fattura

Quando è tutto giusto tocca **Emetti fattura**. Si apre un riepilogo con cliente, importi, bollo e numero previsto.

**[SCREENSHOT: scheda "Emetti fattura"]**

- Gli avvisi in **rosso** ("Da correggere") ti impediscono di emettere: tocca il collegamento accanto per andare a sistemare il dato.
- Gli avvisi in giallo ("Attenzione") ti informano ma non bloccano.
- Spunta la casella di conferma (leggila!) e **tieni premuto** il pulsante **"Tieni premuto per emettere"**.

**L'emissione è definitiva.** Dopo non puoi più modificare né cancellare la fattura (capitolo 8). Il numero (per esempio `12/2026`) viene assegnato **solo in questo momento**.

---

## 7. Mandare la fattura all'Agenzia delle Entrate (SDI)

**L'app non invia nulla.** Dopo l'emissione la fattura risulta **"Emessa"**, ma **non è ancora stata inviata**: finché non la carichi tu, per il Fisco non esiste. **Hai di norma 12 giorni dalla data dell'operazione** per inviarla (chiedi conferma al tuo commercialista).

Il modo gratuito è il portale **"Fatture e Corrispettivi"** dell'Agenzia delle Entrate. Nell'app, sulla fattura emessa, c'è il pulsante **Come inviarla allo SDI** con questi passi:

1. Tocca **Scarica XML** nella fattura emessa. Si scarica un file che si chiama tipo `IT01234567897_00001.xml`. **Non aprirlo e non modificarlo.**
2. Vai sul portale **Fatture e Corrispettivi** dell'Agenzia delle Entrate e accedi con **SPID, CIE o CNS**.
3. Entra nella parte di **Fatturazione elettronica** e **carica il file XML**. Il portale ti dice se l'ha accettato.
4. Torna nell'app e tocca **Segna come inviata**.
5. Dopo un po', lo SDI risponde con un esito. Toccando **Registra esito SDI** scegli:
   - **Consegnata**: tutto a posto, la fattura è arrivata al cliente.
   - **Mancata consegna**: lo SDI non è riuscito a consegnarla (per esempio PEC piena), ma la fattura è comunque **emessa**. Avvisa il cliente e mandagli il PDF.
   - **Scartata**: lo SDI l'ha rifiutata, quindi **non è emessa**. Va corretta e rinviata **entro 5 giorni** dallo scarto con lo stesso numero e la stessa data. L'app oggi **non** ti guida a correggere il file: **chiama il tuo commercialista**.

**[SCREENSHOT: scheda "Come inviarla allo SDI"]**
**[SCREENSHOT: scheda "Registra esito SDI"]**
**[SCREENSHOT: portale Fatture e Corrispettivi, caricamento file — da aggiungere a mano]**

Annotare gli stati nell'app non cambia nulla per il Fisco: serve solo a **ricordarti a che punto sei**. Se non segni l'invio, l'app continua a mostrare "Emessa".

### Il PDF per il cliente

Il PDF dell'app è una **copia di cortesia** (c'è scritto sopra). La fattura vera è il file XML inviato allo SDI. Al privato puoi dare il PDF; il cliente con partita IVA di solito la trova nel suo cassetto fiscale.

### Incassi

Quando il cliente paga, nella fattura tocca **Registra incasso**: data, importo, come ha pagato (bonifico, contanti, carta, assegno). Il pagamento **non cambia** niente per l'Agenzia: serve a te per sapere cosa è stato pagato (per un forfettario i ricavi si contano all'incasso: chiedi al commercialista).

---

## 8. Perché una fattura emessa non si cancella

Una fattura emessa è un **documento fiscale**: i numeri devono essere uno dopo l'altro, senza "buchi", e ciò che hai emesso non si può riscrivere. Per questo l'app:

- **non ti fa modificare** una fattura emessa,
- **non ti fa cancellarla**,
- ti permette di cancellare solo **bozze** e **preventivi**.

Non è un limite dell'app: è la regola con cui funziona la fatturazione elettronica. Se hai fatto un errore, si fa una **nota di credito**.

### Come fare una nota di credito

1. Apri la fattura emessa e tocca **Annulla con nota di credito**.
2. Scegli se stornare **tutto** o solo **alcune righe e quantità** (per esempio il rubinetto che il cliente ha reso).
3. Scrivi il **motivo** (obbligatorio, finisce nel documento).
4. Conferma come per la fattura. La nota di credito ha una numerazione sua (`NC1/2026`) e richiama la fattura originale.
5. **Anche la nota di credito va inviata allo SDI**, con gli stessi passi del capitolo 7.

**[SCREENSHOT: scheda "Nota di credito" con scelta delle righe]**

Poi, se serve, rifai la fattura giusta con **Duplica come bozza** (si crea una bozza nuova, senza numero).

Se la fattura è ancora una **bozza**, non serve la nota di credito: la modifichi o la elimini.

---

## 9. Documenti, stati e riepilogo

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

In cima trovi un **riepilogo** dell'anno: totale fatturato (senza IVA, al netto delle note di credito), un promemoria dei **bolli** del trimestre e quanto resta **da incassare**. Sono solo somme di controllo: **non sostituiscono il lavoro del tuo commercialista**. In particolare l'app **non ti avvisa** se ti avvicini al limite di ricavi del regime forfettario: tienilo d'occhio con lui.

Su ogni fattura emessa c'è anche la **Cronologia**: tutto quello che è successo (emessa, XML scaricato, inviata, incassi...). Non si cancella.

---

## 10. Il backup: non perdere i tuoi dati

Se **non usi l'account**, i tuoi dati stanno **solo nel telefono**. Se cancelli i dati del browser, perdi il telefono o lo cambi, **perdi tutto**. Quindi:

1. Vai su **Backup** (dalla pagina Documenti o dal menu: l'indirizzo è `/backup`).
2. Tocca **Scarica backup (.json)**. Si salva un file con data nel nome.
3. **Conservalo in un posto sicuro** (email a te stesso, Google Drive, computer). Fallo ogni tanto, e **sempre prima di cambiare telefono o di cancellare i dati del browser**.

**[SCREENSHOT: pagina Backup]**

Per rimettere i dati (telefono nuovo): **Scegli file di backup...**, seleziona il file e conferma. **Attenzione:** il ripristino **sostituisce** i dati che ci sono sul telefono in quel momento. Se ripristini un backup vecchio, sul telefono tornano le fatture di allora: **non tornano indietro i numeri già usati** (l'app tiene il numero più alto), ma controlla comunque con il commercialista che la numerazione sia continua.

**Importante:** il backup **non è la conservazione a norma delle fatture**. Per quella vedi più sotto.

---

## 11. Account e sincronizzazione (facoltativo)

L'account **non è obbligatorio**. Serve se vuoi ritrovare i dati su un altro telefono o se vuoi il piano Pro.

1. Tocca **Account** (in fondo alla pagina).
2. Scrivi la tua **email** e tocca **Inviami il codice**.
3. Ti arriva una email con un **codice di 6 cifre**: scrivilo e tocca **Accedi**. Niente password da ricordare.
4. La prima volta l'app ti mostra cosa caricherà sul tuo account (listino, clienti, preventivi, fatture) e chiede conferma: **Carica e sincronizza**.

**[SCREENSHOT: pagina Account con login]**
**[SCREENSHOT: schermata di conferma "Carica e sincronizza"]**

Poi i dati si sincronizzano da soli quando c'è internet. Senza internet puoi continuare a lavorare: le modifiche partono appena torna la rete. Per forzare, tocca **Sincronizza ora**. Con **Esci** scolleghi l'account (i dati restano sul telefono).

Cose da sapere:

- Con l'account i tuoi dati e quelli dei tuoi clienti stanno anche sui nostri server in Europa. Leggi l'informativa **Privacy** in fondo alla pagina.
- **Emetti le fatture da un solo telefono.** Se due telefoni emettono nello stesso momento senza internet, potrebbero dare lo stesso numero a due fatture; l'app te lo segnala come "conflitto", ma è meglio evitarlo.
- Le fatture **emesse** non si modificano nemmeno con la sincronizzazione.

### Piani e prezzi

C'è un piano **Gratis** (limite di documenti al mese, indicato nella pagina Account) e un piano **Pro** senza limite di documenti. Il Pro si attiva da **Account → Passa a Pro**, con pagamento a carta e disdetta in qualsiasi momento (**Gestisci abbonamento**). I prezzi sono indicati nella pagina Informazioni.

---

## 12. Conservare le fatture per legge

Le fatture elettroniche vanno **conservate per 10 anni** (da confermare con il tuo commercialista). **VocePreventivo non è un sistema di conservazione a norma.** Per essere in regola puoi:

- attivare il servizio **gratuito di conservazione dell'Agenzia delle Entrate** dal portale Fatture e Corrispettivi (non è automatico: lo devi accettare tu), oppure
- usare un conservatore a pagamento.

Chiedi al tuo commercialista quale scegliere.

---

## 13. Se qualcosa non va

- **La voce non parte:** scrivi la frase nel campo di testo. Controlla che il microfono sia consentito al browser (impostazioni del telefono). Serve internet per la dettatura.
- **Non riesco a emettere:** leggi gli avvisi in rosso nella scheda "Emetti fattura": ti dicono cosa manca (partita IVA, indirizzo del cliente, righe "da verificare"...).
- **Lo SDI ha scartato la fattura:** non è emessa. Chiama subito il commercialista: hai 5 giorni per rinviarla.
- **Ho cancellato per sbaglio una bozza:** non si recupera. Per questo i preventivi si conservano e le bozze si duplicano.
- **Altre domande:** vedi il file delle domande frequenti (`FAQ-SUPPORTO.md`).

*Aggiornato al 4 novembre 2026. Le regole fiscali citate sono quelle che l'app applica oggi e non sono ancora state verificate da un professionista: per qualsiasi dubbio fiscale rivolgiti al tuo commercialista.*
