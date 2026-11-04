# Licenze delle dipendenze di terze parti

> Inventario tecnico generato da `scripts/audit/gen-licenses.cjs` (legge `package-lock.json` e i `package.json` in `node_modules` di root, `server/` e `mobile/`) il 2026-11-04.
> **Non è consulenza legale.** Le note sulle conseguenze delle licenze sono spiegazioni generali e semplificate: tutto ciò che è marcato **[DA VERIFICARE CON UN LEGALE]** va controllato da un avvocato prima del lancio commerciale.
> Si rigenera con `node scripts/audit/gen-licenses.cjs` (tabelle) e `node scripts/audit/gen-licenses.cjs --notices <file.txt>` (testo completo degli avvisi, vedi §5).

## 1. Sintesi

- **Dipendenze di produzione** (cioè quelle che finiscono nell'app o nel server): root/PWA 33 pacchetti, server 32 (di cui 24 binari opzionali di esbuild per piattaforma), mobile 14. Totale pacchetti distinti distribuiti agli utenti (PWA + app nativa): 47.
- **Nessuna licenza GPL, AGPL o LGPL tra le dipendenze di produzione.** Le licenze sono quasi tutte permissive (MIT, ISC, 0BSD, Apache-2.0, Zlib).
- **Da guardare** (una sola licenza copyleft "debole" in produzione, due casi anomali):

| Pacchetto | Dove | Licenza | Perché va guardato |
|---|---|---|---|
| `@capgo/capacitor-speech-recognition` 8.4.6 | app nativa (mobile) | **MPL-2.0** | copyleft a livello di file, vedi §3.1 |
| `dompurify` 3.4.17 | PWA (caricato solo a richiesta, tramite jsPDF) | **MPL-2.0 OR Apache-2.0** (doppia licenza) | si sceglie Apache-2.0: nessun problema, ma va dichiarato, vedi §3.2 |
| `rgbcolor` 1.0.1 | PWA (stesso percorso: jsPDF → canvg) | "MIT OR SEE LICENSE IN FEEL-FREE.md" | licenza non standard, testo informale, vedi §3.3 |

- **Solo strumenti di sviluppo (NON distribuiti agli utenti)**, quindi senza obblighi di attribuzione per il prodotto: `lightningcss` (MPL-2.0, usato da Vite per compilare il CSS), `@img/sharp-libvips-*` (LGPL-3.0-or-later, dentro `sharp`, usato solo da `mobile/scripts/make-assets.mjs` per generare le icone). Finché restano sulla macchina di build e non entrano nell'app non creano obblighi; **[DA VERIFICARE CON UN LEGALE]** solo se un giorno si distribuisse una build che li include.
- **Non coperto da questo inventario**: le librerie *native* che Gradle (Android) e CocoaPods/SwiftPM (iOS) scaricano al momento della build dell'app (es. AndroidX, Capacitor nativo) e i servizi di sistema usati dal riconoscimento vocale (Google/Apple). Vanno inventariati quando esisteranno le cartelle native definitive (`mobile/android`, `mobile/ios`) con i report dei rispettivi strumenti (es. il plugin Gradle delle licenze). Anche **font, icone, immagini e testi** del sito non sono inclusi: l'app usa i font di sistema (`font-src 'self'` e nessun file font in `dist`), le icone sono proprie (`public/icon.svg`).

## 2. Cosa significano le licenze presenti (in parole semplici)

| Licenza | Cosa permette | Cosa chiede |
|---|---|---|
| MIT, ISC, 0BSD, BSD | Usare, modificare, vendere in un prodotto chiuso | MIT/ISC/BSD: tenere l'avviso di copyright e il testo della licenza insieme al prodotto (bastano le "Informazioni legali"). 0BSD: nulla |
| Apache-2.0 | Come sopra, più una concessione esplicita dei brevetti | Avviso di copyright + testo della licenza + eventuale file NOTICE; indicare le modifiche fatte ai file |
| Zlib (con pako: "MIT AND Zlib") | Uso libero, anche commerciale | Non dichiarare di aver scritto tu il software originale; le versioni modificate vanno indicate come tali |
| **MPL-2.0** | Uso anche commerciale, anche dentro un prodotto chiuso | È un copyleft "debole", **a livello di singolo file** (vedi sotto) |
| LGPL / GPL / AGPL | (non presenti in produzione) | Obblighi molto più pesanti (GPL/AGPL: rischio di dover aprire anche il codice proprio). Se ne comparisse una in produzione: **stop e verifica legale** |

## 3. Casi da trattare con attenzione

### 3.1 `@capgo/capacitor-speech-recognition` — MPL-2.0 (app nativa) **[DA VERIFICARE CON UN LEGALE]**

- **In parole semplici**: puoi usare il plugin dentro un'app a pagamento e a sorgente chiuso. Il vincolo riguarda **solo i file di quel plugin**: se li *modifichi* e distribuisci l'app, devi rendere disponibile il sorgente *di quei file modificati* (con la stessa licenza MPL). Il resto del codice di VocePreventivo resta tuo e chiuso.
- **Se si usa senza modifiche** (situazione attuale): nella pratica bastano l'avviso di licenza e un'indicazione di dove ottenere il sorgente del plugin (il suo repository pubblico o la versione npm 8.4.6).
- **Cose da non fare**: copiare codice del plugin nei propri file; applicare patch locali (`patch-package`) senza metterle a disposizione.
- **Da chiarire con un legale**: come la MPL-2.0 si concilia con la distribuzione tramite App Store/Play Store (le condizioni degli store aggiungono limiti ai destinatari), e se il testo "dove ottenere il sorgente" nell'app è sufficiente.
- **Alternativa se non si vuole il tema**: usare il riconoscimento vocale del browser nella PWA (già presente) o un altro plugin con licenza permissiva.

### 3.2 `dompurify` — "MPL-2.0 OR Apache-2.0"

È una **doppia licenza a scelta**. Si dichiara di usarlo sotto **Apache-2.0** (permissiva) e si evita ogni discorso sulla MPL. Arriva come dipendenza *opzionale* di jsPDF, in un file caricato solo se il codice chiama `doc.html()` (che l'app non usa). **[DA VERIFICARE CON UN LEGALE]** soltanto se si volesse dichiarare la MPL.

### 3.3 `rgbcolor` — "MIT OR SEE LICENSE IN FEEL-FREE.md" **[DA VERIFICARE CON UN LEGALE]**

Il pacchetto dichiara MIT, ma il file allegato (`FEEL-FREE.md`) è un permesso informale dell'autore ("Feel free to use the code for your own color picker tool or whatever you like"), non una licenza standard. Arriva da jsPDF → canvg (rendering di SVG, non usato dall'app) ed è presente come file nel pacchetto distribuito (`dist/assets/index.es-*.js`). Rischio pratico basso, ma l'ambiguità va risolta: o si conferma l'opzione MIT, o si evita il pacchetto (vedi `docs/DIPENDENZE.md`, "dipendenze non usate/da alleggerire").

### 3.4 Altre osservazioni

- `stackblur-canvas` 2.7.0 (MIT) è distribuito **senza file LICENSE**: la licenza è solo nel campo `license` del `package.json`. L'avviso di copyright va ricostruito dal repository del pacchetto.
- Gli avvisi delle librerie incluse a runtime nel server (hono, zod, tsx, esbuild, ...) non vanno mostrati agli utenti finali perché il server non viene distribuito; vanno comunque mantenuti se si consegna il codice a terzi.
- Il pacchetto `core-js` (MIT) è opzionale (jsPDF → canvg) e non entra nel bundle.

## 4. Inventario completo delle dipendenze di produzione


### PWA (browser)

| Pacchetto | Versione | Licenza | Diretta | Note |
|---|---|---|---|---|
| @babel/runtime | 7.29.13 | MIT |  |  |
| @types/pako | 2.0.4 | MIT |  |  |
| @types/raf | 3.4.3 | MIT |  | opzionale |
| @types/trusted-types | 2.0.7 | MIT |  | opzionale |
| base64-arraybuffer | 1.0.2 | MIT |  | opzionale |
| canvg | 3.0.11 | MIT |  | opzionale |
| cookie | 1.1.1 | MIT |  |  |
| core-js | 3.51.0 | MIT |  | opzionale |
| css-line-break | 2.1.0 | MIT |  | opzionale |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) |  | opzionale |
| fast-png | 6.4.0 | MIT |  |  |
| fflate | 0.8.3 | MIT |  |  |
| fuse.js | 7.5.0 | Apache-2.0 | sì |  |
| html2canvas | 1.4.1 | MIT |  | opzionale |
| idb | 8.0.4 | ISC | sì |  |
| iobuffer | 5.4.0 | MIT |  |  |
| jspdf | 4.2.1 | MIT | sì |  |
| jspdf-autotable | 5.0.9 | MIT | sì |  |
| pako | 2.2.0 | (MIT AND Zlib) |  |  |
| performance-now | 2.1.0 | MIT |  | opzionale |
| raf | 3.4.1 | MIT |  | opzionale |
| react | 19.3.1 | MIT | sì |  |
| react-dom | 19.3.1 | MIT | sì |  |
| react-router | 7.18.5 | MIT |  |  |
| react-router-dom | 7.18.5 | MIT | sì |  |
| regenerator-runtime | 0.13.11 | MIT |  | opzionale |
| rgbcolor | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md |  | opzionale |
| scheduler | 0.28.0 | MIT |  |  |
| set-cookie-parser | 2.7.3 | MIT |  |  |
| stackblur-canvas | 2.7.0 | MIT |  | opzionale, senza file LICENSE |
| svg-pathdata | 6.0.3 | MIT |  | opzionale |
| text-segmentation | 1.0.3 | MIT |  | opzionale |
| utrie | 1.0.2 | MIT |  | opzionale |

