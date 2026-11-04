# PWA: installazione, aggiornamenti e avviso privacy sulla voce

## 1. Installazione
VocePreventivo è una PWA: si apre dal browser all'indirizzo del sito e si può installare (Android/Chrome: "Installa app" o "Aggiungi a schermata Home"; iPhone/Safari: Condividi, poi "Aggiungi a Home"). Dopo il primo caricamento funziona anche senza rete: il service worker (`public/sw.js`, versione `v3`) salva la shell dell'app e le pagine legali; **non** salva mai le chiamate all'API (`/v1/*`). I dati dell'utente stanno nel dispositivo (IndexedDB e bozze in localStorage), non nel service worker.

## 2. Come arrivano gli aggiornamenti
1. Dopo un deploy il file `sw.js` cambia (Caddy lo serve sempre senza cache). Il browser lo controlla ad ogni apertura; l'app lo ricontrolla **ogni ora** e **quando torna in primo piano** (`src/pwa/updater.ts`).
2. Il nuovo worker si installa in background (`sw.js` v3 fa `skipWaiting` e `clients.claim`: prende subito il controllo, ma **non ricarica** le pagine aperte; gli asset della versione vecchia restano in cache, quindi la sessione in corso non si rompe).
3. L'app mostra l'avviso `UpdatePrompt`: **«È disponibile una nuova versione»** con **Aggiorna ora** e **Più tardi**. Non ricarica mai da sola.
4. **Aggiorna ora**: se non c'è nessun lavoro in corso la pagina si ricarica subito. Se c'è (vedi sotto) l'avviso diventa «L'aggiornamento partirà appena hai finito» e la pagina si ricarica da sola appena tutto è libero. **Più tardi** nasconde l'avviso fino alla prossima nuova versione.
5. Se il browser tiene in attesa un worker (`registration.waiting`), l'app gli manda `{type:'SKIP_WAITING'}` (già gestito da `sw.js`) e ricarica dopo `controllerchange`.

Errori (registrazione, rete assente, controllo fallito) sono silenziosi: al massimo un `console.debug`; l'app non si blocca.

### Lavori in corso: `registerBusy` / `unregisterBusy`
`src/pwa/busy.ts` è un registro di operazioni che non vanno interrotte da un ricaricamento. Chi le avvia deve registrarle e liberarle sempre (anche in caso di errore):
```ts
import { registerBusy, unregisterBusy } from '../pwa/busy';
registerBusy('invoice-issue');
try { await issueInvoice(id); } finally { unregisterBusy('invoice-issue'); }
```
Chiavi consigliate: `invoice-issue` (emissione fattura/nota di credito: **mai** aggiornare durante), `doc-dirty:<id>` (documento con modifiche non salvate: registrare alla prima modifica, liberare dopo il salvataggio o l'uscita), `hold-confirm` (pressione prolungata di conferma in corso), `sync`, `backup-import`. Le registrazioni sono conteggiate. **Stato attuale:** il registro e l'avviso sono pronti, ma i moduli che emettono fatture, editano documenti o gestiscono la pressione prolungata (UI-FATTURE, VOCE) devono ancora chiamare `registerBusy`; finché non lo fanno l'avviso non sa che c'è un lavoro in corso. Anche in quel caso le bozze sono già salvate in localStorage.

## 3. Montare `UpdatePrompt` in `src/App.tsx`
La registrazione è già in `src/main.tsx`. Resta da montare il componente (una sola volta, fuori dalle rotte, ad es. accanto a `StorageBanner`):
```tsx
import { UpdatePrompt } from './pwa/UpdatePrompt';
// dentro il JSX di App, a livello radice:
<UpdatePrompt />
```
Il componente non riceve props, usa `role="status"` + `aria-live="polite"`, è fissato in basso (rispetta le aree sicure di iPhone), non rende nulla finché non c'è una nuova versione o se il browser non supporta i service worker. Stili in `src/pwa/UpdatePrompt.css` (variabili `--c-surface`, `--c-text`, `--c-primary`, `--c-on-primary` con valori di riserva).

## 4. Provare un aggiornamento in locale
Il service worker si registra solo in produzione (`import.meta.env.PROD`).
1. `npx vite build && npx vite preview --port 4173` e aprire `http://localhost:4173` (localhost è ammesso per i service worker). Ricaricare una volta: ora l'app è controllata dal worker.
2. In un altro terminale cambiare `VERSION` in `public/sw.js` (es. `'v3-prova'`) **solo nella copia di prova** (non committare), rifare `npx vite build` (il `preview` serve i nuovi file).
3. Nella scheda aperta: DevTools > Application > Service Workers > "Update" (oppure cambiare scheda e tornare). Deve comparire «È disponibile una nuova versione».
4. Prova del blocco "lavoro in corso": coperta da `npx vitest run src/pwa` (service worker finto: lavoro in corso, "Più tardi", errori, controllo periodico).
5. Ripristinare `public/sw.js`.

## 5. Dettatura: avviso privacy da mostrare al primo uso del microfono
La Web Speech API del browser (Chrome, Edge, Safari) può inviare l'audio al **fornitore del browser** (ad es. Google in Chrome, Apple in Safari) per trasformarlo in testo: l'app non può impedirlo né vederlo. Va detto all'utente **prima** del primo uso del microfono, con una conferma. Testo proposto (da mostrare una volta, memorizzando la scelta in localStorage; ripetibile da Impostazioni/Info):

> **Dettatura vocale e privacy**
> Per riconoscere la tua voce, il browser può inviare l'audio al suo fornitore (ad esempio Google su Chrome, Apple su Safari), che lo elabora secondo la propria informativa. VocePreventivo non registra né conserva l'audio. Se preferisci, puoi scrivere il testo con la tastiera: il resto dell'app funziona uguale.
> [Continua con il microfono]  [Scrivo a mano]

Nell'app nativa il testo cambia: il riconoscimento è quello del telefono (su iPhone l'audio può essere elaborato da Apple, già dichiarato nel permesso di sistema `NSSpeechRecognitionUsageDescription`) e la trascrizione tramite il nostro server (`/v1/voice/transcribe`), se attivata, va dichiarata nell'informativa privacy (`public/legal/privacy.html`, `docs/privacy/`).
**Modifica minima proposta (non fatta qui):** nel widget voce (`src/voice/ui/VoiceCommandWidget.tsx`, di VOCE) prima di avviare il riconoscimento dal provider Web Speech (`src/voice/provider/webSpeechProvider.ts`): se `localStorage['vp.voicePrivacyAck']` non è `'1'`, aprire una finestra con il testo sopra e avviare il microfono solo dopo «Continua» (che scrive il flag); con «Scrivo a mano» si apre il campo di testo. Da verificare con il legale (LEGALE) che l'informativa riporti la stessa dicitura.
