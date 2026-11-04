/**
 * Interfaccia che lo storage offre al modulo di sync (src/sync): cambio account su dispositivo condiviso (S8)
 * e importazione dell'audit proveniente da altri dispositivi (S10). Solo tipi: nessuna dipendenza da index.ts.
 * Implementazione: `storageHooks` in ./index.
 */
import type { AuditEntry } from '../types';

/** Valore esatto da passare in `confirm` per cancellare i dati locali (protezione da chiamate accidentali). */
export const CLEAR_LOCAL_DATA_CONFIRM = 'CANCELLA-DATI-LOCALI' as const;

export interface ClearLocalDataOptions {
  /** OBBLIGATORIO e uguale a 'CANCELLA-DATI-LOCALI': senza, non viene cancellato nulla (la funzione lancia). */
  confirm: typeof CLEAR_LOCAL_DATA_CONFIRM;
  /**
   * true (predefinito) = restituisce in `backupJson` un backup completo (exportBackup, fatture emesse con XML incluse)
   * letto nella STESSA transazione della cancellazione. false = nessuna copia: i dati sono persi.
   */
  keepBackupCopy?: boolean;
  /**
   * false (predefinito) = svuota anche il registro audit locale. true = il registro sopravvive e viene aggiunta
   * UNA voce 'edit' che registra la cancellazione.
   */
  keepAudit?: boolean;
}

export interface ClearLocalDataResult {
  /** Backup JSON di sicurezza (solo con keepBackupCopy !== false). */
  backupJson?: string;
  /** Quanto è stato cancellato. */
  cleared: { catalog: number; documents: number; invoicesIssued: number; customers: number; audit: number };
  /** true se è stata scritta la voce di audit (solo con keepAudit). */
  auditWritten: boolean;
}

export interface ImportAuditResult {
  /** Voci nuove aggiunte al registro locale. */
  added: number;
  /** Voci ignorate: già presenti (stesso id), non valide o duplicate nel lotto. */
  skipped: number;
}

export interface StorageHooks {
  /** PERICOLOSA. Svuota profilo, catalogo, documenti, rubrica clienti (e audit salvo keepAudit). Vedi ClearLocalDataOptions. */
  clearLocalData(opts: ClearLocalDataOptions): Promise<ClearLocalDataResult>;
  /** Importa voci di audit di altri dispositivi: idempotente per id, append-only, nessuna sovrascrittura. */
  importAuditEntries(entries: AuditEntry[]): Promise<ImportAuditResult>;
}
