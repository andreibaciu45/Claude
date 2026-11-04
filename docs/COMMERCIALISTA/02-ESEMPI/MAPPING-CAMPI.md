# Dalla schermata al file XML: dove finisce ogni dato

Questo documento descrive, campo per campo, come i dati inseriti nell'app diventano elementi del file XML FatturaPA. Si legge con accanto uno dei due esempi in questa cartella:

- `esempio-A-TD01-consumatore-bollo.xml`: fattura n. 12/2026 del 15/10/2026 di Mario Rossi (idraulico, forfettario) a una consumatrice, con bollo addebitato.
- `esempio-B-TD04-parziale.xml`: nota di credito NC1/2026 del 20/10/2026 a un'azienda, che storna parzialmente la fattura 12/2026 (reso di un rubinetto da 36 €).

Tutti i dati sono **fittizi**. Gli esempi sono stati preparati a mano in fase di ricerca e il generatore del programma, nei test automatici, produce un file con la stessa struttura. Due differenze volute rispetto a come li produce il programma: nell'esempio compare l'attributo `xsi:schemaLocation` (l'indirizzo non è verificato e il programma non lo scrive) e nell'esempio B l'elemento facoltativo `RiferimentoNumeroLinea`, che il programma non scrive. **Gli esempi non sono stati validati contro lo schema XSD ufficiale.**

Nota di lettura: i nomi in corsivo tra parentesi sono i nomi dei campi nell'app, per chi li cerca nello schermo.

## 1. Intestazione: chi trasmette

| Elemento XML | Valore nell'esempio | Da dove viene | Regola applicata |
|---|---|---|---|
| `FatturaElettronica versione` | `FPR12` | Fisso | Formato per fatture verso privati e partite IVA (non PA) |
| `IdTrasmittente/IdPaese` | `IT` | Fisso | |
| `IdTrasmittente/IdCodice` | `01234567897` | Profilo, "Partita IVA" | Il trasmittente è l'artigiano stesso (partita IVA). Punto da confermare: vedi checklist F4 |
| `ProgressivoInvio` | `00001` | Contatore interno del profilo (base 36, 5 caratteri) | Cresce a ogni emissione (fatture e note di credito), non si riutilizza |
| `FormatoTrasmissione` | `FPR12` | Fisso | |
| `CodiceDestinatario` | `0000000` (A), `ABC1234` (B) | Cliente, "Codice destinatario" | Codice SDI del cliente se valido (7 caratteri); altrimenti `0000000` (consumatore, o cliente con PEC); cliente estero `XXXXXXX` |
| `PECDestinatario` | assente | Cliente, "PEC" | Presente solo se il codice destinatario non c'è e la PEC è valida |

Nome file: `IT` + partita IVA + `_` + progressivo + `.xml`, per esempio `IT01234567897_00001.xml` (A) e `IT01234567897_00002.xml` (B).

## 2. Cedente/prestatore: l'artigiano

| Elemento XML | Esempio | Da dove viene | Regola applicata |
|---|---|---|---|
| `IdFiscaleIVA/IdPaese`, `IdCodice` | `IT`, `01234567897` | Profilo, "Partita IVA" | Paese sempre `IT`. La partita IVA è controllata (11 cifre e cifra di controllo) |
| `CodiceFiscale` | `RSSMRA80A01H501U` | Profilo, "Codice fiscale" | Controllo formale del codice. Se manca: avviso, non blocco |
| `Anagrafica/Nome`, `Cognome` | `Mario`, `Rossi` | Profilo, "Titolare" | Usato se il codice fiscale è di 16 caratteri (persona fisica) e il titolare ha almeno due parole: **prima parola = Nome, il resto = Cognome**. Vedi checklist H3 |
| `Anagrafica/Denominazione` | non nell'esempio | Profilo, "Ragione sociale" | Usata quando non si può separare nome e cognome |
| `RegimeFiscale` | `RF19` | Fisso | Solo forfettario; con regime non attivo l'emissione è bloccata |
| `Sede/Indirizzo, CAP, Comune, Provincia, Nazione` | `Via Roma 10`, `00100`, `Roma`, `RM`, `IT` | Profilo, indirizzo | Obbligatori per emettere. CAP 5 cifre, provincia 2 lettere. Nazione sempre `IT` |
| `IscrizioneREA` | non nell'esempio | Profilo (ufficio REA e numero) | Facoltativa; se mancano entrambi non compare; `StatoLiquidazione` sempre `LN` (non in liquidazione) |
| `Contatti` | non nell'esempio | Profilo, telefono ed email | Facoltativi; telefono 5-12 caratteri, email valida |

## 3. Cessionario/committente: il cliente

| Elemento XML | Esempio A (consumatrice) | Esempio B (azienda) | Da dove viene e regola |
|---|---|---|---|
| `IdFiscaleIVA` | assente | `IT` + `09876543217` | Cliente, "Partita IVA". Presente solo se il cliente ha la partita IVA; per un estero l'`IdPaese` è la nazione del cliente |
| `CodiceFiscale` | `VRDLGI85M41F205H` | assente | Cliente, "Codice fiscale". Necessario almeno uno fra P.IVA e codice fiscale; entrambi con controllo formale (solo per clienti italiani) |
| `Anagrafica` | `Nome`=Luigia, `Cognome`=Verdi | `Denominazione`=Bianchi Costruzioni S.r.l. | Cliente, "Nome". Nome e Cognome solo se il cliente **non** ha partita IVA, ha un codice fiscale di 16 caratteri e il nome ha almeno due parole; altrimenti Denominazione (massimo 80 caratteri) |
| `Sede` | `Via Milano 5`, `20100`, `Milano`, `MI`, `IT` | `Via Torino 3`, `10100`, `Torino`, `TO`, `IT` | Cliente, indirizzo (obbligatorio). Per un cliente estero: CAP `00000` e nessuna provincia |

## 4. Dati generali del documento

| Elemento XML | Esempio A | Esempio B | Da dove viene e regola |
|---|---|---|---|
| `TipoDocumento` | `TD01` | `TD04` | Fattura = TD01; nota di credito = TD04. Altri tipi non supportati |
| `Divisa` | `EUR` | `EUR` | Fisso |
| `Data` | `2026-10-15` | `2026-10-20` | "Data dell'operazione" scelta dall'utente (proposta: oggi). Non può essere nel futuro oltre 1 giorno. Avviso se più vecchia di 12 giorni (checklist B1-B3) |
| `Numero` | `12/2026` | `NC1/2026` | Assegnato all'emissione: progressivo per anno; sezionale `NC` per le note di credito (checklist A1-A4). Massimo 20 caratteri, almeno una cifra |
| `DatiBollo/BolloVirtuale` | `SI` | assente | Presente se l'imponibile supera 77,47 € (checklist D1). Nell'esempio B (36 €) non c'è bollo |
| `DatiBollo/ImportoBollo` | `2.00` | assente | |
| `ImportoTotaleDocumento` | `372.00` | `36.00` | Somma delle righe + eventuale rimborso bollo. Il bollo a carico dell'artigiano **non** si somma |
| `Causale` (prima) | Dicitura forfettario | "Storno parziale della fattura n. 12/2026 del 15/10/2026: reso rubinetto miscelatore." | Fattura: dicitura forfettario. Nota di credito: motivo dello storno scritto dall'utente (l'app antepone "Storno della fattura n. ... del ..." se il motivo non cita già il numero) |
| `Causale` (seconda) | Dicitura "compenso non assoggettato a ritenuta..." | Dicitura forfettario | La dicitura sulla ritenuta compare solo sulle fatture. Testi lunghi vengono divisi in blocchi da 200 caratteri |
| `DatiFattureCollegate/IdDocumento` | assente | `12/2026` | Solo nota di credito: numero della fattura originale |
| `DatiFattureCollegate/Data` | assente | `2026-10-15` | Solo nota di credito: data della fattura originale |
| `DatiFattureCollegate/RiferimentoNumeroLinea` | assente | `3` | **Solo nell'esempio**: facoltativo, il programma non lo scrive |

