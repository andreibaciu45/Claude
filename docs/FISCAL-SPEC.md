# VocePreventivo — Specifica fiscale (fatturazione forfettari)

Redatto il 2026-11-04 dall'agente ANALISTA FISCALE. Documento di **ricerca**: nessuna riga di codice applicativo è stata toccata.
**Non è consulenza fiscale.** Va fatto rivedere da un commercialista prima dell'uso in produzione (vedi §7).

## 0. Metodo, fonti e limiti della ricerca (LEGGERE PRIMA)

- Gli host ufficiali **non erano raggiungibili** da questa sessione: `www.fatturapa.gov.it`, `www.agenziaentrate.gov.it` e `www.informazionefiscale.it`
  non risolvono (`getaddrinfo ENOTFOUND`, host fuori dai domini di rete consentiti). Non ho insistito.
  Per verificare le fonti primarie bisogna aggiungere questi host alla rete consentita della sessione, oppure farlo a mano.
- Ho usato solo **WebSearch**, che restituisce sintesi di fonti secondarie (Il Sole 24 Ore, Eutekne, Fatture in Cloud, fiscomania, Fiscozen, ecc.).
  **Nessuna affermazione di questo documento è stata letta su fonte primaria in questa sessione.**
- Quindi la scala di certezza è:
  - **CONFERMATO DA PIÙ FONTI SECONDARIE**: più siti indipendenti concordano; la norma sottostante è nota. Va comunque controllata sulla fonte primaria.
  - **DA VERIFICARE**: una sola fonte secondaria, fonti discordanti, oppure conoscenza generale mia non riscontrata in questa sessione.
  - **NON TROVATO**: non ho trovato nulla; non invento.
- Il grado **VERIFICATO su fonte primaria** non è stato raggiunto per nessun punto. Dove sotto compare "fonte primaria attesa", indica dove andare a controllare.

---

## 1. Numerazione, cancellazione, note di credito, bollo, termini

### 1.1 Numerazione delle fatture

| Regola | Fonte | Certezza |
|---|---|---|
| La fattura deve avere un numero progressivo che la identifichi in modo univoco (art. 21, c. 2, lett. b, DPR 633/1972). Il forfettario non applica IVA ma resta soggetto all'obbligo di fatturazione. | Fonte primaria attesa: DPR 633/72 art. 21 (Normattiva / Gazzetta Ufficiale). | DA VERIFICARE (conoscenza generale, non riscontrata in sessione) |
| Numerazione per anno solare (es. `1/2026`) oppure progressiva continua; in entrambi i casi univoca. Scelta consigliata: **un contatore per anno** e per sezionale. | Prassi; AdE ha ammesso più sezionali. | DA VERIFICARE |
| "Senza buchi": la norma richiede progressività e univocità; un buco è un indizio che un documento è stato emesso e non registrato. Per sicurezza l'app deve garantire **zero buchi** per le fatture emesse. | Raccomandazione di progetto. | Scelta di progetto |
| Sezionali (es. `A/1`, `B/1`) ammessi se ciascuno è progressivo; per l'MVP si prevede un solo sezionale più eventualmente uno per le note di credito. | Prassi. | DA VERIFICARE |
| Campo XML `Numero`: 1-20 caratteri, deve contenere almeno una cifra. | Schema XSD FatturaPA / Allegato A specifiche tecniche. | DA VERIFICARE (conoscenza dello schema, XSD non scaricato) |

**Scelta di progetto per non creare buchi:** la bozza di fattura **non ha numero definitivo**. Il numero viene assegnato nella stessa
transazione IndexedDB che porta lo stato a `emessa`. Annullare o eliminare una bozza non consuma numeri.
Questo oggi diverge da `nextDocumentNumber()` di ARCHITECTURE.md (che incrementa alla creazione): va cambiato, vedi §5.

### 1.2 Cosa si può fare con una fattura

| Stato | Cancellare? | Modificare? | Note |
|---|---|---|---|
| Preventivo (qualsiasi stato) | Sì | Sì | Non è documento fiscale. Se ha già generato una fattura, conservare il collegamento. |
| Fattura in **bozza** (mai emessa/inviata) | Sì | Sì | Nessun numero definitivo consumato (vedi 1.1). |
| Fattura **emessa** ma **scartata** dallo SDI (notifica NS) | Non cancellare: restare in stato `scartata` | Sì, correggere e **reinviare** | Una fattura scartata si considera **non emessa**. Si può rinviare **con lo stesso numero e la stessa data entro 5 giorni dalla notifica di scarto** (soluzione preferita). Oltre i 5 giorni, o se non si può rinviare con lo stesso numero: nuovo numero e data coerenti con i documenti emessi nel frattempo, con collegamento alla fattura scartata. Fonti: AdE risposta n. 140/2024 (citata da fonti secondarie), Fatture in Cloud, Namirial, Agenda Digitale. **CONFERMATO DA PIÙ FONTI SECONDARIE** sul principio dei 5 giorni; il trattamento del caso oltre 5 giorni è DA VERIFICARE (fonte primaria attesa: risposta AdE n. 140/2024 e circolare 14/E 2019). |
| Fattura **inviata e accettata/consegnata** (RC) o in mancata consegna (MC) | **MAI** | **MAI** | Una fattura accettata dallo SDI "non è più annullabile": si corregge con **nota di credito TD04** (eventualmente seguita da nuova fattura). CONFERMATO DA PIÙ FONTI SECONDARIE (TeamSystem, Fatture in Cloud). |

Anche una fattura inviata solo da noi (es. XML generato e scaricato, stato `emessa`) è considerata **emessa** a livello app dal momento
in cui l'utente conferma: da lì l'app non permette più di modificarla né eliminarla (§5), perché non possiamo sapere se è stata caricata sullo SDI.

### 1.3 Nota di credito (TD04)

| Punto | Contenuto | Fonte / certezza |
|---|---|---|
| Quando | Storno totale o parziale di una fattura già emessa (errore su importi, resi, sconti successivi, annullamento). Per forfettari senza IVA vale lo stesso. | DA VERIFICARE (prassi diffusa; fonti secondarie: TeamSystem, Fiscozen) |
| TipoDocumento | `TD04` | Allegato A specifiche tecniche (tabella TipoDocumento). DA VERIFICARE su fonte primaria. |
| Numerazione | Entra nella stessa numerazione progressiva delle fatture **oppure** in un sezionale dedicato (es. `NC1/2026`). Scelta MVP: **sezionale dedicato note di credito**, progressivo per anno. | Scelta di progetto; legittimo con sezionali. DA VERIFICARE col commercialista. |
| Riferimento al documento originale | Blocco `DatiFattureCollegate` dentro `DatiGenerali` con `IdDocumento` (numero fattura originale) e `Data` (data originale). Utile anche richiamare nella `Causale`. | Struttura dello schema (conoscenza generale). DA VERIFICARE su XSD. |
| Natura / aliquota | Come la fattura originale: `AliquotaIVA 0.00` e `Natura N2.2`. Importi **positivi** nello XML (la nota di credito è identificata dal TipoDocumento, non dal segno). | Fonte secondaria: guida CAF che indica N2.2 anche per TD04 forfettario. DA VERIFICARE. |
| Quando si può emettere | Per i forfettari non c'è il termine IVA dell'art. 26 (non detraggono IVA), ma conviene emettere la nota **senza ritardo** e nel periodo d'imposta corretto per i ricavi per cassa. | DA VERIFICARE col commercialista |

### 1.4 Bollo (imposta di bollo 2,00 €)

| Punto | Contenuto | Certezza |
|---|---|---|
| Quando | Fatture senza IVA (qui: forfettario, Natura N2.2) con importo **superiore a 77,47 €**: bollo da 2,00 €. Il totale su cui valutare la soglia include eventuali contributi previdenziali. | CONFERMATO DA PIÙ FONTI SECONDARIE (Fiscozen e altri). Fonte primaria attesa: DPR 642/1972, art. 13 Tariffa Parte I. |
| Come si indica nello XML | `DatiGeneraliDocumento/DatiBollo` con `BolloVirtuale` = `SI` e `ImportoBollo` = `2.00`. | CONFERMATO DA FONTE SECONDARIA (Fiscozen). Struttura da verificare su XSD. |
| Addebito al cliente | Di norma si addebita al cliente con una riga "Rimborso imposta di bollo" a 2,00 € con Natura **N1** (esclusa art. 15 DPR 633/72), con relativo `DatiRiepilogo` N1 e incluso in `ImportoTotaleDocumento`. Se resta a carico del fornitore: nessuna riga, ma `DatiBollo` va comunque valorizzato. | DA VERIFICARE (prassi professionale diffusa, non riscontrata su fonte primaria) |
| Versamento | A carico del fornitore tramite F24 con i codici tributo trimestrali (es. 2524 per il 4° trimestre, secondo una fonte), con scadenze trimestrali; AdE calcola l'importo dalle fatture inviate. L'app **non** paga né calcola il versamento, ma può esporre il conteggio. | Codice 2524 CONFERMATO DA FONTE SECONDARIA (Fiscozen); scadenze e regime dei piccoli importi DA VERIFICARE |
| Bollo e nota di credito | Le fonti secondarie **sono discordanti**: una dice che la nota di credito non fa recuperare il bollo già versato sull'originale; un'altra che se la nota scende sotto 77,47 € la nota stessa non è soggetta. **Regola proposta (prudente):** il bollo già versato sulla fattura originale non viene stornato dall'app; la nota di credito ha il proprio bollo solo se il suo importo supera 77,47 € e non reca IVA (valutazione identica a una fattura). | DA VERIFICARE col commercialista (rischio reale) |
| Preventivi | Non rientrano di norma tra i documenti soggetti a bollo (vedi §4.6). | DA VERIFICARE |

