# Checklist di lancio: dai primi test ai 10 clienti paganti

Stato: proposta operativa, **aggiornata il 4 novembre 2026** (riallineata ai file e agli script attuali). Va letta con `docs/STATO-PRODOTTO.md` (a che punto siamo), `docs/GO-TO-MARKET.md` (canali, post), `docs/PRICING.md` (costi) e `docs/MARKET-2.md` (concorrenti). Le voci non spuntate sono da fare. Le voci spuntate **[x]** risultano fatte nel repository (verificato il 4/11/2026); nulla di ciò che dipende da terzi, da un dominio, da un server o da un telefono vero risulta fatto.

Regola: ogni blocco ha un **cancello**; non si passa al blocco successivo se il cancello non è chiuso.

## Blocco 0 - Decisioni di base (settimana 0)

- [ ] Esito delle 10 interviste e decisione GO / GO CON CAMBIAMENTI / NO-GO (`docs/INTERVISTE.md` §6).
- [x] Messaggio riscritto senza il claim "non esiste niente di simile" (PrevAI, VoxTrade e Smart Scope esistono: `docs/MARKET-2.md` §2). Fatto nei testi pubblici (`src/pages/LandingPage.tsx`, `public/prodotto.html`), regole in `docs/POSIZIONAMENTO.md`. Da rileggere prima di ogni nuovo post.
- [ ] Decidere il posizionamento: "preventivo veloce complementare al gestionale" o "gestionale con SDI". Cambia prezzo, roadmap e testi.
- [ ] Decidere il prezzo definitivo (A/B previsti: `docs/MARKET-2.md` §3) e se i prezzi sono IVA inclusa o esclusa. I prezzi attuali (15 €/mese, 120 €/anno, Free 3 documenti) stanno in `src/billing/pricing.ts`; **tenerli uguali** a `server/src/billing/entitlements.ts` (limite Free), ai prezzi Stripe e a quelli scritti a mano in `public/prodotto.html` (anche nel JSON-LD).
- [x] Testo "due mesi in meno" dell'annuale corretto: ora la pagina dice "risparmi 60 € rispetto al mensile", calcolato da `src/billing/pricing.ts`.
- [ ] Decidere cosa succede dopo i 3 mesi gratuiti dell'offerta "primi 20" (`docs/GO-TO-MARKET.md`) e se si usano i **codici invito** per il lancio riservato (`docs/OPERAZIONI.md` §4: `INVITE_ONLY=1` + `vpadmin create-invite-code`).

**Cancello 0**: decisione scritta su target, prezzo, IVA.

## Blocco 1 - Fisco e legale (prima di incassare un euro)

