Ultimo allineamento al codice: 04/11/2026

# App per telefono (Android e iPhone) — guida non tecnica

Stato: la "scatola" nativa (Capacitor) è pronta nella cartella `mobile/`. **Non è mai stata aperta in Android Studio/Xcode né provata su un telefono vero**: nessuna delle cose qui sotto è stata verificata su dispositivo. Tutto ciò che dipende da regole di Apple/Google è da ricontrollare sui loro siti il giorno in cui si procede: marcato **[DA VERIFICARE]**.

## 1. Cos'è e quando conviene farla
L'app dello store è la stessa web app (PWA) racchiusa in un guscio nativo, con in più: microfono/riconoscimento vocale del telefono (italiano), salvataggio/condivisione di PDF e XML, icona e schermata di avvio. Una sola base di codice, nessuna riscrittura.
Secondo `ARCHITECTURE-V2.md` §3.5 conviene farla **dopo** i primi clienti paganti e solo se la PWA non basta (voce su iPhone poco affidabile, clienti che chiedono "dov'è l'app nello store?"). Prima: PWA, costo zero.

## 2. Costi
| Voce | Costo | Note |
|---|---|---|
| Apple Developer Program | 99 $/anno | Obbligatorio per iPhone (anche TestFlight). Se non rinnovato l'app esce dallo store. |
| Google Play Console | 25 $ una tantum | Android. |
| Mac | 0 € | Non serve: la build iOS gira su un computer Apple in cloud (GitHub Actions, workflow `mobile.yml`). I minuti macOS possono costare sui repository privati **[DA VERIFICARE]**. |
| iPhone e telefono Android di prova | variabile | Indispensabili per i test (v. §9). |
| Commissioni Apple/Google | 15–30 % | Solo se gli abbonamenti si vendono dentro l'app (v. §7). |
| Domiciliazione / D-U-N-S | 0 € | Il numero D-U-N-S serve se ci si iscrive come **azienda** (gratuito, richiede giorni/settimane **[DA VERIFICARE]**). Da persona fisica non serve ma nello store comparirà il nome e cognome personali. |

## 3. Decisioni da prendere PRIMA di iniziare (non reversibili)
1. **Identificativo dell'app** (oggi segnaposto `it.example.vocepreventivo`). Una volta pubblicata non si cambia più. Formula: dominio al contrario, es. `it.tuodominio.vocepreventivo`. Va scritto in **tre posti**: `mobile/capacitor.config.ts` (`appId`), e per iOS/Android si rigenerano le cartelle (v. §8) oppure si cambia nelle impostazioni del progetto; più `BUNDLE_ID` in `.github/workflows/mobile.yml`.
2. **Chi è l'editore**: persona fisica o società/ditta (compare nella scheda dello store).
3. **Nome pubblico** ("VocePreventivo" è provvisorio: verificare disponibilità e marchio).
4. Come si vendono gli abbonamenti (v. §7).

## 4. Creare gli account
**Apple** (1–3 giorni, a volte più): 1) un Apple ID con verifica in due passaggi; 2) iscrizione su developer.apple.com/programs come Individuo o Organizzazione (l'organizzazione richiede D-U-N-S e un sito web); 3) pagare 99 $; 4) in App Store Connect creare la scheda app con l'identificativo scelto.
**Google**: 1) account Google dedicato; 2) iscrizione a Play Console, pagare 25 $; 3) verifica dell'identità (documento; per le aziende anche D-U-N-S); 4) i nuovi account **personali** devono fare un test chiuso con un numero minimo di tester per un numero minimo di giorni prima di poter pubblicare in produzione **[DA VERIFICARE: valori attuali]**. Pianificare 2–3 settimane.

