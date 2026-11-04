# Dipendenze: audit, rischi e proposte (SICUREZZA-FRONTEND)

Data: 2026-11-04. Nessun `package.json` è stato modificato: qui ci sono solo **proposte** (con rischio di rottura) per il coordinatore. Il registry npm era raggiungibile, quindi gli audit sono reali (non simulati).

## 1. `npm audit`

| Cartella | Comando | Esito |
|---|---|---|
| root (PWA) | `npm audit` | **0 vulnerabilità** (18 prod, 123 dev, 63 opzionali) |
| `server/` | `npm audit` | **0 vulnerabilità** (6 prod, 82 dev) |
| `mobile/` | `npm audit --omit=dev` | **0 vulnerabilità** nelle dipendenze di produzione |
| `mobile/` | `npm audit` | **4 moderate**, tutte nella catena di sviluppo `@capacitor/assets` |

### Le 4 moderate di `mobile/` (solo strumenti di build, non finiscono nell'app)

Catena: `@capacitor/assets@4.0.0` → `@trapezedev/project@7.1.11` → `xcode@3.0.1` → `uuid@7.0.3`.
Avviso: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) "uuid: missing buffer bounds check in v3/v5/v6 when `buf` is provided" (CVSS 7.5 sulla carta, `uuid < 11.1.1`).

- **Esposizione reale: bassa.** `@capacitor/assets` si lancia a mano sul PC dello sviluppatore per generare icone/splash (`npm run assets`); nessuno invia input non fidato a `uuid`, e non viene incluso nell'app né nel server.
- **Non usare `npm audit fix --force`**: propone `@capacitor/assets@1.0.0`, cioè un *downgrade* di tre major che rompe lo script `assets`.
- **Proposta A (consigliata, rischio basso-medio)**: in `mobile/package.json` aggiungere
  ```json
  "overrides": { "@trapezedev/project": { "xcode": "^4.0.0" } }
  ```
  (`@capacitor/cli` usa già `xcode@4.0.0`, che dipende solo da `simple-plist` e non da `uuid`; `@trapezedev/project` dichiara `xcode ^3.0.1`, quindi è un salto di major forzato). Rischio: l'API di `xcode` 4 può differire da quella attesa da `@trapezedev/project` 7: provare `npm run assets` e `npm run patch:native` dopo `npm i`; se si rompe, annullare.
- **Proposta B (rischio medio)**: `"overrides": { "uuid": "^11.1.1" }` (la v11 è ancora CommonJS+ESM; la v12 non lo è più, quindi non andare oltre `^11`). Stesso test di A.
- **Proposta C (rischio nullo)**: non fare nulla finché `@trapezedev/project` non aggiorna `xcode`, accettando il rischio per uno strumento solo-sviluppo. Annotare qui la decisione.

## 2. Pacchetti deprecati

Solo uno, in sviluppo: `uuid@7.0.3` ("uuid@10 and below is no longer supported") in `mobile/`, stessa catena del §1. Nessun pacchetto di produzione risulta deprecato dal registry.

## 3. Pacchetti non aggiornati

`npm outdated` non segnala nulla nelle tre cartelle: tutte le dipendenze dirette sono già all'ultima versione compatibile con l'intervallo `^` dichiarato.

## 4. Script di installazione (postinstall) sospetti

Verificati in `package-lock.json` (`hasInstallScript`):

| Pacchetto | Dove | Giudizio |
|---|---|---|
| `core-js` 3.51.0 | PWA, opzionale (via jsPDF → canvg) | Lo script stampa solo il messaggio di raccolta fondi: innocuo. Non entra nel bundle. |
| `esbuild` 0.28.2 | **server, produzione** (via `tsx`) | Script legittimo (verifica/ottimizza il binario di piattaforma). Vedi §6: in produzione non servirebbe. |
| `fsevents` 2.3.3 | solo macOS, opzionale/dev | Modulo nativo di Apple/Node, atteso. |

Nessuno script di installazione che scarichi o esegua codice remoto. Proposta (NON provata, rischio basso-medio): provare in CI `npm ci --ignore-scripts` e verificare che `esbuild`/`sharp` funzionino comunque (i binari di piattaforma sono pacchetti opzionali già nel lockfile); se no, ammettere gli script solo per quei due pacchetti.

## 5. Pacchetti con un solo mantenitore o senza aggiornamenti recenti

