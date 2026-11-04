/**
 * Set "cieco": frasi scritte DOPO la messa a punto delle regole sul corpus principale e misurate alla prima esecuzione.
 * Serve a stimare la generalizzazione (il corpus principale è stato usato per tarare le regole, quindi è ottimistico).
 * Alla prima esecuzione: 40/42 (95,2%), con 2 errori ("la mia fattura preferita" letta come nuova fattura a 0,55;
 * "annulla la 12" come storno a 0,80). Le regole sono state poi corrette: da qui il set NON è più cieco.
 */
import type { CorpusCase } from './corpus';

const P = (t: string, type: CorpusCase['type'], args?: Record<string, unknown>): CorpusCase => ({ t, kind: 'pos', type, args });
const N = (t: string): CorpusCase => ({ t, kind: 'neg' });
const A = (t: string): CorpusCase => ({ t, kind: 'amb' });

export const HELDOUT: CorpusCase[] = [
  P('preventivo per Lombardi, rifacimento del bagno', 'new_document', { docType: 'preventivo' }),
  P('scusa, nuova fattura per Marino: sei ore di manodopera', 'new_document', { docType: 'fattura' }),
  P('genera un preventivo per Silvestri', 'new_document', { docType: 'preventivo' }),
  P('trasforma il preventivo ventidue in una fattura', 'convert_quote', { ref: { kind: 'number', number: 22 } }),
  P('convertilo in fattura', 'convert_quote'),
  P('emetti la fattura di Moretti', 'issue_invoice', { ref: { kind: 'customer', name: 'Moretti' } }),
  P('emetti subito la fattura numero tre', 'issue_invoice', { ref: { kind: 'number', number: 3 } }),
  P('storna la fattura 30', 'credit_note', { ref: { kind: 'number', number: 30 } }),
  P('annulla la fattura trentadue con nota di credito per errore di battitura', 'credit_note', { ref: { kind: 'number', number: 32 } }),
  P('crea una nota di credito sulla fattura 14', 'credit_note', { ref: { kind: 'number', number: 14 } }),
  P('segna pagata la fattura 18', 'mark_paid', { ref: { kind: 'number', number: 18 } }),
  P('Greco ha saldato 500 euro', 'mark_paid', { amount: 500 }),
  P('la fattura di Fontana è stata incassata', 'mark_paid', { ref: { kind: 'customer', name: 'Fontana' } }),
  P('segna come inviata la fattura 6', 'mark_sent', { ref: { kind: 'number', number: 6 } }),
  P('metti il preventivo 11 come accettato', 'quote_status', { status: 'accettato' }),
  P('duplica il preventivo di Ricci', 'duplicate', { ref: { kind: 'customer', name: 'Ricci' } }),
  P('clona la fattura 4', 'duplicate', { ref: { kind: 'number', number: 4 } }),
  P('apri il preventivo di Bruno', 'open', { ref: { kind: 'customer', name: 'Bruno' } }),
  P('mostra la fattura numero quindici', 'open', { ref: { kind: 'number', number: 15 } }),
  P('vai all ultimo preventivo', 'open', { ref: { kind: 'last' } }),
  P('mostra i preventivi di Serra', 'list', { customerName: 'Serra' }),
  P('aggiungi una mano di vernice al preventivo', 'add_line'),
  P('inserisci tre prese elettriche alla fattura', 'add_line'),
  P('elimina la bozza 2', 'delete_draft'),
  P('rimuovi il preventivo numero cinque', 'delete_draft', { ref: { kind: 'number', number: 5 } }),
  P('scarica l xml della fattura numero 9', 'download', { format: 'xml', ref: { kind: 'number', number: 9 } }),
  P('stampa il preventivo 3', 'download', { format: 'pdf' }),
  P('scarica il pdf della fattura di Rossi', 'download', { format: 'pdf' }),
  P('conferma emissione fattura', 'confirm', { what: 'issue' }),
  P('conferma lo storno', 'confirm', { what: 'credit_note' }),
  P('va bene', 'affirm'),
  P('lascia perdere', 'dismiss'),
  P('annulla l ultima operazione', 'undo'),
  N('la mia fattura preferita'),
  N('quanto tempo ci vuole per posare il parquet'),
  N('metà del lavoro è finito'),
  N('ho comprato un tubo da venti'),
  A('emetto una fattura'),
  A('ma se emetto la fattura poi la posso cambiare?'),
  A('stornare'),
  A('fattura'),
  A('annulla la 12'),
];
