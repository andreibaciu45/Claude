// Setup opzionale (attivo solo con TEST_FAKE_NOW=<ISO>): fissa SOLO `Date` a un istante dato, senza toccare i timer reali.
// Serve a cercare test che dipendono dall'orologio della macchina (cambio d'anno, fine mese, ora legale):
//   TEST_FAKE_NOW=2027-01-01T00:00:10 npx vitest run
// I test che usano già vi.useFakeTimers/vi.setSystemTime sovrascrivono questo valore, come devono.
import { vi } from 'vitest';

const iso = process.env.TEST_FAKE_NOW;
if (iso) vi.setSystemTime(new Date(iso));