### 1.5 Termini di emissione, data operazione e data documento

| Punto | Contenuto | Certezza |
|---|---|---|
| 12 giorni | La fattura immediata va emessa entro **12 giorni dall'effettuazione dell'operazione** (art. 21, c. 4, DPR 633/72). Il termine si riferisce alla **trasmissione allo SDI**. Un caso di trasmissione oltre il 12° giorno è considerato tardivo anche se cade in un giorno festivo (interpello 129/2020, citato da fonte secondaria). | CONFERMATO DA PIÙ FONTI SECONDARIE (fiscomania, money.it, Assolombarda, Fatture in Cloud). Fonte primaria attesa: art. 21 DPR 633/72 e circolare AdE 14/E 2019. |
| Data del documento | Nel campo `Data` si indica la data di effettuazione dell'operazione. La data di invio allo SDI può essere successiva, entro i 12 giorni. Esiste dibattito: alcune fonti dicono che un documento immediato con data posteriore all'operazione non sia corretto. | DA VERIFICARE (discordanza tra fonti) |
| Momento dell'operazione per servizi | Per le prestazioni di servizi coincide col pagamento del corrispettivo; per le cessioni di beni con la consegna/spedizione. Un artigiano che fa lavoro + materiali tende a fatturare a fine lavori. | CONFERMATO DA FONTE SECONDARIA; norma: art. 6 DPR 633/72. DA VERIFICARE |
| Fattura differita | Possibile entro il 15 del mese successivo se c'è documento di trasporto/consegna. **Fuori MVP.** | CONFERMATO DA FONTE SECONDARIA |
| Sanzioni per ritardo | Art. 6 D.Lgs. 471/97. Un sito divulgativo cita 90%-180% dell'imponibile con minimo di 500 €, ma per chi non ha IVA le misure sono diverse. **Non riportare cifre in UI.** | DA VERIFICARE |

**Regola per l'app:** campo `Data` = data operazione, proposta uguale alla data odierna, modificabile. Se la fattura viene scaricata/trasmessa
più di 12 giorni dopo `Data`, mostrare un avviso (non un blocco) e registrare nell'audit log.

---

## 2. Fattura elettronica FatturaPA per forfettari (B2B e B2C)

### 2.1 Versione dello schema e delle specifiche tecniche

| Elemento | Esito | Certezza |
|---|---|---|
| Specifiche tecniche (Allegato A) **versione 1.9.1**, pubblicate il 31 marzo 2026, in vigore dal **15 maggio 2026**. Novità riportate dalle fonti: nuovo controllo 00327 per fatture verso la capogruppo di gruppo IVA; massimo codici destinatario da 100 a 300; aggiornate le procedure di accreditamento web service/SFTP; nuovo valore `ESENZSPORT` in `AltriDatiGestionali` (compensi sportivi dilettanti); obbligo CUN per prodotti agroalimentari dal 16 maggio 2026. | Fonti: Il Sole 24 Ore, Eutekne, Edicom, Informazione Fiscale, FIP. Nessuna fonte primaria letta. | DA VERIFICARE (fonti secondarie concordi, nessuna primaria) |
| Versione precedente 1.9 in vigore dal 1° aprile 2025 (introdusse TD29 per segnalare omessa/irregolare fatturazione e il regime fiscale RF20). | Fonti: Sovos, Namirial, studiopizzano. | DA VERIFICARE |
| Attributo `versione` del file e `FormatoTrasmissione`: **`FPR12`** (fatture verso privati e P.IVA, "ordinaria"). Resta il formato per il nostro caso. Namespace: `http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2`. | Conoscenza generale dello schema, coerente con tutte le fonti. | DA VERIFICARE su XSD |
| Numero di versione del file XSD (es. 1.2.2 o 1.2.3): **fonti discordanti** (una dice che lo schema 1.2.2 "resta valido nel 2026"; un'altra non conferma la 1.2.3). **Non so quale sia il file XSD in vigore.** | — | **NON TROVATO** (da risolvere scaricando l'XSD dal sito ufficiale) |
| Versioni successive alla 1.9.1 uscite fra maggio e novembre 2026: **non ho potuto verificare**; la ricerca non ne ha restituite. | — | **NON TROVATO** |

