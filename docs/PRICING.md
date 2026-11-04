# VocePreventivo — Ipotesi di prezzi, costi e break-even

Data: 4 novembre 2026. **Ultimo aggiornamento: 4 novembre 2026** (aggiornati solo i riferimenti al testo "due mesi in meno", i prossimi passi e la sezione 9 sui limiti nell'app; le ipotesi di prezzo e di costo restano quelle originali). Stato: **ipotesi di lavoro**.

> **Tutti i numeri di questo documento sono stime, non dati.** Nessun cliente ha ancora pagato, nessun preventivo di fornitore è stato richiesto, nessun costo è stato misurato. Le cifre di costo vengono da `docs/ARCHITECTURE-V2.md` §1.9 (che le definisce "ordini di grandezza, non preventivi"); le ipotesi di conversione sono nostre e **non** si basano su misure. Dove un valore è "da verificare" si trova su un listino ufficiale o su un preventivo, che non abbiamo ancora.

## 1. Cosa c'è oggi nel prodotto (fatti verificati nel codice)

| Elemento | Valore attuale | Dove |
|---|---|---|
| Piano Gratis | 0 €, **3 documenti al mese** | `server/src/billing/entitlements.ts` (`FREE_DOCS_PER_MONTH = 3`) |
| Piano Pro | **15 € al mese** oppure **120 € all'anno**, documenti illimitati, sincronizzazione | pagina Informazioni (`src/pages/LandingPage.tsx`) |
| IVA sui prezzi | "da definire prima del lancio" (inclusa o esclusa? non deciso) | pagina Informazioni; bozza Termini |
| Pagamento | Carta, tramite Stripe | idem |
| Periodo di tolleranza se il pagamento fallisce | 7 giorni (configurabile) | `server/src/billing/entitlements.ts` |
| Quote voce server (solo per chi non può usare la dettatura del browser) | 20 minuti/mese Gratis, 120 Pro | `server/src/billing/README.md` |
| Trasmissione allo SDI tramite provider | **Non attiva** (nessun provider scelto); oggi l'utente carica l'XML a mano | `server/src/sdi/` |

**Incoerenza trovata in origine, ora risolta nel codice (verificato il 4/11/2026):** la pagina Informazioni diceva che i 120 €/anno sono "due mesi in meno rispetto al mensile", ma 12 x 15 € = 180 € e 120 € equivalgono a **6 mesi in meno** (sconto del 33%). Il testo attuale (`src/pages/LandingPage.tsx`, `public/prodotto.html`) dice "risparmi 60 € rispetto al mensile", calcolato da `src/billing/pricing.ts` (`PRO_YEARLY_SAVING`). Resta da ricordare che `public/prodotto.html` ha il prezzo scritto a mano (e nel JSON-LD): va aggiornato a mano se cambiano i prezzi.

## 2. Ipotesi di piani

Tre configurazioni da confrontare. La A è quella già scritta nel prodotto.

| | A (attuale) | B (più basso) | C (più alto) |
|---|---|---|---|
| Gratis | 3 documenti/mese | 3 documenti/mese | 3 documenti/mese |
| Pro mensile | 15 € | 12 € | 19 € |
| Pro annuale | 120 € (10 €/mese, -33%) | 99 € (8,25 €/mese, -31%) | 159 € (13,25 €/mese, -30%) |
| Il prezzo include l'IVA? | da decidere | da decidere | da decidere |

Il riferimento di 12-19 € viene da `ARCHITECTURE-V2.md` §1.9 ("ipotesi 12-19 € di prezzo"). Il prezzo giusto va deciso parlando con gli artigiani (disponibilità a pagare): **non abbiamo ancora fatto interviste**.

Considerazioni di prodotto (opinioni, non dati):

- Tre documenti al mese gratis bastano a provare l'app e a un artigiano molto piccolo; chi fattura 10-30 volte al mese passa al Pro. Se si vuole che il Gratis sia solo una prova, si può contare solo il primo mese o i primi N documenti in totale (da valutare).
- Il piano annuale migliora la cassa e riduce la perdita di clienti (disdette), ma ha un costo di gestione dei rimborsi e di eventuali richieste di fatturazione.
- Nel Gratis è utile includere **sempre** l'esportazione dei propri dati e le funzioni di base (backup): è un fattore di fiducia e anche un obbligo di correttezza verso gli utenti, e non pesa sui costi.
- **Fair use** del Pro: nelle bozze dei Termini è citato ma non definito (da definire con un legale).

## 3. Costi

### 3.1 Costi fissi mensili (stime da ARCHITECTURE-V2 §1.9)

| Voce | Fase "solo web app" | Con app negli store |
|---|---|---|
| Server (VPS in UE) | 4-6 € | 4-6 € |
| Backup | 1-3 € | 1-3 € |
| Dominio (circa 12 €/anno) | 1 € | 1 € |
| Email per i codici di accesso (piano gratuito del fornitore) | 0 € | 0 € |
| Apple Developer (99 $/anno) | - | circa 8 € |
| Google Play (25 $ una tantum) | - | circa 0 € (ammortizzato) |
| Controllo del servizio (piano gratuito) | 0 € | 0 € |
| **Totale** | **circa 7-10 €** | **circa 16-19 €** |

In questo documento uso come valori centrali **8,50 €/mese** (solo web) e **17,50 €/mese** (con store).

**Costi una tantum e non inclusi** (stime o non stimabili):

| Voce | Stima |
|---|---|
| Revisione di Termini e informative da parte di un legale/consulente privacy | circa 150-300 € (`ARCHITECTURE-V2` §1.8) |
| Revisione del commercialista | **non preventivata** (da definire) |
| Assicurazione (RC professionale / cyber) | **non preventivata** (da richiedere) |
| Tempo di lavoro di chi sviluppa e fa assistenza | **non incluso** in nessun calcolo qui sotto |
| Tasse sul reddito, contributi, commissioni di eventuali store sugli acquisti in-app | **non incluse** |
| IVA sui prezzi | vedi 4.1 |

### 3.2 Costi variabili per cliente pagante al mese (stime da ARCHITECTURE-V2 §1.9)

| Voce | Stima | Note |
|---|---|---|
| Commissione Stripe | circa 1,5% + 0,25 € a pagamento con carta UE standard (**da verificare** sul listino attuale) | su 15 € = 0,47 €; su un abbonamento annuale da 120 € = 2,05 € una volta (circa 0,17 €/mese) |
| Trascrizione della voce sui nostri server | circa 0,17-0,33 $ per utente attivo (solo chi non può usare la dettatura del browser) | calcolata con circa 0,003-0,006 $ al minuto (prezzi da aggregatori, **da verificare**); uso ipotizzato di 55 minuti/mese. Uso 0,25 € come valore centrale |
| Interpretazione dei comandi con modello linguistico (solo come ripiego) | meno di 0,05 € | |
| Invio allo SDI tramite un provider | **non c'è oggi** (l'utente carica a mano) | Se in futuro si adottasse un provider: ipotesi 0,05-0,30 € per fattura (**da verificare con preventivi: nessun listino trovato**), con 10-30 fatture/mese circa 1-5 € |

