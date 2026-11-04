# UX-POLISH — report di collaudo e correzioni

Agente UX-POLISH. Perimetro modificato: `src/styles/**`, `src/ui/index.tsx`, `public/**`, `src/pages/*/*.css`, `src/voice/ui/voice.css`. **Nessun TSX di pagina toccato** (vedi sezione 5 per le modifiche che richiedono il TSX).

Metodo: build di produzione (`npx vite build`), preview su `:4182`, Playwright/Chromium con dati caricati dall'app stessa (profilo forfettario «Mario Bianchi Impianti», P.IVA 01234567897, CF BNCMRA80A01H501A; listino di esempio "idraulico" 20 voci; preventivo PRev-0001 → fattura 1/2026 emessa → nota di credito NC1/2026; più un duplicato e una bozza di fattura). Schermate: `/`, `/?edit=` (bozza in modifica), `/documenti`, `/documenti/:id` (preventivo, bozza, emessa, nota di credito), `/catalogo` (+ sheet di modifica), `/profilo` (+ errore con toast), `/backup`, `/account`, `/info`, sheet «Emetti fattura» e sheet voce, a 360x740, 390x844, 768x1024, 1280x800, tema chiaro e scuro.

Screenshot (tutti in `docs/ux/`, schema `<schermata>_<larghezza>_<light|dark>_<top|bottom>.jpg`; `top` = in cima, `bottom` = scorsa fino in fondo, solo a 360/390):
- Esempi chiave: `docs/ux/home_390_light_bottom.jpg`, `docs/ux/doc-preventivo_390_light_bottom.jpg`, `docs/ux/profilo-errore_390_light_top.jpg` (toast sopra al microfono, non sulla tab bar), `docs/ux/doc-emessa_390_dark_top.jpg`, `docs/ux/catalogo-sheet_390_dark_top.jpg`, `docs/ux/voce-sheet_1280_light_top.jpg`, `docs/ux/sheet-emetti_390_dark_top.jpg`.
- Prima delle correzioni: `docs/ux/BEFORE_*.jpg` (es. `BEFORE_home_390_light_bottom.jpg`, `BEFORE_profilo-errore_390_light_top.jpg`, `BEFORE_catalogo_390_light_top.jpg`).
- Stress test: `docs/ux/zoom_zoom200-360_home.jpg`, `zoom_zoom200-390_profilo.jpg`, `zoom_zoom400-320_home.jpg`, `zoom_bigtext-390_home.jpg` (testo di sistema 200%), `safe-area_390_home.jpg` / `safe-area_390_profilo.jpg` (notch 47px, home indicator 34px), `keyboard_390x520_catalogo-sheet.jpg` (tastiera virtuale simulata: viewport 520px).
- Nota: dopo 3 documenti nel mese la home mostra lo stato «piano Gratis esaurito» (limite Free); per la bozza in modifica usa `home-edit_*` (`/?edit=<id>`).

## 1. Problemi trovati e risolti

