# Analisi di mercato (prima passata, 04/11/2026)

Fonti: ricerche web; dati di prezzo/recensioni NON verificati. Da approfondire dalle schede ufficiali.

## Dimensione
- ~1,23–1,24 milioni di imprese artigiane attive in Italia (InfoCamere/CNA 2025); edilizia = quasi una nuova impresa artigiana su due.
- Trend: -128 mila imprese in 10 anni, ma il 2025 ha tenuto. Numero in calo = pochi ma più carichi di lavoro → più bisogno di velocità.

## Concorrenti trovati
| Prodotto | Tipo | Nota |
|---|---|---|
| Artesan | App mobile artigiani (cantieri, materiali, preventivi, rapportini) | Free con limiti |
| Tradiecore / Tradify | Gestionali lavori + preventivi + fatture | Generalisti, molti campi da compilare |
| Perfetto, ElettroSmart | Software preventivi impianti elettrici | Desktop/tradizionali |
| Plumber Invoices & Estimates | App PDF + firma | Limite fatture nella versione free |
| PreventivApp, Preventivalo, EasyCloudHome, iUtoo | Marketplace lato cliente | Non competitor diretti |
| App di dettatura generiche (Speechy, TalkType…) | Solo trascrizione | Non producono righe/prezzi/totali |

## Gap
Non trovata nessuna app che unisca: **dettatura vocale in italiano → ricerca nel proprio listino/magazzino → scheda
preventivo con totali → PDF** in pochi secondi. I gestionali esistenti richiedono di compilare campi; le app di dettatura
non conoscono prezzi. (Assenza non dimostrata: verificare su App Store/Google Play.)

## Posizionamento
"Detti il lavoro, ti esce il preventivo." Target: idraulici, elettricisti, imbianchini, serramentisti, manutentori, piccole imprese edili.
Prezzo ipotesi: free (3 documenti/mese) · Pro 12–19 €/mese o 119 €/anno.

## Rischi
- Distribuzione (gruppi Facebook di categoria, WhatsApp, passaparola, fornitori/rivenditori di materiali).
- Qualità del riconoscimento vocale in cantiere (rumore) → sempre scheda modificabile + fallback testo.
- Web Speech API: ottimo su Chrome/Android e Safari recente; Firefox no.
- "Fattura" PDF ≠ fattura elettronica SDI: comunicarlo con chiarezza.
- Il riconoscimento vocale del browser può inviare l'audio ai server del vendor del browser (Google/Apple): da dichiarare nell'informativa.
