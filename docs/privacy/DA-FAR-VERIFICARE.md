# Affermazioni legali/fiscali incerte — da far verificare a legale e commercialista

Tutti i documenti in `public/legal/` e `docs/privacy/` sono **BOZZE** non redatte da un avvocato. Questa lista raccoglie ciò che è incerto o assunto. Fonti fiscali dell'app = secondarie (`docs/FISCAL-SPEC.md`, §0 e §8). Segnaposto da compilare: [RAGIONE SOCIALE] [P.IVA] [EMAIL] [PEC] [SEDE] [DATA].

## A. Per il legale / consulente privacy
1. **Ruoli**: noi titolari per i dati dell'account; **responsabili art. 28** per i dati dei clienti degli artigiani. Confermare la qualificazione e che l'accettazione "a clic" del DPA con versione/timestamp sia sufficiente (forma scritta, anche elettronica).
2. **Stripe**: titolare autonomo o responsabile? Quali termini/DPA applicare? Dove trattano i dati?
3. **Basi giuridiche** elencate nella privacy (6.1.b, 6.1.c, 6.1.f) e test di bilanciamento per sicurezza/log e audit di accettazione.
4. **Trasferimenti extra-UE**: stato attuale del Data Privacy Framework (UE-USA), SCC, per Stripe, email transazionale, STT, browser. Possibile data residency UE per l'STT.
5. **Audio**: dettatura del browser (titolari autonomi Google/Apple) vs trascrizione sui nostri server tramite STT: ruolo, informativa, zero retention, assenza di addestramento; serve consenso/informazione specifica?
6. **DPIA** non obbligatoria (ipotesi in `CHECKLIST-GDPR.md`) e **DPO** non obbligatorio.
7. **Registro dei trattamenti**: obbligo/esenzione (art. 30.5) per noi come titolare e come responsabile.
8. **Cookie / strumenti tecnici**: conferma che storage tecnico (IndexedDB, localStorage, service worker, token di sessione) non richieda banner/consenso; cookie di Stripe nelle pagine di pagamento.
9. **Termini per i tempi di conservazione**: [N] giorni per cancellazione, log, backup, richieste di assistenza; durata di conservazione dell'audit di accettazione.
10. **Notifica data breach**: termini del DPA verso gli artigiani ([24/48] ore) e coordinamento con le 72 ore del titolare.
11. **Consumatori**: recesso 14 giorni e richiamo al Codice del Consumo (articolo non verificato nel testo; la bozza dei Termini non cita numeri di articolo), clausole vessatorie (doppia approvazione specifica ove richiesta), foro competente, piattaforma ODR (se ancora attiva).
12. **Limitazione di responsabilità** (tetto = importo pagato negli ultimi 12 mesi, esclusione sanzioni fiscali) e sua validità verso professionisti e consumatori.
13. **Quota Free**: definizione di "documento" nei Termini; comportamento al raggiungimento del limite.
14. **Rinnovo automatico, prezzi, IVA** indicata (inclusa/esclusa), obblighi informativi di legge sugli abbonamenti online.
15. **Fair use** del piano Pro.
16. **Cancellazione account vs fatture emesse**: archivio ristretto o restituzione; termine; base (art. 17.3.b).
17. **Autorizzazione generale ai sub-responsabili** con preavviso di [30] giorni e diritto di opposizione/recesso.
18. **Audit**: modalità, frequenza, costi.
19. **Obbligo di informare i clienti finali**: spetta all'artigiano; valutare se offrire un testo-tipo.
20. **Dati dei minori / dati particolari**: divieto di inserirli; verificare l'adeguatezza.

## B. Per il commercialista
1. Il documento "fattura elettronica" per forfettari: l'app genera l'XML ma **non lo trasmette**; corretta la formula "Una fattura non trasmessa allo SDI non è emessa a fini fiscali"?
2. **Conservazione**: 10 anni; servizio gratuito AdE (durata/condizioni discordanti nelle fonti: 10 vs 15 anni; adesione); l'app **non** è conservatore a norma — corretta la formulazione nei Termini?
3. Codici e regole XML (RF19, N2.2, TD01/TD04), dicitura forfettario e riferimento normativo, bollo da 2 € sopra la soglia, bollo su note di credito e preventivi (vedi `docs/FISCAL-SPEC.md` §7.2).
4. **Termini di emissione** (12 giorni), scarto SDI e rinvio con stesso numero/data entro 5 giorni, mancata consegna.
5. Numerazione per anno e sezionale FT/NC; collisione con più dispositivi offline.
6. Responsabilità dell'utente per sanzioni e correttezza; adeguatezza del disclaimer (`FISCAL-SPEC.md` §7.3) e del checkbox di emissione.
7. Soglie del regime forfettario e uso dell'app da parte di chi esce dal regime.
8. **Conservazione dei nostri dati di fatturazione** (abbonamenti): periodi e obblighi contabili/fiscali; trattamento IVA dei nostri prezzi (B2B/B2C, e-commerce).
9. Se offrire "archivio ristretto" delle fatture altrui ci configuri come conservatore o comporti obblighi ulteriori.
10. Claim di marketing sulla landing: "genera l'XML della fattura elettronica per forfettari", nessuna promessa di conformità.

## C. Placeholder tecnici da decidere
Fornitori (hosting UE, backup, email, STT), data center, periodi di conservazione, RPO/RTO, durata sessioni, SLA, foro.