Costo anche dei clienti **gratuiti**: modesto (server condiviso, fino a 20 minuti di voce server al mese, assistenza). Non lo conto, ma l'assistenza ai non paganti è un costo di tempo reale.

## 4. Margine per cliente

Calcolo: prezzo (al netto di IVA) meno Stripe, meno 0,25 € di voce server, meno 0,05 € di modello linguistico, meno l'eventuale costo SDI. Valori in euro al mese per cliente, arrotondati.

### 4.1 Se il prezzo di listino è IVA esclusa o inclusa

Non è deciso. Se i 15 € fossero **IVA inclusa** con aliquota ordinaria del 22% (aliquota e trattamento fiscale della nostra stessa attività: **da verificare con il commercialista**), il netto sarebbe 15 / 1,22 = 12,30 €. Qui sotto riporto entrambi i casi.

### 4.2 Piano mensile da 15 €

| Scenario costo SDI | Netto 15 € (IVA esclusa) | Netto 12,30 € (IVA inclusa 22%) |
|---|---|---|
| Nessun costo SDI (come oggi: upload manuale) | circa **14,2 €** | circa **11,5 €** |
| SDI 1 €/mese | circa 13,2 € | circa 10,5 € |
| SDI 5 €/mese (pessimista) | circa 9,2 € | circa 6,5 € |

