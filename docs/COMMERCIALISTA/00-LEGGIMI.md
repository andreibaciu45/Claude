# VocePreventivo — Pacchetto di revisione per il commercialista

Data di preparazione: 4 novembre 2026. Versione del programma: 0.1.0 (sviluppo concluso, non ancora in vendita).

Questo pacchetto è scritto per chi **non è uno sviluppatore**. Non servono competenze informatiche: serve il Suo giudizio professionale su regole fiscali che il programma applica in automatico.

## 1. In due righe

VocePreventivo è un'app per artigiani in **regime forfettario** (idraulici, elettricisti, imbianchini...). L'artigiano detta a voce il lavoro fatto ("tre ore di manodopera e due metri di tubo"), l'app prepara un **preventivo**, e quando il lavoro è finito lo trasforma in **fattura elettronica** (file XML in formato FatturaPA) più una copia PDF.

Il punto delicato, e il motivo di questa revisione: **l'app calcola e scrive da sola** numero, data, bollo, diciture e codici della fattura. Se una di queste regole è sbagliata, lo è per tutti i clienti. Per questo chiediamo a Lei di controllarle una per una **prima** del lancio.

## 2. Cosa fa e cosa NON fa

| L'app FA | L'app NON FA |
|---|---|
| Prepara preventivi (non sono documenti fiscali) | **Non trasmette nulla allo SDI.** Genera il file XML; l'artigiano lo scarica e lo carica da sé sul portale gratuito "Fatture e Corrispettivi" dell'Agenzia delle Entrate (o via PEC) |
| Assegna il numero progressivo alla fattura solo al momento dell'emissione (per anno, sezionale `FT`; note di credito sezionale `NC`) | **Non conserva a norma.** L'archivio dell'app (sul telefono o sincronizzato) non è conservazione sostitutiva: l'artigiano deve attivare il servizio gratuito dell'Agenzia o un conservatore |
| Genera l'XML FatturaPA formato FPR12, tipo documento TD01 (fattura) e TD04 (nota di credito), regime RF19, natura N2.2 | **Non è consulenza fiscale** e non garantisce la conformità: lo dichiarano i Termini e le schermate |
| Calcola il bollo da 2 € oltre 77,47 € e lo scrive nell'XML (`DatiBollo`) | **Non calcola né versa il bollo** (F24 trimestrale): mostra solo un conteggio indicativo |
| Blocca modifica e cancellazione di una fattura emessa; si corregge con nota di credito | **Non controlla tutte le soglie del regime forfettario**: nella versione base non c'era alcun avviso; è in lavorazione un controllo degli 85.000 € sugli incassi registrati. Non controlla i 100.000 € né le cause di esclusione (checklist E9) |
| Registra a mano invio, esito SDI (consegnata / mancata consegna / scartata) e incassi | Non legge le ricevute dello SDI da sola: le registra l'utente |
| Genera una copia PDF "di cortesia" con la dicitura forfettario | Non gestisce: clienti esteri (solo avviso), PA e split payment, ritenute, casse previdenziali, reverse charge, fattura differita, autofatture, regimi diversi da RF19 |

## 3. Come provarlo in 10 minuti (con dati fittizi)

Tutti i dati qui sotto sono inventati e hanno i codici di controllo formalmente corretti. **Non usi dati reali.**

1. Apra l'indirizzo dell'app che Le è stato inviato (funziona anche da computer, meglio da telefono). Non serve registrarsi.
2. **Profilo** (icona "Profilo" in basso): compili
   - Ragione sociale: `Mario Rossi Idraulica` · Titolare: `Mario Rossi`
   - Partita IVA: `01234567897` · Codice fiscale: `RSSMRA80A01H501U`
   - Indirizzo: `Via Roma 10` · CAP `00100` · Comune `Roma` · Provincia `RM`
   - IBAN: `IT60X0542811101000000123456` · Condizioni di pagamento: `Bonifico entro 30 giorni`
   - Attivi il **regime forfettario**.
