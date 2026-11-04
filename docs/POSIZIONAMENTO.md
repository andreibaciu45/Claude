# Posizionamento di VocePreventivo

Data: 4 novembre 2026. Base: `docs/MARKET-2.md` (consultazione 04/11/2026, fonti di terzi, non ufficiali), `docs/PRICING.md`, `docs/COMMERCIALISTA/00-LEGGIMI.md`. I prezzi non sono trattati qui: li decide l'utente (`src/billing/pricing.ts`).

## 1. Cosa abbiamo scoperto (e cosa cambia)

- Esiste almeno un concorrente diretto italiano con preventivi da voce, testo e immagini via WhatsApp (PrevAI; scheda Capterra https://www.capterra.com/p/10046107/PrevAI/, 04/11/2026). Esistono anche prodotti vocali stranieri (VoxTrade, Smart Scope) e servizi su misura. Da provare di persona, non lo abbiamo fatto.
- Il vero concorrente è lo **status quo gratuito**: carta, Word, WhatsApp, portale gratuito dell'Agenzia delle Entrate o servizio della banca per la fattura.
- Quindi: **nessun claim di unicità o primato**, in nessun canale. Frasi vietate: "unico", "primo", "nessuno fa", "non esiste niente di simile", "il migliore", "risparmi X ore", "conforme", "a norma".
- Un confronto con un concorrente vive solo in `docs/` (con fonte e data). Sul sito è ammessa solo una tabella neutra "cosa fa / cosa non fa", senza cifre di terzi e senza giudizi.

## 2. Posizionamento (in una frase)

> Il preventivo dal **tuo** listino, a voce, pensato per l'artigiano italiano: si apre dal browser senza installare nulla, funziona anche offline e i dati restano sul tuo dispositivo. Affianca il tuo gestionale o il portale gratuito dell'Agenzia delle Entrate, non li sostituisce.

Ciò che è vero e difendibile (verificato nel codice e nei documenti del progetto):

| Punto | Formulazione onesta |
|---|---|
| Preventivo da voce | Detti il lavoro, l'app propone le righe cercando nel tuo listino; le voci non trovate sono segnate "da verificare". Le righe vanno sempre controllate. Internamente: obiettivo "pochi secondi per la prima bozza", da misurare dal vivo prima di dirlo in pubblico. |
| Per l'artigiano italiano | Italiano, unità e voci dei mestieri di cantiere, forfettario. |
| Offline e senza installare | PWA: si aggiunge alla Home. Listino, documenti e PDF funzionano senza campo; la dettatura del browser di solito richiede rete (si può scrivere la frase). Mai provata su dispositivi reali su larga scala: non vantarsene. |
| Dati | Senza account restano sul dispositivo; con account facoltativo sincronizzati su server UE. Dettatura: l'audio può passare da Google/Apple o, su iPhone, dai nostri server solo per la trascrizione. |
| Fatture per il forfettario | Fatture e note di credito, XML FatturaPA (TD01/TD04, RF19) più copia di cortesia PDF. **L'XML lo carichi tu sul portale dell'Agenzia delle Entrate (o via PEC).** |
| Complementare | Ha senso accanto a ciò che l'artigiano già usa. Non va venduto come gestionale. |

### Cosa NON facciamo: scelte dichiarate, non difetti nascosti

- **Nessun invio automatico allo SDI.** Scelta: oggi non c'è un provider e l'utente mantiene il controllo del file che invia.
- **Nessuna conservazione a norma.** Chi emette fatture deve conservarle secondo legge (servizio gratuito dell'Agenzia o conservatore): da dirlo chiaramente.
- Nessuna contabilità, ritenute, casse previdenziali, split payment, reverse charge, regimi diversi da RF19. Nessuna consulenza fiscale né garanzia di conformità (vedi `docs/COMMERCIALISTA/00-LEGGIMI.md` §2).
- Nessuna app negli store e nessuna prova su clienti reali alla data del documento.

Va detto con lo stesso tono con cui si dicono i pregi: "fa X, non fa Y, per Y usa il tuo gestionale".

## 3. Target prioritario

Idraulico, elettricista o imbianchino **in regime forfettario**, solo o con 1-2 collaboratori, che oggi fa i preventivi su Word, carta o WhatsApp, in cantiere o la sera, e fattura con il portale gratuito o con la banca. Secondari: serramentista, piccola impresa edile. Fuori target: chi ha già un gestionale con invio SDI e non perde tempo sui preventivi; chi ha bisogno di contabilità. Segmenti e dimensione: `docs/MARKET-2.md` §4 (numeri con ipotesi dichiarate).

## 4. Tre messaggi chiave

1. **"Dal tuo listino, a voce."** Detti il lavoro, controlli le righe, mandi il PDF mentre sei sul posto. I prezzi sono i tuoi.
2. **"Si apre dal browser, anche senza campo."** Niente da scaricare; i dati restano sul tuo telefono; l'account è facoltativo.
3. **"Affianca quello che già usi."** Fatture e note di credito da forfettario con XML da caricare tu sul portale dell'Agenzia delle Entrate. Niente invio automatico e niente conservazione a norma: lo diciamo prima, non dopo.

## 5. Cinque obiezioni e risposte oneste

1. **"Ho già il portale gratuito dell'Agenzia delle Entrate."** Giusto, e puoi continuare a usarlo: per trasmettere le fatture allo SDI è lo strumento di riferimento. VocePreventivo non lo sostituisce: serve prima, per preparare il preventivo dal tuo listino e, se vuoi, l'XML da caricare lì. Se i preventivi non ti pesano, non ti serve.
2. **"Mi fido più di un'app con assistenza."** Comprensibile. Un gestionale grande ha assistenza e storia che noi non abbiamo ancora: il prodotto è nuovo, l'assistenza è via email (risposta entro 24 ore: impegno da rispettare). Per questo c'è il piano gratuito: provalo su un lavoro vero e tieni il tuo gestionale per le fatture importanti.
3. **"E se sbaglia il preventivo?"** Può sbagliare: la dettatura può capire male e una voce può non corrispondere. Per questo le voci non trovate sono "da verificare" e ogni riga si controlla e si corregge prima del PDF. La responsabilità del documento resta tua, come per un preventivo scritto a mano. Le fatture emesse non si modificano: si annullano con nota di credito.
4. **"Il microfono in cantiere non funziona."** In ambienti rumorosi può sbagliare, e senza rete la dettatura del browser di solito non va. Si può scrivere la frase nel campo di testo e l'app la interpreta allo stesso modo. Vale la pena provarla nel tuo cantiere prima di decidere.
5. **"Quanto mi costa e dove finiscono i miei dati?"** (e "e se cambio telefono?") Gratis fino a 3 documenti al mese; il piano a pagamento è sul sito. Senza account i dati sono solo sul telefono: fai il backup. Con l'account stanno su server UE. Puoi esportare tutto e smettere quando vuoi. (Cifre sempre da `src/billing/pricing.ts`, mai scritte a mano.)

## 6. Cosa non promettere mai

- Unicità, primato, "il migliore", "l'unica app che...", "non esiste niente di simile".
- Tempi o risparmi numerici ("in 40 secondi", "risparmi 5 ore") finché non misurati dal vivo e con campione dichiarato.
- Conformità fiscale, "a norma", "fattura valida garantita", sostituzione del commercialista.
- Invio automatico allo SDI, conservazione a norma, trasmissione per conto dell'utente.
- Dettatura perfetta, funzionamento in qualsiasi rumore o senza rete.
- Recensioni, numeri di utenti, testimonianze non reali; "il più scelto".
- Confronti di prezzo o di qualità con concorrenti, o dati su di loro, in pubblico.
- Dati "sempre al sicuro": senza account il backup è dell'utente.

## 7. Coerenza e controlli

- Testi pubblici aggiornati: `src/pages/LandingPage.tsx`, `public/prodotto.html` (sezioni "Per chi è e per chi non è" e "Come si confronta con il portale gratuito dell'Agenzia delle Entrate", neutre). Gli FAQ restano allineati a `docs/COMMERCIALISTA/00-LEGGIMI.md`.
- Fuori dal mio perimetro, da allineare dall'utente: il testo "due mesi in meno" sull'annuale (`docs/PRICING.md` §1), IVA dei prezzi, e il JSON-LD di prodotto.html che riporta i prezzi (15/120 €) se cambiano in `pricing.ts`.
- Da fare prima del lancio: provare PrevAI e Smart Scope, ricontrollare la frase "non ho trovato un'app self-service per l'artigiano italiano che parta dal tuo listino e funzioni nel browser" direttamente su App Store e Google Play (e comunque non usarla in pubblico).
