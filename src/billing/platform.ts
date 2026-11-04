/**
 * App nativa (Capacitor)? Nelle app store NON si mostrano prezzi né pulsanti d'acquisto
 * (linea guida Apple 3.1.1, vedi docs/MOBILE.md §7). Mai lancia.
 */
export function isNativeApp(): boolean {
  try {
    const c = (globalThis as { window?: { Capacitor?: { isNativePlatform?: () => boolean } } }).window?.Capacitor;
    return c?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
