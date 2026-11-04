/**
 * Visibilità del pulsante flottante dei comandi vocali (`.vc-fab`).
 *
 * DECISIONE DI PRODOTTO: sulla home "/" finché NON c'è una scheda documento aperta (fase di dettatura della
 * NewQuotePage) esiste già il microfono grande della dettatura: due microfoni sulla stessa schermata confondono
 * (uno detta il testo, l'altro esegue comandi). Quindi in quella fase il pulsante flottante è nascosto.
 * I comandi vocali restano disponibili su tutte le altre rotte e dentro la scheda (fase "edit").
 *
 * Meccanismo: la pagina che ospita il microfono grande chiama `useHideVoiceFab(true)` finché è in fase di
 * dettatura; il contatore evita problemi se due componenti la richiedono insieme, e il cleanup al cambio
 * rotta/unmount ripristina il pulsante da solo. Il widget legge lo stato con `useVoiceFabHidden()`.
 */
import { useEffect, useSyncExternalStore } from 'react';

let hideCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => hideCount > 0;

/** Da usare nel widget: true se una pagina ha chiesto di nascondere il pulsante flottante. */
export const useVoiceFabHidden = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false);

/** Da usare nelle pagine con un microfono proprio: nasconde il pulsante flottante finché `hide` è vero. */
export function useHideVoiceFab(hide: boolean): void {
  useEffect(() => {
    if (!hide) return;
    hideCount += 1; emit();
    return () => { hideCount -= 1; emit(); };
  }, [hide]);
}
