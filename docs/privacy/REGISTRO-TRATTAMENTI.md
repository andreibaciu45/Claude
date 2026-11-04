# Registro dei trattamenti (art. 30 GDPR) — BOZZA

> BOZZA da far revisionare da un legale/consulente privacy. Non è consulenza legale. Segnaposto: [RAGIONE SOCIALE] [P.IVA] [EMAIL] [PEC] [SEDE] [DATA].
> L'obbligo di tenuta del registro e l'eventuale esenzione per imprese con meno di 250 dipendenti (art. 30.5) vanno valutati: [DA VERIFICARE]. Il registro è comunque raccomandato, e nel caso del responsabile (art. 30.2) il trattamento non occasionale lo rende di fatto necessario [DA VERIFICARE].

Ultimo aggiornamento: [DATA]. Fonte tecnica: `docs/ARCHITECTURE-V2.md` §1.3, §1.7, §1.8.

## Parte A — Come TITOLARE (art. 30.1)

Titolare: [RAGIONE SOCIALE], [P.IVA], [SEDE], [EMAIL], [PEC]. DPO: non designato (valutazione in `CHECKLIST-GDPR.md`) [DA VERIFICARE].

| # | Trattamento | Finalità | Interessati | Categorie di dati | Base giuridica | Destinatari | Extra-UE | Conservazione | Misure |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Gestione account artigiano | Registrazione, accesso, erogazione servizio | Artigiani/imprese (spesso persone fisiche) | Email, hash password, dati azienda (ragione sociale, P.IVA, indirizzo, regime), impostazioni | Contratto 6.1.b | Hosting UE, email transazionale | [da verificare per email] | Durata account + [N] gg | Cap. misure |
| T2 | Fatturazione abbonamento Pro | Pagamenti, fatture nostre, obblighi contabili | Artigiani | Email, importi, date, stato abbonamento, ID cliente Stripe | Contratto 6.1.b; obbligo di legge 6.1.c | Stripe (titolare autonomo), commercialista | Stripe: [DA VERIFICARE] | Termine contabile/fiscale [10 anni, DA VERIFICARE] | idem |
| T3 | Quote e limiti piano | Contare documenti/mese Free | Artigiani | Contatori per tenant/mese | Contratto 6.1.b | — | No | Durata account | idem |
| T4 | Audit di accettazione Termini/DPA | Prova di accettazione | Artigiani | Versione, data/ora, ID utente [IP: da valutare] | 6.1.b / 6.1.f | — | No | Durata rapporto + prescrizione [DA VERIFICARE] | idem |
| T5 | Sicurezza e log tecnici | Prevenzione abusi, diagnosi | Utenti | IP, timestamp, esito richiesta, ID (mai contenuti/token/audio) | Legittimo interesse 6.1.f | Hosting UE | No | [N] gg | idem |
| T6 | Assistenza e contatti | Rispondere a richieste | Chi scrive | Email, messaggio | 6.1.b / 6.1.f | Servizio email [fornitore] | [verificare] | [N] mesi dalla chiusura | idem |
| T7 | Sito/landing | Servire le pagine | Visitatori | Log tecnici dell'hosting | 6.1.f | Hosting | [verificare] | secondo hosting | idem |

## Parte B — Come RESPONSABILE per conto degli artigiani (art. 30.2)

| Campo | Contenuto |
|---|---|
| Responsabile | [RAGIONE SOCIALE], [SEDE], [EMAIL] |
| Titolari per conto dei quali si tratta | Gli utenti artigiani/imprese con account (elenco = tabella tenant; accettazione DPA registrata in audit log) |
| Categorie di trattamenti | Archiviazione e sincronizzazione di documenti, catalogo, anagrafica clienti; generazione PDF/XML; backup; trascrizione vocale transitoria |
| Interessati finali | Clienti degli artigiani (persone fisiche, ditte individuali, referenti) |
| Dati | Nome/ragione sociale, indirizzo, CF/P.IVA, email, telefono, contenuto dei documenti (descrizioni, importi). Non sanitari, no art. 9/10 |
| Audio | Trattato in transito per la trascrizione; **non conservato** |
| Trasferimenti extra-UE | Nessuno previsto per i dati principali (hosting/backup UE). Trascrizione vocale: [fornitore STT da definire; DA VERIFICARE se extra-UE e garanzie] |
| Sub-responsabili | Vedi `public/legal/subprocessors.html` |
| Conservazione | Fino a chiusura account; export + cancellazione; fatture emesse: archivio ristretto o restituzione (decisione in DPA) [DA VERIFICARE] |
| Misure di sicurezza | TLS+HSTS; dati UE; backup cifrati (age); cifratura applicativa AES-256-GCM per campi sensibili (IBAN); segreti solo in env; isolamento per tenant; hash password; rate limiting; log senza contenuti; minimo privilegio; audit log; fatture immutabili |

## Revisioni
| Data | Modifica | Autore |
|---|---|---|
| [DATA] | Prima bozza | — |
