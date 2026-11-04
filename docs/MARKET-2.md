# Analisi di mercato, seconda passata (consultazione: 04/11/2026)

Agente RICERCA-MERCATO-2. Sostituisce le ipotesi di `docs/MARKET.md` con dati reperiti dove possibile.

## 0. Limiti di questa verifica (leggere prima)

- **Nessun sito ufficiale è stato raggiungibile.** WebFetch ha fallito con errore DNS (host non risolto) su fattureincloud.it, aruba.it, fattura24.com, fiscozen.it, agenziaentrate.gov.it. Non ho insistito. Per leggere i listini ufficiali questi host vanno abilitati nella rete della sessione.
- Tutti i dati vengono da **WebSearch**, cioè da sintesi di pagine di terzi: comparatori, blog, aggregatori (Capterra, GetApp), pagine commerciali di concorrenti. Molti comparatori (Centro Fiscale, Finom, FlexTax, Fiscozen) **vendono prodotti concorrenti** e sono di parte. Etichette usate sotto:
  - **[TERZI]** = riportato da una pagina di terzi, non letto sul sito ufficiale; da ricontrollare.
  - **[CONFLITTO]** = fonti discordanti.
  - **NON VERIFICATO** = non trovato.
- Le URL citate sono quelle comparse nei risultati di ricerca, consultate il 04/11/2026. Non ho riaperto le pagine una per una: i numeri sono quelli riportati nella sintesi del motore di ricerca.
- Nessun prezzo è inventato. Dove non ho il dato, lo scrivo.

## 1. Concorrenti

### 1.1 Gestionali di fatturazione italiani (con SDI)

| Prodotto | Prezzi pubblici [TERZI] | Limiti | SDI / conservazione | Voce | Fonte |
|---|---|---|---|---|---|
| Fatture in Cloud, piano Forfettari | 48 €/anno + IVA il primo anno (4 €/mese); **96 € + IVA al rinnovo** secondo due comparatori. Altri piani: Standard 144, Premium 252, Complete 612 €/anno (numero piani incerto) [CONFLITTO sul numero di piani] | 400 documenti/anno nel piano forfettari; 1 utente | Invio SDI incluso nei piani (da confermare sul listino); costo per fattura NON VERIFICATO | NON VERIFICATO (app mobile esiste; dettatura non citata) | https://centrofiscale.com/fatture-in-cloud-recensione-2026/ ; https://centrofiscale.com/miglior-software-fatturazione-elettronica-2026/ ; https://www.fiscozen.it/guide/migliori-software-fatturazione-elettronica-2026/ |
| Aruba Fatturazione Elettronica | "E-Fattura Free" a 0 € per pochissime fatture; piano base da **29,90 €/anno + IVA** (primo trimestre 1 €/mese) con moduli opzionali | Dipende dai moduli | Invio SDI sì; conservazione come modulo (costo NON VERIFICATO) | NON VERIFICATO | https://centrofiscale.com/aruba-fattura-elettronica-costi-2026/ ; https://www.finanza.com/lavoro/partita-iva/freelance-forfettario-fattura-aruba ; listino ufficiale indicato: aruba.it/listino-fatturazione-elettronica.aspx (non raggiungibile) |
| Fattura24 | Professional 48 € + IVA primo anno, **120 € + IVA dopo**; piani fino a 384 €/anno al rinnovo [CONFLITTO: un comparatore parla di 4 €/mese promo] | Professional: 3.000 fatture (un solo comparatore) | NON VERIFICATO nel dettaglio | NON VERIFICATO | https://centrofiscale.com/fattura24-alternativa-confronto-fatturazione-italia/ ; https://www.fiscozen.it/guide/migliori-software-fatturazione-elettronica-2026/ |
| Danea Easyfatt (TeamSystem) | Circa 100 €/anno (base) fino a 180 € + IVA/anno per la licenza piena; Enterprise circa 420 €/anno. Fonti discordanti e in parte datate [CONFLITTO] | Limite documenti per piano (valore NON VERIFICATO) | NON VERIFICATO | NON VERIFICATO | https://centrofiscale.com/fatture-in-cloud-vs-aruba-vs-danea-2026/ ; https://www.capterra.it/software/209315/easyfatt |
| SumUp Fatture | 0 € canone secondo un comparatore; altre fonti: gratis fino a 4 fatture/mese, 2,90 € per illimitate [CONFLITTO] | vedi sopra | SDI sì (XML per AdE) | NON VERIFICATO | https://www.sumup.com/it-it/fatture/ ; https://finom.co/it-it/blog/conto-business-con-fatturazione-elettronica/ |
| Agenzia delle Entrate (Fatture e Corrispettivi, procedura web) | **Gratuita**; accesso SPID/CIE/CNS. Un aggregatore dice che include conservazione a norma senza costi [TERZI, da verificare]. L'app Fatturae risulta per privati, non per imprese | Nessuno noto | SDI nativo | No | https://www.dirittobancario.it/wp-content/uploads/sites/default/files/allegati/la_fattura_elettronica_e_i_servizi_gratuiti_dellagenzia_delle_entrate.pdf (guida AdE aggiornata a dicembre 2025, secondo il motore di ricerca) |

