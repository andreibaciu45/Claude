/**
 * Registro dei "lavori in corso" che NON devono essere interrotti da un ricaricamento della pagina
 * (aggiornamento dell'app). Finché c'è almeno una chiave registrata, `UpdatePrompt` non ricarica.
 *
 * Uso negli altri moduli (sempre in coppia, anche in caso di errore):
 *
 *   import { registerBusy, unregisterBusy } from '../pwa/busy';
 *   registerBusy('invoice-issue');
 *   try { await issueInvoice(...); } finally { unregisterBusy('invoice-issue'); }
 *
 * Chiavi consigliate:
 *   - 'invoice-issue'            emissione di una fattura / nota di credito (mai aggiornare durante);
 *   - 'doc-dirty:<id>'           documento in modifica con modifiche non ancora salvate;
 *   - 'hold-confirm'             pressione prolungata di conferma in corso;
 *   - 'sync' / 'backup-import'   operazioni lunghe sui dati.
 *
 * Le registrazioni sono conteggiate: due `registerBusy('x')` richiedono due `unregisterBusy('x')`.
 * Nessun dato viene perso comunque: le bozze sono già salvate in locale; questo evita solo di
 * interrompere un'azione a metà.
 */
type Listener = () => void;

export interface BusyRegistry {
  register(key: string): void;
  unregister(key: string): void;
  isBusy(): boolean;
  keys(): string[];
  subscribe(l: Listener): () => void;
}

export function createBusyRegistry(): BusyRegistry {
  const counts = new Map<string, number>();
  const listeners = new Set<Listener>();
  const emit = () => { for (const l of [...listeners]) { try { l(); } catch { /* un ascoltatore difettoso non blocca gli altri */ } } };
  return {
    register(key) { counts.set(key, (counts.get(key) ?? 0) + 1); emit(); },
    unregister(key) {
      const n = counts.get(key) ?? 0;
      if (n <= 1) counts.delete(key); else counts.set(key, n - 1);
      emit();
    },
    isBusy: () => counts.size > 0,
    keys: () => [...counts.keys()],
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/** Registro condiviso dell'app. */
export const busy = createBusyRegistry();
export const registerBusy = (key: string): void => busy.register(key);
export const unregisterBusy = (key: string): void => busy.unregister(key);
export const isBusy = (): boolean => busy.isBusy();
export const subscribeBusy = (l: Listener): (() => void) => busy.subscribe(l);

/** Esegue `fn` segnando il lavoro come in corso (registra e rilascia sempre, anche in caso di errore). */
export async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T> {
  registerBusy(key);
  try { return await fn(); } finally { unregisterBusy(key); }
}
