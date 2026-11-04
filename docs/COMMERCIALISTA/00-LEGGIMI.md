# VocePreventivo — Pacchetto di revisione per il commercialista

Data di preparazione: 4 novembre 2026. **Ultimo aggiornamento: 4 novembre 2026 (seconda stesura, riallineata al codice attuale).** Versione del programma: 0.1.0 (sviluppo concluso, non ancora in vendita, mai provato con fatture reali).

Questo pacchetto è scritto per chi **non è uno sviluppatore**. Non servono competenze informatiche: serve il Suo giudizio professionale su regole fiscali che il programma applica in automatico.

> **Se ha già ricevuto la prima stesura:** la checklist è stata rifatta riga per riga sul codice attuale. Le novità sono elencate all'inizio di `01-CHECKLIST-FISCALE.md` ("Cosa è cambiato rispetto alla prima stesura"); le righe cambiate sono segnate **[AGGIORNATA]** e quelle aggiunte **[NUOVA]**. Anche l'esempio A (`02-ESEMPI`) è stato aggiornato.

## 1. In due righe

VocePreventivo è un'app per artigiani in **regime forfettario** (idraulici, elettricisti, imbianchini...). L'artigiano detta a voce il lavoro fatto ("tre ore di manodopera e due metri di tubo"), l'app prepara un **preventivo**, e quando il lavoro è finito lo trasforma in **fattura elettronica** (file XML in formato FatturaPA) più una copia PDF.

Il punto delicato, e il motivo di questa revisione: **l'app calcola e scrive da sola** numero, data, bollo, diciture e codici della fattura. Se una di queste regole è sbagliata, lo è per tutti i clienti. Per questo chiediamo a Lei di controllarle una per una **prima** del lancio.

## 2. Cosa fa e cosa NON fa