**Dove scaricare lo schema XSD ufficiale (da fare a mano, non l'ho potuto fare):**
sito FatturaPA (`fatturapa.gov.it` → Norme e regole → Documentazione FatturaPA → "Formato FatturaPA" / schema del file XML) e sezione "Fatturazione elettronica"
del sito dell'Agenzia delle Entrate → "Specifiche tecniche". L'URL esatto del file `.xsd` **non l'ho verificato**: non lo scrivo per non inventarlo.
Il pacchetto dello schema richiama anche gli XSD di xmldsig (`ds:`), che servono per la validazione offline.
Il repository `italia/fatturapa-testsdi` (GitHub, ricordato nei risultati) è un riferimento per i test SDI, non uno schema ufficiale.

**Come validare (solo nei test, NON installare ora):**
1. Scaricare XSD + xmldsig nella cartella `test/fixtures/xsd/` (da committare, versionati: il nome file riporta la versione).
2. Validare i fixture XML con `xmllint --noout --schema FatturaPA.xsd file.xml` (CLI, in CI Linux) oppure da Vitest con `xmllint-wasm` (WASM, funziona in Node senza binari nativi) o `libxmljs2`.
3. Test di regressione: i 2 fixture in §2.5 devono validare, e un set di fixture "negativi" (P.IVA lunga, Numero senza cifre, ecc.) devono fallire.
4. Il controllo XSD **non basta**: lo SDI applica controlli semantici (coerenza totali, bollo, natura, destinatario). Vedi §5.3.
5. Strumenti ufficiali gratuiti per la verifica manuale: "Controlla fattura" e "Verifica file" del portale Fatture e Corrispettivi (AdE). Esistenza CONFERMATA DA CONOSCENZA GENERALE, DA VERIFICARE.

Nota: in questa sessione ho controllato solo la **buona formazione** XML dei due esempi con `xmllint` (vedi §2.5), **non** la validità contro lo XSD.

### 2.2 Struttura XML essenziale (forfettario, fattura TD01)

Ordine degli elementi (l'XSD è una `sequence`: l'ordine conta). Tutte le informazioni sulla struttura sono **DA VERIFICARE sull'XSD**.

**FatturaElettronicaHeader**
- `DatiTrasmissione`
  - `IdTrasmittente` (`IdPaese` = IT, `IdCodice` = codice fiscale/identificativo di chi trasmette)
  - `ProgressivoInvio`: 1-10 caratteri alfanumerici, univoco per trasmittente
  - `FormatoTrasmissione`: `FPR12`
  - `CodiceDestinatario`: 7 caratteri. Codice SDI del cliente, oppure `0000000` se il cliente usa PEC o è consumatore, oppure `XXXXXXX` per clienti esteri.
  - `PECDestinatario` (solo se `0000000` e il cliente ha comunicato una PEC)
- `CedentePrestatore`
  - `DatiAnagrafici`: `IdFiscaleIVA` (IT + P.IVA), `CodiceFiscale`, `Anagrafica` (`Denominazione` **oppure** `Nome` + `Cognome`), **`RegimeFiscale` = `RF19`** (Regime forfettario)
  - `Sede`: `Indirizzo`, `CAP`, `Comune`, `Provincia`, `Nazione`
  - facoltativi: `IscrizioneREA` (utile per artigiani iscritti), `Contatti`
- `CessionarioCommittente`
  - `DatiAnagrafici`: `IdFiscaleIVA` (se ha P.IVA) e/o `CodiceFiscale`; `Anagrafica`
  - `Sede`

**FatturaElettronicaBody**
- `DatiGenerali/DatiGeneraliDocumento`: `TipoDocumento` (`TD01` fattura, `TD04` nota di credito), `Divisa` = `EUR`, `Data` (YYYY-MM-DD), `Numero`, `DatiBollo` (se dovuto), `ImportoTotaleDocumento`, `Causale` (testo libero, max 200 caratteri per occorrenza, ripetibile)
- `DatiGenerali/DatiFattureCollegate` (solo nota di credito): `IdDocumento`, `Data`
- `DatiBeniServizi`
  - `DettaglioLinee`: `NumeroLinea`, `Descrizione`, `Quantita`, `UnitaMisura`, `PrezzoUnitario`, `PrezzoTotale`, `AliquotaIVA` = `0.00`, **`Natura` = `N2.2`**
  - `DatiRiepilogo`: uno per ogni coppia aliquota/natura: `AliquotaIVA`, `Natura`, `ImponibileImporto`, `Imposta` = `0.00`, `RiferimentoNormativo`
- `DatiPagamento` (consigliato): `CondizioniPagamento` (`TP02` pagamento completo), `DettaglioPagamento` (`ModalitaPagamento` es. `MP05` bonifico, `MP08` carta, `MP01` contanti, `DataScadenzaPagamento`, `ImportoPagamento`, `IBAN`)

### 2.3 Regole per il forfettario

| Tema | Regola | Fonte / certezza |
|---|---|---|
| Regime fiscale | `RegimeFiscale` = `RF19` | CONFERMATO DA FONTE SECONDARIA coerente con la conoscenza dello schema; DA VERIFICARE su Allegato A |
| IVA | Nessuna IVA in fattura, nessuna rivalsa (`AliquotaIVA` `0.00`, `Natura` `N2.2` "non soggette – altre operazioni"). Fonte secondaria: "Il campo Natura deve essere valorizzato con N2.2". | CONFERMATO DA FONTE SECONDARIA; norma: L. 190/2014 art. 1 c. 58. DA VERIFICARE. |
| Dicitura obbligatoria | In `RiferimentoNormativo` (e meglio anche in `Causale`): *"Operazione effettuata ai sensi dell'articolo 1, commi da 54 a 89, della Legge n. 190/2014 – Regime forfettario"*. Fino a 100 caratteri in `RiferimentoNormativo`: il testo breve sicuro è *"Art. 1, c. 54-89, L. 190/2014 - Regime forfettario"*. | Testo di prassi; DA VERIFICARE. Fonte primaria attesa: L. 190/2014. |
| Ritenuta d'acconto | **Non applicabile**: i ricavi dei forfettari non sono assoggettati a ritenuta (art. 1, c. 67, L. 190/2014). Il forfettario non compila `DatiRitenuta`; in `Causale` si consiglia: *"Compenso non assoggettato a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014"*. | DA VERIFICARE (conoscenza generale) |
| Cassa previdenziale | Gli artigiani sono nella gestione INPS Artigiani: **non** hanno una cassa da rivalsare in fattura, quindi niente `DatiCassaPrevidenziale`. È rilevante solo per professionisti con cassa (es. 4% integrativo) — fuori MVP. | DA VERIFICARE |
| Consumatori finali | `CessionarioCommittente` con solo `CodiceFiscale` (niente `IdFiscaleIVA`), `CodiceDestinatario` = `0000000`. La fattura va comunque trasmessa allo SDI. Al consumatore va consegnata una **copia analogica o elettronica** (copia di cortesia, anche PDF). | Conoscenza generale; DA VERIFICARE |
| Cliente con P.IVA italiana | `IdFiscaleIVA` IT + P.IVA, `CodiceFiscale` se disponibile; `CodiceDestinatario` a 7 caratteri se noto, altrimenti `0000000` (con `PECDestinatario` se nota). Se non c'è codice né PEC, la fattura finisce nell'area riservata del cliente su Fatture e Corrispettivi. | Conoscenza generale; DA VERIFICARE |
| Cliente estero | `CodiceDestinatario` = `XXXXXXX`; `IdFiscaleIVA` con il codice paese del cliente; `Sede/Nazione` = codice ISO; `CAP` = `00000` e `Provincia` omessa se estero. Per servizi a UE/extra-UE bisogna valutare la natura dell'operazione (può cambiare `Natura` e regole). **Fuori MVP: bloccare o avvisare.** | Conoscenza generale; DA VERIFICARE |
| Bollo | Vedi §1.4. | — |
| Esigibilità IVA | Non va indicata (`EsigibilitaIVA` omesso) quando c'è `Natura`. | Conoscenza dello schema; DA VERIFICARE |

### 2.4 Nome file, codifica, firma

| Punto | Regola | Certezza |
|---|---|---|
| Nome file | `IT` + identificativo del trasmittente + `_` + progressivo di **5 caratteri alfanumerici** + `.xml`; esempio `IT01234567897_00001.xml`. Il progressivo del nome file è indipendente dal numero fattura e deve essere univoco per trasmittente. | DA VERIFICARE su Allegato A. Sfumatura da chiarire: lo schema indica come `IdCodice` il codice fiscale del trasmittente; se il trasmittente è la ditta individuale, CF e P.IVA possono differire. Negli esempi si usa la P.IVA sia in `IdTrasmittente` sia nel nome file, in coerenza fra loro. **Controllare con prova di invio sul portale AdE.** |
| Codifica | UTF-8, dichiarazione `<?xml version="1.0" encoding="UTF-8"?>`, niente BOM. Caratteri non ammessi (es. alcuni caratteri di controllo) vanno ripuliti; i campi di testo accettano caratteri Latin-1 ASCII-compatibili nella lista caratteri dell'Allegato A (**da verificare quali**). Escape XML obbligatorio per `&`, `<`, `>`. | DA VERIFICARE |
| Firma digitale | **Non obbligatoria** per fatture verso privati e P.IVA (obbligatoria solo se si firma per volontà o per PA). | CONFERMATO DA FONTE SECONDARIA (avvocatoandreani.it / Agenda Digitale), DA VERIFICARE |
| Formato di trasmissione | `FPR12` per B2B/B2C; `FPA12` è per la PA e **non** è nel nostro perimetro (fatture a PA richiedono Codice Univoco Ufficio, CIG/CUP, split payment, ecc.). | Conoscenza generale; DA VERIFICARE |

### 2.5 Due esempi XML completi (fixture di test)

Dati interamente **fittizi**: P.IVA `01234567897` e `09876543217` hanno il carattere di controllo corretto (calcolato), i CF `RSSMRA80A01H501U` e
`VRDLGI85M41F205H` anche (algoritmo standard). **Non usare in produzione.**
Esito dei controlli in sessione: **ben formati** (`xmllint --noout`); **non validati contro XSD** (non scaricabile).

#### Esempio A — Fattura TD01, forfettario, cliente consumatore, con bollo a carico del cliente

Calcolo: 280,00 + 54,00 + 36,00 = 370,00 (imponibile N2.2) + 2,00 rimborso bollo (N1) = 372,00. Bollo dovuto: importo non-IVA 370 > 77,47.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
    xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_v1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>01234567897</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>00001</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>01234567897</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>
        <Anagrafica>
          <Nome>Mario</Nome>
          <Cognome>Rossi</Cognome>
        </Anagrafica>
        <RegimeFiscale>RF19</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 10</Indirizzo>
        <CAP>00100</CAP>
        <Comune>Roma</Comune>
        <Provincia>RM</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>VRDLGI85M41F205H</CodiceFiscale>
        <Anagrafica>
          <Nome>Luigia</Nome>
          <Cognome>Verdi</Cognome>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Milano 5</Indirizzo>
        <CAP>20100</CAP>
        <Comune>Milano</Comune>
        <Provincia>MI</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-10-15</Data>
        <Numero>12/2026</Numero>
        <DatiBollo>
          <BolloVirtuale>SI</BolloVirtuale>
          <ImportoBollo>2.00</ImportoBollo>
        </DatiBollo>
        <ImportoTotaleDocumento>372.00</ImportoTotaleDocumento>
        <Causale>Operazione effettuata ai sensi dell'articolo 1, commi da 54 a 89, della Legge n. 190/2014 - Regime forfettario.</Causale>
        <Causale>Compenso non assoggettato a ritenuta d'acconto ai sensi dell'art. 1, comma 67, L. 190/2014.</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Manodopera idraulica - sostituzione rubinetto cucina</Descrizione>
        <Quantita>8.00</Quantita>
        <UnitaMisura>h</UnitaMisura>
        <PrezzoUnitario>35.00</PrezzoUnitario>
        <PrezzoTotale>280.00</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>2</NumeroLinea>
        <Descrizione>Tubo rame 16 mm</Descrizione>
        <Quantita>12.00</Quantita>
        <UnitaMisura>m</UnitaMisura>
        <PrezzoUnitario>4.50</PrezzoUnitario>
        <PrezzoTotale>54.00</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>3</NumeroLinea>
        <Descrizione>Rubinetto miscelatore cucina</Descrizione>
        <Quantita>1.00</Quantita>
        <UnitaMisura>pz</UnitaMisura>
        <PrezzoUnitario>36.00</PrezzoUnitario>
        <PrezzoTotale>36.00</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
      </DettaglioLinee>
      <DettaglioLinee>
        <NumeroLinea>4</NumeroLinea>
        <Descrizione>Rimborso imposta di bollo</Descrizione>
        <Quantita>1.00</Quantita>
        <PrezzoUnitario>2.00</PrezzoUnitario>
        <PrezzoTotale>2.00</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N1</Natura>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
        <ImponibileImporto>370.00</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>Art. 1, c. 54-89, L. 190/2014 - Regime forfettario</RiferimentoNormativo>
      </DatiRiepilogo>
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N1</Natura>
        <ImponibileImporto>2.00</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>Escluso art. 15 DPR 633/72 - Rimborso bollo</RiferimentoNormativo>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>2026-11-14</DataScadenzaPagamento>
        <ImportoPagamento>372.00</ImportoPagamento>
        <IBAN>IT60X0542811101000000123456</IBAN>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
```

Nota sull'IBAN dell'esempio: è l'IBAN di esempio ampiamente usato in documentazione (checksum valido), non di una persona reale.

#### Esempio B — Nota di credito TD04, storno parziale (rubinetto 36,00 €) della fattura 12/2026

Importo 36,00 € ≤ 77,47 € e senza IVA → **nessun bollo** sulla nota (regola prudente di §1.4; DA VERIFICARE). Progressivo nome file diverso: `IT01234567897_00002.xml`.
Cliente persona giuridica con P.IVA e codice destinatario, per mostrare anche questo caso (in un fixture reale tenere lo stesso cliente della fattura originale).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
    xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_v1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>01234567897</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>00002</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>ABC1234</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>01234567897</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>
        <Anagrafica>
          <Nome>Mario</Nome>
          <Cognome>Rossi</Cognome>
        </Anagrafica>
        <RegimeFiscale>RF19</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 10</Indirizzo>
        <CAP>00100</CAP>
        <Comune>Roma</Comune>
        <Provincia>RM</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>09876543217</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>Bianchi Costruzioni S.r.l.</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Torino 3</Indirizzo>
        <CAP>10100</CAP>
        <Comune>Torino</Comune>
        <Provincia>TO</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD04</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-10-20</Data>
        <Numero>NC1/2026</Numero>
        <ImportoTotaleDocumento>36.00</ImportoTotaleDocumento>
        <Causale>Storno parziale della fattura n. 12/2026 del 15/10/2026: reso rubinetto miscelatore.</Causale>
        <Causale>Operazione effettuata ai sensi dell'articolo 1, commi da 54 a 89, della Legge n. 190/2014 - Regime forfettario.</Causale>
      </DatiGeneraliDocumento>
      <DatiFattureCollegate>
        <RiferimentoNumeroLinea>3</RiferimentoNumeroLinea>
        <IdDocumento>12/2026</IdDocumento>
        <Data>2026-10-15</Data>
      </DatiFattureCollegate>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Storno: Rubinetto miscelatore cucina (reso)</Descrizione>
        <Quantita>1.00</Quantita>
        <UnitaMisura>pz</UnitaMisura>
        <PrezzoUnitario>36.00</PrezzoUnitario>
        <PrezzoTotale>36.00</PrezzoTotale>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N2.2</Natura>
        <ImponibileImporto>36.00</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>Art. 1, c. 54-89, L. 190/2014 - Regime forfettario</RiferimentoNormativo>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
```

Note sui fixture:
- In B il `RiferimentoNumeroLinea` (3) si riferisce alla riga della fattura originale; è facoltativo e va omesso per storno totale.
- `schemaLocation`: l'URL dell'XSD in `xsi:schemaLocation` è quello comunemente riportato in letteratura; **non verificato**. L'attributo non incide sulla validazione SDI, ma va confermato prima di inserirlo nel generatore (si può omettere).
- Storno **totale**: copiare tutte le righe della fattura originale (compresa l'eventuale riga di rimborso bollo N1, se si decide di restituirlo; politica da concordare col commercialista).
- Caso cliente con PEC: `CodiceDestinatario` `0000000` + `PECDestinatario`. Caso estero: `CodiceDestinatario` `XXXXXXX`, `IdPaese` del cliente, `CAP` `00000`.

---

## 3. Trasmissione allo SDI

### 3.1 Opzioni

| Opzione | Come funziona | Costi | Pro | Contro | Certezza |
|---|---|---|---|---|---|
| **(a) Download XML + upload manuale** sul portale gratuito *Fatture e Corrispettivi* dell'AdE (o app FatturAE) | L'app genera e valida l'XML; l'utente lo carica con SPID/CIE/CNS. Le notifiche sono visibili nel portale. | Zero | Nessuna responsabilità tecnica sul canale; nessun backend; nessun accreditamento; rispetta "no dati sui nostri server" | Passaggio manuale; l'app non sa l'esito (serve che l'utente lo riporti a mano); onere sull'utente di rispettare i 12 giorni | Esistenza e gratuità del portale: conoscenza generale, DA VERIFICARE (host AdE non raggiungibile) |
| **(b) PEC** a `sdi01@pec.fatturapa.it` | L'utente invia l'XML come allegato dalla propria PEC. Al **primo** invio, nella prima risposta (RC o NS) lo SDI comunica l'indirizzo PEC da usare per gli invii successivi. Le ricevute tornano alla stessa casella PEC. Nessun accreditamento preventivo. Firma non richiesta per B2B/B2C. **Se si invia la fattura alla PEC del cliente senza passare dallo SDI, la fattura è considerata non emessa.** | Costo della casella PEC (di norma già posseduta dall'artigiano, obbligatoria per ditte) | Nessun accreditamento; automatizzabile dal client di posta dell'utente | Una PWA senza backend non può spedire PEC: serve che l'utente allegi il file a mano (o `navigator.share` con file verso l'app di posta). Controllo più debole delle ricevute | CONFERMATO DA PIÙ FONTI SECONDARIE (avvocatoandreani.it, Agenda Digitale, Odoo/pypi doc) sul processo; indirizzo `sdi01@pec.fatturapa.it` per il primo invio: DA VERIFICARE su fonte AdE |
| **(c) Provider/intermediario con API** (Aruba, Fatture in Cloud, OpenAPI.com, A-Cube, Invoicetronic, Invopop…) | L'app (o un nostro backend) invia l'XML via REST; il provider trasmette allo SDI e restituisce le notifiche (anche via webhook). Due modelli: **(c1) account del cliente** (l'artigiano ha il proprio account/chiavi sul provider; il cliente è il soggetto che si accredita) oppure **(c2) nostro account** (siamo noi, o il nostro provider, il trasmittente per conto di tutti: ci vuole delega/mandato e più responsabilità). | Vedi tabella sotto | Notifiche automatiche, stato in app, conservazione spesso inclusa | Serve un **backend** (chiavi API non vanno nel client PWA), contratto, DPA, costi ricorrenti | Vedi sotto |
| **(d) Accreditamento diretto SDICoop / SFTP** | Si diventa trasmittente accreditati: richiesta sul portale AdE, test di conformità/interoperabilità, endpoint pubblici HTTPS con certificati dedicati (SDICoop richiede un servizio SOAP esposto per ricevere notifiche; canale SFTP alternativo). | Nessuna tariffa AdE trovata; costi = sviluppo, certificati, infrastruttura h24, monitoraggio | Nessun costo per fattura, controllo totale | Tempi e complessità elevati (nelle community i test di interoperabilità falliscono spesso per certificati/SSL); responsabilità operativa piena; **non adatto a un MVP** | Esistenza della procedura: CONFERMATO DA FONTI SECONDARIE (Microsoft Docs, forum Italia). Costi e tempi: **NON TROVATO** (nessuna fonte primaria) |

#### Provider con API — dati effettivamente trovati

| Provider | Dato trovato | Certezza |
|---|---|---|
| OpenAPI.com | "Nessun costo di attivazione, paghi quanto consumi"; prezzo fatturazione elettronica **da 0,025 € + IVA** per documento; consultazione codice destinatario da 0,015 € a chiamata; free tier di 1.440 richieste/giorno; blog del 2020 cita 10 anni di conservazione inclusa. | DA VERIFICARE (snippet di pagina commerciale; verificare listino attuale e cosa include "da") |
| Aruba Fatturazione Elettronica | API con limiti d'uso (es. 30 invii/minuto per IP, riportato per v1 e v2 firmate). Prezzi **non trovati**. | Limiti: DA VERIFICARE. Prezzi: NON TROVATO |
| Fatture in Cloud | Ha API e una guida alla fatturazione elettronica; prezzi API **non trovati**. | NON TROVATO |
| A-Cube | Accreditato presso l'AdE per lo scambio in Italia e su Peppol; ambiente sandbox di default; prezzi **non trovati**. | Prezzi: NON TROVATO |
| Invoicetronic | API REST per inviare/ricevere dallo SDI, chiave di test per sandbox e chiave live; per l'ambiente di produzione è richiesta una registrazione presso l'AdE. Prezzi **non trovati**. | Prezzi: NON TROVATO |
| Invopop | Documentazione per app SDI Italia; prezzi **non verificati**. | NON TROVATO |

Per decidere serve **chiedere preventivi** a 2-3 provider (cost per documento, minimo mensile, SLA, webhook, conservazione, DPA, mandato).

#### Notifiche SDI da gestire (stato in app, §5)

| Sigla | Nome | Significato | Stato app proposto | Certezza |
|---|---|---|---|---|
| NS | Notifica di scarto | Il file non supera i controlli; la fattura è **non emessa**; reinvio entro 5 giorni stesso numero/data | `scartata` | CONFERMATO DA PIÙ FONTI SECONDARIE |
| RC | Ricevuta di consegna | Consegnata al destinatario | `consegnata` | CONFERMATO DA PIÙ FONTI SECONDARIE |
| MC | Mancata consegna | SDI non riesce a recapitare (es. canale non attivo); per i privati la fattura **si considera emessa**; il cedente dovrebbe avvisare il cliente per altra via e la fattura è nell'area riservata del cliente | `mancata_consegna` | CONFERMATO DA PIÙ FONTI SECONDARIE; tempi di nuovi tentativi discordanti fra fonti (da pochi minuti fino a 5 o 10 giorni): DA VERIFICARE |
| NE | Notifica esito committente | Solo per **fatture PA** (EC01 accettata / EC02 rifiutata) | non usato (PA fuori perimetro) | CONFERMATO DA PIÙ FONTI SECONDARIE |
| DT | Decorrenza termini | Solo PA: scaduti i termini per esito (15 giorni, secondo una fonte) | non usato | DA VERIFICARE |
| AT | Attestazione di avvenuta trasmissione con impossibilità di recapito | Solo PA | non usato | CONFERMATO DA FONTI SECONDARIE |

Alcune fonti indicano che per i privati lo SDI risponde con RC oppure MC (la "ricevuta di impossibilità di recapito" è il nome comune per MC nel B2B/B2C).
Il nome preciso e le tipologie vanno rivisti su Allegato A.

### 3.2 Conservazione elettronica a norma

- Le fatture elettroniche vanno conservate in modo elettronico a norma per **10 anni** (conservazione). CONFERMATO DA PIÙ FONTI SECONDARIE; fonte primaria attesa: DM 17/06/2014 e art. 2220 c.c.
- L'AdE offre un **servizio gratuito di conservazione** per le fatture transitate dallo SDI. **Non è automatico**: va attivato in *Fatture e Corrispettivi* accettando la convenzione. Chi non aderisce non è coperto. Le fatture precedenti all'adesione vanno caricate/gestite a parte. CONFERMATO DA PIÙ FONTI SECONDARIE.
- Durata del servizio AdE: **fonti discordanti** (10 anni dalla fine dell'anno di riferimento secondo alcune, "15 anni" secondo altre; durata della convenzione 3 anni rinnovabile secondo un articolo del 2021). **NON confermato**: verificare sul portale.
- Per l'app: NON siamo conservatori. L'IndexedDB locale e il backup JSON **non** sono conservazione a norma. Messaggio in UI: "Per la conservazione legale attiva il servizio gratuito dell'Agenzia delle Entrate o usa un conservatore". Il file XML emesso deve comunque restare scaricabile e immutabile (hash, §5).

### 3.3 Confronto e raccomandazione per l'MVP

| Criterio | (a) Upload manuale | (b) PEC manuale | (c) API provider | (d) SDICoop diretto |
|---|---|---|---|---|
| Costo per fattura | 0 | 0 (+ costo PEC) | indicativo da 0,025 € (OpenAPI), altri da richiedere | 0 + costi infrastrutturali |
| Backend necessario | No | No | Sì | Sì |
| Tempo di sviluppo | Minimo | Minimo | Medio | Alto (settimane/mesi, non quantificato da fonti) |
| Stato esito in app | Manuale | Manuale | Automatico | Automatico |
| Responsabilità nostra | Qualità XML | Qualità XML | Qualità XML + disponibilità servizio + dati personali + eventuale mandato | Massima |
| Compatibile con "nessun backend v1" | Sì | Sì | No | No |

**RACCOMANDAZIONE (MVP economico):**
1. **v1: opzione (a)**, con (b) come alternativa descritta in UI. L'app genera XML, lo valida (XSD + regole semantiche §5.3), lo fa scaricare/condividere, e guida l'utente al caricamento sul portale gratuito AdE. L'utente aggiorna lo stato della fattura a mano (`inviata`, `consegnata`, `scartata`, `mancata consegna`) con campi per incollare data e identificativo SDI.
2. **v2: opzione (c1)**, provider con API **su account dell'utente** (BYOK o OAuth), tramite un backend minimo che non conserva fatture oltre il necessario. Prima di scegliere: preventivi scritti e prova in sandbox.
3. Non fare (d) fino ad avere volumi che lo giustifichino.
4. Evitare (c2) (nostro account unico): ci renderebbe trasmittenti e responsabili per conto terzi, con rischio di mandato, privacy e sanzioni.

**Rischi di responsabilità per noi** (dettaglio in §7): XML errato che lo SDI accetta ma con dati sbagliati; numerazione con buchi o duplicati dovuti a bug o a ripristino da backup; superamento dei 12 giorni; utente che ritiene "emessa" una fattura mai trasmessa; uso del software da parte di chi non è forfettario; conservazione non a norma presentata come tale.

---

## 4. Forfettario: altro che serve

| Tema | Regola | Fonte / certezza |
|---|---|---|
| Soglia di accesso e permanenza | **85.000 €** di ricavi/compensi annui (portata da 65.000 con L. 197/2022). Confermata anche per il 2026; l'ipotesi di salire a 100.000 € discussa nel dibattito sulla legge di bilancio è stata **smentita**. | CONFERMATO DA PIÙ FONTI SECONDARIE (Wolters Kluwer, money.it, Ediltecnico, BusinessOnline, Quickfisco). Fonte primaria attesa: L. 190/2014 art. 1 c. 54 e L. 197/2022; L. 207/2024 e testo bilancio 2026. |
| Uscita in corso d'anno | Se si superano **100.000 €** nell'anno: uscita immediata dal regime, IVA dovuta dalla operazione che supera il limite. Fra 85.000 e 100.000: uscita dall'anno successivo. | CONFERMATO DA FONTE SECONDARIA coerente con la conoscenza generale; DA VERIFICARE |
| Redditi da lavoro dipendente | Causa di esclusione se nell'anno precedente si sono percepiti redditi da lavoro dipendente/assimilati oltre **35.000 €** (soglia portata da 30.000 con L. 207/2024; fonte indica conferma per il 2026). Irrilevante se il rapporto è cessato. | Soglia 35.000: CONFERMATO DA PIÙ FONTI SECONDARIE; DA VERIFICARE su L. 207/2024. Una fonte (Centro Fiscale) parla ancora di 30.000: considerarla superata. |
| Spese per personale | Tetto di **20.000 €** per lavoro accessorio, dipendenti e collaboratori | UNA sola fonte (Quickfisco) lo conferma per il 2026; DA VERIFICARE |
| Altre esclusioni | Società di persone/srl trasparenti, non residenti salvo eccezioni, attività di cessione di fabbricati/mezzi di trasporto nuovi, regimi speciali IVA, ecc. | NON esplorato in dettaglio: fuori scopo, demandare al commercialista |
| Obbligo di fattura elettronica per i forfettari | Introdotto in due tappe: dal 1° luglio 2022 per chi aveva ricavi > 25.000 €, dal **1° gennaio 2024 per tutti** (D.L. 36/2022). Oggi vale per tutti i forfettari, senza soglia. | CONFERMATO DA PIÙ FONTI SECONDARIE (Ipsoa, trend-online, fiscomania); la mia ricerca ha trovato solo una indicazione di un diverso calendario "2026" ma senza dettagli: nessuna fonte parla di cambi per il 2026. DA VERIFICARE su D.L. 36/2022 e L. 197/2022. |
| IVA / rivalsa / ritenuta | Niente IVA né rivalsa, niente ritenuta d'acconto (L. 190/2014 art. 1 c. 58 e 67). | DA VERIFICARE |
| Regime di cassa | I ricavi/compensi rilevano **per cassa** (incasso), con tassazione sostitutiva. Quindi la data di **pagamento** conta per le soglie; l'app deve poter registrare data e importo incasso, e distinguere "emessa" da "incassata". | DA VERIFICARE (conoscenza generale: L. 190/2014 art. 1 c. 64-65) |
| Acquisti con IVA, reverse charge | Il forfettario non detrae IVA; acquisti dall'estero possono comportare integrazione/ autofattura. **Fuori MVP**. | Fuori scopo |
| Comunicazione autorizzazione al regime | I fornitori dell'artigiano non applicano ritenuta; l'artigiano deve rispettare i requisiti. L'app deve chiedere all'utente di **dichiarare** di essere in RF19 e di sapere quando esce. | Raccomandazione |
| Preventivo vs fattura | Il preventivo è un'offerta commerciale, **non** un documento fiscale e **non** va inviato allo SDI. La fattura è il documento fiscale. Un preventivo accettato può fondare obbligazioni contrattuali: scrivere la validità (già `quoteValidityDays`), "importi indicativi/ esclusi extra", e non chiamarlo "fattura proforma". | Distinzione CONFERMATA DA CONOSCENZA GENERALE; DA VERIFICARE per i profili civilistici (art. 1326 ss., 2230 c.c.) |
| Bollo sul preventivo | Di norma **non** dovuto: l'imposta di bollo colpisce fatture, ricevute, quietanze ecc. (tariffa DPR 642/72) e i contratti solo in caso d'uso; un preventivo non rientra fra gli atti elencati. Se il preventivo contiene accettazione firmata (contratto) il discorso cambia. **Non trovato nessun testo primario in sessione.** | DA VERIFICARE |
| Il PDF "fattura di cortesia" | Va marcata chiaramente "COPIA DI CORTESIA – il documento fiscale è la fattura elettronica trasmessa allo SDI". Il PDF **non** ha valore fiscale. Il consumatore finale ha diritto a una copia, che può essere questo PDF. | DA VERIFICARE |
| Diciture da stampare nel PDF | Dicitura forfettario, "Imposta di bollo assolta in modo virtuale" se bollo, IBAN, scadenza, dati cedente. | Prassi |
| Dato personale | Il cliente persona fisica ha dati personali in fattura: finalità fiscali, conservazione 10 anni. Informativa privacy dell'artigiano verso i suoi clienti: sua responsabilità. | Raccomandazione |

---

## 5. Modello dati proposto

Contesto: `src/types.ts` **non va modificato dal mio agente**. Questo è un diff **proposto** per l'architetto/agente PREVENTIVO + AREA PERSONALE.

### 5.1 Diff TypeScript commentato

```diff
 export type DocType = 'preventivo' | 'fattura';
-export type DocStatus = 'bozza' | 'inviato' | 'accettato' | 'pagato';
+// Preventivo: bozza -> inviato -> accettato | rifiutato | scaduto
+export type QuoteStatus = 'bozza' | 'inviato' | 'accettato' | 'rifiutato' | 'scaduto' | 'convertito';
+// Fattura: ciclo di vita fiscale. 'emessa' e successivi sono IMMUTABILI (vedi InvoiceFiscal.lockedAt).
+export type InvoiceStatus =
+  | 'bozza'            // modificabile, eliminabile, SENZA numero definitivo
+  | 'emessa'           // numero assegnato, XML generato e congelato (hash). Non modificabile, non eliminabile
+  | 'inviata'          // l'utente dichiara di averla caricata/inviata allo SDI (o il provider l'ha accettata)
+  | 'consegnata'       // RC ricevuta
+  | 'mancata_consegna' // MC: considerata emessa, avvisare il cliente
+  | 'scartata'         // NS: si considera NON emessa; correggere e reinviare (5 giorni) o riemettere
+  | 'stornata';        // coperta integralmente da nota di credito (stato derivato/denormalizzato)
+// Stato di pagamento, separato dallo stato fiscale (ricavi per cassa)
+export type PaymentStatus = 'non_pagata' | 'parziale' | 'pagata';
+/** Per retro-compatibilità con i documenti esistenti ('inviato'|'accettato'|'pagato') serve una migrazione IndexedDB (v2). */
+export type DocStatus = QuoteStatus | InvoiceStatus;
+
+/** Tipo documento FatturaPA supportati nell'MVP */
+export type TipoDocumento = 'TD01' | 'TD04';
+/** Natura IVA: nell'MVP solo N2.2 (righe) e N1 (rimborso bollo). Altre nature: fuori MVP */
+export type NaturaIva = 'N2.2' | 'N1';
+/** Esito SDI registrato (manualmente in v1, da webhook in v2) */
+export type SdiOutcome = 'RC' | 'NS' | 'MC';
+
+export interface SdiEvent {
+  at: number;                 // epoch ms
+  type: SdiOutcome | 'INVIO'; // INVIO = trasmissione dichiarata
+  channel: 'portale_ade' | 'pec' | 'provider' | 'sdicoop';
+  sdiIdentifier?: string;     // identificativo SDI quando disponibile
+  errorCodes?: string[];      // codici di scarto (es. quelli dell'allegato errori SDI)
+  note?: string;
+}
+
+/** Dati fiscali della sola fattura. Presente SOLO per type='fattura'. */
+export interface InvoiceFiscal {
+  tipoDocumento: TipoDocumento;     // TD01 fattura, TD04 nota di credito
+  year: number;                     // anno di numerazione
+  sectional: string;                // sezionale: 'FT' per fatture, 'NC' per note di credito
+  seq: number;                      // progressivo nel sezionale+anno, assegnato SOLO all'emissione
+  number: string;                   // '12/2026' o 'NC1/2026' (1-20 caratteri, con almeno una cifra)
+  operationDate: string;            // data operazione/documento (ISO) = campo XML Data
+  issuedAt?: number;                // momento di emissione (epoch ms)
+  lockedAt?: number;                // da qui il documento è immutabile
+  progressivoInvio?: string;        // ProgressivoInvio / nome file: 5 caratteri alfanumerici univoci
+  xml?: string;                     // XML congelato all'emissione (stringa UTF-8)
+  xmlSha256?: string;               // hash esadecimale dell'XML congelato (WebCrypto SHA-256)
+  fileName?: string;                // 'IT01234567897_00001.xml'
+  stampDuty: boolean;               // bollo dovuto (DatiBollo)
+  stampDutyChargedToCustomer: boolean; // se true, riga rimborso bollo N1
+  stampAmount: number;              // 0 o 2.00
+  customerChannel: 'codice' | 'pec' | 'consumatore' | 'estero';
+  codiceDestinatario?: string;      // 7 caratteri; '0000000' o 'XXXXXXX'
+  pecDestinatario?: string;
+  // Note di credito
+  originalDocumentId?: string;      // id (interno) della fattura stornata
+  originalNumber?: string;          // numero ORIGINALE come stampato (IdDocumento)
+  originalDate?: string;            // data originale (ISO)
+  creditNoteReason?: string;        // causale dello storno
+  // Esiti
+  sdiEvents: SdiEvent[];            // storico notifiche
+  // Rinvio dopo scarto
+  resubmissionOf?: string;          // id della fattura scartata che questa sostituisce (se nuovo numero)
+  paymentStatus: PaymentStatus;
+  payments: { date: string; amount: number; method?: string }[]; // per cassa
+}
+
+/** Registro append-only. Mai modificato, mai cancellato (nemmeno da "reset"; solo da backup esplicito dell'utente) */
+export interface AuditEntry {
+  id: string;
+  at: number;
+  docId: string;
+  action: 'create' | 'edit' | 'issue' | 'download_xml' | 'mark_sent' | 'sdi_event' |
+          'credit_note' | 'convert_quote' | 'duplicate' | 'delete_draft' | 'payment' | 'voice_command';
+  actor: 'user';                    // in v2 potrà esserci l'ID utente
+  detail?: string;                  // testo breve; MAI dati sensibili superflui
+  xmlSha256?: string;               // hash coinvolto
+  voiceTranscript?: string;         // se l'azione è partita da un comando vocale
+}
+
 export interface QuoteDocument {
   id: string;
   type: DocType;
-  number: string; // "PRev-0012"
+  number: string; // preventivo: "PRev-0012" (può avere buchi, non è fiscale). Fattura bozza: '' finché non emessa
   date: string; // ISO yyyy-mm-dd
   customer: Customer;
   lines: DocLine[];
   notes?: string;
-  status: DocStatus;
+  status: DocStatus;
+  invoice?: InvoiceFiscal;      // solo type==='fattura'
+  convertedFromQuoteId?: string; // fattura nata da preventivo
+  convertedToInvoiceId?: string; // preventivo già convertito
   transcript?: string;
   createdAt: number;
   updatedAt: number;
 }

 export interface Customer {
   id: string;
   name: string;
-  vatOrFiscalCode?: string;
+  vatNumber?: string;       // P.IVA (11 cifre, checksum)
+  fiscalCode?: string;      // CF (16 alfanumerici persone fisiche, o 11 cifre)
+  country?: string;         // ISO-2; default 'IT'
+  zip?: string; city?: string; province?: string;
+  codiceDestinatario?: string; pec?: string;
   address?: string;
   email?: string;
   phone?: string;
 }

 export interface Profile {
   ...
+  // Obbligatori per emettere fattura elettronica
+  regimeFiscale: 'RF19';           // solo RF19 supportato in MVP
+  forfettarioSince?: string;       // anno/ data apertura, per eventuali avvisi
+  invoiceYearCounters: Record<string, number>; // chiave `${sectional}-${year}` -> ultimo seq usato (gestito in transazione)
+  nextProgressivoInvio: number;    // contatore base-36 per il nome file (5 char)
+  stampDutyDefaultChargedToCustomer: boolean;
+  reaOffice?: string; reaNumber?: string; // IscrizioneREA facoltativa
-  nextInvoiceNumber: number;   // sostituito da invoiceYearCounters
 }

 export interface DocLine {
   ...
+  natura?: NaturaIva;  // default 'N2.2' se profile.regimeForfettario
 }
```

Principi implementativi (per gli agenti STORAGE/PREVENTIVO):
1. **Emissione = un'unica transazione IndexedDB** (`readwrite` su `profile` + `documents` + `audit`): assegna `seq`, genera XML, calcola SHA-256, imposta `status:'emessa'`, `lockedAt`. Se qualcosa fallisce, nulla si scrive: nessun buco.
2. **Immutabilità**: `saveDocument` rifiuta ogni modifica a un documento con `lockedAt` (eccetto aggiunta di `sdiEvents`, `payments`, `paymentStatus`, `status` per le sole transizioni consentite). `deleteDocument` rifiuta fatture non-bozza.
3. **Transizioni consentite**: bozza→emessa; emessa→inviata→(consegnata|mancata_consegna|scartata); scartata→(reinviata come `inviata` stesso numero entro 5 giorni | nuova bozza collegata); consegnata|mancata_consegna|inviata→stornata solo tramite creazione di una nota di credito.
4. **Backup/ripristino**: l'importazione di un backup non deve ridurre i contatori; se i contatori ripristinati sono inferiori al massimo `seq` presente, usare il massimo. Avvisare l'utente che ripristinare un backup vecchio può generare duplicati di numero.
5. **Migrazione** di documenti esistenti: i `fattura` esistenti sono PDF di cortesia, non fiscali: marcarli `legacy: true` o trattarli come bozze/cortesia, senza numero fiscale.
6. Importi: lavorare con **centesimi interi** per le somme fiscali (evitare errori di virgola mobile), usando `roundMoney` solo in presentazione. `PrezzoTotale` = `Quantita` × `PrezzoUnitario` arrotondato a 2 decimali (nello XML possono servire fino a 8 decimali per prezzo unitario e quantità).

### 5.2 Mapping app → XML

| Campo app | Elemento XML |
|---|---|
| `Profile.vatNumber` | `CedentePrestatore/.../IdFiscaleIVA/IdCodice` (e `IdTrasmittente/IdCodice`, vedi 2.4) |
| `Profile.fiscalCode` | `CedentePrestatore/.../CodiceFiscale` |
| `Profile.businessName`/`ownerName` | `Anagrafica` (`Denominazione` se società; `Nome`+`Cognome` se ditta individuale) |
| `Profile.regimeFiscale` | `RegimeFiscale` |
| `invoice.tipoDocumento` | `TipoDocumento` |
| `invoice.operationDate` | `DatiGeneraliDocumento/Data` |
| `invoice.number` | `Numero` |
| `invoice.stampDuty` | `DatiBollo` (`BolloVirtuale` `SI`, `ImportoBollo` `2.00`) |
| `invoice.progressivoInvio` | `ProgressivoInvio` e nome file |
| `originalNumber`/`originalDate` | `DatiFattureCollegate/IdDocumento`, `Data` |
| `DocLine.*` | `DettaglioLinee` |
| `Totals` | `DatiRiepilogo`, `ImportoTotaleDocumento` |

### 5.3 Regole di validazione da implementare (pre-emissione)

**Controlli anagrafici (bloccanti)**
- **P.IVA italiana**: 11 cifre numeriche, controllo checksum (algoritmo di Luhn variante italiana: somma cifre in posizione dispari + cifre pari raddoppiate con -9 se >9; cifra di controllo = (10 − somma mod 10) mod 10). Calcolato e usato nei fixture.
- **Codice fiscale persona fisica**: 16 caratteri alfanumerici `[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]` più carattere di controllo (tabelle dispari/pari, resto mod 26). Gestire l'omocodia (lettere al posto delle cifre) senza rifiutarla. CF di società: 11 cifre (checksum come P.IVA).
- Cliente: almeno uno fra P.IVA e CF; consumatore: CF obbligatorio per fattura elettronica (se il cliente non fornisce CF, vedi regole AdE: **DA VERIFICARE** col commercialista).
- `CodiceDestinatario`: 7 caratteri alfanumerici maiuscoli (`0000000`, `XXXXXXX` o codice SDI). PEC: formato email, 7-256 caratteri.
- `Provincia`: 2 lettere maiuscole per IT; `CAP`: 5 cifre per IT (`00000` per estero); `Nazione`: ISO 3166 alfa-2.
- IBAN: lunghezza 15-34, checksum mod 97.

**Lunghezze e formati XML (valori dallo schema, da riconfermare sull'XSD scaricato)**

| Campo | Regola |
|---|---|
| `Denominazione` | 1-80 caratteri |
| `Nome`, `Cognome` | 1-60 caratteri ciascuno |
| `Indirizzo` | 1-60 caratteri |
| `NumeroCivico` | 1-8 caratteri (meglio incluso in `Indirizzo`) |
| `Comune` | 1-60 caratteri |
| `ProgressivoInvio` | 1-10 caratteri alfanumerici |
| Nome file progressivo | 5 caratteri alfanumerici |
| `Numero` | 1-20 caratteri, con almeno una cifra |
| `Data` | `YYYY-MM-DD`, non nel futuro (valutare), 12 giorni dall'invio |
| `Descrizione` (riga) | 1-1000 caratteri |
| `Quantita` | decimale con 2-8 decimali |
| `PrezzoUnitario`, `PrezzoTotale` | decimale con 2-8 decimali |
| `AliquotaIVA` | 2 decimali; qui sempre `0.00` |
| `ImponibileImporto`, `ImportoTotaleDocumento` | 2 decimali, `ImportoTotaleDocumento` = somma imponibili + imposte |
| `Causale` | 1-200 caratteri per occorrenza |
| `RiferimentoNormativo` | 1-100 caratteri |
| `UnitaMisura` | 1-10 caratteri |
| `Telefono` | 5-12 caratteri; `Email` 7-256 |
| Caratteri | solo quelli ammessi dall'Allegato A: sostituire o rifiutare gli altri |

**Controlli semantici (come i controlli SDI)**
- `Natura` obbligatoria quando `AliquotaIVA` = 0; `RiferimentoNormativo` in `DatiRiepilogo`.
- Un `DatiRiepilogo` per ogni coppia `AliquotaIVA`/`Natura` usata nelle righe; `ImponibileImporto` = somma di `PrezzoTotale` di quel gruppo (tolleranza 0,01).
- `PrezzoTotale` = `Quantita` × `PrezzoUnitario` (con sconto), tolleranza arrotondamento 0,01.
- `ImportoTotaleDocumento` coerente con totali e bollo.
- Bollo: se `Imposta` totale = 0 e importo non-IVA > 77,47 → `DatiBollo` obbligatorio; se ≤ 77,47 → non inserirlo.
- Nota di credito: `originalNumber`/`originalDate` obbligatori; importo ≤ importo residuo non stornato della fattura originale; stesso cliente e stesso regime.
- Fattura: almeno 1 riga; nessuna riga `needsReview` irrisolta; importi > 0; nessuna aliquota IVA ≠ 0 per `RF19`.
- Avvisi (non bloccanti): trasmissione oltre 12 giorni da `Data`; ricavi annui che si avvicinano a 85.000 € e 100.000 €; cliente estero.
- Il generatore deve poter ricevere l'**XSD** nei test (non nel runtime) e un test "snapshot" per i 2 fixture di §2.5.

---

## 6. Comandi vocali per la fatturazione

Principio: la voce **propone**, non decide. Azioni irreversibili passano sempre da una schermata di riepilogo con **conferma esplicita non vocale-implicita** (tocco su pulsante, eventualmente anche "conferma" parlato dopo la lettura del riepilogo, ma mai un solo comando che emette).

| Comando (esempi) | Effetto | Reversibile? | Regole di sicurezza |
|---|---|---|---|
| "Preventivo per Rossi, ..." (già esistente) | Crea bozza preventivo | Sì | Nessuna conferma extra |
| "Fattura per Rossi, due ore di manodopera e tre metri di tubo" | Crea **bozza** di fattura | Sì (bozza) | Mai emettere dal comando di creazione. Cliente ambiguo → elenco di scelta. Righe `needsReview` evidenziate |
| "Converti il preventivo 8 in fattura" | Crea **bozza** di fattura copiando righe e cliente; il preventivo passa a `convertito`; salva il collegamento | Sì finché la fattura è bozza | Mostra riepilogo; se il preventivo è già convertito, avvisa e chiede di scegliere. Il numero della fattura non è assegnato qui |
| "Emetti la fattura" / "Emetti la bozza di Rossi" | Congela XML, assegna numero | **NO** | Pulsante dedicato + riepilogo (cliente, totale, bollo, data, numero che verrà assegnato) + avviso "dopo l'emissione non si può modificare né cancellare, si può solo stornare con nota di credito". Richiede tocco di conferma; **non** completabile solo a voce. Dati anagrafici validi (§5.3) |
| "Annulla la fattura 12 con nota di credito" / "Storna la fattura 12" | Crea **bozza** di nota di credito collegata (totale, o parziale se richiesto "solo il rubinetto") | Sì finché bozza | Il comando non emette la nota. Riepilogo con il riferimento alla fattura originale. Emissione della nota = stessa conferma di "Emetti". Se la fattura è `scartata` o `bozza` → NON creare nota: proporre "correggi e reinvia" o "elimina bozza" |
| "Elimina la fattura 12" | Se bozza: elimina; se emessa: **rifiutato** con spiegazione ("una fattura emessa non si cancella, puoi stornarla") | Elimina bozza: no | Conferma esplicita per eliminare bozze con righe; per emesse proporre nota di credito |
| "Segna come pagata la fattura 12" / "Rossi ha pagato 300 euro" | Registra pagamento (data, importo) per cassa; stato `pagata`/`parziale` | Sì (correggibile con annotazione) | Richiede data (default oggi) e importo; non modifica il documento fiscale; riga in audit log; avvisa se l'importo supera il residuo |
| "Segna come inviata allo SDI" / "è stata consegnata" / "è stata scartata" | Aggiorna `sdiEvents` e stato | Parzialmente | Chiede data e canale; per "scartata" chiede il codice errore e avvia la procedura (entro 5 giorni) |
| "Duplica la fattura 12" / "Duplica il preventivo 8" | Copia come **bozza** nuova (senza numero, data odierna) | Sì | Mai copiare numero, XML, hash o `sdiEvents`. Per le fatture ripulire i riferimenti a note di credito |
| "Segna il preventivo 8 come accettato / rifiutato" | Cambia stato preventivo | Sì | — |
| "Cambia la data della fattura" / "aggiungi una riga" | Modifica solo se bozza | Sì | Rifiutato se `emessa` o successivi |
| "Leggi il totale" / "Quanto ho fatturato questo mese?" | Sola lettura | — | Il fatturato per cassa si calcola dagli incassi |
| "Scarica l'XML della fattura 12" | Download/condivisione | — | Solo per fatture emesse; scrive audit |

Regole trasversali:
- Ogni comando vocale è loggato (`AuditEntry.voiceTranscript`).
- Riconoscimento del numero: leggere sempre a voce/schermo "fattura 12/2026 di Rossi, totale 372,00" e chiedere conferma prima di agire su documenti già emessi (storno, pagamento, segnalazione SDI).
- Per i comandi su documenti **non bozza**, mai agire per corrispondenza fuzzy sul numero: se ambiguo, mostrare elenco.
- Timeout: conferma valida pochi secondi/ un tocco; niente conferme "a ritroso".
- Se il riconoscimento ha bassa confidenza sul cliente o sugli importi, non procedere all'emissione.

---

## 7. Rischi legali e cose da far verificare a un commercialista

### 7.1 Rischi

1. **Dati XML errati accettati dallo SDI** (cliente, importi, natura, dicitura): il cliente o il fisco possono contestare; correggere richiede nota di credito e nuova fattura.
2. **Numerazione**: buchi o duplicati (bug, ripristino backup, due dispositivi). Mitigazioni in §5.1. Un'app locale senza sync non può impedire che l'artigiano usi **due dispositivi** con contatori separati: **rischio alto**, da dichiarare in UI o risolvere in v2.
3. **Superamento dei 12 giorni**: sanzioni a carico dell'utente (misure da confermare).
4. **Bollo**: assenza o importo sbagliato; trattamento nelle note di credito discordante tra fonti (§1.4); versamento trimestrale non gestito dall'app.
5. **Perdita dei dati locali**: IndexedDB cancellabile dal browser/ dal sistema. Le fatture emesse esistono anche presso lo SDI (area riservata), ma l'obbligo di conservazione resta dell'utente. Mostrare promemoria di backup e conservazione AdE.
6. **Conservazione**: l'app non è un sistema di conservazione a norma (§3.2). Non vendere come tale.
7. **Uso da parte di non forfettari** o dopo l'uscita dal regime (soglie 85.000/100.000 €): l'app produrrebbe fatture senza IVA illegittime. Richiedere dichiarazione e mostrare avvisi di soglia sul fatturato di cassa.
8. **Clienti esteri, reverse charge, PA, split payment, ritenute, casse previdenziali, autofatture**: fuori MVP; bloccare o avvisare.
9. **Privacy/GDPR**: i dati dei clienti dell'artigiano restano sul suo dispositivo (v1). Con provider/backend (v2) diventiamo responsabili del trattamento: DPA, registro dei trattamenti, eventuale subprocessore. Voce: la Web Speech API del browser può inviare l'audio ai server del vendor del browser: informativa.
10. **Responsabilità per mandato/trasmissione**: in (c2) e (d) siamo trasmittenti; evitarlo in MVP.
11. **Fonti non primarie**: questo documento si basa su fonti secondarie. Alcune cifre (sanzioni, soglie, regole bollo) possono essere cambiate o essere inesatte.
12. **Preventivi**: una volta accettati possono vincolare; la validità e l'esclusione dei lavori extra vanno in chiaro.
13. **Pubblicità/denominazione**: chiamare "fattura elettronica" solo ciò che genera XML FatturaPA valido; il PDF "di cortesia" non è fattura.

### 7.2 Da far verificare a un commercialista (checklist)

- [ ] Numerazione: sezionale separato per note di credito oppure unico? Un contatore per anno senza buchi è sufficiente?
- [ ] `Data` del documento: data operazione vs data emissione; comportamento oltre 12 giorni; sanzioni per un forfettario.
- [ ] Bollo: addebito al cliente con riga N1, indicazione in `DatiBollo`, importi sopra/sotto 77,47 € con riga N1 inclusa nella soglia; bollo sulle **note di credito** (originale non recuperabile?).
- [ ] Dicitura forfettario: testo esatto in `RiferimentoNormativo` e in `Causale`; ritenuta d'acconto (art. 1 c. 67).
- [ ] `IdTrasmittente`/nome file: P.IVA o codice fiscale; compatibilità col portale AdE (prova in produzione con una fattura reale prima del lancio).
- [ ] Consumatori senza codice fiscale; copia di cortesia obbligatoria.
- [ ] Gestione scarto: riemissione con stesso numero/data entro 5 giorni, oltre quando serve nuovo numero.
- [ ] Gestione MC (mancata consegna) e obbligo di avviso al cliente.
- [ ] Ricavi per cassa e soglie 85.000/100.000 €; conseguenze di uscita in corso d'anno.
- [ ] Esclusioni al regime (dipendente > 35.000 €, spese personale > 20.000 €, altre).
- [ ] Bollo sui preventivi e valore legale del preventivo accettato.
- [ ] Conservazione: durata e condizioni del servizio gratuito AdE; adesione.
- [ ] Quale versione degli schemi/specifiche è in vigore ora (1.9.1 dal 15/05/2026 secondo fonti secondarie; eventuali successive) e il nome file dell'XSD.

### 7.3 Disclaimer da inserire (bozza di testo, da far approvare)

**In app (schermata di emissione, `/info` e PDF):**
> VocePreventivo ti aiuta a preparare documenti e a generare il file XML della fattura elettronica. Non è un consulente fiscale e non sostituisce il tuo commercialista. Sei tu il responsabile della correttezza dei dati, della numerazione, dei termini di emissione, dell'invio allo SDI e della conservazione. L'app non trasmette fatture allo SDI per tuo conto: dopo aver scaricato il file devi caricarlo sul portale Fatture e Corrispettivi dell'Agenzia delle Entrate (o inviarlo con altro canale valido). Una fattura non trasmessa allo SDI non è emessa. L'app non è un sistema di conservazione a norma: attiva il servizio gratuito dell'Agenzia delle Entrate o scegli un conservatore. Il PDF generato è una copia di cortesia senza valore fiscale. L'app è pensata per chi è in regime forfettario: se non lo sei più, non usarla per emettere fatture.

**Al momento dell'emissione (checkbox obbligatorio):**
> Confermo di essere in regime forfettario, di aver verificato cliente, importi e data, e di sapere che la fattura emessa non può essere modificata né eliminata, ma solo stornata con nota di credito.

**Termini di servizio:** limitazione di responsabilità per sanzioni, nessuna garanzia di conformità a future modifiche normative, aggiornamento delle specifiche tecniche, obbligo dell'utente di verificare con un professionista.

---

## 8. Riepilogo di cosa NON ho verificato (per chi continua)

1. Nessuna fonte primaria letta (AdE, FatturaPA, Gazzetta Ufficiale, MEF non raggiungibili).
2. Versione e nome del file XSD in vigore a novembre 2026; eventuali specifiche successive alla 1.9.1.
3. Costi per fattura di Aruba, Fatture in Cloud, A-Cube, Invoicetronic; costi e tempi di SDICoop/SFTP.
4. Trattamento esatto del bollo nelle note di credito; bollo sui preventivi.
5. Esatta lista dei caratteri ammessi, lunghezze massime effettive, codici di errore SDI.
6. Durata e condizioni del servizio di conservazione gratuita AdE.
7. Convalida dei fixture contro XSD e invio di prova reale allo SDI/portale.
