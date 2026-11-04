/** Descrizioni in italiano dei comandi (chip "Intendevi…?", riepiloghi, log). */
import type { Command, DocRef } from './types';

const kind = (t?: string) => (t === 'preventivo' ? 'il preventivo' : t === 'fattura' ? 'la fattura' : 'il documento');

export function describeRef(r: DocRef): string {
  switch (r.kind) {
    case 'id': return 'il documento selezionato';
    case 'number': return `${kind(r.docType)} ${r.number}${r.year ? `/${r.year}` : ''}`;
    case 'last': return `${r.docType === 'preventivo' ? 'l’ultimo preventivo' : r.docType === 'fattura' ? 'l’ultima fattura' : 'l’ultimo documento'}`;
    case 'customer': return `${kind(r.docType)} di ${r.name}`;
    case 'current': return r.docType ? `${kind(r.docType)} aperto` : 'il documento aperto';
  }
}

export function describeCommand(c: Command): string {
  switch (c.type) {
    case 'new_document': return `Nuovo ${c.docType}: «${c.dictation}»`;
    case 'convert_quote': return `Converti in fattura ${describeRef(c.ref).replace(/^il /, 'il ')}`;
    case 'issue_invoice': return `Emetti ${describeRef({ ...(c.ref as object), docType: 'fattura' } as DocRef)}`;
    case 'credit_note': return `Storna con nota di credito ${describeRef(c.ref)}${c.reason ? ` (${c.reason})` : ''}`;
    case 'mark_paid': return `Segna come pagata ${describeRef(c.ref)}${c.amount !== undefined ? ` (${c.amount} €)` : ''}`;
    case 'mark_sent': return `Segna come inviato ${describeRef(c.ref)}`;
    case 'quote_status': return `Segna ${describeRef(c.ref)} come ${c.status}`;
    case 'duplicate': return `Duplica ${describeRef(c.ref)}`;
    case 'open': return `Apri ${describeRef(c.ref)}`;
    case 'list': return `Mostra ${c.docType === 'preventivo' ? 'i preventivi' : c.docType === 'fattura' ? 'le fatture' : 'i documenti'}${c.customerName ? ` di ${c.customerName}` : ''}`;
    case 'add_line': return `Aggiungi «${c.dictation}» a ${describeRef(c.ref)}`;
    case 'delete_draft': return `Elimina ${describeRef(c.ref)}`;
    case 'download': return `Scarica il ${c.format.toUpperCase()} di ${describeRef(c.ref)}`;
    case 'confirm': return c.what === 'issue' ? 'Conferma emissione' : 'Conferma storno';
    case 'affirm': return 'Sì';
    case 'dismiss': return 'Annulla richiesta';
    case 'undo': return 'Annulla l’ultima azione';
  }
}
