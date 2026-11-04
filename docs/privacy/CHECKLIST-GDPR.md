# Checklist GDPR del titolare — BOZZA

> Non è consulenza legale; ogni valutazione è un'ipotesi da far confermare a un legale/DPO. Segnaposto: [RAGIONE SOCIALE] [P.IVA] [EMAIL] [PEC] [SEDE] [DATA].

## Prima del lancio con account (modalità B)
- [ ] Compilare i segnaposto in tutti i documenti `public/legal/*` e pubblicarli (privacy, termini, DPA, cookie, sub-responsabili).
- [ ] Scegliere i fornitori (hosting UE, backup, email, STT) e **firmare i DPA** (v. `DPA-FORNITORI.md`).
- [ ] Aggiornare `subprocessors.html` con i fornitori reali, sede e garanzie di trasferimento.
- [ ] Accettazione clic di Termini + DPA al signup con versione e timestamp (audit log) — verifica con SERVER-CORE.
- [ ] Compilare il registro dei trattamenti (`REGISTRO-TRATTAMENTI.md`) con dati reali.
- [ ] Procedura data breach testata a tavolino (`PROCEDURA-DATA-BREACH.md`).
- [ ] Procedura diritti operativa (`PROCEDURA-DIRITTI.md`); funzioni export/cancellazione account verificate.
- [ ] Definire periodi di conservazione ([N] gg segnaposto) e implementare la cancellazione.
- [ ] Verificare che i log non contengano audio, contenuti, token.
- [ ] Verificare lo stato del Data Privacy Framework e/o SCC per ogni fornitore extra-UE [DA VERIFICARE].
- [ ] Revisione legale di tutti i testi (1–2 ore stimate, `ARCHITECTURE-V2.md` §1.8).
- [ ] Designazione referente privacy interno; DPO: valutare (v. sotto).
- [ ] Misure per clienti consumatori (recesso, ODR): verifica legale.

## Valutazioni (ipotesi motivate)

### DPIA (valutazione d'impatto, art. 35) — ipotesi: NON obbligatoria
Motivazione ipotizzata: i dati sono personali comuni (anagrafica e documenti commerciali), non categorie particolari; non c'è profilazione sistematica né monitoraggio su larga scala; non ci sono decisioni automatizzate con effetti giuridici (l'abbinamento voce→listino è sempre confermato dall'utente); il volume è contenuto (microimprese). Elementi che potrebbero cambiare la valutazione: crescita su larga scala del numero di interessati, uso dell'audio con modelli di terzi e conservazione delle trascrizioni, introduzione di funzioni di profilazione, consultazione degli elenchi del Garante sui trattamenti soggetti a DPIA. Azione: far confermare a un legale/DPO e **documentare la valutazione** (questa pagina); rivedere a ogni funzione nuova. [DA VERIFICARE]

### DPO (art. 37) — ipotesi: NON obbligatorio
Non siamo autorità pubblica; l'attività principale non consiste (ipotesi) in monitoraggio regolare e sistematico su larga scala né in trattamento su larga scala di dati particolari. Da riconsiderare con la crescita. [DA VERIFICARE]

### Ruoli
- Titolari per account/fatturazione: noi. Responsabili (art. 28) per i dati dei clienti degli artigiani: noi. Stripe: titolare autonomo per i pagamenti [DA VERIFICARE]. Fornitori di hosting/email/STT: sub-responsabili.
- Browser/OS per la dettatura: titolari autonomi (informativa all'utente).

### Basi giuridiche
Contratto (6.1.b) per il servizio; obbligo di legge (6.1.c) per la contabilità; legittimo interesse (6.1.f) per sicurezza e prova degli accordi (da documentare con test di bilanciamento breve) [DA VERIFICARE]. Nessun consenso richiesto salvo future funzioni (analytics, marketing).

### Minimizzazione e privacy by design
- Modalità A: nessun dato ai nostri server.
- Audio non conservato; log senza contenuti.
- Account non obbligatorio per il piano Free [decisione di prodotto, `ARCHITECTURE-V2.md` §1.8 punto 9].
- Cifratura dei campi sensibili (IBAN).

### Altri punti
- [ ] Marketing/newsletter: oggi non previsti; se introdotti serve base giuridica e consenso/soft-spin [DA VERIFICARE].
- [ ] Cookie: nessun analytics di terze parti; verificare l'inquadramento come soli strumenti tecnici [DA VERIFICARE].
- [ ] Minori: servizio non rivolto a minori.
- [ ] Formazione di chi ha accesso ai dati; accessi amministrativi tracciati.
- [ ] Riesame annuale di registro, sub-responsabili, misure.