Confronto con `ARCHITECTURE-V2` §1.9, che stimava un margine lordo di circa 8-12 € per cliente a 15 €: coincide con gli scenari "con SDI".

### 4.3 Piano annuale da 120 € (10 €/mese equivalenti)

| Scenario costo SDI | Netto 10 €/mese (IVA esclusa) | Netto 8,20 €/mese (IVA inclusa 22%) |
|---|---|---|
| Nessun costo SDI | circa **9,5 €** | circa **7,7 €** |
| SDI 1 €/mese | circa 8,5 € | circa 6,7 € |
| SDI 5 €/mese | circa 4,5 € | circa 2,7 € |

Il piano annuale rende meno al mese, ma incassa subito 120 € e riduce le disdette (ipotesi, non misura).

## 5. Break-even: quanti clienti paganti servono

### 5.1 Coprire i soli costi fissi

Con un margine di 2,7-14,2 € per cliente e costi fissi di 8,50 € (solo web) o 17,50 € (con store):

| Costi fissi | Margine 14,2 € (mensile, IVA esclusa, no SDI) | Margine 6,5 € (mensile, IVA inclusa, SDI 5 €) | Margine 2,7 € (annuale, IVA inclusa, SDI 5 €) |
|---|---|---|---|
| 8,50 € (solo web) | **1 cliente** | **2 clienti** | **4 clienti** |
| 17,50 € (con store) | **2 clienti** | **3 clienti** | **7 clienti** |

Tradotto: **i costi di server e servizi si coprono con pochissimi clienti.** Questo numero è fuorviante se letto da solo, perché non include il lavoro di chi sviluppa e assiste, l'assicurazione, le revisioni, le tasse e il marketing. Ed è anche per questo che `ARCHITECTURE-V2` §1.9 avverte che "con 10 clienti i costi fissi non vengono coperti dalla sola fattura SDI" se si usasse un provider a pagamento.

### 5.2 Per arrivare a un margine mensile desiderato

Formula: **clienti = (margine desiderato + costi fissi) / margine per cliente**. Esempi con costi fissi 8,50 € (solo web), piano mensile 15 € IVA esclusa:

| Margine mensile desiderato (prima di tasse e tempo non pagato) | Senza costo SDI (14,2 €/cliente) | Con SDI 5 €/mese (9,2 €/cliente) |
|---|---|---|
| 500 € | circa 36 clienti | circa 56 clienti |
| 1.000 € | circa 71 clienti | circa 110 clienti |
| 2.000 € | circa 142 clienti | circa 218 clienti |

Con IVA inclusa nel prezzo, i numeri salgono di circa il 25%. Con il solo piano annuale da 120 € salgono di circa il 50%.

### 5.3 Una tantum da recuperare

Revisione legale (150-300 €) più eventuale assicurazione e commercialista (non quantificati): con 14,2 € di margine, 300 € si recuperano con circa 21 clienti-mese (cioè 21 clienti per un mese, o 7 clienti in tre mesi). Il valore reale dipenderà dai preventivi che ancora non abbiamo.

## 6. Ipotesi di conversione (nostre, non misurate)

La domanda: quanti utenti gratuiti servono per avere i clienti paganti calcolati sopra. **Le percentuali sotto sono ipotesi di scenario, non benchmark e non dati**: servono solo a dimensionare l'ordine di grandezza.

