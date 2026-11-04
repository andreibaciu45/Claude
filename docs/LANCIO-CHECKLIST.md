# Checklist di lancio: dai primi test ai 10 clienti paganti

Stato: proposta operativa, 04/11/2026. Va letta con `docs/GO-TO-MARKET.md` (canali, post), `docs/PRICING.md` (costi) e `docs/MARKET-2.md` (concorrenti). Le voci non spuntate sono da fare; nulla qui risulta già fatto.

Regola: ogni blocco ha un **cancello**; non si passa al blocco successivo se il cancello non è chiuso.

## Blocco 0 - Decisioni di base (settimana 0)

- [ ] Esito delle 10 interviste e decisione GO / GO CON CAMBIAMENTI / NO-GO (`docs/INTERVISTE.md` §6).
- [ ] Riscrivere il messaggio senza il claim "non esiste niente di simile" (PrevAI, VoxTrade e Smart Scope esistono: `docs/MARKET-2.md` §2).
- [ ] Decidere il posizionamento: "preventivo veloce complementare al gestionale" o "gestionale con SDI". Cambia prezzo, roadmap e testi.
- [ ] Decidere il prezzo definitivo (A/B previsti: `docs/MARKET-2.md` §3) e se i prezzi sono IVA inclusa o esclusa.
- [ ] Correggere il testo "due mesi in meno" dell'annuale (`docs/PRICING.md` §1) e allinearlo con `src/billing/pricing.ts`.

**Cancello 0**: decisione scritta su target, prezzo, IVA.

## Blocco 1 - Fisco e legale (prima di incassare un euro)

