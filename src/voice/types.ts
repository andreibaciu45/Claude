/**
 * Tipi condivisi del modulo voce.
 * `Command` è l'unione discriminata prodotta dal classificatore DETERMINISTICO (nessun LLM) e consumata da
 * policy (rischio/conferme) ed executor (storage/engine/pdf).
 */
export type DocKind = 'preventivo' | 'fattura';

/** Riferimento a un documento, come pronunciato dall'utente. Risolto dall'executor (resolve.ts). */
export type DocRef =
  | { kind: 'number'; number: number; year?: number; docType?: DocKind }
  /** "l'ultima fattura", "l'ultimo preventivo" */
  | { kind: 'last'; docType?: DocKind; draftOnly?: boolean }
  /** "questo", "il documento corrente", o nessun riferimento esplicito */
  | { kind: 'current'; docType?: DocKind }
  /** "la fattura di Rossi"; `latest` = "l'ultima fattura di Rossi" */
  | { kind: 'customer'; name: string; docType?: DocKind; draftOnly?: boolean; latest?: boolean };

export type Command =
  | { type: 'new_document'; docType: DocKind; dictation: string }
  | { type: 'convert_quote'; ref: DocRef }
  | { type: 'issue_invoice'; ref: DocRef }
  | { type: 'credit_note'; ref: DocRef; reason?: string }
  | { type: 'mark_paid'; ref: DocRef; amount?: number }
  | { type: 'mark_sent'; ref: DocRef }
  | { type: 'quote_status'; ref: DocRef; status: 'accettato' | 'rifiutato' }
  | { type: 'duplicate'; ref: DocRef }
  | { type: 'open'; ref: DocRef }
  | { type: 'list'; docType?: DocKind; customerName?: string }
  | { type: 'add_line'; dictation: string; ref: DocRef }
  | { type: 'delete_draft'; ref: DocRef }
  | { type: 'download'; format: 'pdf' | 'xml'; ref: DocRef }
  /** frase esplicita "conferma emissione" / "conferma storno": l'UNICA frase vocale che conferma un'azione irreversibile */
  | { type: 'confirm'; what: 'issue' | 'credit_note' }
  /** "sì", "ok", "va bene": MAI sufficiente per azioni irreversibili */
  | { type: 'affirm' }
  | { type: 'dismiss' }
  | { type: 'undo' };

export type CommandType = Command['type'];

export interface ClassifyContext {
  /** id del documento aperto a schermo (rotta /documenti/:id), se c'è */
  currentDocumentId?: string;
  /** ipotesi alternative del riconoscimento (n-best): servono a scartare intent distruttivi ambigui */
  nBest?: string[];
}

export interface ScoredCommand { command: Command; confidence: number }

export interface Classification {
  command: Command | null;
  /** 0..1 */
  confidence: number;
  /** altre interpretazioni plausibili (intent diverso dal principale), dalla più alla meno probabile */
  alternatives?: ScoredCommand[];
}