## 5. Righe (dettaglio dei beni e servizi)

| Elemento XML | Esempio (riga 1) | Da dove viene e regola |
|---|---|---|
| `NumeroLinea` | `1` | Ordine delle righe nell'app (la riga di rimborso bollo è l'ultima) |
| `Descrizione` | "Manodopera idraulica - sostituzione rubinetto cucina" | Descrizione della riga (max 1000 caratteri). Caratteri non ammessi sostituiti, testo lungo troncato, **con avviso prima dell'emissione** (checklist H2) |
| `Quantita` | `8.00` | Quantità; 2 decimali minimo, fino a 8 |
| `UnitaMisura` | `h` | Unità della riga; facoltativa, max 10 caratteri |
| `PrezzoUnitario` | `35.00` | Prezzo unitario netto in euro |
| `ScontoMaggiorazione` | non nell'esempio | Sconto % della riga: `Tipo` = `SC`, `Percentuale` |
| `PrezzoTotale` | `280.00` | Quantità x prezzo, meno lo sconto, arrotondato al centesimo (mezzo centesimo in su). Tutti i calcoli in centesimi interi |
| `AliquotaIVA` | `0.00` | Sempre 0.00 (qualsiasi IVA scritta sulla riga è ignorata con avviso) |
| `Natura` | `N2.2` | Sempre N2.2 per le righe di lavoro e materiali (checklist E2) |
| Riga "Rimborso imposta di bollo" | Riga 4 dell'esempio A: 1 x 2,00 €, `Natura` `N1` | Aggiunta solo se il bollo è dovuto **e** addebitato al cliente (checklist D4) |