### 1.2 Banche e servizi per forfettari

| Prodotto | Prezzo [TERZI] | Note | Fonte |
|---|---|---|---|
| Qonto | Da circa 9 €/mese + IVA con fatturazione annuale (un'altra fonte: 11 €); una pagina Qonto cita anche un piano Starter a 0 € per freelance con e-fattura [CONFLITTO] | Fatturazione elettronica SDI integrata nel conto | https://qonto.com/it/blog/gestione-aziendale/fatturazione/costo-fatturazione-elettronica ; https://qonto.com/it/blog/qonto/funzionalita/piano-starter |
| Revolut Business | Basic 10 €, Grow 35 €/mese; e-fattura SDI nativa non confermata (fonti discordanti) | Serve uno strumento a parte | https://centrofiscale.com/qonto-vs-revolut-business-2026/ |
| Vivid Business | Indicato a 0 € con SDI via A-Cube; pagina ufficiale non trovata | NON VERIFICATO | https://finom.co/it-it/blog/conto-business-con-fatturazione-elettronica/ |
| Tide | Nessun dato italiano trovato | NON VERIFICATO | |
| Fiscozen (servizio forfettari) | **499 €/anno IVA inclusa** (49,90 €/mese) con commercialista dedicato e fatturazione illimitata [TERZI, anche da pagine Fiscozen] | Servizio completo, non solo software | https://www.economia-italia.com/fiscozen-alternative ; https://www.fiscozen.it/guide/migliori-software-fatturazione-elettronica-2026/ |
| Commercialisti online per forfettari | Da 264 € + IVA a 499 €/anno | e-fattura di solito inclusa | https://www.economia-italia.com/commercialista-online-forfettario |
| Fatture Facili, Taxfix | NON VERIFICATO (nessun dato trovato) | | |

### 1.3 App per artigiani e imprese di servizi

| Prodotto | Prezzo | Funzioni / note | Voce | Fonte |
|---|---|---|---|---|
| Artesan (Evoltech) | Free con limiti (cantieri, foto, preventivi, documenti) + abbonamento. Prezzi in zloty sullo store polacco (Pro 49,99 zł; 5 utenti 199,99 zł); **prezzo in euro NON VERIFICATO**. Su Google Play circa 79 installazioni (poco diffusa) | Cantieri, materiali, preventivi (a prezzo fisso o a ore), assistenza in italiano | NON VERIFICATO | https://apps.apple.com/pl/app/artesan/id6739995997 ; https://appgoblin.info/apps/io.evoltech.artesan |
| Tradify / Tradiecore | Tradify: Lite 47 $, Pro 51 $, Plus 61 $ **per utente al mese** [TERZI]. Tradiecore: NON VERIFICATO | Gestionale lavori in lingua inglese, pensato per mercati anglofoni; non emette e-fattura SDI (da verificare) | NON VERIFICATO | https://www.capterra.com/p/152413/Tradify/pricing/ ; https://toolradar.com/tools/tradify/pricing |
| Jobber | Piani circa 49 $ (Core) fino a 199 $ (Grow) e oltre; struttura per utente o per piano discordante [CONFLITTO] | Mercato USA/Canada; non pensato per SDI | NON VERIFICATO | https://www.getonecrew.com/post/jobber-pricing |
| Fergus | Per utente/mese in valuta locale: AUD 48-72 circa [CONFLITTO tra fonti] | Australia/NZ/UK/USA | NON VERIFICATO | https://fergus.com/pricing/ ; https://help.fergus.com/en/articles/362678-what-does-fergus-cost |

Non sono prodotti per l'Italia: confermano però che il segmento "gestionale per artigiano" esiste e si paga 40-60 $ a utente fuori dall'Italia.

### 1.4 App con voce / AI per preventivi (il punto più importante)

| Prodotto | Paese / lingua | Prezzo [TERZI] | Cosa fa | Fonte |
|---|---|---|---|---|
| **PrevAI** | Italia (prezzi in euro) | Starter **19 €/mese, 10 preventivi/mese**; Elite **59 €/mese**, illimitati; prova gratuita. 0 recensioni su Capterra | Trasforma descrizioni colloquiali in preventivi; via **WhatsApp con testo, voce o immagini**, anteprima in circa un minuto | https://www.capterra.com/p/10046107/PrevAI/ |
| PreventivAI (prodotto diverso) | Italia? | da 9,90 € | NON VERIFICATO | https://www.capterra.co.uk/software/1095077/PreventivAI |
| VoxTrade | Inglese, 100+ lingue dichiarate | Free: 5 preventivi + 5 fatture/mese, 10 minuti di trascrizione; tier da 9,99 $ e da 39 $ (illimitati, 120 minuti) | Preventivi a voce, scansione scontrini, analisi video | https://www.capterra.com/p/10038849/VoxTrade/ ; https://www.getapp.com/sales-software/a/voxtrade/ |
| Smart Scope: AI Estimating | iPhone, inglese | NON VERIFICATO | Voce -> righe -> abbinamento al listino (dichiara di usare Claude) | https://mwm.ai/apps/smart-scope-ai-estimating/6761380768 |
| SnapQuote, EZ-Estimates, Estimo AI, CountBricks | Inglese | NON VERIFICATO | Preventivi vocali o testuali in PDF; claim di "meno di 60 secondi" è del produttore | https://www.producthunt.com/products/snapquote/makers ; https://peerpush.net/p/ez-estimates ; https://www.countbricks.com/post/estimating-apps |
| kissmyskills | Italia | Sviluppo su misura una tantum; non è un'app self-service | Assistente AI per idraulici/elettricisti: risponde alle chiamate perse, prepara bozza dal listino che il titolare verifica | https://kissmyskills.com/it/pages/ai-for-home-services |
| Dragon Anywhere | Generica | NON VERIFICATO | Dettatura documenti, non conosce prezzi | https://mwm.ai/it/apps/dragon-anywhere/1024652126 |

Evidenza di campo (non indipendente): un post su DEV Community di un autore che lavora per un SaaS edile francese riporta, su 50 clienti e 6 mesi, preventivi vocali in circa 22 minuti contro 45, con 94% di accuratezza dopo controllo; e che registrare senza guardare il cantiere produce output scadente (hanno imposto una foto). https://dev.to/olivier_ebrahim_1bbaa5877/voice-ai-for-construction-estimating-lessons-from-2000-quotes-in-2026-m18 . L'autore è di parte: usare solo come ipotesi da testare.

### 1.5 Valutazioni negli store e nelle recensioni

- **Fatture in Cloud**: il produttore dichiara 4,8 su Google Play e 4,7 su App Store (https://www.fattureincloud.it/mobile/). Un aggregatore indica Google Play 4,07 su circa 5,5 mila voti (https://appgoblin.info/apps/com.fattureincloud.fattureincloud2). Capterra Italia: 3,7/5 su 60 recensioni, assistenza 3,4/5, facilità d'uso 4,0/5, qualità-prezzo 3,3/5 (https://www.capterra.it/software/199642/fatture-in-cloud). I dati ufficiali e quelli indipendenti divergono: **valore reale NON VERIFICATO**.
- **Punti di forza ricorrenti** (Fatture in Cloud): facilità d'uso, assistenza in italiano, app mobile.
- **Debolezze ricorrenti** (da comparatori e Capterra, quindi di parte): **aumento al rinnovo** (da 48 a 96 € + IVA), rinnovo automatico con disdetta il giorno prima, prezzi legati a promozioni, passaggi forzati a piani superiori per limiti di documenti, assistenza telefonica lenta nei periodi di punta, un solo utente nel piano base.
- Per Aruba, Fattura24, Danea, Artesan, Qonto e le app AI: **valutazioni e punti deboli NON VERIFICATI**. Serve leggere le recensioni a 1-2 stelle direttamente su App Store e Google Play.
- Non ho trovato recensioni su Trustpilot.

## 2. Confronto onesto con la nostra proposta

| | VocePreventivo oggi | Gestionali SDI (FIC, Aruba, Fattura24, Danea) | AdE / banche | PrevAI | VoxTrade e simili |
|---|---|---|---|---|---|
| Preventivo a voce in italiano | Sì (dettatura del browser) | NON VERIFICATO | No | Sì, via WhatsApp (da provare) | Sì, ma non pensato per l'Italia |
| Ricerca nel proprio listino | Sì | Anagrafica prodotti, non da voce | No | Dichiarato "da listino" (kissmyskills) / NON VERIFICATO per PrevAI | Sì (Smart Scope) |
| Fattura elettronica SDI | **NO** (l'utente carica a mano l'XML) | **Sì** | **Sì** | NON VERIFICATO | No |
| Conservazione a norma | **NO** | Sì o modulo | AdE: dichiarata gratuita [TERZI] | NON VERIFICATO | No |
| App nativa negli store | **NO, solo PWA, mai provata su dispositivi reali** | Sì | Sì (banche) | WhatsApp | Sì |
| Dati | Locali sul dispositivo, account opzionale | Cloud del fornitore | Cloud | Cloud | Cloud |
| Prezzo/anno | Free (3 doc/mese) o 120 € | 30-180 € + IVA (con SDI) | 0 | 228 € (Starter) | da 120 $ |
| Prova su clienti reali | **Nessuna** | Migliaia | Milioni | Poche (0 recensioni) | Non per l'Italia |

### Il vuoto di mercato dichiarato in MARKET.md regge ancora?

**Solo in parte, e in forma molto più stretta.** MARKET.md diceva "non trovata nessuna app che unisca dettatura in italiano, listino proprio, scheda con totali, PDF". Oggi:

1. **PrevAI** (italiana, 19 €/mese) fa preventivi da voce, testo e immagini via WhatsApp. È il concorrente più vicino e non l'avevamo trovato. Non so quanto sia buono (0 recensioni) né se usi il listino dell'utente.
2. **VoxTrade e Smart Scope** fanno voce -> righe -> listino -> PDF, in inglese e su altri mercati; localizzare in italiano è un'attività plausibile per loro.
3. **kissmyskills** vende lo stesso concetto su misura.

Quindi l'affermazione "non esiste niente di simile" **non va usata** né nei post né sulla pagina pubblica. Quello che possiamo dire con onestà: "non ho trovato un'app *self-service, pensata per l'artigiano italiano, che parte dal tuo listino e funziona nel browser senza installare nulla*". Anche questa frase è da riconfermare cercando direttamente su App Store e Google Play (non fatto: non ho accesso).

Il differenziatore reale è più modesto: nessun download, dati sul telefono, prezzo più basso di PrevAI, listino personale. Il resto (SDI, conservazione, app nativa, track record) lo hanno gli altri e noi no.

Un'implicazione di prodotto: chi ha già Fatture in Cloud o Aruba per le fatture non ha bisogno di una seconda fattura. Il nostro prodotto ha senso come **strumento di preventivo veloce**, che poi esporta verso lo strumento che già usano. Il GO-TO-MARKET lo dice già ("non sostituisce il gestionale"); i prezzi invece sono impostati come se fossimo un sostituto.

## 3. Prezzo

Nostro: Free 3 documenti/mese; Pro 15 €/mese o 120 €/anno (`src/billing/pricing.ts`; IVA inclusa o esclusa: non deciso).

| Riferimento (annuo, IVA esclusa salvo diversa indicazione) [TERZI] | Valore | Noi (120 €/anno) |
|---|---|---|
| AdE, banche con e-fattura incluse (Qonto Starter / Vivid) | 0 € | molto più cari |
| Aruba base | 29,90 € (+ moduli) | circa 4 volte, senza SDI |
| Fatture in Cloud forfettari | 48 € poi 96 € | 25% sopra il rinnovo, senza SDI |
| Fattura24 Professional | 48 € poi 120 € | alla pari, senza SDI |
| Danea Easyfatt | 100-180 € | alla pari |
| PrevAI Starter | 228 € (10 preventivi/mese) | circa metà, ma funzioni da verificare |
| VoxTrade | da circa 120 $ (9,99 $/mese) | alla pari |
| Fiscozen | 499 € IVA incl. (servizio con commercialista) | non comparabile |
| Tradify (per utente) | 564-732 $ | molto più economici |

Lettura:
- **Rispetto ai gestionali fiscali siamo cari o alla pari**, e offriamo meno (niente SDI né conservazione). Rispetto agli strumenti gratuiti (AdE, conti con e-fattura) siamo cari per definizione.
- **Rispetto ai prodotti AI/voce siamo nella fascia bassa**, e lì ha senso il confronto.
- **A 15 €/mese pagare mese per mese è la parte più debole**: 180 € all'anno è sopra quasi tutti i gestionali italiani.
- Posizionamento sensato (opinione): non "gestionale", ma **"il preventivo in 2 minuti"**, complementare a ciò che l'artigiano già usa. Quindi prezzo percepito come "costo di un caffè al mese": ipotesi da testare 6-9 €/mese o 59-79 €/anno, non 15 €. Se le interviste mostrano che l'invio SDI è decisivo, il prezzo 15 € ha senso solo con SDI.
- **Rischio principale**: molti forfettari fatturano già gratis con AdE o con la banca, e i preventivi li fanno su carta, Word o WhatsApp. Il "concorrente" vero è lo status quo gratuito. Rischio secondario: PrevAI o un gestionale grande aggiungono la dettatura (FIC ha un'app e un parco clienti già pagante).
- Nota di coerenza (da `docs/PRICING.md`): il testo "due mesi in meno" sull'annuale va corretto (120 € = 6 mesi in meno rispetto a 180 €).

### Due esperimenti di prezzo semplici

1. **Livello di prezzo (annuale)**: Payment Link A 69 €/anno vs B 120 €/anno (mensile mostrato sotto). Metrica: acquisti / persone che hanno visto l'offerta; numeri piccoli, solo indicativi. Si affianca all'A/B già in GO-TO-MARKET (12/99 vs 19/149); preferisco però un salto più ampio (69 vs 120) perché i prezzi di riferimento trovati sono bassi e una differenza di 12-19 € non si distingue con 20-30 persone per gruppo.
2. **Cosa si limita nel Free**: gruppo A = 3 documenti/mese qualsiasi (oggi); gruppo B = preventivi illimitati, 3 fatture/mese. Metrica: quanti arrivano al limite e quanti pagano o lasciano. Domanda parallela a tutti: "se ti togliessi questo, sentiresti la mancanza?". Ipotesi: i preventivi sono l'abitudine, le fatture sono il motivo per pagare (PRICING.md §6).

Da aggiungere nelle interviste le 4 domande di Van Westendorp (vedi `docs/INTERVISTE.md`).

## 4. Segmenti e dimensione

### 4.1 Dati reperiti

| Dato | Valore | Anno | Fonte | Stato |
|---|---|---|---|---|
| Contribuenti in regime forfettario | **2.027.665** (+3,5% sul 2023; +24,7% in 5 anni); "circa 2 milioni" nelle statistiche delle dichiarazioni 2025 (anno d'imposta 2024) pubblicate dal Dipartimento Finanze il 28/05/2026 | PI 2024 | https://flextax.it/quanti-sono-forfettari-italia/ (pagina commerciale) ; https://www.mysolution.it/fisco/informazioni/news/2026/05/28/dichiarazioni-fiscali-2025-oltre-428-milioni-di-contribuenti-in-aumento-le-adesioni-al-regime-forfettario/ | Numero puntuale da ricontrollare sulla fonte MEF; non ho letto il documento originale |
| Forfettari 2022 | circa 1,8 milioni (regimi agevolati, quasi tutti forfettari) | 2022 | https://www.finanza.com/?p=156792 (riportato) | [TERZI] |
| Artigiani iscritti INPS (gestione speciale) | **1.376.982** (-5% sul 2023; 1.448.939 nel 2023; 1.524.008 nel 2022) | 2024 | https://www.dottrinalavoro.it/notizie-c/inps-osservatorio-lavoratori-autonomi-i-dati-2024 | [TERZI], altra fonte INPS cita 1.456.918 per il 2023 |
| Imprese artigiane registrate | **1.245.193** | 30/09/2025 | Comunicato Movimprese Unioncamere/InfoCamere, 3º trimestre 2025: https://www.unioncamere.gov.it/sites/default/files/articoli/2025-10/2025_10_20_com_movi_3_2025.docx | Dato dalla tabella 1B, letto tramite il motore di ricerca |
| Imprese registrate totali | 5.849.524 | 31/12/2025 | https://www.unioncamere.gov.it/sites/default/files/articoli/2026-01/23012026_com_movi_anno_2025.docx | idem |
| Edilizia artigiana, solo Emilia-Romagna | 47.370 imprese attive | fine 2025 | https://imprese.regione.emilia-romagna.it/industria-artigianato-cooperazione-servizi/temi/artigianato-artistico-e-tradizionale/dati-statistici-dicembre-2025-1.pdf | dato regionale |
| Impiantisti (idraulici, elettricisti) a livello nazionale | **NON VERIFICATO** (servono i codici ATECO di dettaglio da InfoCamere) | | | |
| Quanti forfettari sono artigiani nei mestieri target | **NON VERIFICATO** | | | |

Nota: le categorie si sovrappongono (un artigiano può essere forfettario); **non si possono sommare 2 milioni e 1,25 milioni**. I 2 milioni di forfettari sono in gran parte professionisti, consulenti, commercianti.

### 4.2 TAM / SAM / SOM prudente (le ipotesi NON sono dati)

Metodo: ricavo annuo a 120 €/anno per cliente (prezzo attuale, IVA esclusa; già dubbio, vedi §3).

| Livello | Calcolo | Risultato | Dati o ipotesi |
|---|---|---|---|
| **TAM** teorico | 1.245.193 imprese artigiane x 120 € | circa 150 milioni €/anno | numero = dato; prodotto = teorico, irrealistico (comprende parrucchieri, panettieri, ecc.) |
| **SAM** | quota di mestieri "di cantiere/impianti" tra gli artigiani: **ipotesi 35%** (circa 435 mila imprese); di queste, quota che fa preventivi sul telefono e prova app nuove: **ipotesi 20%** (circa 87 mila) | circa 87 mila imprese, circa 10 milioni €/anno | entrambe le percentuali sono nostre ipotesi, nessuna fonte |
| **SOM** a 12-24 mesi | **ipotesi** 0,2-1% del SAM | **175-870 paganti**, cioè circa 21-104 mila €/anno | ipotesi; a confronto GO-TO-MARKET punta a 3-10 paganti in 60-90 giorni |

Con prezzo a 69 €/anno (esperimento 1) il SOM varierebbe di conseguenza (circa 12-60 mila €). Il SOM è sensibile quasi solo alla conversione e alla distribuzione, non alla dimensione del mercato: il mercato non è il collo di bottiglia, lo è raggiungere gli artigiani.

## 5. Conclusioni e cosa fare

1. Il vuoto non è più "inesistente": esistono PrevAI (Italia), VoxTrade e Smart Scope. Il messaggio di lancio va riscritto senza claim di unicità.
2. Il vero concorrente è lo status quo gratuito (AdE, banca, carta, WhatsApp) e i gestionali da 30-100 €/anno che hanno già SDI.
3. 120 €/anno senza SDI è alto rispetto ai gestionali italiani; la fascia giusta per un "preventivo veloce" è probabilmente più bassa (da testare).
4. Il mercato (decine di migliaia di artigiani raggiungibili) è sufficiente; il problema è la distribuzione.
5. Prima di tutto: leggere i listini ufficiali (host non raggiungibili da qui) e provare PrevAI e Smart Scope di persona.

Da verificare a mano (non ho potuto): listini ufficiali FIC/Aruba/Fattura24/Danea/SumUp/Qonto; costo SDI per fattura; valutazioni e recensioni negative nei due store; prezzo Artesan in euro; Tradiecore; Fatture Facili e Taxfix; PrevAI nel dettaglio (listino, voce, recensioni); numero impiantisti da InfoCamere; cifra ufficiale dei forfettari dal sito del Dipartimento Finanze.
