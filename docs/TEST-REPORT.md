# Rapporto stabilità e copertura dei test

Agente STABILITÀ-TEST. Data analisi: 2026-11-04. Macchina: 4 core, condivisa con gli altri agenti (i tempi risentono del carico).
Comando unico: `scripts/test/all.sh` (typecheck + test root + shared + server, senza rete, riepilogo finale).
Opzioni: `SHUFFLE=1` (ordine casuale), `TEST_FAKE_NOW=2027-01-01T00:00:10` (sposta l'orologio, solo root/shared), `COVERAGE=1`, `SKIP_SERVER=1`, `SKIP_TYPECHECK=1`.

## 1. Stato finale

| Suite | Test | Tempo (wall) | Note |
|---|---|---|---|
| root (`npx vitest run`) | 1190 | 28 s a macchina libera, 45-60 s sotto carico | 75 file, ogni file crea un jsdom (~65% del tempo è ambiente) |
| shared (`-c shared/vitest.config.ts`) | 184 (+1 skip) | ~1 s | lo skip è la validazione XSD (vedi 4) |
| server (`cd server && npx vitest run`) | 384 (+1 expected-fail, +1 skip) | 14-22 s | i test più lenti lanciano processi figli |
| typecheck client+shared / server | - | 3 s / 2 s | verdi |

Esecuzioni fatte: root 14 volte (normale, `--sequence.shuffle`, `--pool=threads`, seed fisso, 3 istanze in parallelo per stressare), shared 4, server 6, più 3 orologi finti (2027-01-01, 2026-12-31 23:59:40, 2028-02-29). Dopo le correzioni sotto, tutte verdi.

## 2. Test instabili trovati e correzioni

| Test | Frequenza osservata | Causa | Correzione (asserzioni non indebolite) |
|---|---|---|---|
| `src/pages/BackupPage.test.tsx` «Controllo dati: archivio sano» (era il test di src/pages fallito una volta) e «conferma esplicita» | 1 su ~10 esecuzioni, solo a macchina carica | attesa fissa: `flush()` = 12 giri di `setTimeout(0)`; il controllo di integrità su IndexedDB finto non aveva finito | `flush` ora attende che il DOM si stabilizzi (`src/__tests__/settle.ts`, tetto 8 s); `until()` per l'esito del controllo. Stesso helper in `BackupPage.integrity`, `DocumentsPage.collect`, `NumberingCard` (stesso schema) |
| `src/pages/account/invite.ui.test.tsx` errore non gestito `window is not defined` (da `LoginForm.verify`, `setBusy` nel `finally`) | 1 su ~8 | il test finisce mentre `verifyCode -> sync` è ancora in corso: lo `setState` arriva dopo la chiusura di jsdom | `afterEach` attende `settleUi()` prima di smontare. Vedi anche 3 (codice di produzione) |
| `src/storage/perf.test.ts` (4 test) | 100% con `--sequence.shuffle` | i test condividono il seed del `beforeAll` e gli ultimi sono distruttivi: l'ordine è parte del progetto | `describe(..., { shuffle: false })` |
| `src/storage/perf.test.ts` «backup» / «migrazione REALE» | 3 su 3 con 3 suite in parallelo | `testTimeout` predefinito 5 s, mentre il test stesso ammette 25-30 s | `timeout: 120_000` sul blocco; in più `testTimeout: 20_000` globale in `vite.config.ts` (server: 30 s) |
| `src/engine/customerMatch.test.ts` «rubrica grande: veloce» | 1 su ~14 (250 ms contro 150) | una sola misura a tempo reale | miglior tempo su 5 prove (una regressione O(n^2) peggiora tutte le prove) |
| `src/engine/perf.test.ts` «parse < 50 ms» e «frasi mai viste» | 2 su ~6 con carico (361 ms contro 250; 68 contro 50) | tempo reale, misura singola | migliore di 3 prove per frase; per le frasi mai viste, 3 serie diverse e vale la migliore |
| Bombe a orologio (dal 1/1/2027): `storage/invoices.test.ts` (3 test), `storage/importValidation.test.ts`, `pages/DocumentsPage.collect.test.tsx` (2 test) | 100% dal 2027-01-01 (trovate con `TEST_FAKE_NOW`) | fixture con date/numeri 2026 ma orologio reale (`NC1/2026` contro `NC1/2027`, data nel futuro) | `vi.useFakeTimers({ toFake: ['Date'] })` fissato al 2026-06-15 + `useRealTimers` in `afterEach` |

Non instabili ma da sapere: i test a tempo reale rimasti (`src/engine/robust.test.ts` 2-4 s, `engine/parse.test.ts` 3 s, `storage/perf.test.ts`) hanno soglie larghe (almeno 10x il tempo tipico). Il resto delle date nei test usa `vi.setSystemTime` o l'anno corrente in modo coerente (verificato con i tre orologi finti).

### Test lenti (> 2 s, a macchina carica)

| Test | Tempo | Motivo |
|---|---|---|
| `storage/perf.test.ts` migrazione REALE v1 (5000 doc) | 2,3-4,7 s | volume voluto |
| `storage/perf.test.ts` backup/ripristino 5000 doc | 2,2-3,8 s | volume voluto |
| `pages/invoice/coherence.test.tsx` DocumentView su 60 documenti | 2,2-3,8 s | 60 render completi |
| `pages/profile/NumberingCard.test.tsx` «abbassare il valore» | 2,3 s (una volta) | render + doppia conferma |
| server `review/multiprocess` stesso opId a due processi | 4,2-4,3 s | avvia processi figli (inevitabile) |
| server `ops/e2e` (3 test), `ops/admin-cli`, `core/loadtest` | 2,0-2,9 s | processi figli / carico 2 s per costruzione |

## 3. Segnalazioni su codice di produzione (non corretto, non è compito di questo agente)

1. **Sync server, `server/src/sync/service.ts` `applyCatalog` (SERVER-CORE)**: una `delete` su una voce mai vista dal server è un no-op senza tombstone; se poi arriva una `upsert` più vecchia (clientTs minore) la voce «risorge». Con l'ordine inverso resta cancellata, quindi lo stato finale dipende dall'ordine di arrivo (divergenza tra dispositivi/retry riordinati). Riprodotto in `server/test/core/sync.property.test.ts` con `it.fails` (diventa rosso quando verrà corretto: allora togliere `.fails`). Le sole upsert, con duplicati e ordine casuale, convergono.
2. **`src/pages/account/LoginForm.tsx` `verify` (SYNC-CLIENT)**: `setBusy(false)` nel `finally` viene eseguito anche dopo lo smontaggio del componente. In produzione è innocuo; nei test ha causato l'errore non gestito (mitigato nel test).
3. **`src/voice/examples.test.ts` (VOCE)**: in una sola esecuzione su ~14 «Storna la fattura dodici» ha dato `disambiguate` invece di `proceed`, mentre `src/voice/**` era in modifica; nelle 3 riesecuzioni successive e nelle esecuzioni finali è verde. Da ricontrollare quando VOCE ha finito.

**Rossi residui**: nessuno al momento della consegna (tutte le suite verdi, typecheck verde). Nessun test è stato disabilitato; l'unico `it.fails` è la segnalazione 1.

## 4. Copertura

`@vitest/coverage-v8` **non è installato** (né in root né in `server/`; non ho installato nulla). Configurazione già pronta in `vite.config.ts` (blocco `coverage`, esclude test e utilità). Per misurare:

```
npm i -D @vitest/coverage-v8@^5          # una volta, versione uguale a vitest (5.1.x)
npx vitest run --coverage                # root (src + shared importati dai test root)
npx vitest run -c shared/vitest.config.ts --coverage
cd server && npm i -D @vitest/coverage-v8@^5 && npx vitest run --coverage
```

Report in `coverage/` (html + json-summary). Suggerimento per `package.json` (non modificabile da questo agente): `"test:coverage": "vitest run --coverage"` e `"test:all": "scripts/test/all.sh"`.

### Mappa delle aree critiche (analisi del codice e dei test, non misura)

Legenda: buona = casi principali, limiti e regressioni; media = percorsi principali ma buchi noti; scarsa = poco o niente.

| Area | Test esistenti | Giudizio | Buchi da colmare |
|---|---|---|---|
| Numerazione fiscale (`storage/invoices.ts`) | `numbering.test`, `counterStart.test`, `invoices.test`, `creditnotes.test`, `integrity.test`; **nuovo** `properties.test` (8 scenari casuali con emissioni concorrenti, fallimenti, cancellazioni, note di credito) | buona | numerazione tra due dispositivi (limite noto: collisione segnalata solo dal server); ripresa dopo errore a metà transazione reale (si testa con IndexedDB finto, non con abort veri) |
| Immutabilità fatture | `invoices.test`, `rejected.test`, server `sync.test` (`locked_document`) | buona | nessun test che un `importBackup`/`saveSyncedDocument` non possa riscrivere un campo bloccato su tutte le combinazioni di campi (parzialmente in `importValidation.test`) |
| Totali in centesimi | `shared/fiscal/money.test`, `discount.test`, `coherence.test` (UI=PDF=XML=CSV su 60 casuali); **nuovo** `money.property.test` (riferimento razionale esatto, invarianza dall'ordine, bollo) | buona | `src/engine/totals.ts` (float, usato dal motore di dettatura) non ha il confronto con i centesimi su input casuali: oggi due aritmetiche coesistono (`engine/totals` e `fiscal/money`) |
| XML FatturaPA (`shared/fatturapa`) | `generate.test`, `validate.test`, `text.test`, `legalText.test`, `review.test` | media | **la validazione contro lo XSD ufficiale è sempre SKIP**: `docs/xsd/` non esiste (nessuno schema scaricato). Senza di essa nessun test dimostra che l'XML sia accettato dallo SDI. Mancano fuzz su caratteri speciali/lunghezze massime dei campi e su tutte le nature IVA |
| Sync client (`src/sync`) | `engine.test`, `outbox.test`, `snapshot.test`, `conflicts.test`, `api.test`, `account.test`, UI | media | idempotenza dell'engine con operazioni duplicate/riordinate lato client (outbox) non verificata in modo casuale; il server sì (**nuovo** `sync.property.test`) |
| Sync server (`server/src/sync`) | `core/sync.test`, `isolation`, `concurrency`, `review/multiprocess`; **nuovo** `sync.property.test` | buona | tombstone (segnalazione 3.1); limiti `MAX_DOC_BYTES`/catalogo coperti solo a campione |
| Bozza locale | `quote/draft.test`; **nuovo** `draft.property.test` (300 bozze casuali con -0/NaN/Infinity, testi ostili) | buona | ripristino da `localStorage` corrotto a metà scrittura (quota) solo per `setItem` che lancia |
| Backup/ripristino | `storage.test` (backup), `importValidation.test`, `BackupPage*.test`, `perf.test`; **nuovo** round-trip casuale + idempotenza + backup vecchio | buona | backup v1/v2 casuali verso v3 (solo esempi fissi); file molto grandi nel browser reale (solo IndexedDB finto) |
| Comandi vocali (`src/voice`) | `corpus.test` (corpus e held-out), `policy.test`, `executor.test`, `bookCustomer.test`, `examples.test`, `review.test`, provider | media | `voice/resolve.ts`, `describe.ts` senza test diretti; **nessun test end-to-end che un'azione irreversibile (emettere/stornare) non parta mai senza la scheda di conferma esplicita** (esiste solo `policy.test` sulla decisione, non sul widget `VoiceCommandWidget`); undo delle azioni reversibili solo a campione |
| Piani Free/Pro | client `billing.test`, `LimitGate.test`, `review.test`; server `extra/billing.test`, `ops/grants.test`, `core/sync.test` (quota) | media | confine mensile (fuso orario, cambio mese) della quota 3/mese; coerenza tra quota client (`allowance`) e server su sequenza casuale di creazioni/cancellazioni |
| Server auth | `core/auth.test`, `hardening`, `gdpr`, `encryption`, `ops/invites`, `fix/otp-distributed` | buona | `auth/middleware.ts`, `limits.ts`, `security.ts` coperti solo tramite le rotte; nessun test di scadenza token al limite esatto |
| Server webhook (Stripe) | `extra/billing.test` (replay stesso event id, firma), `ops/grants.test`, `extra/hardening` | media | firma con timestamp fuori tolleranza e payload troncato/duplicato in parallelo; ordine invertito degli eventi (`subscription.deleted` prima di `checkout.completed`) |
| Server DB/backup/migrazioni | `core/db`, `core/backup`, `ops/migrations`, `ops/maintenance` | buona | migrazione con DB di versioni intermedie casuali |
| UI pagine (`NewQuotePage`, `ProfilePage`, `CatalogPage`, `CustomersPage`, `LandingPage`, `InvoicePanel`, `IssueSheet`, `SdiSheets`, …) | solo indirettamente (`DocumentView.test`, `customers.test`, `coherence.test`) | scarsa | molte schermate senza test di rendering; rischio regressioni UX non fiscali |

## 5. Test aggiunti

- `shared/fiscal/money.property.test.ts`: 6 test, 40 seed (importi interi, totale = somma esatta, uguaglianza col riferimento razionale BigInt, invarianza dall'ordine, float contro centesimi, round-trip `toCents`/`fromCents`).
- `src/storage/properties.test.ts`: 16 test (numerazione senza buchi con operazioni casuali su 8 seed, emissione parallela, backup round-trip su 5 seed, idempotenza, backup vecchio che non abbassa i contatori).
- `src/pages/quote/draft.property.test.ts`: 4 test (round-trip stretto con `Object.is` su 300 bozze, via `localStorage`, idempotenza, input corrotti).
- `server/test/core/sync.property.test.ts`: 14 test (6 seed di convergenza con duplicati e ordine casuale, 6 di quota contata una volta, riconsegna dello stesso lotto, 1 `it.fails` per la segnalazione 3.1).
- Infrastruttura: `scripts/test/all.sh`, `scripts/test/fake-now.setup.ts` (usato da `vite.config.ts` e `server/vitest.config.ts` solo se `TEST_FAKE_NOW` è impostato), `src/__tests__/settle.ts`.

Limite di `TEST_FAKE_NOW` sul server: i test `ops/e2e` e `review/multiprocess` lanciano processi figli che usano l'orologio vero, quindi con l'orologio spostato falliscono per costruzione (non per difetti). Tutti gli altri test del server sono verdi anche con 2027-01-01 e 2028-02-29.

## 6. Regole per i nuovi test (per tutti gli agenti)

1. Niente `setTimeout` fissi né 12 giri di `flush`: usare `settleUi()` o un `until(cond)` con tetto.
2. Test con date: fissare `Date` con `vi.useFakeTimers({ toFake: ['Date'] })` e `vi.setSystemTime(...)`, ripristinare in `afterEach`. Mai fixture 2026 con orologio reale.
3. Soglie di tempo: miglior tempo su N prove, mai misura singola; il tetto serve a trovare ordini di grandezza, non millisecondi.
4. Test che dipendono dall'ordine o da uno stato condiviso: `{ shuffle: false }` sul blocco, dichiarando il motivo.
5. Ogni test che tocca IndexedDB/`localStorage` ripulisce in `beforeEach` (`__resetStorageForTests` + `deleteDB`).
