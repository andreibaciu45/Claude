# VocePreventivo — Piano SEO e contenuti

Data: 4 novembre 2026. Stato: **prima versione, pronta per la revisione del commercialista**. Nessun dato di traffico o di posizionamento esiste ancora: tutto ciò che segue è un piano, non un risultato.

## 1. Cosa è stato creato

| File | Scopo |
|---|---|
| `public/guide/index.html` | Indice delle guide (pagina "hub") |
| `public/guide/*.html` (11 guide) | Guide statiche, autonome, in italiano, con JSON-LD `Article`, `FAQPage`, `BreadcrumbList` |
| `public/guide/guide.css` | Stile condiviso (chiaro/scuro, mobile first, nessuna dipendenza esterna) |
| `public/og/*.svg` | Immagini per le anteprime social (una per guida + una per l'indice) |
| `public/sitemap.xml` | Sitemap con landing, indice e guide |
| `public/robots.txt` | Consente tutto e indica la sitemap |

Le pagine non usano JavaScript, cookie, font esterni o strumenti di analisi di terze parti, coerentemente con l'informativa privacy ("niente tracciamenti di terze parti").

## 2. Il segnaposto del dominio: `https://[DOMINIO]`

Il dominio non è ancora scelto (vedi `docs/GO-TO-MARKET.md`, checklist di pubblicazione). Il segnaposto `https://[DOMINIO]` compare in:

- `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image` di ogni pagina;
- gli URL dentro i blocchi JSON-LD;
- `public/sitemap.xml` e `public/robots.txt` (riga `Sitemap:`).

**Prima della pubblicazione**, sostituirlo ovunque, per esempio (dalla radice del repository, con il dominio vero al posto di `esempio.it`):

```
grep -rl '\[DOMINIO\]' public | xargs sed -i 's#https://\[DOMINIO\]#https://esempio.it#g'
```

Poi controllare che `grep -r 'DOMINIO' public` non restituisca più nulla (restano solo i commenti esplicativi in `robots.txt` e `sitemap.xml`, da rimuovere o lasciare).

Il sito è una PWA con HashRouter servita dalla radice del dominio. Le guide stanno in `/guide/`, i documenti legali in `/legal/`, l'app a `/#/` e la landing a `/#/info`. Le guide linkano l'app e la landing con questi percorsi assoluti dalla radice (`/#/`, `/#/info`): funzionano solo se il sito è servito dalla radice del dominio. Se un giorno fosse servito da un sottopercorso, vanno adattati.

### Avvertenze tecniche da conoscere

1. **La landing (`/#/info`) non è indicizzabile come pagina a sé.** I motori di ricerca ignorano la parte dopo `#`. Per questo la sitemap include solo la radice `https://[DOMINIO]/` e non `/#/info`. Le guide statiche sono il vero ingresso SEO del sito. Se si vuole che anche la landing si posizioni, serve una pagina statica dedicata (per esempio `public/index-landing.html` oppure un prerender): è una decisione per chi si occupa di `src/`, fuori dal perimetro di questo lavoro.
2. **Le immagini OG sono SVG.** Alcune piattaforme (in particolare Facebook, LinkedIn e molte app di messaggistica) **non mostrano gli SVG** come anteprima. Prima del lancio convertirle in PNG 1200x630 con un tool a scelta (non richiede modifiche alle pagine: basta cambiare l'estensione in `og:image` e `twitter:image`). Fino ad allora l'anteprima social potrebbe risultare senza immagine: non è un errore delle pagine.
3. **Le pagine legali sono `noindex`** (sono bozze). Va bene così finché non sono state riviste.
4. Il service worker dell'app non deve intercettare `/guide/` come se fosse un percorso dell'app (verificare in fase di build che le pagine statiche vengano servite così come sono). Non è stato modificato nulla fuori dal perimetro assegnato.
5. Le guide linkano `/icon.svg` come favicon e `/icon-512.png` come logo nel JSON-LD: entrambi esistono in `public/`.

## 3. Mappa keyword → pagina

Le keyword vengono dalle domande reali di chi ha il problema. **Non abbiamo volumi di ricerca**: nessuno strumento a pagamento è stato usato e non inventiamo numeri. La colonna "Intento" serve a scegliere il tono.

| Keyword principale | Varianti da coprire nel testo | Pagina | Intento |
|---|---|---|---|
| come fare un preventivo da idraulico / elettricista / imbianchino | preventivo idraulico, preventivo elettricista, preventivo imbianchino, cosa scrivere in un preventivo | `guide/preventivo-idraulico-elettricista-imbianchino.html` | Informativo-pratico |
| modello preventivo lavori edili | fac simile preventivo ristrutturazione, preventivo muratore | `guide/modello-preventivo-lavori-edili.html` | Cerca un modello |
| preventivo a voce | accordo a voce, preventivo verbale, preventivo senza contratto | `guide/preventivo-a-voce.html` | Dubbio / rischio |
| come calcolare il prezzo di un preventivo | prezzo orario artigiano, ricarico materiali | `guide/come-calcolare-prezzo-preventivo.html` | Informativo |
| differenza preventivo e fattura | preventivo è un documento fiscale, preventivo o fattura | `guide/differenza-preventivo-fattura.html` | Chiarimento |
| fattura forfettario cosa scrivere in fattura | fattura forfettario esempio, dicitura forfettario, fattura senza IVA | `guide/cosa-scrivere-fattura-forfettario.html` | Informativo-fiscale |
| bollo 2 euro fattura forfettario | marca da bollo 77,47, bollo fattura elettronica | `guide/bollo-2-euro-fattura-forfettario.html` | Informativo-fiscale |
| numerazione fatture forfettario | numero fattura, ricominciare da 1, sezionale | `guide/numerazione-fatture-forfettario.html` | Informativo-fiscale |
| nota di credito forfettario come si fa | storno fattura, nota di credito parziale | `guide/nota-di-credito-forfettario.html` | Come si fa |
| come annullare una fattura già emessa | stornare una fattura, fattura sbagliata, fattura scartata | `guide/come-annullare-fattura-emessa.html` | Problema urgente |
| fattura elettronica forfettario gratis come inviarla | fattura elettronica senza programma, portale Agenzia delle Entrate, PEC SDI | `guide/fattura-elettronica-forfettario-gratis.html` | Come si fa / gratis |
| guide per artigiani (hub) | preventivi e fatture per artigiani | `guide/index.html` | Navigazionale |

Regole di coerenza: una keyword principale per pagina, nessuna pagina in competizione con un'altra; le pagine si rimandano a vicenda con testi di link descrittivi (già fatto: ogni guida ha 4 guide collegate e link nel testo).

## 4. Regole di contenuto (onestà prima di tutto)

Valgono per le guide esistenti e per tutte quelle future:

- **Nessuna consulenza fiscale presentata come certa.** Formule come "in generale", "di norma", "verifica con il tuo commercialista". Ogni guida fiscale ha un riquadro "Verifica sempre con il tuo commercialista" con la data di ultimo controllo.
- **Nessun articolo di legge o importo di cui non siamo certi.** Le fonti del progetto in `docs/FISCAL-SPEC.md` sono secondarie e marcate "da verificare". Nelle guide compaiono solo: la soglia di 77,47 € e l'importo di 2 € per il bollo, il termine "di 12 giorni" (citato come "il termine più citato, verifica"), il richiamo generico alla "legge n. 190/2014", il tipo di documento TD04. Sono i punti da far confermare al commercialista **prima** della pubblicazione.
- **Nessuna promessa** di risparmi, tempi o conformità. Nessun confronto con altri prodotti.
- **L'app non trasmette allo SDI.** Ogni menzione lo dice. L'app non fa conservazione a norma e non versa il bollo.
- Esempi sempre dichiarati "di fantasia". Nessun numero di clienti, recensioni o testimonianze inventati.
- Tutti i contenuti devono poter essere letti da un artigiano non esperto, in italiano semplice, senza gergo inutile.

### Punti delle guide che dipendono da affermazioni "da verificare"

| Guida | Affermazione | Dove è nel `FISCAL-SPEC.md` | Come è formulata |
|---|---|---|---|
| Bollo | Soglia 77,47 € e importo 2 € | §1.4 (più fonti secondarie) | "regola generale più citata... verifica l'importo vigente" |
| Bollo | Versamento trimestrale con F24 | §1.4 | "in generale... di norma a cadenza trimestrale" |
| Bollo / Nota di credito | Bollo sulla nota di credito | §1.4 (fonti discordanti) | Non affermato: rimanda al commercialista |
| Fattura elettronica | Termine di 12 giorni | §1.5 | "il termine più citato... verifica" |
| Fattura elettronica | Obbligo per tutti dal 2024 | §4 | "in generale" |
| Cosa scrivere / Annullare | Dicitura forfettario, legge 190/2014 | §2.3 | "la formula più diffusa cita... fai confermare" |
| Annullare / Numerazione | Fattura scartata = non emessa | §1.2 | "in generale"; termini e numero rimandati al commercialista |
| Fattura elettronica | Portale gratuito, PEC, conservazione gratuita AdE | §3.1 e §3.2 | Formulazione generica, nessun indirizzo PEC citato |

## 5. Calendario dei nuovi contenuti

Un ritmo sostenibile per una persona sola: **una guida ogni due settimane**. Ogni nuova guida segue lo stesso schema (H1, meta description, FAQ, JSON-LD, riquadro di verifica, link a 3-4 guide collegate). Le date sono indicative.

| Quando | Guida proposta | Keyword | Note |
|---|---|---|---|
| Settimana 2 | Fattura scartata dallo SDI: cosa fare | fattura scartata SDI, come correggerla | Richiede conferma commercialista su termini di reinvio |
| Settimana 4 | Ricevute dello SDI: consegnata, mancata consegna, scartata | ricevute SDI significato | Alto valore pratico |
| Settimana 6 | Conservazione delle fatture elettroniche per i forfettari | conservazione fatture elettroniche gratis | Da verificare servizio gratuito AdE |
| Settimana 8 | Preventivo per ristrutturazione bagno: voci da non dimenticare | preventivo ristrutturazione bagno | Ricerca stagionale, esempi di fantasia |
| Settimana 10 | Preventivo per serramentisti / manutentori: modello | preventivo serramenti | Target del prodotto |
| Settimana 12 | Come dettare un preventivo con il telefono: trucchi per cantieri rumorosi | dettatura vocale preventivo | Onesto sui limiti della dettatura |
| Settimana 14 | Acconti e caparre nei lavori: cosa scrivere | acconto lavori preventivo | Solo parte pratica; fiscale al commercialista |
| Settimana 16 | Fattura a cliente privato senza codice fiscale: cosa fare | fattura consumatore codice fiscale | Da verificare con commercialista |
| Ogni 3 mesi | **Revisione di tutte le guide** | tutte | Aggiornare data "ultimo controllo" solo dopo una verifica reale |

Il contenuto che porta più fiducia è quello onesto sui limiti: ogni guida può dire chiaramente "questo non lo sappiamo, chiedi al commercialista".

## 6. Come misurare (Search Console e altro)

Strumenti previsti, tutti gratuiti e senza cookie sulle pagine:

1. **Google Search Console**, proprietà "Dominio" `[DOMINIO]` (verifica con record DNS: non richiede codice nelle pagine). Poi:
   - inviare `https://[DOMINIO]/sitemap.xml` da "Sitemap";
   - controllare "Pagine" → quante guide risultano indicizzate (le 12 pagine + radice);
   - usare "Ispezione URL" sulle guide appena pubblicate;
   - leggere "Rendimento" → query, pagine, impressioni, clic, CTR, posizione media.
2. **Bing Webmaster Tools** (importa la proprietà da Search Console in pochi clic).
3. **Misura dei visitatori che aprono l'app.** Le pagine non hanno analytics di terze parti e la privacy lo dichiara. Soluzioni compatibili: aggiungere ai link verso l'app un parametro di origine (es. `/?from=guida-bollo#/`) **solo se** l'app o il server lo registrano rispettando la privacy; oppure chiedere agli utenti "come ci hai conosciuti?" in fase di registrazione. Se in futuro si adotta uno strumento di analisi, aggiornare prima l'informativa privacy e `public/legal/cookie.html`.

Indicatori da guardare, **senza obiettivi inventati** (non abbiamo benchmark): numero di pagine indicizzate, impressioni e clic per guida, query che portano clic, pagine con molte impressioni e pochi clic (da migliorare nel titolo), quante persone arrivano all'app (quando misurabile). Decisioni dopo 8-12 settimane di dati, non prima: una pagina nuova può impiegare settimane o mesi prima di posizionarsi.

Dati da compilare quando disponibili:

| Metrica | Valore | Data |
|---|---|---|
| Pagine indicizzate | [DA MISURARE] | |
| Impressioni (28 giorni) | [DA MISURARE] | |
| Clic (28 giorni) | [DA MISURARE] | |
| Query principali | [DA MISURARE] | |

## 7. Link esterni etici

Niente acquisto di link, scambi di massa, commenti spam, directory dubbie o reti di siti. Percorsi leciti e coerenti con la fiducia che cerchiamo:

- **Rivenditori di materiali e ferramenta** e **associazioni di categoria**: proporre la guida pertinente come risorsa utile ai loro clienti/iscritti, indicando chiaramente chi siamo. Nessuna contropartita nascosta.
- **Gruppi e forum di categoria**: rispondere a domande reali citando la guida solo quando risolve davvero il problema, rispettando il regolamento; dichiarare sempre di essere gli autori.
- **Commercialisti e CAF** disposti a rivedere una guida: se vogliono essere citati come revisori, con il loro consenso scritto. Non citare nessuno senza permesso.
- **Contenuti ospiti** su blog di settore, con autore e rapporto dichiarati.
- **Scuole professionali e centri di formazione** per artigiani: guide come materiale didattico.
- Link `rel="nofollow"` o `rel="sponsored"` ove ci sia un rapporto commerciale.

Su ogni canale si dice chiaramente cosa fa l'app e cosa non fa (non trasmette allo SDI, non è consulenza).

## 8. Prima di pubblicare: lista di controllo

- [ ] Sostituire `[DOMINIO]` (sezione 2).
- [ ] Far rivedere le guide fiscali al commercialista (sezione 4, tabella). Aggiornare la data "ultimo controllo" nelle pagine dopo la revisione.
- [ ] Convertire le immagini OG in PNG 1200x630 (sezione 2, avvertenza 2).
- [ ] Verificare che il server serva `/guide/`, `/og/`, `/sitemap.xml`, `/robots.txt` come file statici.
- [ ] Inviare la sitemap a Search Console.
- [ ] Controllare che il testo delle guide non prometta funzioni che l'app non ha (rilettura finale con `docs/COMMERCIALISTA/00-LEGGIMI.md`).
- [ ] Decidere se la landing deve diventare una pagina statica indicizzabile.
