/** Catalogo sintetico grande (fino a ~N voci) ricavato dai 6 cataloghi di prova: per i test di prestazioni. */
import type { CatalogItem } from '../../types';
import { TRADES } from './catalogs';

const BRANDS = ['Bticino', 'Vimar', 'Grohe', 'Ideal Standard', 'Vaillant', 'Daikin', 'Baxi', 'Legrand', 'Mapei', 'Sikkens', 'Rehau', 'Ariston', 'Geberit', 'Caleffi', 'Knauf'];
const FINISH = ['bianco', 'nero', 'grigio', 'cromato', 'satinato', 'standard', 'rinforzato', 'professionale'];

export function bigCatalog(n = 2000): CatalogItem[] {
  const base = Object.values(TRADES).flat();
  const out: CatalogItem[] = [];
  let i = 0;
  while (out.length < n) {
    const b = base[i % base.length];
    const round = Math.floor(i / base.length);
    if (round === 0) out.push({ ...b, id: `${b.id}#0` });
    else {
      const brand = BRANDS[(i * 7 + round) % BRANDS.length];
      const fin = FINISH[(i * 3 + round) % FINISH.length];
      out.push({
        ...b,
        id: `${b.id}#${round}`,
        name: `${b.name} ${brand} ${fin}`,
        aliases: [...b.aliases.map((a) => `${a} ${brand.toLowerCase()}`), `${b.name.toLowerCase()} ${fin}`],
      });
    }
    i++;
  }
  return out;
}