- [ ] **Commercialista**: partita IVA e codice ATECO per attività di software/SaaS; regime fiscale (forfettario o ordinario) e suoi limiti; IVA sui servizi digitali a consumatori/imprese UE; fatturazione ai clienti (la nostra fattura è elettronica e va a SDI); trattamento dei corrispettivi Stripe; contributi INPS. Risultato atteso: nota scritta con le risposte.
- [ ] **Legale / consulente privacy**: revisione di Termini, Privacy, Cookie, informativa sul riconoscimento vocale (l'audio può andare a Google/Apple), ruoli (titolare / responsabile), registro dei trattamenti, durata di conservazione, trasferimenti extra-UE. Costo stimato nel repo: 150-300 € (`docs/PRICING.md` §3.1; non preventivato). Bozze in `public/legal/*.html` e `docs/COMMERCIALISTA/`.
- [ ] Clausole da verificare: fair use del Pro, recesso e rimborso (diritto di recesso per B2C e B2B), limitazione di responsabilità per errori di calcolo di preventivi/fatture, avviso che la fattura PDF **non** è una fattura elettronica SDI.
- [ ] **Assicurazione**: chiedere 2-3 preventivi per RC professionale / cyber (software con dati fiscali). Valutare se serve prima dei primi clienti paganti. Costo: non stimato.
- [ ] Marchio: verifica disponibilità di "VocePreventivo" (UIBM / EUIPO, App Store e Google Play) prima di investire nel dominio e nei contenuti.

**Cancello 1**: revisioni ricevute e recepite nei file; nessun segnaposto `[...]` residuo nelle pagine legali.

## Blocco 2 - Dominio e testi

- [ ] Acquistare il dominio (circa 12 €/anno nelle stime; verificare prezzo reale).
- [ ] Sostituire `[DOMINIO]` in **tutti** i file (cercare con `grep -rn "\[DOMINIO\]" /home/user/Claude`), inclusi legal, email, README, manifest, URL di ritorno Stripe.
- [ ] Sostituire gli altri segnaposto (titolare, indirizzo, email di supporto, P.IVA).
- [ ] Email di supporto con risposta entro 24 ore e un sostituto per le ferie.
- [ ] Pagina Informazioni: prezzi coerenti con Stripe, IVA indicata, nota visibile "la fattura è copia di cortesia, non SDI".

**Cancello 2**: nessun `[DOMINIO]` o altro segnaposto nel build di produzione.

## Blocco 3 - Infrastruttura

- [ ] **VPS in UE** (stima 4-6 €/mese), aggiornamenti automatici di sicurezza, firewall, accesso solo con chiave SSH, HTTPS con rinnovo automatico del certificato.
- [ ] **Backup** giornalieri del database (stima 1-3 €/mese) con **prova di ripristino effettuata** e documentata; conservazione e cifratura.
- [ ] **Email transazionale** (codici di accesso, ricevute): provider UE o con DPA; configurare SPF, DKIM, DMARC; test di consegna su Gmail, Outlook, iCloud e spam.
- [ ] **Stripe in produzione**: attivazione account (richiede P.IVA, IBAN, documenti), creazione dei prodotti e dei prezzi (`STRIPE_PRICE_MONTH`, `STRIPE_PRICE_YEAR`) allineati a `src/billing/pricing.ts`, webhook con firma verificata, portale clienti, Stripe Tax o gestione IVA decisa dal commercialista, ricevute/fatture. Test con carta reale per importo minimo e rimborso.
- [ ] Monitoraggio minimo: controllo di raggiungibilità, errori del server, scadenza certificato, spazio disco; chi viene avvisato e come.
- [ ] Piano di risposta a un incidente o a una violazione dei dati (chi, cosa, entro 72 ore se serve notifica al Garante).

**Cancello 3**: acquisto di prova completo (checkout -> webhook -> Pro attivo -> disdetta -> ritorno a Free) eseguito in produzione, con ripristino da backup provato.

## Blocco 4 - Test su dispositivi reali

Finora la PWA non è stata provata su dispositivi reali (vedi `docs/GO-TO-MARKET.md`).

- [ ] iPhone con Safari recente (almeno 2 versioni di iOS): installazione "Aggiungi a Home", microfono, offline, permessi, comportamento dopo il blocco schermo.
- [ ] Android con Chrome (almeno 2 marche, una economica): installazione, microfono, offline, notifiche se previste.
- [ ] Firefox e altri browser: messaggio chiaro quando la dettatura non è supportata e fallback testuale.
- [ ] Dettatura: 20 frasi tipiche per mestiere (idraulico, elettricista, imbianchino, serramentista) con tasso di errore misurato; con rumore e in dialetto (scheda in `docs/INTERVISTE.md`).
- [ ] Rete debole o assente: creazione preventivo offline, sincronizzazione al ritorno, comportamento al limite Free e `quota_exceeded`.
- [ ] Stampa/PDF: apertura su telefono, condivisione via WhatsApp e email, dimensioni.
- [ ] Accessibilità di base: testo grande, contrasto, uso con una mano.
- [ ] Esportazione e import del backup; cancellazione account e dati.

**Cancello 4**: nessun errore bloccante su 2 iPhone e 2 Android; tasso di errori di dettatura documentato.

## Blocco 5 - Lancio ristretto (settimane 1-4)

- [ ] Lista di 40 artigiani da contattare (non pubblicare ancora su tutti i canali), dai 5 che hanno fatto il test e dai loro colleghi.
- [ ] Offerta "primi 20" decisa (`docs/GO-TO-MARKET.md`); definire cosa succede dopo i 3 mesi gratuiti e chiarirlo per iscritto.
- [ ] Un modo semplice per segnalare problemi dall'app (email o modulo).
- [ ] Registro a mano dei 6 numeri settimanali (sotto).
- [ ] Primi pagamenti reali: ricevuta o fattura emessa a ogni cliente, come stabilito dal commercialista.

## Cosa misurare

Settimanale, in un foglio, senza strumenti di analisi di terze parti (la privacy attuale non li prevede; se si aggiungono, aggiornare l'informativa):

| Metrica | Come | Soglia di partenza (ipotesi) |
|---|---|---|
| Persone contattate -> risposte -> prove avviate | conteggio manuale | rispondono almeno 20% |
| Attivazione: documento reale entro 48 ore | messaggio dopo 3 giorni / conteggio lato server se c'è account | > 40% |
| Ritorno: secondo documento entro 7 giorni | idem | > 30% |
| Tempo medio da richiesta a PDF | prova osservata + domanda | meno di 2 minuti nei test |
| Righe dettate corrette senza modifiche | osservazione | almeno 2 su 3 |
| Arrivo al limite di 3 documenti e scelta (paga / aspetta / abbandona) | log lato server e messaggio | informativo |
| Paganti, importo, mensile/annuale, motivo di ogni "no" | Stripe + note | 10 paganti reali |
| Disdette (churn) mensili | Stripe | informativo, da osservare sui primi 3 mesi |
| Richieste di assistenza per cliente e tempo di risposta | casella email | risposta entro 24 ore |
| Richieste di SDI / conservazione | note | se ricorrono, vedi piano B |

Le soglie sono ipotesi nostre, non benchmark.

## Rischi principali

| Rischio | Segnale | Risposta |
|---|---|---|
| I forfettari usano già strumenti gratuiti (AdE, banca) | "ho già la fattura gratis" | non competere sulla fattura; puntare sul preventivo; prezzo più basso; esportazione verso il loro strumento |
| La dettatura sbaglia in cantiere | > 1 riga su 2 da correggere | tastiera guidata, foto del listino, dettatura breve per voce; test di altri motori vocali (costi in `docs/PRICING.md`) |
| Concorrenti con più risorse (PrevAI, gestionali con app) | un concorrente aggiunge voce o riduce il prezzo | differenziarsi su semplicità, dati locali, prezzo |
| Responsabilità su calcoli/fisco | cliente contesta un importo | Termini rivisti, avvisi, assicurazione, log delle versioni dei documenti |
| Privacy della voce | dubbi degli utenti | informativa chiara, scelta del motore, nessuna registrazione dell'audio sui nostri server di default |
| Carico di assistenza | oltre 5 richieste a settimana con meno di 10 clienti | guida in app, FAQ, limitare il Gratis |
| Costi reali di SDI se si aggiunge un provider | preventivi di provider | calcolare margine (`docs/PRICING.md` §4) prima di promettere |
| Pochi paganti nonostante l'interesse | 0-2 paganti dopo 60 giorni | tornare alle interviste: è un problema di prodotto o di messaggio, non di canale |

## Piano B

1. **Se il problema è la dettatura**: passare a un input ibrido (tastiera + suggerimenti dal listino) e rivalidare con 5 artigiani.
2. **Se serve l'SDI**: scegliere un provider dopo 2-3 preventivi (nessun listino trovato: `docs/PRICING.md` §3.2) oppure integrare i gestionali esistenti (esportare preventivi in un formato che FIC/Aruba importino) invece di costruire l'SDI.
3. **Se il prezzo è troppo alto**: scendere a 6-9 €/mese o 59-79 €/anno e riprovare il test.
4. **Se la distribuzione è il problema**: accordi con rivenditori e associazioni (CNA, Confartigianato) anziché i gruppi Facebook.
5. **Se dopo 90 giorni i paganti sono 0-2 e le interviste non mostrano il problema**: fermarsi e ridefinire il target (altri mestieri) o il prodotto; l'app e la documentazione restano riutilizzabili.

## Piano temporale indicativo

| Settimana | Cosa |
|---|---|
| 0 | Blocco 0; richieste a commercialista, legale, assicurazione |
| 1-2 | 10 interviste, 5 test; Blocco 4 in parallelo |
| 2-3 | Blocchi 1-3 chiusi; dominio e segnaposto |
| 4 | Lancio ristretto ai primi 20 |
| 5-8 | Prova di prezzo, 6 post, rivenditori, feedback a 15 giorni |
| 9-12 | Primi 10 paganti reali oppure decisione sul piano B |

I tempi di commercialista, legale e attivazione di Stripe dipendono da terzi e sono la parte più a rischio di slittamento.
