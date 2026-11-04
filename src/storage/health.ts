/**
 * Stato di salute dell'archivio, osservabile da tutta l'app (banner `StorageBanner`, pagine, test).
 * Modulo PURO (nessuna dipendenza da IndexedDB): lo aggiorna `db.ts`.
 *
 *  - 'ok'          archivio persistente aperto e funzionante.
 *  - 'degraded'    archivio persistente aperto, ma ultimo salvataggio fallito (spazio pieno, transazione annullata)
 *                  oppure spazio libero quasi finito (< 50 MB).
 *  - 'unavailable' NESSUN archivio persistente: IndexedDB assente/non apribile (dati solo in memoria, per bozze e preventivi)
 *                  oppure connessione persa (altra scheda, versione più nuova) e riapertura in corso.
 * Mai un ripiego silenzioso in memoria dopo che l'archivio persistente era stato aperto con successo.
 */

export type StorageHealth = 'ok' | 'degraded' | 'unavailable';

export type StorageReason =
  | 'no-indexeddb' // IndexedDB non esiste (navigazione privata di vecchi browser, archivio disabilitato)
  | 'open-failed' // apertura iniziale fallita
  | 'connection-closed' // connessione chiusa (browser, InvalidStateError)
  | 'version-change' // un'altra scheda ha aggiornato/eliminato il database
  | 'blocked' // l'apertura è bloccata da un'altra scheda con una versione vecchia
  | 'quota' // spazio esaurito (QuotaExceededError)
  | 'aborted' // transazione annullata dal browser
  | 'low-space' // meno di 50 MB liberi
  | 'unknown';

export const LOW_SPACE_BYTES = 50 * 1024 * 1024;

export interface StorageStatus {
  health: StorageHealth;
  reason?: StorageReason;
  /** Messaggio breve in italiano, adatto al banner. */
  message: string;
  /** true = c'è una connessione IndexedDB utilizzabile ora. */
  persistent: boolean;
  /** true = si sta usando l'archivio in memoria (solo se IndexedDB non è mai stato apribile): niente viene salvato. */
  memoryOnly: boolean;
  /** true = è in corso/pianificato un tentativo di riapertura automatica. */
  retrying: boolean;
  lowSpace: boolean;
  freeBytes?: number;
  /** Esito di navigator.storage.persist() (undefined = non richiesto/non supportato). */
  persisted?: boolean;
  since?: number;
}

/** Errore lanciato quando un'operazione non può essere eseguita (o salvata) su un archivio persistente. */
export class StorageUnavailableError extends Error {
  readonly reason: StorageReason;
  readonly cause?: unknown;
  constructor(reason: StorageReason, message?: string, cause?: unknown) {
    super(message ?? reasonMessage(reason));
    this.name = 'StorageUnavailableError';
    this.reason = reason;
    this.cause = cause;
  }
}

export function reasonMessage(reason: StorageReason): string {
  switch (reason) {
    case 'no-indexeddb':
      return 'Questo browser non permette di salvare i dati (navigazione privata o archivio disabilitato): i dati non verranno salvati. L\'emissione di fatture è bloccata.';
    case 'open-failed':
      return 'Non riesco ad aprire l\'archivio del browser: i dati non verranno salvati. L\'emissione di fatture è bloccata.';
    case 'connection-closed':
      return 'La connessione con l\'archivio si è interrotta. Riprovo ad aprirlo: finché non torna disponibile non si può emettere né salvare nulla di fiscale.';
    case 'version-change':
      return 'Un\'altra scheda ha aggiornato l\'archivio dei dati. Chiudi le altre schede dell\'app o ricarica la pagina.';
    case 'blocked':
      return 'L\'apertura dell\'archivio è bloccata da un\'altra scheda dell\'app rimasta aperta: chiudila.';
    case 'quota':
      return 'Spazio esaurito: l\'ultimo salvataggio NON è andato a buon fine. Libera spazio sul dispositivo e riprova.';
    case 'aborted':
      return 'Il browser ha annullato l\'ultimo salvataggio: l\'operazione NON è stata registrata. Riprova.';
    case 'low-space':
      return 'Lo spazio libero sul dispositivo sta per finire (meno di 50 MB): libera spazio e scarica un backup.';
    default:
      return 'Errore dell\'archivio dei dati: l\'ultima operazione NON è stata salvata.';
  }
}

interface Internal {
  /** Connessione IndexedDB utilizzabile. */
  persistent: boolean;
  memoryOnly: boolean;
  retrying: boolean;
  /** Ragione dell'indisponibilità (solo se !persistent). */
  lostReason?: StorageReason;
  /** Ultimo salvataggio fallito con connessione ancora viva. */
  writeFailure?: StorageReason;
  lowSpace: boolean;
  freeBytes?: number;
  persisted?: boolean;
  since?: number;
}

let state: Internal = { persistent: false, memoryOnly: false, retrying: false, lowSpace: false };
let cached: StorageStatus | null = null;
const listeners = new Set<() => void>();

function derive(s: Internal): StorageStatus {
  const base = { persistent: s.persistent, memoryOnly: s.memoryOnly, retrying: s.retrying, lowSpace: s.lowSpace, freeBytes: s.freeBytes, persisted: s.persisted, since: s.since };
  if (!s.persistent && s.lostReason) return { ...base, health: 'unavailable', reason: s.lostReason, message: reasonMessage(s.lostReason) };
  if (s.writeFailure) return { ...base, health: 'degraded', reason: s.writeFailure, message: reasonMessage(s.writeFailure) };
  if (s.lowSpace) return { ...base, health: 'degraded', reason: 'low-space', message: reasonMessage('low-space') };
  // stato iniziale (archivio non ancora aperto): non è un problema
  return { ...base, health: 'ok', message: 'Archivio dei dati funzionante.' };
}

export const getStorageStatus = (): StorageStatus => (cached ??= derive(state));
export const getStorageHealth = (): StorageHealth => getStorageStatus().health;

export function subscribeStorageStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Uso interno (db.ts): aggiorna lo stato e avvisa gli osservatori solo se qualcosa è cambiato. */
export function __patchStorageState(patch: Partial<Internal>): void {
  const next = { ...state, ...patch };
  if (patch.lostReason !== undefined || patch.writeFailure !== undefined || patch.persistent === false) next.since = state.since ?? Date.now();
  const before = JSON.stringify(derive(state));
  const after = JSON.stringify(derive(next));
  state = next;
  if (before === after) return;
  if (derive(next).health === 'ok') state.since = undefined;
  cached = derive(state);
  for (const l of [...listeners]) { try { l(); } catch { /* osservatore difettoso */ } }
}

export function __resetStorageHealthForTests(): void {
  state = { persistent: false, memoryOnly: false, retrying: false, lowSpace: false };
  cached = null;
  for (const l of [...listeners]) { try { l(); } catch { /* */ } }
}