- [ ] **Commercialista, per il prodotto**: far compilare `docs/COMMERCIALISTA/01-CHECKLIST-FISCALE.md` (sezioni A-L, comprese le **8 ipotesi** della sezione L e il giudizio finale). Lo scopo è chiudere ogni riga "Da modificare" o "Non sono sicuro" prima del lancio. Il pacchetto è nei file `docs/COMMERCIALISTA/00-LEGGIMI.md` (prova in 10 minuti), `01-...`, `02-ESEMPI/`, `03-RISCHI-E-RESPONSABILITA.md`.
- [ ] **Prova sul portale dell'Agenzia delle Entrate** con 2-3 fatture simboliche generate dall'app (una con bollo addebitato, una con sconto in euro, una nota di credito parziale) per verificare che l'XML sia accettato (checklist H1, J1, L7). **Mai fatto finora: nessuna validazione XSD e nessun invio reale.** Scaricare lo schema XSD ufficiale e collocarlo in `docs/xsd/` (con `xmllint` installato) attiva anche il test che oggi è saltato (`shared/fatturapa/generate.test.ts`, vedi `docs/TEST-REPORT.md` §4).
- [ ] **Commercialista, per l'attività** (la nostra partita IVA): partita IVA e codice ATECO per attività di software/SaaS; regime fiscale (forfettario o ordinario) e suoi limiti; IVA sui servizi digitali a consumatori/imprese UE; fatturazione ai clienti (la nostra fattura è elettronica e va a SDI); trattamento dei corrispettivi Stripe; contributi INPS. Risultato atteso: nota scritta con le risposte.
- [ ] **Legale / consulente privacy**: revisione di Termini, Privacy, Cookie, DPA e sub-responsabili (`public/legal/*.html`), informativa sul riconoscimento vocale (testo dell'avviso in `src/voice/privacy/index.ts`: l'audio può andare a Google/Apple, e su iPhone ai nostri server per la sola trascrizione), ruoli (titolare / responsabile), registro dei trattamenti, durata di conservazione, trasferimenti extra-UE. Le liste di domande sono in `docs/privacy/DA-FAR-VERIFICARE.md` (sezione A legale, B commercialista, C segnaposto tecnici); procedure in `docs/privacy/`. Costo stimato nel repo: 150-300 € (`docs/PRICING.md` §3.1; non preventivato).
- [ ] Clausole da verificare: fair use del Pro, definizione di "documento" nel Free (oggi contano preventivi e fatture create, comprese le conversioni e i duplicati: `docs/PRICING.md` §9), recesso e rimborso (B2C e B2B), limitazione di responsabilità per errori di calcolo di preventivi/fatture (`docs/COMMERCIALISTA/03-RISCHI-E-RESPONSABILITA.md` §3), avviso che la fattura PDF **non** è una fattura elettronica SDI.
- [ ] **Assicurazione**: chiedere 2-3 preventivi per RC professionale / cyber (software con dati fiscali). Valutare se serve prima dei primi clienti paganti. Costo: non stimato.
- [ ] Marchio: verifica disponibilità di "VocePreventivo" (UIBM / EUIPO, App Store e Google Play) prima di investire nel dominio e nei contenuti.

**Cancello 1**: revisioni ricevute e recepite nei file; checklist fiscale compilata e righe "Da modificare" risolte; nessun segnaposto `[...]` residuo nelle pagine legali.

## Blocco 2 - Dominio e testi

- [ ] Acquistare il dominio (circa 12 €/anno nelle stime; verificare prezzo reale).
- [ ] Sostituire `[DOMINIO]` in **tutti** i file. Elenco dei punti da cercare: `grep -rn "\[DOMINIO\]" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=tmp .`. Oggi compare in `public/prodotto.html`, `public/sitemap.xml`, `public/robots.txt`, `public/guide/*.html`, `public/legal/*.html`, `mobile/scripts/patch-native.mjs`, `infra/server.env.example`, `infra/.env.example`, `docs/DEPLOY.md`, `docs/MOBILE.md`, `docs/store/scheda-store.md`, `docs/CONTENUTI-SOCIAL.md`. Per l'app serve anche impostare gli indirizzi di ritorno di Stripe (`STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`) e `CORS_ORIGINS`.
- [ ] Sostituire gli altri segnaposto (classe `ph` nelle pagine legali: ragione sociale, P.IVA, sede, email, PEC, data, prezzi, IVA inclusa/esclusa, politica di rimborso; segnaposto in `docs/privacy/*.md`).
- [ ] Dopo ogni modifica agli `<style>` inline di `index.html`, `public/offline.html`, `public/legal/*.html`, `public/prodotto.html` rieseguire `node scripts/audit/csp-hashes.cjs <dist>` e aggiornare gli hash CSP nei due Caddyfile (altrimenti lo stile sparisce solo in produzione: `docs/SECURITY-FRONTEND.md` §5).
- [ ] Email di supporto con risposta entro 24 ore e un sostituto per le ferie. Le risposte tipo sono in `docs/FAQ-SUPPORTO.md`.
- [ ] Pagina Informazioni: prezzi coerenti con Stripe, IVA indicata, nota visibile "la fattura è copia di cortesia, non SDI".

**Cancello 2**: nessun `[DOMINIO]` o altro segnaposto nel build di produzione.

## Blocco 3 - Infrastruttura

Guide: **`docs/DEPLOY.md`** (installazione e deploy senza Docker) e **`docs/OPERAZIONI.md`** (vita quotidiana, GDPR, incidenti). Nessuna delle due è mai stata eseguita su un server vero.