## 5. Ottenere chiavi e certificati (una volta sola)
**Android — keystore di firma.** È il "sigillo" dell'app: **se lo perdi non puoi più aggiornarla** (salvo l'opzione Play App Signing, consigliata: Google custodisce la chiave finale e tu usi una chiave di caricamento sostituibile).
`keytool -genkeypair -v -keystore release.jks -alias vocepreventivo -keyalg RSA -keysize 2048 -validity 10000`
Conserva `release.jks` e le password in un gestore di password e in un backup separato. Mai nel repository. Codifica per GitHub: `base64 -w0 release.jks`.
**iOS — certificato e profilo.** In developer.apple.com → Certificates: crea un "Apple Distribution" (serve una richiesta CSR da Mac/`openssl`), esportalo come `.p12` con password; in Profiles crea un profilo "App Store" per l'identificativo dell'app; scarica il `.mobileprovision`. **Chiave API App Store Connect** (per caricare su TestFlight da automatico): App Store Connect → Utenti e accessi → Chiavi → genera chiave con ruolo "App Manager", scarica il `.p8` (si scarica **una sola volta**).
Se non hai un Mac per generare la richiesta del certificato: `openssl` su Linux/Windows funziona (CSR + chiave privata, poi conversione in .p12) — i passaggi esatti sono nella documentazione Apple **[DA VERIFICARE]**.

