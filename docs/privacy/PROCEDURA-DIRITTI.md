# Procedura per l'esercizio dei diritti degli interessati — BOZZA

> Bozza da far validare. Termine di risposta generale: "senza ingiustificato ritardo e comunque entro un mese" dal ricevimento (art. 12 GDPR), prorogabile in casi complessi [DA VERIFICARE].

## 1. Canali
Email [EMAIL] (anche PEC [PEC]); funzioni in-app (esporta dati, elimina account). Registrare ogni richiesta in un registro (data, richiedente, tipo, esito, data risposta).

## 2. Chi è il richiedente?
| Richiedente | Ruolo nostro | Azione |
|---|---|---|
| Artigiano con account (dati account/fatturazione) | Titolari | Evadiamo noi, entro 1 mese |
| Cliente finale di un artigiano | Responsabili | **Non rispondiamo nel merito**: inoltriamo la richiesta all'artigiano (titolare) senza ritardo e informiamo il richiedente che ci siamo rivolti al titolare; assistiamo l'artigiano con export/cancellazione/rettifica |
| Utente senza account (modalità A) | Non abbiamo i dati | Spiegare che i dati sono solo sul suo dispositivo |

## 3. Verifica dell'identità
Per l'artigiano: richiesta dall'email dell'account o da sessione autenticata. Per altri: chiedere informazioni minime ragionevoli, senza raccogliere documenti d'identità se non indispensabile [DA VERIFICARE].

## 4. Esecuzione per diritto
- **Accesso / portabilità (artt. 15, 20)**: `GET /account/export` (zip JSON+XML+PDF) — formato strutturato e leggibile da dispositivo.
- **Rettifica (art. 16)**: l'utente modifica nell'App; i documenti fiscali **emessi sono immutabili**: si corregge con nota di credito e nuova fattura (spiegarlo).
- **Cancellazione (art. 17)**: `DELETE /account`; cancellazione di catalogo, clienti non fiscali, bozze, audio; **le fatture emesse** possono essere trattenute per obbligo di conservazione (art. 17.3.b) [DA VERIFICARE] in archivio ristretto o restituite. Cancellare i backup nei tempi indicati nella privacy.
- **Limitazione (art. 18) / opposizione (art. 21)**: sospendere il trattamento non essenziale; valutare caso per caso.
- **Reclamo**: informare del diritto di reclamo al Garante.

## 5. Risposta
Rispondere entro un mese con esito e motivazioni di un eventuale rifiuto; proroga motivata se necessario. Comunicare rettifiche/cancellazioni ai destinatari (sub-responsabili) quando pertinente (art. 19).

## 6. Conservazione del registro
[N] anni, solo i dati minimi necessari.
