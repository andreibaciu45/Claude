# VocePreventivo — Domande frequenti e risposte per l'assistenza

Uso interno e pubblico. Le risposte sono scritte per essere incollate a un cliente. Regola d'oro per chi risponde: **sul fisco non si dà mai un parere**: si spiega cosa fa l'app e si rimanda al commercialista. Dove una regola fiscale è ancora "da verificare" lo diciamo.

Indice: **A** Cos'è e come si usa (1-8) · **B** Fatture e fisco (9-20) · **C** Dati, account, abbonamento (21-26) · **D** Problemi tecnici (27-30)

---

## A. Cos'è e come si usa

**1. Devo registrarmi per usare l'app?**
No. Puoi usarla subito senza account: i dati stanno sul tuo telefono. L'account serve solo se vuoi ritrovare i dati su un altro dispositivo o passare al piano Pro.

**2. Funziona senza internet?**
Sì per preventivi, bozze di fattura, listino e clienti. Serve internet per la dettatura vocale (di solito la fa il browser tramite i server di Google o Apple), per la sincronizzazione e per il pagamento dell'abbonamento. Per caricare la fattura sul portale dell'Agenzia delle Entrate serve internet, ovviamente.

**3. Che telefono e browser servono?**
Meglio Chrome su Android e Safari recente su iPhone. Su Firefox e su alcuni computer la dettatura non c'è: puoi scrivere la frase nel campo di testo e funziona uguale.

**4. Come si installa sul telefono?**
Android: Chrome, tre puntini, "Installa app" o "Aggiungi a schermata Home". iPhone: Safari, tasto Condividi, "Aggiungi a Home". Non passa dagli store. Passi illustrati nel manuale, capitolo 2.

**5. La voce non capisce quello che dico. Cosa faccio?**
Parla piano e dì quantità e unità chiare ("due metri di tubo rame da sedici"). Più il tuo listino è completo, meglio ti capisce. Le righe non riconosciute sono segnate "da verificare" e le correggi a mano. In ogni caso puoi scrivere la frase al posto di dirla.

**6. Perché mi chiede di "verificare" alcune righe?**
Perché non le ha trovate nel tuo listino e non vuole inventare un prezzo. Finché ci sono righe "da verificare" non puoi emettere la fattura: controlla descrizione e prezzo e conferma.

**7. Come importo il mio listino?**
Dalla pagina Catalogo: "Importa CSV" per caricare un file, oppure "Aggiungi voci di esempio" per partire da un listino del tuo mestiere e poi correggere i prezzi, oppure "+ Nuova voce" una alla volta.

**8. Posso cambiare i prezzi per un singolo cliente?**
Sì: dentro il preventivo puoi cambiare prezzo, quantità e sconto di ogni riga senza toccare il listino.

---

## B. Fatture e fisco

**9. L'app invia la fattura all'Agenzia delle Entrate?**
No. Genera il file XML della fattura elettronica; **l'invio lo fai tu**, caricando il file sul portale gratuito "Fatture e Corrispettivi" dell'Agenzia delle Entrate con SPID, CIE o CNS (o con altro canale valido). Finché non lo carichi, la fattura non risulta emessa ai fini fiscali. Nell'app, sulla fattura, c'è la guida passo passo "Come inviarla allo SDI".

**10. Allora a cosa serve se devo mandarla io?**
Prepara per te numero, dati, bollo, diciture e file nel formato giusto: le parti noiose e facili da sbagliare. Il caricamento sul portale è l'ultimo passo, di pochi minuti.

**11. Entro quando devo inviare la fattura?**
Di norma entro 12 giorni dalla data dell'operazione (regola generale: chiedi conferma al tuo commercialista nel tuo caso). L'app ti avvisa se la data della fattura è più vecchia di 12 giorni, ma non sa quando carichi davvero il file e non calcola sanzioni.