- [ ] **VPS in UE** (stima 4-6 €/mese; DEPLOY §1), accesso solo con chiave SSH e hardening (DEPLOY §2-3), DNS (§4), `infra/scripts/setup-vps.sh` (§5: firewall, fail2ban, aggiornamenti di sicurezza, Node 22, Caddy con HTTPS automatico, Litestream, timer).
- [ ] **`/etc/vocepreventivo/server.env`** compilato partendo da `infra/server.env.example` (permessi 600, copia nel gestore password): nessun `CHANGE_ME` rimasto; `APP_ENCRYPTION_KEY` e `AUTH_SECRET` casuali (**senza la chiave di cifratura i dati cifrati non si recuperano**); `NODE_ENV=production`; `SDI_PROVIDER=mock` finché non si sceglie un provider; `REQUIRE_TERMS=1`; `OTP_DIGITS=8` (il client accetta 6-10 cifre); `CORS_ORIGINS` con il dominio vero; `METRICS_TOKEN` (facoltativo, almeno 16 caratteri); `INVITE_ONLY=1` se si fa un lancio riservato. **Attenzione, due refusi nel file di esempio da sistemare prima di copiarlo**: `APP_ENCRYPTION_KEY` compare due volte, e mancano `STRIPE_PRICE_MONTH`, `STRIPE_PRICE_YEAR`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` (senza queste il checkout risponde `billing_unconfigured`; sono descritte in `server/src/billing/README.md`).
- [ ] **Primo deploy** (DEPLOY §6): con GitHub Actions "Deploy produzione" (`.github/workflows/deploy.yml`, solo manuale, ambiente `production` con approvazione e segreti `VPS_*`) oppure a mano con `infra/scripts/deploy-nodocker.sh`. Verifiche: `systemctl status vocepreventivo-server vocepreventivo-litestream caddy`, `curl -fsS https://DOMINIO/health`. Il deploy fa backup, controlla `/health` e torna da solo alla versione precedente se fallisce.
- [ ] **Integrazione continua** (`.github/workflows/ci.yml`: typecheck, test client e server, build) verde sul ramo che si distribuisce.
- [ ] **Backup** (DEPLOY §8): replica Litestream su bucket UE, snapshot giornaliero, snapshot settimanale del VPS, con **prova di ripristino eseguita e documentata**: `sudo -u vocepreventivo ./restore.sh litestream --test`, `vpadmin restore-test` (OPERAZIONI §1) e primo avvio a mano di `vocepreventivo-restore-drill`. Poi il timer mensile.
- [ ] **Email transazionale** (codici di accesso): `SMTP_URL`, `MAIL_FROM`, `SMTP_REQUIRE_TLS=1` (se il fornitore non offre STARTTLS il server non invia); SPF, DKIM, DMARC; test di consegna su Gmail, Outlook, iCloud e spam (OPERAZIONI §7.4).
- [ ] **Stripe in produzione**: attivazione account (richiede P.IVA, IBAN, documenti), creazione dei prezzi mensile e annuale e relativi `STRIPE_PRICE_MONTH` / `STRIPE_PRICE_YEAR` **allineati a `src/billing/pricing.ts`**, `STRIPE_SECRET_KEY`, webhook con firma (`STRIPE_WEBHOOK_SECRET`), portale clienti, Stripe Tax o IVA decisa dal commercialista, ricevute/fatture. Il dominio dei pagamenti deve essere `stripe.com` (altrimenti impostare `VITE_PAYMENT_HOSTS` in fase di build: `src/billing/safeUrl.ts`). Test con carta reale per importo minimo e rimborso.
- [ ] **Monitoraggio minimo** (DEPLOY §9, OPERAZIONI §6): monitor esterno ogni 5 minuti su `https://DOMINIO/health/deep` con controllo della parola `"status":"ok"` e uno su `/health`; avviso email/Telegram; controllo di scadenza certificato e disco (`df -h`).
- [ ] **Routine** (OPERAZIONI §1): chi controlla ogni giorno `vpadmin stats`, ogni settimana `vpadmin integrity-check` (e conserva il "SIGILLO" della catena fiscale fuori dal server), ogni mese la prova di ripristino. Concessioni Pro a mano con `vpadmin grant-pro`.
- [ ] **Piano di risposta a un incidente o a una violazione dei dati** (OPERAZIONI §7.8, `docs/privacy/PROCEDURA-DATA-BREACH.md`; notifica al Garante entro 72 ore se serve) e procedura per le richieste GDPR (OPERAZIONI §5, `docs/privacy/PROCEDURA-DIRITTI.md`).
- [ ] Checklist di sicurezza di DEPLOY §10 spuntata per intero.

