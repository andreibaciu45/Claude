/**
 * Corpus di frasi per misurare il classificatore (ARCHITECTURE-V2 §4.5: "set di test frasi reali che cresce nel tempo").
 * - pos: deve produrre il comando atteso con confidenza >= 0.8 (e gli argomenti indicati in `args`)
 * - neg: NON deve produrre alcun comando (command === null)
 * - amb: ambigua/rumorosa: ammesso null o confidenza < 0.8, MAI un comando irreversibile con confidenza >= 0.8
 */
import type { CommandType } from '../types';

export interface CorpusCase {
  t: string;
  kind: 'pos' | 'neg' | 'amb';
  type?: CommandType;
  /** sottoinsieme (ricorsivo) dei campi del comando atteso */
  args?: Record<string, unknown>;
  ctx?: { currentDocumentId?: string };
}

const P = (t: string, type: CommandType, args?: Record<string, unknown>): CorpusCase => ({ t, kind: 'pos', type, args });
const N = (t: string): CorpusCase => ({ t, kind: 'neg' });
const A = (t: string): CorpusCase => ({ t, kind: 'amb' });

export const CORPUS: CorpusCase[] = [
  // ---- nuovo documento
  P('nuovo preventivo per Rossi tre metri di tubo rame', 'new_document', { docType: 'preventivo' }),
  P('preventivo per Mario Rossi, tre metri di tubo rame da sedici, due ore di manodopera', 'new_document', { docType: 'preventivo' }),
  P('nuova fattura per Bianchi due ore di manodopera', 'new_document', { docType: 'fattura' }),
  P('fai una fattura per Verdi: dieci metri di cavo', 'new_document', { docType: 'fattura' }),
  P('crea un nuovo preventivo per la ditta Neri', 'new_document', { docType: 'preventivo' }),
  P('prepara un preventivo per il signor Esposito, posa di un pavimento', 'new_document', { docType: 'preventivo' }),
  P('fammi un preventivo per Colombo, imbiancatura di due stanze', 'new_document', { docType: 'preventivo' }),
  P('ok, nuovo preventivo per Ferrari', 'new_document', { docType: 'preventivo' }),
  P('vorrei una fattura per Gallo, quattro ore di manodopera', 'new_document', { docType: 'fattura' }),
  P('per favore crea una fattura per Conti', 'new_document', { docType: 'fattura' }),
  P('nuovo preventivo', 'new_document', { docType: 'preventivo' }),
  P('nuova fattura', 'new_document', { docType: 'fattura' }),
  P('fattura per Rossi, due ore di manodopera e tre metri di tubo', 'new_document', { docType: 'fattura' }),
  P('allora, preventivo per Romano: sostituzione rubinetto', 'new_document', { docType: 'preventivo' }),
  // ---- converti
  P('converti il preventivo 8 in fattura', 'convert_quote', { ref: { kind: 'number', number: 8 } }),
  P('converti il preventivo otto in fattura', 'convert_quote', { ref: { kind: 'number', number: 8 } }),
  P('trasforma il preventivo dodici in fattura', 'convert_quote', { ref: { kind: 'number', number: 12 } }),
  P('fai la fattura da questo preventivo', 'convert_quote', { ref: { kind: 'current' } }),
  P('trasforma questo preventivo in una fattura', 'convert_quote', { ref: { kind: 'current' } }),
  P('converti in fattura il preventivo di Rossi', 'convert_quote', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('converti l ultimo preventivo in fattura', 'convert_quote', { ref: { kind: 'last' } }),
  P('crea la fattura dal preventivo 15', 'convert_quote', { ref: { kind: 'number', number: 15 } }),
  P('converti questo in fattura', 'convert_quote', { ref: { kind: 'current' } }),
  // ---- emetti
  P('emetti la fattura', 'issue_invoice', { ref: { kind: 'current' } }),
  P('emetti la bozza di Rossi', 'issue_invoice', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('emetti questa fattura', 'issue_invoice'),
  P('emetti la fattura numero 5', 'issue_invoice', { ref: { kind: 'number', number: 5 } }),
  P('per favore emetti la fattura', 'issue_invoice'),
  P('ok emetti la fattura di Bianchi', 'issue_invoice', { ref: { kind: 'customer', name: 'Bianchi' } }),
  P('emettere la fattura corrente', 'issue_invoice'),
  P('puoi emettere la fattura', 'issue_invoice'),
  // ---- nota di credito
  P('annulla la fattura 12 con nota di credito', 'credit_note', { ref: { kind: 'number', number: 12 } }),
  P('storna la fattura dodici', 'credit_note', { ref: { kind: 'number', number: 12 } }),
  P('annulla la fattura dodici del duemilaventisei con nota di credito', 'credit_note', { ref: { kind: 'number', number: 12, year: 2026 } }),
  P('fai una nota di credito per la fattura 7', 'credit_note', { ref: { kind: 'number', number: 7 } }),
  P('annulla la fattura 12 con nota di credito motivo reso merce', 'credit_note', { ref: { kind: 'number', number: 12 }, reason: 'Reso merce' }),
  P('storna la fattura di Rossi perché errore di importo', 'credit_note', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('annulla l ultima fattura con una nota di credito', 'credit_note', { ref: { kind: 'last' } }),
  P('emetti una nota di credito per la fattura 3', 'credit_note', { ref: { kind: 'number', number: 3 } }),
  P('stornare la fattura 9', 'credit_note', { ref: { kind: 'number', number: 9 } }),
  // ---- pagata
  P('segna la fattura 12 come pagata', 'mark_paid', { ref: { kind: 'number', number: 12 } }),
  P('segna come incassata la fattura dodici', 'mark_paid', { ref: { kind: 'number', number: 12 } }),
  P('Rossi ha pagato 300 euro', 'mark_paid', { ref: { kind: 'customer', name: 'Rossi' }, amount: 300 }),
  P('ho incassato la fattura di Bianchi', 'mark_paid', { ref: { kind: 'customer', name: 'Bianchi' } }),
  P('segna pagata questa fattura', 'mark_paid', { ref: { kind: 'current' } }),
  P('la fattura 8 è stata pagata', 'mark_paid', { ref: { kind: 'number', number: 8 } }),
  P('registra il pagamento di 150 euro per la fattura 4', 'mark_paid', { ref: { kind: 'number', number: 4 }, amount: 150 }),
  P('segna la fattura 21 come saldata', 'mark_paid', { ref: { kind: 'number', number: 21 } }),
  P('Verdi ha pagato', 'mark_paid', { ref: { kind: 'customer', name: 'Verdi' } }),
  // ---- inviata
  P('segna la fattura 12 come inviata', 'mark_sent', { ref: { kind: 'number', number: 12 } }),
  P('segna inviata', 'mark_sent'),
  P('ho inviato la fattura di Rossi', 'mark_sent', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('segna il preventivo 8 come inviato', 'mark_sent', { ref: { kind: 'number', number: 8, docType: 'preventivo' } }),
  // ---- stato preventivo
  P('segna il preventivo 8 come accettato', 'quote_status', { status: 'accettato', ref: { kind: 'number', number: 8 } }),
  P('il cliente ha rifiutato il preventivo 10', 'quote_status', { status: 'rifiutato', ref: { kind: 'number', number: 10 } }),
  P('segna questo preventivo come rifiutato', 'quote_status', { status: 'rifiutato' }),
  // ---- duplica
  P('duplica la fattura 12', 'duplicate', { ref: { kind: 'number', number: 12, docType: 'fattura' } }),
  P('duplica il preventivo 8', 'duplicate', { ref: { kind: 'number', number: 8, docType: 'preventivo' } }),
  P('duplica', 'duplicate'),
  P('duplica questo documento', 'duplicate'),
  P('fai una copia del preventivo di Rossi', 'duplicate', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('duplicami l ultimo preventivo', 'duplicate', { ref: { kind: 'last' } }),
  // ---- apri / mostra
  P('apri la fattura dodici', 'open', { ref: { kind: 'number', number: 12 } }),
  P('apri il preventivo 8', 'open', { ref: { kind: 'number', number: 8, docType: 'preventivo' } }),
  P('mostrami l ultimo preventivo', 'open', { ref: { kind: 'last', docType: 'preventivo' } }),
  P('apri l ultima fattura', 'open', { ref: { kind: 'last', docType: 'fattura' } }),
  P('mostra il documento numero 3', 'open', { ref: { kind: 'number', number: 3 } }),
  P('vai alla fattura 5', 'open', { ref: { kind: 'number', number: 5 } }),
  P('apri la fattura dodici del 2026', 'open', { ref: { kind: 'number', number: 12, year: 2026 } }),
  P('fammi vedere il preventivo otto', 'open', { ref: { kind: 'number', number: 8 } }),
  P('apri la fattura di Rossi', 'open', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('visualizza il preventivo duecentoquindici', 'open', { ref: { kind: 'number', number: 215 } }),
  // ---- elenco
  P('fatture di Rossi', 'list', { customerName: 'Rossi' }),
  P('mostra le fatture di Rossi', 'list', { docType: 'fattura', customerName: 'Rossi' }),
  P('fatture di Bianchi', 'list', { customerName: 'Bianchi' }),
  P('mostrami tutti i preventivi', 'list', { docType: 'preventivo' }),
  P('apri i preventivi di Verdi', 'list', { docType: 'preventivo', customerName: 'Verdi' }),
  P('elenca le fatture', 'list', { docType: 'fattura' }),
  // ---- aggiungi riga
  P('aggiungi due ore di manodopera al preventivo corrente', 'add_line', { dictation: 'due ore di manodopera', ref: { kind: 'current' } }),
  P('aggiungi tre metri di tubo rame', 'add_line', { dictation: 'tre metri di tubo rame' }),
  P('aggiungi una riga: posa piastrelle venti metri quadri', 'add_line'),
  P('aggiungi dieci metri di cavo alla fattura', 'add_line', { dictation: 'dieci metri di cavo' }),
  P('inserisci due rubinetti nel preventivo', 'add_line', { dictation: 'due rubinetti' }),
  P('ok aggiungi quattro ore di manodopera a questo preventivo', 'add_line', { dictation: 'quattro ore di manodopera' }),
  P('metti cinque metri di guaina', 'add_line', { dictation: 'cinque metri di guaina' }),
  // ---- elimina
  P('elimina il preventivo 8', 'delete_draft', { ref: { kind: 'number', number: 8, docType: 'preventivo' } }),
  P('cancella la bozza di Rossi', 'delete_draft', { ref: { kind: 'customer', name: 'Rossi' } }),
  P('elimina questa bozza', 'delete_draft'),
  P('elimina il preventivo di Bianchi', 'delete_draft', { ref: { kind: 'customer', name: 'Bianchi' } }),
  P('butta la bozza', 'delete_draft'),
  P('cancella la fattura 12', 'delete_draft', { ref: { kind: 'number', number: 12 } }),
  // ---- download
  P('scarica il pdf', 'download', { format: 'pdf' }),
  P('scarica l xml', 'download', { format: 'xml' }),
  P('scarica l xml della fattura 12', 'download', { format: 'xml', ref: { kind: 'number', number: 12 } }),
  P('scarica il pdf del preventivo otto', 'download', { format: 'pdf', ref: { kind: 'number', number: 8 } }),
  P('esporta il pdf', 'download', { format: 'pdf' }),
  P('scarica la fattura in x m l', 'download', { format: 'xml' }),
  // ---- controllo
  P('conferma emissione', 'confirm', { what: 'issue' }),
  P('conferma storno', 'confirm', { what: 'credit_note' }),
  P('confermo l emissione', 'confirm', { what: 'issue' }),
  P('conferma annullamento', 'confirm', { what: 'credit_note' }),
  P('sì', 'affirm'),
  P('conferma', 'affirm'),
  P('ok va bene', 'affirm'),
  P('no', 'dismiss'),
  P('lascia stare', 'dismiss'),
  P('annulla', 'undo'),
  P('annulla ultima azione', 'undo'),
  P('torna indietro', 'undo'),
  // ---- errori di riconoscimento: ancora riconosciuti (comandi non distruttivi)
  P('duplca la fattura 12', 'duplicate'),
  P('apri il previntivo otto', 'open', { ref: { kind: 'number', number: 8 } }),
  P('scarica il pdf della fatura 12', 'download', { format: 'pdf' }),
  P('mostra le fature di Rossi', 'list', { customerName: 'Rossi' }),
  // ---- negative: dettato di contenuto o frasi non-comando
  N('tre metri di tubo rame da sedici'),
  N('due ore di manodopera e quattro rubinetti'),
  N('ciao come stai'),
  N('che tempo fa domani'),
  N('mi serve il caffè'),
  N('ieri ho emesso la fattura per Rossi ma il cliente non ha risposto'),
  N('non emettere la fattura'),
  N('la fattura è molto bella'),
  N(''),
  N('   '),
  N('uhm'),
  N('quanto costa un tubo da sedici'),
  N('il preventivo è troppo alto secondo il cliente'),
  N('stasera esco con gli amici'),
  N('togli l ultima riga'),
  // ---- ambigue / rumorose
  A('metti la fattura'),
  A('emeti la fattura'),
  A('emetto la fattura'),
  A('storno la fattura 12'),
  A('annulla la fattura'),
  A('posso emettere la fattura?'),
  A('allora ieri dicevamo di emettere la fattura di Rossi quando arriva il bonifico'),
  A('fattura dodici'),
  A('preventivo otto'),
  A('ultimo preventivo'),
  A('Rossi'),
  A('emetti il preventivo 8'),
];
