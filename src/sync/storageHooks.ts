/**
 * Funzioni di storage che il sync usa per due casi che non può risolvere da solo: cambio account su un dispositivo condiviso
 * (cancellare i dati locali dell'utente precedente) e audit creato da altri dispositivi (importarlo). Il sync dipende solo da
 * questa interfaccia; l'implementazione reale è quella di `src/storage` (`clearLocalData`, `importAuditEntries`), collegata da
 * `detectStorageHooks`. Se una funzione manca (o nei test) vale "non disponibile": nessun errore, comportamento invariato.
 */
import * as storage from '../storage';
import type { AuditEntry } from '../types';

export class StorageHookUnavailableError extends Error {
  constructor(name: string) { super(`Funzione di storage non disponibile: ${name}`); this.name = 'StorageHookUnavailableError'; }
}

export interface StorageHooks {
  readonly available: { readonly clearLocalData: boolean; readonly importAuditEntries: boolean };
  /** Svuota i dati locali. Se lo storage produce una copia di sicurezza la restituisce (JSON) perché l'utente possa scaricarla. */
  clearLocalData(): Promise<{ backupJson?: string } | void>;
  /** Importa voci di audit di altri dispositivi (idempotente per id). Ritorna quante ne ha aggiunte. */
  importAuditEntries(entries: AuditEntry[]): Promise<number>;
}

/** Implementazione predefinita: niente è disponibile, ogni chiamata rifiuta con `StorageHookUnavailableError`. */
export const unavailableStorageHooks: StorageHooks = {
  available: { clearLocalData: false, importAuditEntries: false },
  clearLocalData: () => Promise.reject(new StorageHookUnavailableError('clearLocalData')),
  importAuditEntries: () => Promise.reject(new StorageHookUnavailableError('importAuditEntries')),
};

/** Completa un insieme parziale di funzioni con quelle "non disponibili". */
export function makeStorageHooks(p: { clearLocalData?: StorageHooks['clearLocalData']; importAuditEntries?: StorageHooks['importAuditEntries'] } = {}): StorageHooks {
  return {
    available: { clearLocalData: typeof p.clearLocalData === 'function', importAuditEntries: typeof p.importAuditEntries === 'function' },
    clearLocalData: p.clearLocalData ?? unavailableStorageHooks.clearLocalData,
    importAuditEntries: p.importAuditEntries ?? unavailableStorageHooks.importAuditEntries,
  };
}

/**
 * Collega le funzioni di `src/storage` se esistono (ricerca per nome a runtime). `clearLocalData` viene chiamata con la conferma
 * esplicita richiesta dallo storage e con copia di sicurezza (il JSON torna a chi chiama); l'audit locale viene svuotato con i dati.
 */
export function detectStorageHooks(): StorageHooks {
  const ns = storage as unknown as Record<string, unknown>;
  const names = ['clearLocalData', 'importAuditEntries', 'CLEAR_LOCAL_DATA_CONFIRM'];
  const [c, i, confirm] = names.map((n) => ns[n]);
  return makeStorageHooks({
    clearLocalData: typeof c === 'function'
      ? async () => {
        const r = await (c as (o: { confirm: unknown; keepBackupCopy: boolean }) => Promise<{ backupJson?: string }>)({ confirm, keepBackupCopy: true });
        return r?.backupJson !== undefined ? { backupJson: r.backupJson } : undefined;
      }
      : undefined,
    importAuditEntries: typeof i === 'function'
      ? async (e) => {
        const r = await (i as (x: AuditEntry[]) => Promise<{ added?: number } | number>)(e);
        return typeof r === 'number' ? r : (r?.added ?? 0);
      }
      : undefined,
  });
}