Definizione: "conversione" = quota degli utenti che hanno aperto l'app e creato almeno un documento che passa a pagamento entro 3 mesi.

| Scenario | Conversione ipotizzata | Utenti gratuiti attivi necessari per 71 paganti (margine 1.000 €/mese, senza SDI) | Per 36 paganti (500 €/mese) |
|---|---|---|---|
| Pessimista | 2% | circa 3.550 | circa 1.800 |
| Centrale | 5% | circa 1.420 | circa 720 |
| Ottimista | 8% | circa 890 | circa 450 |

Altre ipotesi da misurare nelle prime settimane (non le conosciamo):

- Quanti dei visitatori della pagina provano l'app.
- Quanti emettono davvero una fattura (non solo un preventivo): la fattura è il motivo per cui un artigiano paga.
- Quanti arrivano al limite dei 3 documenti e che cosa fanno (pagano, tornano al mese dopo, abbandonano).
- Disdette mensili (**churn**): qui non uso nessun valore, ma pesa molto: se per esempio il 5% dei clienti disdice ogni mese, per tenere 71 clienti bisogna acquisirne continuamente circa 3-4 nuovi al mese. Il numero è solo un esempio di calcolo.

**Come trasformare queste ipotesi in dati:** (1) beta chiusa con 5-10 artigiani, (2) misurare le attivazioni e i passaggi a Pro a mano nelle prime 8 settimane (il prodotto non usa strumenti di analisi di terze parti: la raccolta va pensata con la privacy), (3) chiedere agli artigiani quanto pagherebbero (domanda diretta, prima di scegliere A, B o C).

## 7. Rischi per i numeri

| Rischio | Effetto sui numeri |
|---|---|
| Costo reale dell'invio SDI, se si adotta un provider | Può far scendere il margine a 2-9 €; è la voce più incerta |
| Prezzo effettivo con o senza IVA | Cambia il margine di circa il 18% |
| Limite del Gratis troppo generoso o troppo stretto | Poche conversioni, oppure rifiuto del prodotto |
| Costi dell'app negli store (99 $/anno + eventuali commissioni se si vende dentro l'app) | Se Apple impone l'acquisto interno, commissioni 15-30% (**da verificare**; per questo l'ipotesi è vendere solo dal web) |
| Costi di assistenza | Non stimati; per un'app fiscale possono essere alti |
| Assicurazione e responsabilità | Non stimate; vedi `docs/COMMERCIALISTA/03-RISCHI-E-RESPONSABILITA.md` |
| Cambiamenti normativi che richiedono manutenzione | Costo di lavoro non incluso |

## 8. Prossimi passi consigliati

1. Decidere se i prezzi sono IVA inclusa o esclusa, con il commercialista (anche su come fatturiamo noi).
2. ~~Allineare il testo "due mesi in meno"~~: fatto (vedi §1). Resta da tenere allineato `public/prodotto.html` se i prezzi cambiano.
3. Chiedere 2-3 preventivi a provider SDI **solo se** si decide di inviare le fatture al posto dell'utente (oggi non è previsto).
4. Fare 5-10 interviste agli artigiani sulla disponibilità a pagare, prima di fissare A, B o C.
5. Raccogliere i primi dati reali (attivazioni, passaggi a Pro, disdette) e sostituire questo documento con numeri misurati.

## 9. Come funzionano i limiti nell'app

Aggiornato il 4 novembre 2026 sul codice attuale. Implementazione in `src/billing/`. Prezzi e limite Free vivono in un'unica costante (`src/billing/pricing.ts`: `FREE_DOCS_PER_MONTH = 3`, `PRO_PRICE_MONTH = 15`, `PRO_PRICE_YEAR = 120`), usata dall'app e dalla pagina Informazioni; il server ha la sua costante (`server/src/billing/entitlements.ts`) e le due vanno tenute uguali.