| # | Problema (prima) | Correzione |
|---|---|---|
| 1 | Pulsante microfono flottante e toast sovrapposti alla tab bar e ai contenuti; il microfono copriva importi e pulsanti a fondo pagina | Pila inferiore unica con variabili in `tokens.css`: `--bottom-ui` (tab bar + safe-area), `--fab-bottom`, `--fab-zone`, `--stack-top`. Microfono 56px sopra la tab bar a destra (`bottom: var(--fab-bottom)`); toast e barre «Annulla» partono da `--stack-top` (sopra il microfono); con barra Annulla attiva i toast salgono di altri 64px (`:has()`); con una scheda aperta i toast passano in alto così non coprono i pulsanti di conferma. `.shell-main` ha padding-bottom = tab bar + zona microfono, quindi l'ultimo contenuto non è mai coperto. Barre azioni sticky (preventivo, salva profilo) lasciano il posto al microfono accanto (`margin-right`). Desktop: margini fissi, nessuna tab bar. Schermi bassi (< 500px di altezza: landscape, zoom 200%) barre più compatte. |
| 2 | Contrasto: testo bianco su arancio `#e8590c` = 3.58:1 (pulsanti primari), successo su sfondo soft 4.49:1, bianco su rosso in tema scuro (`#fff` su `#ff8a7d`) = 2.29:1 (pulsanti Elimina, toast errore, hold, microfono in ascolto) | `--c-accent` `#c2410c` (5.18:1 con bianco), hover `#9a3412`; `--c-success` `#17703a` (5.12:1); nuovo token `--c-on-danger` (bianco in chiaro 6.57:1, `#2a0703` in scuro 8.13:1) usato ovunque al posto di `#fff`; focus ring `#c2410c` ≥ 3:1 su tutti gli sfondi |
| 3 | Bordi dei campi 1.5:1 (WCAG 1.4.11 chiede 3:1) | `--c-border-strong` (`#6f858c` / `#6a858c` in scuro) per input, select, textarea, chip |
| 4 | Gli stili inline delle pagine (`catalog/styles.ts`: `--text-muted`, `--primary`, `--surface`, `--border`, `--danger`...) usavano variabili **mai definite** (colori di ripiego blu, trasparenti in scuro) | Definiti come alias dei token in `tokens.css`: i filtri del listino, pagina backup/profilo seguono ora tema chiaro/scuro |
| 5 | Focus invisibile sulle voci del listino (stile inline `all: unset` azzera l'outline) e sui campi (outline rimosso) | Regola `button[style*="outline: unset"]:focus-visible` con `!important`; i campi hanno ora outline 3px `--c-focus`. Verifica automatica Tab su 7 schermate: **0 elementi senza anello di focus, 0 coperti da barre fisse** |
| 6 | Target touch < 44px: «×» dei sinonimi (28px), link legali e brand in `/info` (20–27px) | 44px (regole CSS su `button[style*="min-width: 28px"]`, `landing.css`). Verifica: nessun target interattivo < 44px in nessuna schermata (esclusi checkbox/radio nativi, ora 24px con label ≥ 48px) |
| 7 | Pulsanti principali di 48px | `.btn` 52px; pulsanti in sheet, `.dv-actions`, `.qe-actions` 56px (`--touch-lg`); `size="lg"` 60px; pulsante «tieni premuto» 60px. Pensati per uso con una mano e guanti |
| 8 | Campi P.IVA / CF tagliati nel profilo (griglia inline `1fr 1fr` senza `min-width:0`) | `min-width:0` sui figli e colonna singola sotto 400px (anche zoom 200%) |
| 9 | Titolo pagina schiacciato a una parola per riga nel listino (azioni accanto al titolo) | `.page-header > .grow { flex: 1 1 12rem }`: le azioni vanno a capo se non ci stanno |
| 10 | Doppio separatore «· ·» nel piè di pagina quando il badge di sync è vuoto | selettore `:has()` in `shell.css` |
| 11 | Tab bar: etichette che crescono con il testo di sistema e si sovrappongono | cap a 15px, ellissi, 4 voci entrano anche a 180px di larghezza (zoom 200% su 360px) |
| 12 | `prefers-reduced-motion` gestito solo nel widget voce | Regola globale in `base.css` (animazioni/transizioni azzerate; lo spinner resta ma più lento perché indica attività); verificato: durata animazione sheet = 1e-06s |
| 13 | Tastiera virtuale: il pulsante di conferma in fondo a una scheda poteva restare sotto la tastiera (iOS non ridimensiona il layout) | `Sheet` (src/ui): segue `visualViewport` (`--kb-inset`), `scrollIntoView` del campo a fuoco; `sheet` alto `100dvh - safe-area`; `scroll-padding-bottom` globale perché il campo a fuoco non finisca sotto tab bar/microfono (WCAG 2.4.11) |
| 14 | Safe-area iPhone | Tab bar, sheet, toast, barre e microfono usano `--sat/--sab/--sal/--sar` (verificato con insets simulati) |
| 15 | Ruoli ARIA | Verificato: sheet `role=dialog aria-modal aria-labelledby`, focus trap, Esc, focus restituito all'elemento d'origine; tab bar `<nav aria-label>` + `aria-current="page"`; toast `role=status aria-live=polite` — ora i toast d'errore hanno `role="alert"`; `Segmented` ora è un vero radiogroup (un solo tab stop, frecce) |
| 16 | Stati vuoti poco riconoscibili, caricamenti solo «Caricamento…» | `EmptyState`: contenitore tratteggiato, icona in cerchio, azioni a larghezza piena, nuova prop opzionale `icon`; nuovo componente `Skeleton` (+ CSS shimmer) in `src/ui` |
| 17 | Chip a scorrimento orizzontale tagliati senza indizio | sfumatura a destra (`mask-image`) su `.dl-chips` e righe a scorrimento del listino |
| 18 | Checkbox nativa «Cantiere rumoroso» (widget voce) minuscola, senza colore tema | regola globale 24px + `accent-color` |
| 19 | IBAN formattato (31 caratteri) tagliato nel campo | letter-spacing ridotto, ancora al limite a 360px (vedi 5.2) |

Contrasti calcolati sui token (ratio WCAG, testo normale ≥ 4.5; UI ≥ 3):
- Chiaro: testo/sfondo 15.9, testo-2/sfondo 7.1, primary/surface 7.6, on-primary/primary 7.6, on-accent/accent 5.18, on-accent/accent-hover 7.4 (nuovo), danger/surface 6.6, success/surface-soft 5.12, warning/soft 5.07, border-strong/surface ≈3.8.
- Scuro: testo/sfondo 16.6, testo-2/sfondo 9.4, primary/surface 6.7, on-accent/accent 8.2, on-danger/danger 8.13, success/soft 7.3, border-strong/surface 4.1.
- Restano sotto 3:1 solo i bordi decorativi dei contenitori (card, separatori), non necessari alla comprensione.

## 2. PWA
- `manifest.webmanifest`: `shortcuts` (Nuovo preventivo, Documenti, Listino, Backup), `screenshots` (narrow 390x844 x2, wide 1280x800, in `public/screenshots/`), `categories` (business, productivity, finance), `display_override`, `orientation: any` (prima forzava portrait), `prefer_related_applications: false`.
- `sw.js` v2: precache anche di `/legal/*.html` (privacy, termini, dpa, cookie, sub-responsabili; un 404 non blocca l'installazione) e di `offline.html` + `apple-touch-icon.png`; bug corretto: **ogni** navigazione veniva salvata come `index.html` (una pagina legale poteva sovrascrivere la shell dell'app); ora solo le navigazioni dell'app. Fallback offline: pagina esatta → shell dell'app (per rotte senza estensione) → `offline.html` → risposta HTML inline. Risorse non in cache offline: 504 pulito invece di eccezione.
- Verificato con Playwright offline: `/legal/privacy.html` servita dalla cache (h1 corretto), `/` carica l'app, URL sconosciuto mostra «Sei offline». Cache `voceprev-v2` contiene 13 voci; `voceprev-v1` viene eliminata all'attivazione.

## 3. Verifiche eseguite (esito)
- Sovrapposizioni tra elementi fissi (microfono, tab bar, toast, barre Annulla, barre sticky): **0** in tutte le schermate/misure/temi dopo le correzioni (prima: microfono x toast su profilo-errore, backup, account...).
- Overflow orizzontale: 0 (anche a 180px, 195px, 80px di larghezza e con `html{font-size:200%}`).
- Ordine di Tab: logico (tab bar → contenuto → piè di pagina → microfono); nelle schede il focus resta intrappolato.
- Non verificabile qui: comportamento reale della tastiera su iOS/Android, `env(safe-area-*)` reali (simulati con variabili), VoiceOver/TalkBack (verificati solo ruoli e nomi accessibili), PDF.

## 4. Limiti noti dopo le correzioni
- Il microfono è un elemento flottante: durante lo scorrimento copre per un attimo il bordo destro di ciò che passa sotto; la pagina però non lo nasconde mai a fondo scorrimento e le barre azioni gli lasciano il posto.
- Il toast resta visibile anche dopo un cambio di rotta (il provider è sopra al router): può comparire sopra la pagina successiva per max 3,5 s.

## 5. Modifiche che richiedono il TSX delle pagine (non eseguite: fuori perimetro)
1. `src/pages/ProfilePage.tsx`, campo IBAN: a 360–390px il valore formattato (31 car.) è ancora più largo del campo. Modifica: `Textarea rows={2}` oppure mostrare la formattazione a gruppi solo in sola lettura.
2. `src/pages/ProfilePage.tsx`, blocco finale `<div style={{ position: 'sticky', ... }}>`: sostituire lo stile inline con `className="sticky-actions"` (ora compensato da una regola CSS con selettore su `style`, fragile); i titoli `<h2 style={{fontSize:18}}>` delle Card → classe (stile unico per h2 di card).
3. `src/App.tsx`: aggiungere «Salta al contenuto» come `<button>` che fa `document.getElementById('main')?.focus()` (con `tabIndex={-1}` su `<main>`); NON usare `href="#main"` (HashRouter lo interpreta come rotta). Aggiungere inoltre aggiornamento di `document.title` e focus sull'`<h1>` a ogni cambio rotta (`ScrollTop` è il punto giusto).
4. `src/pages/LandingPage.tsx`, riga ~96 `<a className="lp-btn lp-btn--ghost" href="#installa">`: con HashRouter porta a una rotta inesistente. Modifica: `<button>` con `document.getElementById('installa')?.scrollIntoView()` oppure link `#/info`+scroll gestito.
5. `src/pages/NewQuotePage.tsx` (radiogroup «Tipo di documento», `div.segmented` scritto a mano) e `src/pages/DocumentView.tsx` (stato documento legacy): sostituire con `<Segmented>` di `src/ui` per avere tab stop singolo e frecce da tastiera.
6. `src/pages/NewQuotePage.tsx`: sulla home compaiono due microfoni (quello grande `.mic` e il pulsante flottante). Decisione di prodotto: nascondere `.vc-fab` quando `pathname === '/'` e `stage === 'input'` (in `src/voice/ui/VoiceCommandWidget.tsx`, aggiungere `hidden` o `data-hidden`).
7. Stati di caricamento: `ProfilePage.tsx` (`Caricamento…` in `<p>`), `CatalogPage.tsx` (`!loaded`), `DocumentsPage.tsx`, `DocumentView.tsx`, `NewQuotePage.tsx`/`QuoteEditor.tsx` (`.qe-loading` con solo spinner) → usare `<Skeleton lines={3} blocks={2} />` da `src/ui`.
8. `src/pages/DocumentView.tsx`, bozza di fattura: `Scarica PDF (bozza)` occupa metà riga nella griglia `.dv-actions`; aggiungere `className="span-2"` quando è l'unico pulsante.
9. `src/pages/catalog/styles.ts` e pagine che lo usano (`CatalogPage`, `BackupPage`, `ProfilePage`, `ImportSheet`, `ItemSheet`): stili inline con `all: unset` e dimensioni fisse in px → migrare a classi CSS (oggi correzioni CSS tramite selettori su `style`, che si rompono se cambia la serializzazione).
10. `src/voice/ui/VoiceCommandWidget.tsx`: dare `role="status"` a `.vc-live`/barra undo (`.vc-undo`) e `aria-live` coerente; il checkbox «Cantiere rumoroso» va avvolto in `<label className="vc-check">` con testo (ora è un `input` + testo adiacente).
11. `index.html` (non nel perimetro): `<meta name="viewport" content="..., interactive-widget=resizes-content">` per far ridimensionare il layout alla tastiera su Android Chrome; il `<link rel="manifest" href="/manifest.webmanifest">` è assoluto: se l'app sarà servita da sottocartella usare `%BASE_URL%`.
