# CONTRATTO V2 — leggere PRIMA di scrivere codice (tutti gli agenti)

Fonti da leggere secondo il proprio compito: `docs/FISCAL-SPEC.md` (fisco/XML), `docs/ARCHITECTURE-V2.md` (backend, sync, voce, sicurezza), `shared/types.ts`, `shared/api.ts`.
Fonti fiscali = **secondarie, DA VERIFICARE** da un commercialista (lo vedrà a programma finito). Non presentare mai come certo ciò che non lo è.

## Regole di squadra
1. **Una cartella = un proprietario.** Tocca SOLO i tuoi file (tabella sotto). Non modificare `package.json` root, `server/package.json`, `shared/types.ts`, `shared/api.ts`, `vite.config.ts`, `tsconfig*.json`: se ti serve una dipendenza o un campo, segnalalo nel report finale (non fare `npm i` nella root; per `server/` le dipendenze base sono già installate: hono, @hono/node-server, zod, tsx, vitest — se serve altro, scrivilo con `npm i <pkg>` SOLO dentro `server/` e solo se indispensabile, e dichiaralo nel report).
2. **NON fare `git add/commit/push` e NON usare `git stash`, `git checkout -- `, `git reset`, `git clean` o qualsiasi comando che tocchi l'albero di lavoro condiviso** (altri agenti lavorano negli stessi file in questo momento: uno stash li fa sparire per qualche secondo e può rompere il loro lavoro). Per confronti usa `git diff`, `git show HEAD:<file>` o copie nello scratchpad. Il commit lo fa il coordinatore.
3. **Firme fisse**: gli stub esistenti (`shared/fatturapa/index.ts`, `src/storage/invoices.ts`, router in `server/src/*/routes.ts`) vanno implementati mantenendo i nomi e le firme. Puoi aggiungere export, non cambiare quelli esistenti.
4. **Nessun segreto nel repository.** Mai password, chiavi o credenziali (nemmeno nei test o negli esempi): solo variabili d'ambiente + `.env.example` con segnaposto. Nessuna connessione a server reali; nessun deploy.
5. **Verifica prima di chiudere**: `npx tsc --noEmit` (client+shared), `npx tsc -p server --noEmit`, `npx vitest run` (root) e `cd server && npx vitest run`: i tuoi test verdi e NESSUNA regressione negli altri. Gli altri agenti lavorano in parallelo: se un errore di tipo viene da file altrui, ignoralo e segnalalo.
6. Testi UI e documenti in **italiano**. Report finale breve (max 25 righe): fatto / non fatto / dipendenze / rischi.
7. Importi fiscali: **centesimi interi** nei calcoli di `shared/fatturapa`; mai float per le somme.

## Proprietà
| Agente | Cartelle/file |
|---|---|
| FATTURAPA | `shared/fatturapa/**`, `shared/fiscal/**` (regole pure: validatori P.IVA/CF, totali in centesimi, bollo), `docs/xsd/` (lettura) |
| STORAGE-FATTURE | `src/storage/**` (anche `index.ts`, `invoices.ts`), migrazione IndexedDB v2 |
| UI-FATTURE | `src/pages/DocumentView.tsx`, `DocumentsPage.tsx`, `NewQuotePage.tsx`, `src/pages/invoice/**`, `src/pages/quote/**`, `src/pdf/**` |
| VOCE | `src/voice/**`, `src/App.tsx` (solo per montare il widget voce), `src/hooks/useSpeech.ts` |
| SYNC-CLIENT | `src/sync/**`, `src/pages/account/**`, `src/pages/AccountPage.tsx` (nuova rotta `/account` va dichiarata nel report: App.tsx è di VOCE → usa `React.lazy` esportando il componente, VOCE aggiunge la rotta) |
| SERVER-CORE | `server/src/db/**`, `server/src/auth/**`, `server/src/sync/**`, `server/src/documents/**`, `server/src/app.ts`, `server/src/index.ts`, `server/test/core/**` |
| SERVER-EXTRA | `server/src/billing/**`, `server/src/sdi/**`, `server/src/voice/**`, `server/test/extra/**` |
| INFRA | `infra/**`, `.github/workflows/**`, `server/Dockerfile`, `docs/DEPLOY.md` |
| LEGALE | `public/legal/**`, `docs/privacy/**`, `src/pages/LandingPage.tsx`, `src/pages/landing/**` |

## Modello funzionale (decisioni prese)
- **Numerazione fatture**: progressiva per anno e sezionale (`FT` fatture, `NC` note di credito), **assegnata solo all'emissione** (bozza = nessun numero) in una transazione unica. Nessun buco.
- **Fattura emessa = immutabile**: non si modifica, non si cancella. Si annulla con **nota di credito (TD04)** collegata. Si cancellano solo **bozze** e **preventivi**. Una scartata dallo SDI (NS) si considera non emessa: si rinvia con stesso numero/data entro 5 giorni (registrato come evento).
- **Preventivo → Fattura**: `createInvoiceFromQuote` crea una bozza.
- **Trasmissione SDI v1**: l'app genera e valida l'XML; l'utente lo scarica e lo carica sul portale gratuito dell'Agenzia delle Entrate (o PEC); registra a mano invio/esito (`recordSdiEvent`). Lato server esiste un adattatore `SdiProvider` con `MockProvider` (nessun provider reale scelto: nessun costo/credenziale).
- **Account/sync (opzionale)**: l'app funziona senza account (tutto locale). Con account: sync a coda di operazioni verso il server; il server rifiuta modifiche a documenti bloccati e numeri duplicati per (tenant, sezionale, anno, seq) → `SyncConflict`. La numerazione resta assegnata dal client emittente (limite noto: due dispositivi offline simultanei possono collidere → conflitto segnalato; numerazione server-authoritative = futuro).
- **Comandi vocali**: intent deterministici; azioni irreversibili (emettere, stornare) richiedono **sempre scheda di conferma esplicita** (pressione prolungata o frase "conferma emissione"): mai un semplice "sì"; azioni non irreversibili hanno undo.
- **Quote Free/Pro** (server): Free = 3 documenti/mese; Pro illimitato.
- Disclaimer: "strumento di supporto, la responsabilità fiscale resta dell'utente; verifica con il tuo commercialista".

## API tra moduli client (firme fisse, già presenti come stub)
`src/storage/index.ts` (+ `invoices.ts`): vedi file. In più, comuni a STORAGE-FATTURE: `saveDocument` deve lanciare `ImmutableDocumentError` per fatture con `invoice.lockedAt`; `deleteDocument` idem; `getProfile` fornisce default per i campi v2; `importBackup` non riduce i contatori.
`shared/fatturapa`: `validateInvoiceForIssue(doc, profile): ValidationIssue[]` e `generateFatturaPA(doc, profile, progressivoInvio)`.
`src/engine`: `parseDictation`, `computeTotals` (esistenti, non cambiare).
