# DPA da firmare con i fornitori (sub-responsabili) — BOZZA

> Nessun fornitore è ancora scelto. Per ciascuno verificare il DPA standard del fornitore (di solito accettabile online) e che contenga gli elementi dell'art. 28.3 GDPR [DA VERIFICARE da un legale]. Non conservare qui contratti firmati con dati personali o segreti.

## Contenuti minimi da pretendere (art. 28.2-4)
- trattamento solo su istruzioni documentate; riservatezza del personale;
- misure di sicurezza adeguate (art. 32) descritte;
- autorizzazione e flow-down dei sub-sub-responsabili con preavviso;
- assistenza per diritti degli interessati e per violazioni;
- **notifica di violazioni senza ingiustificato ritardo** (idealmente entro 24–48 ore);
- cancellazione/restituzione a fine rapporto; audit;
- localizzazione dei dati nello SEE; garanzie Capo V per trasferimenti (SCC / adeguatezza) [DA VERIFICARE stato del DPF];
- per STT: **nessuna conservazione dell'audio, nessun uso per addestrare modelli (zero data retention)**.

## Stato per fornitore
| Fornitore | Servizio | Dati | Ruolo | Sede/UE | DPA | Garanzie extra-UE | Stato |
|---|---|---|---|---|---|---|---|
| [hosting UE — es. hosting europeo, da scegliere] | Server, DB | Tutti | Sub-responsabile | UE | DPA standard del fornitore: [da accettare] | n/a | DA FARE |
| [storage backup UE] | Backup cifrati (cifrati prima dell'invio) | Copie cifrate | Sub-responsabile | UE | [da accettare] | n/a | DA FARE |
| [email transazionale] | Email di servizio | Email, testo | Sub-responsabile | [UE/extra-UE] | [da accettare] | [SCC/DPF — verificare] | DA FARE |
| [STT — da definire] | Trascrizione | Audio transitorio | Sub-responsabile | [UE/extra-UE] | [da accettare, con zero retention] | [verificare] | DA FARE |
| Stripe | Pagamenti | Dati di pagamento, email | Titolare autonomo (ipotesi) [DA VERIFICARE]; per alcuni servizi Stripe si qualifica come responsabile | [verificare] | Termini/DPA di Stripe: [leggere e accettare] | [verificare] | DA FARE |
| [provider SDI — non attivo] | Trasmissione SDI | Fatture | Sub-responsabile | — | — | — | NON ATTIVO |
| Commercialista / consulenti | Contabilità | Dati di fatturazione | Responsabile o titolare autonomo [verificare] | IT | nomina o NDA | n/a | DA FARE |

## Per ogni DPA firmato
Salvare copia in archivio riservato (fuori dal repository), annotare data e versione, aggiornare `public/legal/subprocessors.html` e `REGISTRO-TRATTAMENTI.md`, avvisare gli utenti con il preavviso previsto dal DPA verso i clienti.