**Cancello 3**: acquisto di prova completo (checkout -> webhook -> Pro attivo -> disdetta -> ritorno a Free) eseguito in produzione, con ripristino da backup provato e invio di una email di accesso reale.

## Blocco 4 - Test su dispositivi reali

**Finora la PWA non è mai stata provata su dispositivi reali.** Le prove automatiche esistenti (sotto) usano Chromium simulando un telefono; non sostituiscono questo blocco.

Prove automatiche da rilanciare prima di ogni rilascio:

- [ ] `scripts/test/all.sh`: typecheck client/shared e server + tutti i test (client, shared, server). Opzioni: `SHUFFLE=1` (ordine casuale), `TEST_FAKE_NOW=2027-01-01T00:00:10` (sposta l'orologio dei test client/shared), `SKIP_SERVER=1`, `SKIP_TYPECHECK=1`, `COVERAGE=1` (richiede `@vitest/coverage-v8`, non installato). Esce con 0 solo se tutto è verde. Stato al 4/11/2026: 1190 test client, 184 condivisi, 384 del server. Sotto carico un test di `BackupPage` può fallire una volta e passare riprovando da solo (`docs/TEST-REPORT.md` §2): rilanciare il file prima di indagare. Dettagli: `docs/TEST-REPORT.md`.
- [ ] `node e2e/run.cjs`: costruisce una copia privata della PWA (`e2e/tmp/dist`), avvia un server statico (:4180) e il server API di prova (:8798, database temporaneo, codice di accesso in chiaro solo per i test) e lancia gli **11 scenari** in `e2e/scenarios/` (onboarding, emissione e XML, note di credito, immutabilità, numerazione e backup, fattura scartata, comandi vocali testuali, account e sincronizzazione, accessibilità, numero di partenza, regressioni). Opzioni: `--only 02,05`, `--no-build`, `--no-servers`. Esce con 0 se tutti PASS; screenshot e `result.json` in `e2e/out/`. Richiede Playwright con Chromium (non è nelle dipendenze del repository: va installato a parte). Se una porta è già occupata da una sessione precedente il runner la riusa e le prove possono fallire per limiti di richieste. Ultimo esito noto: 11/11 PASS (`docs/QA-REPORT.md`).
- [ ] Controlli di sicurezza del frontend (`docs/SECURITY-FRONTEND.md` §4): `node scripts/audit/serve-with-headers.cjs --check`, `node --test scripts/audit/headers.test.cjs`, `node scripts/audit/csp-hashes.cjs <dist>`, `node scripts/audit/sw-audit.cjs --dist <dist>`.
- [ ] Prove del server: `cd server && npx vitest run test/review` (regressioni della revisione) e `npx tsc -p server --noEmit`.

Prove manuali su dispositivi reali:

- [ ] iPhone con Safari recente (almeno 2 versioni di iOS): installazione "Aggiungi a Home", **microfono** (compreso l'avviso privacy e la trascrizione tramite il nostro server quando l'app è installata), offline, permessi, comportamento dopo il blocco schermo, avviso "È disponibile una nuova versione".
- [ ] Android con Chrome (almeno 2 marche, una economica): installazione, microfono, offline, aggiornamenti.
- [ ] Firefox e altri browser: messaggio chiaro quando la dettatura non è supportata e fallback testuale.
- [ ] Dettatura: 20 frasi tipiche per mestiere (idraulico, elettricista, imbianchino, serramentista) con tasso di errore misurato; con rumore e in dialetto (scheda in `docs/INTERVISTE.md`). Include i comandi vocali con la conferma a pressione prolungata (circa 1 secondo) o con la frase "conferma emissione".
- [ ] Rete debole o assente: creazione preventivo offline, sincronizzazione al ritorno, comportamento al limite Free e `quota_exceeded`; **avvio offline dalla cache del service worker** (mai provato).
- [ ] Archivio del telefono: navigazione privata e spazio quasi pieno (striscia "I dati non vengono salvati" e blocco dell'emissione).
- [ ] Stampa/PDF: apertura su telefono, condivisione via WhatsApp e email, dimensioni; scaricamento di XML, ZIP degli XML e CSV del registro.
- [ ] Accessibilità di base: lettore di schermo, testo grande, contrasto, uso con una mano.
- [ ] Backup: esportazione e ripristino, ripristino rifiutato di un file alterato, "Controlla i dati"; cancellazione account e dati.
- [ ] Cambio telefono con account (compresa la rubrica clienti, che non si sincronizza) e senza account (con backup).
- [ ] Scadenze reali non simulate: 12 giorni dall'operazione e 5 giorni dallo scarto (finestra "Correggi e rinvia").
- [ ] App negli store (solo se si decide di farla): `docs/MOBILE.md` §9 (test su dispositivi), nessun prezzo visibile nell'app nativa, build Android/iOS mai provate.

**Cancello 4**: nessun errore bloccante su 2 iPhone e 2 Android; tasso di errori di dettatura documentato; `scripts/test/all.sh` e `node e2e/run.cjs` verdi sulla versione che si rilascia.

## Blocco 5 - Lancio ristretto (settimane 1-4)

- [ ] Lista di 40 artigiani da contattare (non pubblicare ancora su tutti i canali), dai 5 che hanno fatto il test e dai loro colleghi.
- [ ] Offerta "primi 20" decisa (`docs/GO-TO-MARKET.md`); definire cosa succede dopo i 3 mesi gratuiti e chiarirlo per iscritto.
- [ ] Un modo semplice per segnalare problemi dall'app (email o modulo) e una procedura per raccogliere i dettagli (`docs/FAQ-SUPPORTO.md`, ultima sezione).
- [ ] Registro a mano dei 6 numeri settimanali (sotto); per i numeri lato server `vpadmin stats`.
- [ ] Primi pagamenti reali: ricevuta o fattura emessa a ogni cliente, come stabilito dal commercialista.
- [ ] **Chi ha già emesso fatture altrove**: prima del primo uso fargli impostare l'"ultimo numero già usato" (Profilo, "Numerazione fatture elettroniche") e dirgli di emettere da un solo dispositivo.

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
| Responsabilità su calcoli/fisco | cliente contesta un importo | Termini rivisti, avvisi, assicurazione, registro delle attività, revisione del commercialista |
| Un'XML rifiutata dallo SDI per un difetto dello schema | scarti ripetuti dopo il lancio | blocco del lancio finché non c'è la prova sul portale AdE (Blocco 1); "Correggi e rinvia" per i singoli casi |
| Privacy della voce | dubbi degli utenti | informativa chiara (avviso al primo uso del microfono), scelta del motore, nessuna registrazione dell'audio sui nostri server di default |
| Carico di assistenza | oltre 5 richieste a settimana con meno di 10 clienti | guida in app, manuale e FAQ aggiornati, limitare il Gratis |
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
| 0 | Blocco 0; richieste a commercialista, legale, assicurazione; scarico dello schema XSD |
| 1-2 | 10 interviste, 5 test; Blocco 4 in parallelo; prova delle fatture sul portale AdE |
| 2-3 | Blocchi 1-3 chiusi; dominio e segnaposto |
| 4 | Lancio ristretto ai primi 20 |
| 5-8 | Prova di prezzo, 6 post, rivenditori, feedback a 15 giorni |
| 9-12 | Primi 10 paganti reali oppure decisione sul piano B |

I tempi di commercialista, legale e attivazione di Stripe dipendono da terzi e sono la parte più a rischio di slittamento.