## 6. Riepilogo (un blocco per ogni natura)

| Elemento XML | Esempio A, blocco N2.2 | Esempio A, blocco N1 | Esempio B | Regola |
|---|---|---|---|---|
| `AliquotaIVA` | `0.00` | `0.00` | `0.00` | |
| `Natura` | `N2.2` | `N1` | `N2.2` | |
| `ImponibileImporto` | `370.00` | `2.00` | `36.00` | Somma delle righe con quella natura |
| `Imposta` | `0.00` | `0.00` | `0.00` | Sempre 0.00 |
| `RiferimentoNormativo` | "Art. 1, c. 54-89, L. 190/2014 - Regime forfettario" | "Escluso art. 15 DPR 633/72 - Rimborso bollo" | "Art. 1, c. 54-89, L. 190/2014 - Regime forfettario" | Per N2.2 la dicitura forfettario; per N1 "Escluso art. 15 DPR 633/72" (con "- Rimborso bollo" se il blocco è solo il rimborso). Max 100 caratteri |

## 7. Pagamento

| Elemento XML | Esempio A | Da dove viene e regola |
|---|---|---|
| `CondizioniPagamento` | `TP02` | Fisso (pagamento completo) |
| `ModalitaPagamento` | `MP05` | Dedotta dalle parole in "Condizioni di pagamento" del profilo: bonifico = MP05; contanti = MP01; carta/POS/bancomat = MP08; assegno = MP02. Se non riconosce nulla ma c'è un IBAN valido: MP05. Altrimenti niente blocco pagamento (checklist H4) |
| `DataScadenzaPagamento` | `2026-11-14` | Se le condizioni contengono "N giorni" (es. "30 giorni"), data operazione + N giorni; altrimenti assente |
| `ImportoPagamento` | `372.00` | Uguale al totale del documento |
| `IBAN` | `IT60X0542811101000000123456` | Profilo, "IBAN" (controllo formale), solo per MP05 |
| Intero blocco `DatiPagamento` | presente | **Assente nelle note di credito** (esempio B) |

## 8. Cosa NON compare mai nel file

- Nessuna imposta (`Imposta` sempre 0.00), nessuna `EsigibilitaIVA`.
- Nessun `DatiRitenuta`, nessun `DatiCassaPrevidenziale`.
- Nessuna firma digitale.
- Nessun `DatiOrdineAcquisto`, `DatiDDT`, `Allegati`.
- Nessun campo per PA (CIG, CUP, codice univoco ufficio).