### Segreti da inserire in GitHub (Settings → Secrets and variables → Actions)
Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
iOS: `APPLE_TEAM_ID`, `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_PROFILE_NAME`, `IOS_KEYCHAIN_PASSWORD` (una password qualsiasi), `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, `APPSTORE_API_PRIVATE_KEY` (contenuto del `.p8`).
Il workflow `.github/workflows/mobile.yml` è **solo manuale** (pulsante "Run workflow"); non parte mai da solo; senza segreti si ferma con un errore chiaro. Android produce un file `.aab` da caricare a mano su Play Console; iOS produce l'`.ipa` e, se spuntato, lo carica su TestFlight. Prima di ogni invio aumentare il numero di versione (iOS: usa il numero dell'esecuzione; Android: `versionCode` in `mobile/android/app/build.gradle` — da incrementare a mano, **non** ancora automatizzato).

## 6. Schede store, immagini e dichiarazioni
Testi pronti in italiano: `docs/store/` (`scheda-store.md`, `privacy-etichette.md`, `note-revisione.md`).
**Screenshot da produrre** (con dati di esempio, mai clienti reali):
- iPhone 6,9" (1320×2868) e 6,5" (1284×2778): minimo 3, meglio 5–6; iPad solo se si dichiara il supporto iPad.
- Android telefono (min. 2, lato 320–3840 px); icona 512×512; immagine in evidenza 1024×500.
Sequenza consigliata: 1) dettatura "rifare il bagno…" con testo riconosciuto; 2) preventivo con totali; 3) trasformazione in fattura; 4) validazione ed esportazione XML; 5) catalogo prezzi; 6) PDF condiviso su WhatsApp.
**Privacy:** i moduli "Etichette di privacy" (Apple) e "Sicurezza dei dati" (Google) devono essere coerenti con `docs/privacy/` e `public/legal/privacy.html`: bozza in `docs/store/privacy-etichette.md`. Serve un **URL pubblico dell'informativa privacy** e un indirizzo di assistenza.
**Età/categoria:** categoria Business (Apple) / Aziende o Produttività (Google); classificazione età: nessun contenuto sensibile (4+ / PEGI 3). Dichiarare "nessuna pubblicità", "nessun accesso a posizione/contatti/foto".
Esportazione crittografia (iOS): l'app usa solo HTTPS standard → `ITSAppUsesNonExemptEncryption=false` già impostato.

## 7. Abbonamenti e regole Apple/Google (il punto più rischioso)
Apple (linea guida 3.1.1) richiede in generale **In-App Purchase** (commissione 15–30 %) per beni e servizi digitali venduti **dentro** l'app; Google Play ha una regola analoga (sistema di fatturazione Play). Le regole su link e pagamenti esterni sono cambiate negli ultimi anni e **differiscono per paese** (USA, UE/DMA, altri) **[DA VERIFICARE sul testo corrente]**. Opzioni:
| Opzione | Come funziona | Pro | Contro / rischio |
|---|---|---|---|
| A. **App "reader-style" / solo accesso** | Il Pro si compra solo dal sito; l'app permette solo di accedere con l'account. Nell'app: nessun prezzo, nessun pulsante o link per acquistare, nessun invito a "passare a Pro sul sito". Se si raggiunge il limite Free: messaggio neutro ("Limite del piano raggiunto") | Nessuna commissione, semplice | Esperienza di upgrade scadente; Apple può contestare se l'app non rientra nelle categorie ammesse per i "servizi multipiattaforma" (che dipendono dal tipo di app) **[DA VERIFICARE]**; rischio di respingimento 3.1.1/3.1.3. Evitare qualsiasi riferimento ai prezzi nell'app e nelle schermate di revisione. |
| B. **In-App Purchase / Play Billing** | Si vende il Pro nell'app con plugin di acquisti (es. RevenueCat) | Conforme, esperienza fluida | 15–30 % di commissione (15 % per piccoli sviluppatori in programmi dedicati **[DA VERIFICARE]**); lavoro in più (plugin acquisti, prezzi per paese, ripristino acquisti, sincronizzazione con Stripe); doppia gestione fiscale |
| C. **Link esterno consentito** (dove le regole lo permettono, es. USA/UE) | Nell'app c'è un link al sito per abbonarsi | Un solo flusso | Dipende da regole mutevoli e dal paese; possibili commissioni sui link in alcuni casi **[DA VERIFICARE]**; non valido ovunque |
| D. **Solo app Android + PWA su iPhone** | Si rinuncia allo store Apple | Nessun rischio Apple | Si perde la voce nativa iOS (il motivo principale dell'app) |
**Raccomandazione per partire:** opzione A su iPhone (solo accesso; piano Free usabile ed evidenziato nelle note per il revisore), vendere il Pro dal sito; su Android lo stesso, per uniformità. Prevedere di passare a B se Apple respinge. Lo stesso criterio vale per ogni testo nell'app (nessun "Passa a Pro" nella versione nativa: va nascosto quando `Capacitor.isNativePlatform()`; **modifica UI da fare, non è stata fatta**).

> **CHIUSO il 04/11/2026 (verifica sul codice).** Nascondere prezzi e «Passa a Pro» nell'app nativa è fatto: `isNativeApp()` in `src/billing/platform.ts` (basato su `window.Capacitor.isNativePlatform`) è usato da `src/billing/LimitGate.tsx` (nel nativo nessun prezzo né pulsante d'acquisto), `src/pages/account/AccountView.tsx` (nel nativo «Gestisci il tuo abbonamento dal sito» al posto di prezzi e «Passa a Pro»), `src/pages/LandingPage.tsx` (blocco prezzi solo con `!isNativeApp()`) e `src/pages/account/ConflictList.tsx` (pulsante «Passa a Pro» solo con `!native`). Voce nativa collegata: `src/voice/provider/factory.ts` sceglie `NativeSpeechProvider` (`src/voice/provider/native.ts`) quando c'è il bridge Capacitor. Download/condivisione nativi: `downloadBlob` in `src/pages/quote/shared.ts` usa la condivisione nativa. Nessuna di queste parti è stata provata su un telefono: resta valido il §10.

**Linea guida 4.2 (app web racchiuse)**: Apple respinge le app che sono solo un sito. Cosa mostra "valore nativo": voce con riconoscimento nativo, salvataggio/condivisione file, funzionamento offline, icone e schermata di avvio curate. Nelle note per il revisore spiegare che l'app funziona offline e usa microfono e condivisione di file. Rischio medio comunque.
**Altre cause di respingimento da prevenire:** account di prova per il revisore (email+password già attive, con dati d'esempio) e un server online; informativa privacy raggiungibile; testi dei permessi chiari (già in italiano); funzione di **cancellazione account dentro l'app** (Apple la richiede se si può creare un account: 5.1.1(v) **[DA VERIFICARE]** che esista nell'app); nessun crash all'avvio senza rete.

## 8. Come si costruisce (per chi lo fa)
Cartella `mobile/` (progetto separato, non tocca la web app). Prerequisito: `npm run build` nella radice (crea `dist`).
```
cd mobile && npm install
npm run build:web          # build della PWA in ../dist
npm run assets             # icone e splash da public/icon.svg
npx cap sync               # copia dist e plugin nei progetti nativi
npm run patch:native       # permessi microfono (IT), solo se rigeneri android/ios
npx cap open android       # apre Android Studio  | npx cap open ios -> Xcode (solo su Mac)
```
Le cartelle `android/` e `ios/` sono già generate (`cap add` funziona senza SDK) e committabili. Per cambiare identificativo: modificare `appId` e rigenerare (`rm -rf android ios && npx cap add android && npx cap add ios && npm run patch:native && npm run assets`).
**API assoluta e CORS (obbligatori).** Dentro la WebView il percorso relativo `/v1` non funziona: la build per le app va fatta con `VITE_API_URL` assoluto, e il server deve ammettere le origini native:
```
VITE_API_URL=https://[DOMINIO]/v1 npm run build:web      # [DOMINIO] = il tuo dominio
npx cap sync
VITE_API_URL=https://[DOMINIO]/v1 npm run patch:native   # inietta la CSP nell'index.html nativo
```
Sul server: `CORS_ORIGINS=capacitor://localhost,https://localhost,https://[DOMINIO]` (già negli esempi `infra/*.env.example` e nel compose; vedi `docs/DEPLOY.md`).
`patch:native` (da lanciare dopo `cap sync`, che ricopia `dist`) aggiunge all'`index.html` di `android/` e `ios/` una `<meta http-equiv="Content-Security-Policy">` coerente con la CSP del Caddyfile: niente `unsafe-inline`/`unsafe-eval`, stili inline ammessi per hash, `connect-src 'self'` + l'origine dell'API. È idempotente; senza `VITE_API_URL` assoluto (o `--api-url=...`) si ferma con errore. Prova su una copia: `node --test mobile/scripts/csp.test.mjs`. Nell'app nativa il service worker non serve (i file sono locali): l'app si aggiorna con le versioni dello store. Download/condivisione file: `mobile/src-bridge/FILES.md`.

