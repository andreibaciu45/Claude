/**
 * Aggancio al resto dell'app SENZA modificare src/storage.
 *
 * `attachSync()` avvia lo scheduler del motore: sync all'avvio, al ritorno online, quando la scheda torna
 * visibile, ogni 5 minuti, e un rilevamento delle modifiche locali ogni 15 s (confronto di snapshot con gli
 * hash dell'ultimo stato sincronizzato) seguito da un sync con debounce.
 *
 * PUNTO DI AGGANCIO IDEALE (futuro, nello storage): dopo ogni scrittura riuscita (saveProfile, saveCatalogItem,
 * deleteCatalogItem, saveDocument, deleteDocument, importBackup, transazioni di emissione) fare
 *     window.dispatchEvent(new Event('vp:storage-changed'))
 * (costante STORAGE_CHANGED_EVENT). Il motore lo ascolta già: il sync parte dopo 2 s senza polling.
 */
import { syncEngine, STORAGE_CHANGED_EVENT, type SyncEngine } from './engine';

export { STORAGE_CHANGED_EVENT };

/** Notifica manuale di una modifica locale (equivale all'evento). */
export const notifyLocalChange = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT));
};

/** Avvia la sincronizzazione in background. Ritorna la funzione per fermarla. Sicuro se chiamata più volte. */
export function attachSync(engine: SyncEngine = syncEngine): () => void {
  if (typeof window === 'undefined') return () => undefined;
  return engine.start();
}
