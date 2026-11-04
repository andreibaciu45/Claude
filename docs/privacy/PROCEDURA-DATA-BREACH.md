# Procedura in caso di violazione dei dati personali (data breach) — BOZZA

> Bozza operativa da far validare da un legale. I termini citati (72 ore, art. 33 GDPR; "senza ingiustificato ritardo" per il responsabile, art. 33.2; comunicazione agli interessati, art. 34) vanno confermati [DA VERIFICARE].

## Ruoli
- **Responsabile dell'incidente**: [nome / [EMAIL]]. Sostituto: [nome].
- **Per i dati dei clienti degli artigiani siamo responsabili**: dobbiamo avvisare ogni artigiano (titolare) coinvolto **senza ingiustificato ritardo**; il DPA prevede un obiettivo di [24/48] ore dalla conoscenza. L'artigiano valuta e notifica al Garante **entro 72 ore dal momento in cui ne è venuto a conoscenza**.
- **Per i dati dell'account/fatturazione siamo titolari**: dobbiamo valutare e, se c'è rischio, notificare al Garante **entro 72 ore** dalla conoscenza; se il rischio è elevato, comunicare agli interessati.

## Fasi
1. **Rilevazione e contenimento (ora 0)** — Segnare data/ora di conoscenza. Isolare i sistemi, revocare credenziali/token/chiavi compromessi, bloccare l'accesso illecito. Preservare i log (non modificarli).
2. **Valutazione (entro 4–8 ore)** — Che dati (account, clienti, documenti, audio)? Riservatezza, integrità o disponibilità violate? Quanti account e interessati? Dati cifrati? Possibile identificare i tenant colpiti dai log? Rischio per gli interessati (basso/medio/alto): [criteri da definire con il legale].
3. **Notifica ai titolari/artigiani coinvolti (obiettivo [24/48] ore)** — Email all'indirizzo dell'account con: natura, categorie e numero approssimativo di interessati/dati, conseguenze probabili, misure prese, contatto. Template sotto.
4. **Notifica al Garante (solo violazioni nostre come titolare, entro 72 ore)** — Tramite il servizio online del Garante; se in ritardo, indicare i motivi. Notifica per fasi consentita [DA VERIFICARE].
5. **Comunicazione agli interessati** se rischio elevato (art. 34), con linguaggio semplice.
6. **Registro delle violazioni** (anche quelle non notificate): fatti, effetti, rimedi, motivazione della scelta. Conservare.
7. **Post-incidente (entro 14 giorni)** — Causa radice, correzioni, aggiornamento di misure/registro, se necessario aggiornamento DPA e sub-responsabili; avvisare i sub-responsabili coinvolti.

## Se la violazione nasce da un sub-responsabile
Il sub-responsabile deve avvisarci senza ingiustificato ritardo (clausola da inserire nei DPA fornitori): il termine delle 72 ore decorre dalla nostra conoscenza [DA VERIFICARE]. Avviare subito le fasi 2–3.

## Template email ai titolari (bozza)
> Oggetto: Comunicazione di una violazione di dati personali
> Gentile utente, il [DATA] alle [ORA] siamo venuti a conoscenza di [descrizione sintetica]. Sono interessati [categorie di dati] di circa [N] persone. Conseguenze probabili: [..]. Misure adottate: [..]. Misure consigliate a voi: [..]. Contatto: [EMAIL]. Vi aggiorneremo entro [..]. La valutazione sull'eventuale notifica al Garante spetta a voi come titolari; vi forniamo tutte le informazioni necessarie.

## Contatti utili
Garante per la protezione dei dati personali: garanteprivacy.it (servizio di notifica online) [verificare indirizzo/procedura attuale].