## 9. Checklist di test su dispositivi reali
Servono almeno: 1 Android recente, 1 Android vecchio/economico (Android 8–10), 1 iPhone con ultimo iOS, idealmente 1 iPhone con iOS di 2 versioni fa.
- [ ] Installazione pulita; primo avvio: schermata di avvio, nessuna schermata bianca
- [ ] Prima pressione del microfono: compare il permesso con testo italiano; dopo "Non consentire" il messaggio spiega come riabilitarlo
- [ ] Dettatura in italiano: "rifare il bagno trenta metri quadri…"; numeri, euro, decimali; rumore di cantiere
- [ ] Riconoscimento con rete assente e con rete debole (messaggio comprensibile)
- [ ] Comando irreversibile ("emetti fattura"): la scheda di conferma blocca davvero; pressione prolungata funziona
- [ ] Creare preventivo → fattura → XML valido; condividere PDF e XML via WhatsApp, Mail, "Salva su File"
- [ ] Modalità aereo: l'app si apre e funziona offline; ripresa della sincronizzazione al ritorno rete
- [ ] Accesso/uscita account; il token non sopravvive alla disinstallazione; cancellazione account
- [ ] Rotazione schermo, tastiera che copre i campi, notch/Dynamic Island, tema scuro, testo grande
- [ ] Interruzioni: telefonata durante la dettatura, passaggio in background, blocco schermo
- [ ] Aggiornamento da versione precedente (dati IndexedDB conservati)
- [ ] Nessun prezzo o invito all'acquisto visibile (opzione A)
- [ ] Batteria/memoria: 15 minuti di uso continuo senza surriscaldamento

## 10. Cosa NON è stato provato
Build Android (Gradle/SDK), build/archive iOS (Xcode), esecuzione dei plugin su telefono, qualità del riconoscimento `it-IT` (e se funziona offline), flussi di firma e di caricamento, i workflow GitHub, le regole degli store. Verificato: `cap add android/ios` e `cap sync` senza SDK, patch dei permessi, generazione icone/splash, test unitari dell'adattatore voce con bridge simulato, `tsc` della web app.
