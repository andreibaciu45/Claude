/**
 * Validazione fiscale di un backup PRIMA del ripristino (REV-IMP1). Un file modificato a mano non deve poter
 * sostituire fatture emesse né reintrodurre fatture "emesse" ancora modificabili.
 * Per ogni fattura/nota (non "di cortesia" v1):
 *  - stato diverso da 'bozza'  =>  `lockedAt`, `seq`, `number`, XML e `xmlSha256` presenti;
 *  - SHA-256 dell'XML ricalcolato == `xmlSha256` (anche per lo storico degli XML sostituiti);
 *  - `number` coerente con sezionale/seq/anno; sezionale coerente col tipo (FT = TD01, NC = TD04);
 *  - una bozza non ha dati d'emissione;
 *  - unicità del numero; note di credito (TD04) con fattura originale presente, emessa e di tipo TD01.
 * (L'unicità di sezionale+anno+seq e i contatori sono già garantiti da parseBackup/importBackup.)
 */
import type { AuditEntry, QuoteDocument } from '../types';
import { formatInvoiceNumber, sha256Hex } from './invoices';

export type BackupIssueCode =
  | 'hash_mismatch' | 'history_hash_mismatch' | 'missing_xml' | 'missing_locked_at' | 'missing_number' | 'number_mismatch'
  | 'hash_not_in_audit' | 'sectional_mismatch' | 'draft_has_issue_data' | 'duplicate_number' | 'credit_note_original_missing' | 'credit_note_original_invalid';

export interface BackupIssue {
  docId: string;
  /** Numero mostrato all'utente (fiscale se presente). */
  number: string;
  code: BackupIssueCode;
  message: string;
  /** Per i riferimenti: id di un altro documento coinvolto. */
  relatedId?: string;
}

export interface BackupValidation {
  issues: BackupIssue[];
  /** Id dei documenti da rifiutare (con i dipendenti: una nota di credito il cui originale è rifiutato). */
  rejectedIds: Set<string>;
}

const label = (d: QuoteDocument): string => d.invoice?.number || d.number || d.id;

