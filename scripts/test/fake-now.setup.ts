// Setup opzionale (attivo solo con TEST_FAKE_NOW=<ISO>): sposta l'orologio di `Date` a un istante dato (poi scorre in tempo reale),
// senza toccare i timer. Serve a cercare test che dipendono dall'orologio della macchina (cambio d'anno, fine mese, anno bisestile):
//   TEST_FAKE_NOW=2027-01-01T00:00:10 npx vitest run
// Non importa vitest (funziona con le due installazioni, root e server). I test che usano vi.setSystemTime/useFakeTimers
// sovrascrivono questo valore, come devono.
const iso = process.env.TEST_FAKE_NOW;
if (iso) {
  const Real = Date;
  const target = Real.parse(iso);
  if (Number.isNaN(target)) throw new Error(`TEST_FAKE_NOW non valido: ${iso}`);
  const offset = target - Real.now();
  const nowMs = () => Real.now() + offset;
  class ShiftedDate extends Real {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.length === 0) super(nowMs()); else super(...(args as [any]));
    }
    static now(): number { return nowMs(); }
  }
  globalThis.Date = ShiftedDate as unknown as DateConstructor;
}