| L'app FA | L'app NON FA |
|---|---|
| Prepara preventivi (non sono documenti fiscali) | **Non trasmette nulla allo SDI.** Genera il file XML; l'artigiano lo scarica e lo carica da sé sul portale gratuito "Fatture e Corrispettivi" dell'Agenzia delle Entrate (o via PEC). Nessun provider di trasmissione è stato scelto |
| Assegna il numero progressivo alla fattura solo al momento dell'emissione (per anno, sezionale `FT`; note di credito sezionale `NC`). Chi ha già emesso altrove può **impostare l'ultimo numero usato** (Profilo, "Numerazione fatture elettroniche") | **Non conserva a norma.** L'archivio dell'app (sul telefono o sincronizzato) non è conservazione sostitutiva: l'artigiano deve attivare il servizio gratuito dell'Agenzia o un conservatore |
| Genera l'XML FatturaPA formato FPR12, tipo documento TD01 (fattura) e TD04 (nota di credito), regime RF19, natura N2.2. Le diciture di legge sono un **testo unico** identico in XML e PDF | **Non è consulenza fiscale** e non garantisce la conformità: lo dichiarano i Termini e le schermate |
| Calcola il bollo da 2 € oltre 77,47 € (dopo gli sconti) e lo scrive nell'XML (`DatiBollo`) con la relativa dicitura | **Non calcola né versa il bollo** (F24 trimestrale): mostra solo un conteggio indicativo per trimestre |
| Blocca modifica e cancellazione di una fattura emessa; si corregge con nota di credito. Se lo SDI scarta il file, "**Correggi e rinvia**" entro 5 giorni dalla data dell'esito mantiene numero e data | **Non controlla tutte le soglie del regime forfettario**: mostra solo un indicatore degli **incassi registrati nell'app** rispetto agli 85.000 € (avviso dall'80%). Non controlla i 100.000 € né le cause di esclusione (checklist E9) |
| Registra a mano invio, esito SDI (consegnata / mancata consegna / scartata, con data) e incassi | Non legge le ricevute dello SDI da sola: le registra l'utente |
| Genera una copia PDF "di cortesia" con la dicitura forfettario | Non gestisce: clienti esteri (solo avviso), PA e split payment, ritenute, casse previdenziali, reverse charge, fattura differita, autofatture, regimi diversi da RF19 |
| Per il commercialista: **registro delle fatture in CSV**, **ZIP di tutti gli XML emessi**, **registro delle attività** (cosa è stato fatto e quando, con impronta degli XML) | Il registro e lo ZIP sono comodità di consegna, **non** sono conservazione né contabilità |
| Blocca le scritture fiscali se l'archivio del telefono non è affidabile; verifica le fatture emesse quando si ripristina un backup; ha un "Controllo dati" sulla numerazione | Su più dispositivi la numerazione resta affidabile solo emettendo da **uno solo**: il server rifiuta i numeri doppi sincronizzati, ma non li impedisce a monte (checklist A7) |

## 3. Come provarlo in 10 minuti (con dati fittizi)

Tutti i dati qui sotto sono inventati e hanno i codici di controllo formalmente corretti. **Non usi dati reali.** I passaggi seguono i flussi attuali dell'app. Se ha poco tempo, salti i passi 9 e 10 (sono le novità più delicate: li guardi con calma se può).

1. **Primo avvio.** Apra l'indirizzo dell'app che Le è stato inviato (funziona anche da computer, meglio da telefono). Non serve registrarsi. All'inizio il listino è vuoto e la schermata "Nuovo" avvisa che mancano i dati del profilo.
2. **Profilo** (icona "Profilo" in basso) e poi **Salva dati azienda**:
   - Ragione sociale: `Mario Rossi Idraulica` · Titolare: `Mario Rossi`
   - Partita IVA: `01234567897` · Codice fiscale: `RSSMRA80A01H501U`
   - Indirizzo: `Via Roma 10` · CAP `00100` · Comune `Roma` · Provincia `RM`
   - IBAN: `IT60X0542811101000000123456` · Condizioni di pagamento: `Bonifico entro 30 giorni`
   - Attivi il **regime forfettario**. (Provi anche una partita IVA sbagliata, per esempio `01234567890`: l'app la rifiuta.)
3. **Numero di partenza.** Sempre nel Profilo, scheda **"Numerazione fatture elettroniche"**: scelga "fatture", anno corrente e scriva nel campo "Ultimo numero già usato" `11`, poi **Imposta numero di partenza** e confermi. La prossima fattura sarà `12/2026`. (Provi anche a scrivere un numero più basso dopo aver emesso una fattura: l'app lo impedisce.)
4. **Listino e preventivo.** Da **Catalogo** tocchi **Aggiungi voci di esempio** (mestiere Idraulico). Poi in **Nuovo** scriva nel campo di testo (la voce non serve) `preventivo per Luigia Verdi, 8 ore di manodopera idraulica a 35 euro, 12 metri di tubo rame a 4,50, un rubinetto miscelatore 36 euro` e tocchi **Interpreta**. Le righe che l'app non trova nel listino sono segnate "da verificare" e **vanno confermate o corrette a mano** (descrizione e prezzo), altrimenti la fattura non si può emettere. Alla fine il totale deve essere 370,00 €. Tocchi **Genera preventivo**.
5. **Fattura in bozza.** Apra il preventivo da **Documenti** e tocchi **Converti in fattura**: si crea una *bozza* (senza numero). Completi il cliente: Luigia Verdi, codice fiscale `VRDLGI85M41F205H`, Via Milano 5, 20100 Milano (MI). Nel riquadro "Dati della fattura" verifichi la data dell'operazione e che compaia la casella **"Addebita al cliente il bollo da 2,00 €"** (il bollo è dovuto perché 370 € superano 77,47 €): la spunti e salvi con **Salva bozza fattura**.
6. **Emetti fattura**: tocchi il pulsante, controlli il riepilogo (numero previsto `12/2026`, bollo, diciture che compariranno in fattura), spunti la conferma e **tenga premuto** il pulsante "Tieni premuto per emettere". Controlli il numero assegnato, la data e gli eventuali avvisi.
7. **Scarica XML.** Confronti il file con `02-ESEMPI/esempio-A-TD01-consumatore-bollo.xml` e con la tabella in `02-ESEMPI/MAPPING-CAMPI.md`. Nella `Causale` devono comparire, nell'ordine, la dicitura forfettario, quella del bollo e quella sulla ritenuta. Controlli che il PDF riporti "Copia di cortesia" e le stesse diciture.
8. **Nota di credito.** Provi l'errore: **Annulla con nota di credito**, parziale su una riga (**Storno parziale**, motivo obbligatorio). Confronti con `esempio-B-TD04-parziale.xml`. Provi poi a modificare o cancellare la fattura emessa: l'app deve rifiutare.
9. **Fattura scartata.** Su una fattura emessa tocchi **Segna come inviata**, poi **Registra esito SDI**, scelga **Scartata** (può indicare un codice di errore e la data della notifica). Compare **Correggi e rinvia**: cambi per esempio l'indirizzo del cliente e tocchi **Rigenera il file XML**. Controlli che il **numero e la data restano gli stessi**, che il file ha un nuovo nome e che il vecchio XML resta consultabile. Provi poi, con una data di esito vecchia di più di 5 giorni, a vedere che l'app propone invece **Rifai come nuova fattura** (bozza collegata, numero nuovo).
10. **Incassi e registro.** Su una fattura tocchi **Registra incasso** (data, importo, metodo). In **Documenti** guardi il riepilogo (fatturato, da incassare, bolli per trimestre, barra degli incassi rispetto a 85.000 €) e provi **Esporta registro fatture (CSV)**, **Esporta tutti gli XML (ZIP)** e **Registro attività**.

Facoltativo (5 minuti): carichi l'XML su "Controlla fattura" / "Verifica file" del portale Fatture e Corrispettivi dell'Agenzia delle Entrate, se Le è comodo (esistenza e uso del servizio: da verificare da parte Sua). **Nessun invio reale allo SDI è mai stato provato e nessuna validazione contro lo schema XSD ufficiale è stata fatta**: questa è la prova più utile che può fare (riga H1).

## 4. Cosa Le chiediamo di verificare

La lista completa è in **`01-CHECKLIST-FISCALE.md`**: ogni riga è una regola che il programma applica, con dove si trova nel codice, la fonte che abbiamo consultato e **quanto siamo sicuri**, e una domanda precisa. La sezione **L** raccoglie le **8 ipotesi** che le revisioni indipendenti del codice hanno dichiarato di aver adottato senza poterle verificare.

Una premessa onesta: **nessuna delle nostre fonti è primaria.** Non siamo riusciti a consultare i siti dell'Agenzia delle Entrate né la Gazzetta Ufficiale; ci siamo basati su siti di consulenza fiscale. Dove non siamo sicuri scriviamo **"da verificare"**. Non abbiamo inventato nulla: se manca una fonte, c'è scritto.

Priorità consigliata se ha poco tempo (le regole con più rischio):
1. Bollo: soglia, rimborso al cliente (natura N1), bollo sulle note di credito, soglia dopo gli sconti (righe D1-D9, J5, L3).
2. Numerazione e data (righe A1-A7, B1-B4): in particolare che l'anno di numerazione segue la data operazione (A3/L2) e come ci si comporta a metà anno (A6).
3. Diciture e codici (RF19, N2.2, causali, testo unico XML e PDF) (righe E1-E7).
4. Termini: 12 giorni, scarto con rinvio entro 5 giorni dalla data dell'esito, e come contarli (righe B1, F1-F4, L1).
5. Ricavi per cassa e soglie 85.000/100.000 € (righe E9-E10, L4): oggi c'è solo un avviso sugli incassi registrati nell'app.
6. Conservazione e formulazioni dei disclaimer (righe G1-G3).
7. Sconti in euro come riga negativa o dentro le righe (J1-J2, L7): meglio se può far provare un XML sul portale.

### Formato della risposta

Basta compilare la colonna **"Esito"** della checklist con una di queste tre voci:

- **Corretto**: la regola è giusta così com'è.
- **Da modificare**: è sbagliata o incompleta; scriva nella colonna "Note" cosa cambiare (e, se può, il riferimento normativo).
- **Non sono sicuro**: serve un approfondimento o un parere di terzi; scriva cosa servirebbe.

Può rispondere in uno qualsiasi di questi modi: (a) compilando la tabella in un editor di testo/Word; (b) rispondendo "A1 Corretto, A2 Da modificare: ..." in una email; (c) a voce, e annotiamo noi. Non serve riscrivere le domande.

Alla fine Le chiediamo anche un giudizio complessivo: "si può lanciare" / "si può lanciare dopo queste modifiche" / "non lanciare" (spazio in fondo alla checklist).

## 5. Indice del pacchetto

| File | Contenuto |
|---|---|
| `00-LEGGIMI.md` | Questo documento |
| `01-CHECKLIST-FISCALE.md` | Le regole implementate (sezioni A-L), con le domande e la colonna "Esito" da compilare |
| `02-ESEMPI/esempio-A-TD01-consumatore-bollo.xml` | Esempio di fattura (TD01) a un consumatore, con bollo a carico del cliente (aggiornato il 4/11/2026) |
| `02-ESEMPI/esempio-B-TD04-parziale.xml` | Esempio di nota di credito parziale (TD04) a un'azienda |
| `02-ESEMPI/MAPPING-CAMPI.md` | Tabella: ogni campo dell'app dove finisce nell'XML |
| `03-RISCHI-E-RESPONSABILITA.md` | Cosa succede se l'app sbaglia, avvertenze, limiti, assicurazione |

Gli XML sono **esempi con dati fittizi**. Sono confrontati con l'output del programma a ogni esecuzione dei test automatici (stessa struttura) e controllati come "ben formati", ma **non sono stati validati contro lo schema XSD ufficiale** (non scaricato; non esiste nel repository). Questa validazione resta da fare (vedi riga H1).

### Cosa è stato provato, e come

- Test automatici sul calcolo e sulla generazione dell'XML (oltre 1.500 test in tutto il progetto, tra cui verifiche su documenti casuali con sconti e testi ostili) e una suite di 11 scenari in un browser reale simulato su telefono (onboarding, emissione, nota di credito, immutabilità, numerazione e backup, fattura scartata, comandi vocali testuali, account e sincronizzazione, accessibilità, numero di partenza, regressioni). Tutto verde il 4 novembre 2026.
- **Non provato**: invio reale allo SDI, validazione XSD ufficiale, microfono reale, iPhone e Android reali, pagamenti reali, server di produzione. Dettaglio in `docs/STATO-PRODOTTO.md` e `docs/QA-REPORT.md`.

Documenti tecnici di riferimento, se vuole approfondire: `docs/FISCAL-SPEC.md` (ricerca fiscale completa, con il grado di certezza di ogni affermazione), `docs/CODE-REVIEW-FATTURE.md` (revisione indipendente del cuore fiscale, con le 8 ipotesi), `docs/privacy/DA-FAR-VERIFICARE.md` (sezione B: domande per il commercialista già raccolte), `public/legal/termini.html` (bozza dei Termini di servizio).