export async function validateBackupDocuments(documents: QuoteDocument[], audit: AuditEntry[] = []): Promise<BackupValidation> {
  // impronte registrate nel registro audit per ciascun documento (emissione, correzioni): contro chi ricalcola XML E hash insieme
  const auditHashes = new Map<string, Set<string>>();
  for (const a of audit) if (a.xmlSha256) (auditHashes.get(a.docId) ?? auditHashes.set(a.docId, new Set()).get(a.docId)!).add(a.xmlSha256);
  const issues: BackupIssue[] = [];
  const add = (d: QuoteDocument, code: BackupIssueCode, message: string, relatedId?: string) =>
    issues.push({ docId: d.id, number: label(d), code, message, ...(relatedId ? { relatedId } : {}) });
  const byId = new Map(documents.map((d) => [d.id, d]));
  const seenNumbers = new Map<string, string>();

  for (const d of documents) {
    const i = d.invoice;
    if (d.type !== 'fattura' || !i || i.legacy) continue;
    const L = label(d);
    const hasIssueData = i.seq !== undefined || !!i.number || !!i.xml || !!i.xmlSha256 || !!i.fileName || !!i.progressivoInvio || i.issuedAt !== undefined;
    if (d.status === 'bozza' && !i.lockedAt) {
      if (hasIssueData) add(d, 'draft_has_issue_data', `${L}: è una bozza ma contiene numero, XML o altri dati d'emissione: il file è stato modificato.`);
      continue;
    }
    // emessa (o in uno stato successivo all'emissione)
    if (!i.lockedAt) add(d, 'missing_locked_at', `${L}: risulta emessa (stato "${d.status}") ma non è bloccata (manca lockedAt): resterebbe modificabile.`);
    if (d.status === 'bozza' && i.lockedAt) add(d, 'draft_has_issue_data', `${L}: è in stato "bozza" ma risulta bloccata: dati incoerenti.`);
    if (typeof i.seq !== 'number' || !Number.isInteger(i.seq) || i.seq < 1 || !i.number) {
      add(d, 'missing_number', `${L}: fattura emessa senza numero progressivo valido.`);
    } else {
      const expected = formatInvoiceNumber(i.sectional, i.seq, i.year);
      if (i.number !== expected) add(d, 'number_mismatch', `${L}: il numero "${i.number}" non corrisponde a sezionale ${i.sectional}, progressivo ${i.seq} e anno ${i.year} (atteso "${expected}").`);
      const nk = `${i.sectional}|${i.year}|${i.number}`;
      const other = seenNumbers.get(nk);
      if (other && other !== d.id) add(d, 'duplicate_number', `${L}: numero fattura duplicato.`, other);
      seenNumbers.set(nk, d.id);
    }
    if ((i.tipoDocumento === 'TD04') !== (i.sectional === 'NC')) {
      add(d, 'sectional_mismatch', `${L}: il sezionale "${i.sectional}" non è coerente con il tipo di documento ${i.tipoDocumento}.`);
    }
    if (!i.xml || !i.xmlSha256) {
      add(d, 'missing_xml', `${L}: mancano il file XML o la sua impronta SHA-256: non si può verificare che sia quello emesso.`);
    } else if ((await sha256Hex(i.xml)) !== i.xmlSha256) {
      add(d, 'hash_mismatch', `${L}: l'XML non corrisponde alla sua impronta SHA-256: il contenuto della fattura emessa è stato modificato.`);
    }
    const known = auditHashes.get(d.id);
    if (known && i.xmlSha256 && !known.has(i.xmlSha256)) {
      add(d, 'hash_not_in_audit', `${L}: l'impronta dell'XML non compare nel registro delle operazioni (audit) del backup: la fattura emessa potrebbe essere stata sostituita.`);
    }
    for (const [k, h] of (i.xmlHistory ?? []).entries()) {
      if (h.xml && h.xmlSha256 && (await sha256Hex(h.xml)) !== h.xmlSha256) {
        add(d, 'history_hash_mismatch', `${L}: la versione precedente n. ${k + 1} dell'XML non corrisponde alla sua impronta SHA-256.`);
      }
    }
    if (i.tipoDocumento === 'TD04') {
      const o = i.originalDocumentId ? byId.get(i.originalDocumentId) : undefined;
      if (!o) add(d, 'credit_note_original_missing', `${L}: nota di credito che rimanda a una fattura originale non presente nel backup.`, i.originalDocumentId);
      else if (o.type !== 'fattura' || o.invoice?.tipoDocumento !== 'TD01' || !o.invoice.lockedAt) {
        add(d, 'credit_note_original_invalid', `${L}: la fattura originale collegata non è una fattura emessa.`, o.id);
      }
    }
  }

  // una nota di credito il cui originale è rifiutato non ha più senso: si rifiuta a cascata
  const rejectedIds = new Set(issues.map((x) => x.docId));
  for (let changed = true; changed;) {
    changed = false;
    for (const d of documents) {
      const oid = d.invoice?.tipoDocumento === 'TD04' ? d.invoice.originalDocumentId : undefined;
      if (oid && rejectedIds.has(oid) && !rejectedIds.has(d.id)) {
        rejectedIds.add(d.id);
        add(d, 'credit_note_original_invalid', `${label(d)}: la fattura originale collegata è stata rifiutata, quindi anche questa nota di credito.`, oid);
        changed = true;
      }
    }
  }
  return { issues, rejectedIds };
}

/** Errore di `importBackup` quando il backup contiene documenti fiscali non validi (default: nessun ripristino). */
export class BackupValidationError extends Error {
  readonly issues: BackupIssue[];
  constructor(issues: BackupIssue[]) {
    super(`Backup non valido: ${issues.length} problema/i nelle fatture emesse. Nessun dato è stato modificato.\n${issues.map((i) => `• ${i.message}`).join('\n')}`);
    this.name = 'BackupValidationError';
    this.issues = issues;
  }
}