### Server API

| Pacchetto | Versione | Licenza | Diretta | Note |
|---|---|---|---|---|
| @hono/node-server | 2.1.6 | MIT | sì |  |
| esbuild | 0.28.2 | MIT |  |  |
| fsevents | 2.3.3 | MIT |  | opzionale |
| hono | 4.13.16 | MIT | sì |  |
| tsx | 4.23.15 | MIT | sì |  |
| zod | 4.6.7 | MIT | sì |  |
| @esbuild/* (26 binari per piattaforma di esbuild) | 0.28.2 | MIT |  | opzionali: se ne installa uno solo |

### App nativa (Capacitor)

| Pacchetto | Versione | Licenza | Diretta | Note |
|---|---|---|---|---|
| @aparajita/capacitor-secure-storage | 8.0.1 | MIT | sì |  |
| @capacitor/android | 8.6.0 | MIT |  |  |
| @capacitor/app | 8.1.2 | MIT | sì |  |
| @capacitor/core | 8.6.0 | MIT | sì |  |
| @capacitor/filesystem | 8.1.5 | MIT | sì |  |
| @capacitor/ios | 8.6.0 | MIT |  |  |
| @capacitor/keyboard | 8.0.6 | MIT |  |  |
| @capacitor/preferences | 8.0.1 | MIT | sì |  |
| @capacitor/share | 8.0.3 | MIT | sì |  |
| @capacitor/splash-screen | 8.0.2 | MIT | sì |  |
| @capacitor/status-bar | 8.0.4 | MIT | sì |  |
| @capacitor/synapse | 1.0.4 | ISC |  |  |
| @capgo/capacitor-speech-recognition | 8.4.6 | MPL-2.0 | sì |  |
| tslib | 2.9.1 | 0BSD |  |  |


Le righe "opzionale" sono dipendenze opzionali dei pacchetti padre (jsPDF per la PWA): npm le installa, ma sono caricate solo se il padre le richiama.

## 5. Testo da mostrare nell'app e sul sito

### 5.1 Pagina "Informazioni legali → Licenze di terze parti" (testo breve)

> **Software di terze parti**
> VocePreventivo è costruito con software libero e open source. Ringraziamo gli autori. Le librerie principali sono: React (MIT, Meta Platforms), React Router (MIT, Remix Software e React Training), jsPDF e jspdf-autotable (MIT), idb (ISC, Jake Archibald), fflate (MIT), pako (MIT e Zlib), DOMPurify (utilizzato sotto licenza Apache-2.0) e, nell'app per smartphone, Capacitor (MIT, Ionic/OutSystems), il plugin di archiviazione sicura di Aparajita Fishman (MIT) e il plugin di riconoscimento vocale di Capgo / Martin Donadieu (Mozilla Public License 2.0, codice sorgente: https://github.com/Cap-go/capacitor-speech-recognition).
> Ogni libreria resta di proprietà dei rispettivi autori ed è usata secondo la propria licenza. L'elenco completo, con versioni e testi delle licenze, è disponibile qui: **Licenze complete** (apre `/legal/licenze-terze-parti.txt`).

### 5.2 File completo degli avvisi (`/legal/licenze-terze-parti.txt`)

Si genera con `node scripts/audit/gen-licenses.cjs --notices public/legal/licenze-terze-parti.txt` (47 pacchetti della PWA e dell'app nativa, circa 90 KB, con nome, versione, licenza, titolare e testo della licenza di ciascuno). Va rigenerato a ogni aggiornamento delle dipendenze e a ogni release; l'app nativa deve includerlo (o linkarlo) nelle "Informazioni". La cartella `public/legal/` appartiene all'agente LEGALE: il file non è stato creato lì (fuori dal perimetro di questo lavoro).

### 5.3 Frase per termini d'uso / sito

> Il software di terze parti incluso in VocePreventivo è soggetto alle rispettive licenze, indicate nella pagina "Licenze di terze parti". Nessuna di queste licenze limita il tuo uso del servizio. Il nome e il logo VocePreventivo non sono concessi in licenza.

## 6. Cose da fare prima del lancio

1. Far rivedere a un legale §3.1 (MPL-2.0 e store), §3.3 (rgbcolor) e la frase 5.3. **[DA VERIFICARE CON UN LEGALE]**
2. Aggiungere `licenze-terze-parti.txt` alle pagine legali (agente LEGALE) e linkarlo da Informazioni.
3. Rigenerare l'inventario quando si cambiano dipendenze; aggiungere alla CI un controllo che fallisca se compare una licenza GPL/AGPL/LGPL in produzione (basta filtrare l'output di `gen-licenses.cjs --json`).
4. Inventariare le librerie native (Gradle/CocoaPods) quando le cartelle `mobile/android` e `mobile/ios` saranno definitive.