Fonte: `npm view <pkg> maintainers time.modified`. "1 mantenitore" = un solo account npm: è un indicatore di rischio (bus factor, takeover dell'account), non un difetto.

**Di produzione e diretti, con 1 mantenitore**: `jspdf`, `jspdf-autotable`, `idb`, `fuse.js` (non usato, vedi §6), `zod`, `hono`, `@hono/node-server`, `tsx`, `@aparajita/capacitor-secure-storage`. `@capgo/capacitor-speech-recognition` ne ha 2.
Mitigazione generale: lockfile sempre committato, `npm ci` in CI/deploy, attivare la notifica di nuove versioni (Dependabot/Renovate) e leggere i changelog; per `@aparajita/capacitor-secure-storage` (custodisce il token di sessione sul telefono) prevedere un piano B (es. `@capacitor/preferences` + Keychain/Keystore nativi) se venisse abbandonato.

**Transitivi della catena jsPDF → `html2canvas`/`canvg` ferma da oltre due anni** (ultimo rilascio tra 2022 e 2023): `rgbcolor` (2022), `text-segmentation` (2022), `utrie` (2022), `css-line-break` (2022), `base64-arraybuffer` (2022), `performance-now` (2022), `raf` (2022), `regenerator-runtime` (2023). Sono dipendenze **opzionali** di jsPDF, usate solo da `doc.html()` e dal rendering SVG; l'app usa `jsPDF` solo con testo e `autoTable` (`src/pdf/render.ts`). Nella build restano come file mai caricati (`dist/assets/html2canvas-*.js` 199 kB, `index.es-*.js` 151 kB, `purify.es-*.js` 29 kB). Nessun rischio a runtime finché non si chiama `doc.html()`; per la licenza di `rgbcolor` vedi `docs/LICENZE-TERZE-PARTI.md` §3.3.

## 6. Dipendenze non usate o da alleggerire (grep, senza strumenti esterni)

| Dipendenza | Evidenza | Proposta | Rischio |
|---|---|---|---|
| `fuse.js` (root) | nessun `import`/`require` in `src/`, `shared/`, `e2e/` (solo citato in `docs/ARCHITECTURE.md`) | rimuoverla (`npm rm fuse.js`) | nullo se il grep è corretto; lanciare `npm test` |
| `@capacitor/app`, `@capacitor/preferences` (mobile) | nessun import in `src/` né in `mobile/scripts` | verificare con chi cura l'app nativa: se non serve un plugin nativo (back button, preferenze) rimuoverli; ogni plugin nativo aggiunge superficie e revisione store | basso |
| `@capacitor/splash-screen`, `@capacitor/status-bar` | usati solo da `capacitor.config.ts` (plugin nativi) | tenere | – |
| `tsx` + `esbuild` (server, **produzione**) | il server gira con `tsx src/index.ts` (`server/Dockerfile`, `infra/systemd/*.service`) | compilare in JavaScript in fase di build (`tsc` o `esbuild` come devDependency) e avviare `node dist/index.js`: via un compilatore a runtime, immagine più piccola, avvio più rapido, meno superficie d'attacco | medio (cambia Dockerfile/systemd/script di avvio: proprietà INFRA e SERVER) |
| catena `html2canvas`/`canvg`/`dompurify` | v. §5 | niente da fare finché non si chiama `doc.html()`; valutare un alias di build che le escluda (richiede `vite.config.ts`) | basso |

## 7. Raccomandazioni di processo

1. In CI: `npm ci && npm audit --omit=dev --audit-level=high` in root, `server/` e `mobile/` (blocca solo su problemi di produzione; i moderati di sviluppo come quelli del §1 generano un avviso, non un errore).
2. Dependabot/Renovate settimanale, raggruppando le dipendenze di sviluppo.
3. Rigenerare `docs/LICENZE-TERZE-PARTI.md` a ogni aggiornamento di dipendenze (`scripts/audit/gen-licenses.cjs`).
4. `npm audit` non vede le librerie **native** di Android/iOS (Gradle, CocoaPods): quando esisteranno le build definitive, aggiungere gli strumenti dei rispettivi ecosistemi (`gradle dependencyCheck`, `pod outdated`, controllo delle versioni minime SDK).
5. Pubblicare la lista in `docs/SECURITY-REVIEW.md` come rischio residuo se si decide di non intervenire sul §1.

## 8. Cosa non ho potuto fare

- Audit delle dipendenze **native** (Gradle/Pods): le cartelle `mobile/android` e `mobile/ios` esistono (generate da Capacitor) ma senza lockfile né report delle librerie native, e non ho gli SDK Android/Xcode per risolvere le dipendenze.
- Valutare l'affidabilità reale dei mantenitori (storia, reputazione): l'indicatore usato è solo il numero di account npm e la data dell'ultimo rilascio.
- Provare le proposte A/B del §1 (richiedono di modificare `mobile/package.json`, vietato dal contratto).