**12. Il PDF è la fattura?**
No. Il PDF è una **copia di cortesia** (c'è scritto sopra). La fattura è il file XML inviato allo SDI. Al cliente privato puoi consegnare il PDF come copia.

**13. Perché non posso modificare o cancellare una fattura emessa?**
Perché le fatture hanno numeri progressivi e non si riscrivono: una volta emessa, la fattura è bloccata. Se hai sbagliato si fa una **nota di credito** (pulsante "Annulla con nota di credito") e, se serve, una nuova fattura. Le bozze invece si modificano e si eliminano liberamente.

**14. Come si fa una nota di credito?**
Apri la fattura emessa, "Annulla con nota di credito", scegli se stornare tutto o solo alcune righe, scrivi il motivo e conferma. Poi **invia anche la nota di credito allo SDI**, come una fattura. Vedi manuale, capitolo 8.

**15. Lo SDI ha scartato la mia fattura. Cosa devo fare?**
Una fattura scartata si considera non emessa. In generale si corregge l'errore e si rinvia con lo stesso numero e la stessa data entro 5 giorni dalla notifica di scarto (regola riportata da più fonti: chiedi conferma al tuo commercialista). Nell'app registra l'esito "Scartata" così lo stato è corretto; se sulla fattura c'è il pulsante "Correggi e rinvia" (versione in lavorazione al 4/11/2026) tiene numero e data e rigenera il file; oltre i 5 giorni propone una nuova fattura collegata. In ogni caso, contatta il tuo commercialista.

**16. Quando devo mettere il bollo da 2 euro?**
Per un forfettario, la fattura senza IVA di importo **superiore a 77,47 €** ha il bollo di 2,00 €. L'app lo calcola da sola e lo scrive nel file. Puoi scegliere di addebitarlo al cliente (compare la riga "Rimborso imposta di bollo") o tenerlo a tuo carico. **Il versamento del bollo lo fai tu** (l'app mostra solo un promemoria dei bolli del trimestre). Il trattamento del bollo sulle note di credito è una regola che stiamo facendo verificare.

**17. Devo pagare io il bollo? Come?**
Sì, il bollo virtuale lo paga chi emette la fattura, con versamento periodico: l'app non paga e non calcola il versamento. Chiedi al tuo commercialista come e quando.

**18. Cosa scrive l'app sulla mia fattura riguardo al regime forfettario?**
Una dicitura che richiama l'articolo 1, commi 54-89, della legge 190/2014, il fatto che non c'è IVA, e una frase sulla non applicazione della ritenuta d'acconto. Il testo esatto è in fase di verifica da parte di un commercialista; se il tuo ti indica una formula diversa, diccelo.

