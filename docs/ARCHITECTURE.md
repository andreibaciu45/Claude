# VocePreventivo — architettura (nome di lavoro)

PWA mobile-first: l'artigiano **detta** il preventivo, l'app cerca le voci nel suo catalogo/magazzino,
mostra una scheda grafica modificabile e genera PDF di **preventivo** o **fattura**.

## Scelte
- **Nessun backend nella v1.** Tutto in locale (IndexedDB). Costo zero di esercizio, nessun dato sui nostri server.
  "Area personale" = profilo azienda + catalogo + archivio documenti, con **backup/ripristino JSON**.
  Account cloud e sync = v2 (richiederà privacy policy server-side).
- **Voce**: Web Speech API (`SpeechRecognition`, `it-IT`) — gratuita, nessuna chiamata a LLM.
  Fallback: campo di testo (stesso parser), per Firefox/desktop senza supporto.
- **Interpretazione**: parser deterministico italiano (numeri in lettere, unità, "per", "e") + fuzzy match (Fuse.js)
  sul catalogo. Le voci non trovate diventano righe `needsReview`.
- **PDF**: jsPDF + jspdf-autotable, generato nel browser.
- **"Fattura" = fattura di cortesia/proforma PDF.** NON è fattura elettronica SDI (XML): va detto chiaramente in UI.
  Export XML FatturaPA = roadmap v2.

## Stack
Vite + React 18 + TypeScript, react-router (HashRouter), `idb`, `fuse.js`, `jspdf`, `vitest`.
Nessuna libreria UI: CSS proprio con variabili (light/dark).

## Struttura e proprietà (UN agente per cartella — non toccare le cartelle altrui)

| Cartella | Agente | Contenuto |
|---|---|---|
| `src/styles/`, `src/ui/`, `src/App.tsx`, `src/main.tsx`, `index.html`, `public/` | DESIGN | design system, shell, nav mobile, PWA, componenti base |
| `src/storage/`, `src/pages/CatalogPage.tsx`, `ProfilePage.tsx`, `BackupPage.tsx` | AREA PERSONALE | IndexedDB, CRUD, import CSV, backup |
| `src/engine/` | MOTORE VOCE | parser dettatura + matching + test |
| `src/pdf/`, `src/pages/NewQuotePage.tsx`, `DocumentsPage.tsx`, `DocumentView.tsx`, `src/hooks/useSpeech.ts` | PREVENTIVO | microfono, scheda grafica, totali, PDF, archivio |
| `src/pages/LandingPage.tsx`, `public/legal/` | MARKETING | landing, prezzi, privacy/termini |

Il file `src/types.ts` è il contratto: **non modificarlo**; se serve un campo, segnalarlo nel report finale.
Non toccare `package.json`/`vite.config.ts` (dipendenze già installate). Non fare `git commit`.

## API tra moduli (firme fisse)

```ts
// src/storage/index.ts  (AREA PERSONALE)
getProfile(): Promise<Profile>; saveProfile(p: Profile): Promise<void>;
listCatalog(): Promise<CatalogItem[]>; saveCatalogItem(i: CatalogItem): Promise<void>; deleteCatalogItem(id: string): Promise<void>;
listDocuments(): Promise<QuoteDocument[]>; getDocument(id: string): Promise<QuoteDocument|undefined>;
saveDocument(d: QuoteDocument): Promise<void>; deleteDocument(id: string): Promise<void>;
nextDocumentNumber(type: DocType): Promise<string>;   // incrementa il contatore nel profilo
exportBackup(): Promise<string>; importBackup(json: string): Promise<void>;

// src/engine/index.ts  (MOTORE VOCE)
parseDictation(transcript: string, catalog: CatalogItem[]): ParseResult;
computeTotals(lines: DocLine[], opts: { forfettario: boolean; type: DocType }): Totals;

// src/pdf/index.ts  (PREVENTIVO)
generateDocumentPdf(doc: QuoteDocument, profile: Profile): Promise<Blob>;

// src/ui/index.ts  (DESIGN) — esporta: Button, Card, Field, Input, Select, Sheet (bottom-sheet), Badge, EmptyState, Toast/useToast, PageHeader, Money
```
Routing (HashRouter, in App.tsx di DESIGN): `/` Nuovo preventivo · `/documenti` · `/documenti/:id` · `/catalogo` · `/profilo` · `/backup` · `/info` (landing).
Nav mobile: tab bar in basso (Nuovo · Documenti · Catalogo · Profilo).