- **Gratis**: 3 documenti **nuovi** al mese (preventivi e fatture), contati sul mese di calendario del dispositivo in base a `createdAt`. Contano anche la **bozza di fattura creata convertendo un preventivo** (`createInvoiceFromQuote`) e i documenti **duplicati**: un preventivo convertito in fattura consuma quindi 2 documenti del mese. Le bozze eliminate **non** rimborsano il conteggio (registro locale `vp:billing:ledger`). Le **note di credito non contano** e non sono mai bloccate.
- **Mai bloccati**: modificare un documento esistente, scaricarlo, consultarlo, esportare il backup, registrare incassi ed esiti SDI, correggere e rinviare una scartata, stornare con nota di credito. Le fatture emesse restano sempre consultabili e stornabili anche oltre il limite.
- **Pro**: documenti illimitati e sincronizzazione. Il piano viene letto da `GET /v1/me` quando c'è un account e tenuto in cache locale (`vp:billing:plan`); dopo un sync riuscito `/me` si rilegge se più vecchio di 1 ora; se l'app non riesce a riverificarlo (offline, server non raggiungibile) il Pro resta valido per **14 giorni** dall'ultima verifica riuscita (`OFFLINE_GRACE_MS`), poi si torna al Free finché non ci si riconnette. Il passaggio a Free deciso dal server è immediato. I dati non vengono mai toccati.
- **Limite "morbido" senza account**: senza account il conteggio è solo sul dispositivo e chi vuole può aggirarlo (cancellando i dati del browser, usando un altro browser). Non è una protezione e non la presentiamo come tale. L'unico limite **vincolante** è quello del server sui documenti sincronizzati: se supera la quota Free il server risponde `quota_exceeded`, il documento resta intero sul dispositivo e l'app lo segnala in "Da controllare" (con "Passa a Pro" e "Riprova").
- **Differenza di fuso (corretta)**: l'app conta il mese del dispositivo, il server il mese UTC. Dalla revisione del client (difetto B1) il conteggio del server viene confrontato solo se riguarda il mese UTC corrente (`serverUsedFor`, `periodKey`), così a cavallo del mese nessuno resta bloccato per ore. Resta qualche ora di differenza possibile tra la vista locale e quella del server.
- **Interfaccia**: contatore discreto "Documenti questo mese: 2/3" (nuovo documento e Account), avviso "Ti resta 1 documento gratuito questo mese", schermata gentile al raggiungimento del limite ("Hai usato i 3 documenti gratuiti di questo mese", con la data di azzeramento, senza conto alla rovescia né testi colpevolizzanti, con "Continua a consultare i documenti" in evidenza). La verifica del limite avviene anche in "Converti in fattura" e "Duplica"; se la verifica non riesce l'utente non viene bloccato.
- **App nativa (iOS/Android)**: nessun prezzo e nessun pulsante d'acquisto (regola Apple 3.1.1, `docs/MOBILE.md` §7); compare solo "Gestisci il tuo abbonamento dal sito". La sezione prezzi della pagina Informazioni è nascosta. Implementato in `src/billing/platform.ts` (`isNativeApp`) e usato in `LimitGate`, `AccountView`, `LandingPage`; mai provato su un'app nativa vera.
- **Pagamento**: da Account, "Passa a Pro" chiama `/v1/billing/checkout`, "Gestisci abbonamento" chiama `/v1/billing/portal`. Gli indirizzi di pagamento ricevuti dal server vengono aperti solo se sono https verso `stripe.com` (e sottodomini) o l'host dell'app; per un dominio di pagamento personalizzato va impostato `VITE_PAYMENT_HOSTS` (`src/billing/safeUrl.ts`). Al ritorno (`#/account?checkout=success` o `cancel`) l'app interroga `/me` per qualche secondo finché il webhook ha attivato il Pro; il parametro nell'URL da solo non attiva nulla.
- **Non provato**: il pagamento reale con Stripe, l'attivazione del Pro dal webhook su un server di produzione, la quota server oltre il Free in condizioni reali (solo test automatici; `docs/QA-REPORT.md`).