**19. Posso fare fatture a clienti all'estero o alla Pubblica Amministrazione?**
La Pubblica Amministrazione no (servono dati e formati che l'app non gestisce). I clienti esteri si possono inserire, ma l'app ti avvisa che la natura dell'operazione "potrebbe non essere corretta": **prima di emettere chiedi al commercialista**.

**20. L'app mi dice quando supero il limite di ricavi del forfettario?**
Non in modo completo. L'app non controlla la soglia di uscita in corso d'anno (100.000 €) né le cause di esclusione. Il riepilogo in Documenti somma le fatture emesse, non i ricavi "per cassa" che contano per il forfettario; è in lavorazione un indicatore sugli 85.000 € calcolato solo sugli incassi che hai registrato nell'app (da aggiornare sulla versione finale). Tieni d'occhio i ricavi con il tuo commercialista.

---

## C. Dati, account, abbonamento

**21. Dove sono i miei dati? Chi li vede?**
Senza account stanno solo sul tuo telefono e noi non li vediamo. Con l'account vengono sincronizzati sui nostri server nell'Unione Europea; per i dati dei tuoi clienti siamo tuoi "responsabili del trattamento". Dettagli nell'informativa Privacy. Il riconoscimento vocale è di solito fatto dal browser (Google o Apple); su iPhone con l'app installata l'audio può passare dai nostri server solo per essere trascritto e non viene conservato.

**22. Ho perso/cambiato il telefono. Come recupero tutto?**
Con l'account: accedi dal telefono nuovo con la tua email (ti mandiamo un codice) e ritrovi i dati. Senza account: puoi recuperare i dati **solo** se avevi scaricato un backup (pagina Backup): rimetti il file sul telefono nuovo. Senza backup e senza account i dati non si possono recuperare.

**23. Come faccio il backup?**
Pagina Backup, "Scarica backup (.json)", e conserva il file in un posto sicuro. Ripristino: "Scegli file di backup...". Il ripristino **sostituisce** i dati presenti. Il backup **non** è la conservazione a norma delle fatture.

**24. Le fatture sono conservate a norma di legge dall'app?**
No. VocePreventivo non è un sistema di conservazione sostitutiva. Le fatture elettroniche vanno conservate per 10 anni (conferma dal tuo commercialista): puoi attivare il servizio gratuito di conservazione dell'Agenzia delle Entrate dal portale Fatture e Corrispettivi (non è automatico), oppure usare un conservatore.

**25. Come funziona il piano gratuito e quello Pro?**
Gratis: un numero limitato di documenti al mese (3 al mese nella versione attuale; la definizione precisa di "documento" è in fase di revisione) con tutte le funzioni di base. Pro: documenti illimitati e sincronizzazione su più dispositivi. Prezzi indicativi nella pagina Informazioni; l'IVA sui prezzi è ancora da definire. Si paga con carta tramite Stripe.

**26. Come disdico il Pro?**
Da Account, "Gestisci abbonamento": si apre il portale di pagamento dove puoi disdire in qualsiasi momento. Se il pagamento fallisce hai alcuni giorni di tolleranza prima di tornare al piano gratuito. I tuoi documenti non vengono cancellati.

---

## D. Problemi tecnici

**27. Non riesco ad accedere: non arriva il codice.**
Controlla spam/promozioni e che l'email sia scritta giusta. Il codice dura pochi minuti e ha un massimo di tentativi: richiedine uno nuovo con "Invia di nuovo il codice". Se ancora non arriva, scrivici da quell'indirizzo.

**28. L'app mi mostra "conflitto" nella sincronizzazione. Cosa significa?**
Due dispositivi hanno modificato la stessa cosa, oppure un documento è stato emesso su un altro dispositivo con un numero già usato. L'app non cancella mai i tuoi dati: ti mostra i conflitti e te li fa risolvere. **Per le fatture, emetti da un solo dispositivo.**

**29. Ho già emesso fatture quest'anno con un altro programma. Da che numero parte l'app?**
Da `1/anno`. Oggi l'app **non** permette di impostare il numero di partenza. Se hai già fatture numerate nell'anno, **non emettere con l'app finché non ne hai parlato con il tuo commercialista** (e con noi: è un limite che stiamo valutando di risolvere).

**30. La fattura mi dice "Emessa" ma il cliente non l'ha ricevuta.**
"Emessa" significa solo che l'app l'ha bloccata e ha preparato il file: **non vuol dire che sia stata inviata**. Controlla di aver caricato l'XML sul portale dell'Agenzia delle Entrate e di aver registrato "Segna come inviata". Se lo SDI risponde "Mancata consegna" (per esempio PEC del cliente piena) la fattura è comunque emessa: avvisa il cliente e mandagli il PDF.

---

### Per chi risponde: cosa NON dire mai

- Non dire "la fattura è a posto/regolare": non possiamo garantirlo.
- Non dire che l'app "invia" o "conserva" le fatture.
- Non indicare cifre di sanzioni.
- Non consigliare se applicare il bollo o come registrare l'incasso in un caso particolare: rimanda al commercialista.
- Se un cliente segnala un possibile errore fiscale dell'app (bollo, diciture, numero), **raccogli**: data, numero fattura, schermata, e passa la segnalazione al responsabile del prodotto; non cambiare nulla sulle sue fatture.