3. **Nuovo** (microfono): scriva nel campo di testo (la voce non serve) `preventivo per Luigia Verdi, 8 ore di manodopera idraulica a 35 euro, 12 metri di tubo rame a 4,50, un rubinetto miscelatore 36 euro`. L'app propone le righe: quelle che non trova nel listino sono segnate "da verificare" e **vanno confermate o corrette a mano** (descrizione e prezzo), altrimenti la fattura non si può emettere. Alla fine il totale deve essere 370,00 €. Salvi il preventivo.
4. Apra il preventivo da **Documenti** e prema **Converti in fattura**: si crea una *bozza* (senza numero).
5. Completi il cliente: Luigia Verdi, codice fiscale `VRDLGI85M41F205H`, Via Milano 5, 20100 Milano (MI). Nel riquadro "Dati della fattura" verifichi la data dell'operazione e che compaia la casella **"Addebita al cliente il bollo da 2,00 €"** (il bollo è dovuto perché 370 € superano 77,47 €): la spunti.
6. **Emetti**: tenga premuto il pulsante e spunti la conferma. Controlli il numero assegnato (es. `1/2026`), la data e gli avvisi mostrati.
7. **Scarica XML**. Confronti il file con `02-ESEMPI/esempio-A-TD01-consumatore-bollo.xml` e con la tabella in `02-ESEMPI/MAPPING-CAMPI.md`.
8. Provi l'errore: **Annulla con nota di credito**, parziale su una riga. Confronti con `esempio-B-TD04-parziale.xml`.
9. Provi a modificare o cancellare la fattura emessa: l'app deve rifiutare.
10. Controlli che il PDF riporti "Copia di cortesia" e la dicitura forfettario.

Facoltativo (5 minuti): carichi l'XML su "Controlla fattura" / "Verifica file" del portale Fatture e Corrispettivi dell'Agenzia delle Entrate, se Le è comodo (esistenza e uso del servizio: da verificare da parte Sua).

## 4. Cosa Le chiediamo di verificare

La lista completa è in **`01-CHECKLIST-FISCALE.md`**: ogni riga è una regola che il programma applica, con dove si trova nel codice, la fonte che abbiamo consultato e **quanto siamo sicuri**, e una domanda precisa.

Una premessa onesta: **nessuna delle nostre fonti è primaria.** Non siamo riusciti a consultare i siti dell'Agenzia delle Entrate né la Gazzetta Ufficiale; ci siamo basati su siti di consulenza fiscale. Dove non siamo sicuri scriviamo **"da verificare"**. Non abbiamo inventato nulla: se manca una fonte, c'è scritto.

Priorità consigliata se ha poco tempo (le regole con più rischio):
1. Bollo: soglia, rimborso al cliente (natura N1), bollo sulle note di credito (righe D1-D7).
2. Numerazione e data (righe A1-A5, B1-B4): in particolare che l'anno di numerazione segue la data operazione.
3. Diciture e codici (RF19, N2.2, causali) (righe E1-E7).
4. Termini: 12 giorni, scarto con rinvio entro 5 giorni (righe B1, F1-F4).
5. Ricavi per cassa e soglie 85.000/100.000 € (righe E9-E10): oggi non implementati come controlli.
6. Conservazione e formulazioni dei disclaimer (righe G1-G3).

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
| `01-CHECKLIST-FISCALE.md` | Le regole implementate, con le domande e la colonna "Esito" da compilare |
| `02-ESEMPI/esempio-A-TD01-consumatore-bollo.xml` | Esempio di fattura (TD01) a un consumatore, con bollo a carico del cliente |
| `02-ESEMPI/esempio-B-TD04-parziale.xml` | Esempio di nota di credito parziale (TD04) a un'azienda |
| `02-ESEMPI/MAPPING-CAMPI.md` | Tabella: ogni campo dell'app dove finisce nell'XML |
| `03-RISCHI-E-RESPONSABILITA.md` | Cosa succede se l'app sbaglia, avvertenze, limiti, assicurazione |

Gli XML sono **esempi con dati fittizi**. Sono stati controllati come "ben formati" e confrontati con l'output del programma nei test automatici, ma **non sono stati validati contro lo schema XSD ufficiale** (non scaricato). Questa validazione resta da fare (vedi riga H1).

Documenti tecnici di riferimento, se vuole approfondire: `docs/FISCAL-SPEC.md` (ricerca fiscale completa, con il grado di certezza di ogni affermazione), `docs/privacy/DA-FAR-VERIFICARE.md` (sezione B: domande per il commercialista già raccolte), `public/legal/termini.html` (bozza dei Termini di servizio).
