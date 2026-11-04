import { useSyncExternalStore } from 'react';
import { syncEngine, type SyncEngine, type SyncStatus } from './engine';

/** Stato osservabile della sincronizzazione (idle/syncing/offline/errore/conflitto, ultimo sync, coda). */
export function useSyncStatus(engine: SyncEngine = syncEngine): SyncStatus {
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
}
