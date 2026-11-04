import { describe, expect, it } from 'vitest';
import { bigCatalog } from './bench/bigCatalog';
import { CAT_ELETTRICISTA } from './bench/catalogs';
import { getMatcher, parseDictation, prepareCatalog } from './index';

const PHRASES = [
  'preventivo per Mario Rossi tre metri di tubo rame da sedici dodici raccordi a gomito quattro ore di manodopera una caldaia vaillant',
  'per il signor Colombo quattro prese tre interruttori sei faretti led venti metri di cavo 2,5 venti metri di cavo 1,5 un quadro elettrico e otto ore di manodopera elettrica',
  'tinteggiare soggiorno 50 mq e camera 30 mq con sconto del dieci per cento iva al dieci',
  'sette metri di tubo multistrato da venti e due rubinetti cucina cinque prese usb tre magnetotermici da sedici',
];
const time = (f: () => void) => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

describe('prestazioni con catalogo da 2000 voci', () => {
  const big = bigCatalog(2000);

  it('il catalogo di prova ha 2000 voci', () => expect(big).toHaveLength(2000));

  it('parse < 50 ms con indice già costruito (mediana di più frasi)', () => {
    prepareCatalog(big);
    // per ogni frase si tiene il tempo MIGLIORE su 3 prove: un picco di carico della macchina (CI, suite in parallelo)
    // non è una regressione, mentre una regressione di complessità peggiora tutte le prove.
    const times = PHRASES.map((p) => Math.min(...Array.from({ length: 3 }, () => time(() => parseDictation(p, big)))));
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const worst = times[times.length - 1];
    expect(median).toBeLessThan(50);
    expect(worst).toBeLessThan(250); // margine per macchine lente/CI; il caso tipico è di pochi ms
  });

  it('frasi mai viste su catalogo caldo: < 50 ms', () => {
    prepareCatalog(big);
    // frasi mai viste = non ripetibili: si usano 3 serie diverse (numeri diversi) e vale la serie MIGLIORE, così un picco di carico
    // della macchina su una serie non dà un falso rosso, mentre una regressione vera peggiora tutte le serie.
    const sets = [
      ['otto lastre idrofughe e quaranta metri di montante e guida', 'quattro finestre pvc con sei maniglie e 3 serrature', 'due caldaie vaillant e un termostato wifi'],
      ['nove lastre idrofughe e trenta metri di montante e guida', 'cinque finestre pvc con sette maniglie e 4 serrature', 'tre caldaie vaillant e due termostati wifi'],
      ['dieci lastre idrofughe e venti metri di montante e guida', 'sei finestre pvc con otto maniglie e 5 serrature', 'quattro caldaie vaillant e tre termostati wifi'],
    ];
    const runs = sets.map((fresh) => fresh.map((p) => time(() => parseDictation(p, big))).sort((a, b) => a - b));
    expect(Math.min(...runs.map((t) => t[2]))).toBeLessThan(100); // peggiore della serie migliore
    expect(Math.min(...runs.map((t) => t[1]))).toBeLessThan(50); // mediana della serie migliore
  });

  it('l\'indice è memoizzato per contenuto: stesso catalogo (anche array diverso) = stesso indice', () => {
    const a = getMatcher(big);
    const b = getMatcher(big.map((x) => ({ ...x })));
    expect(b).toBe(a);
  });

  it('cambiare un alias invalida l\'indice; cambiare solo il prezzo no, ma il prezzo nuovo arriva nelle righe', () => {
    const cat = CAT_ELETTRICISTA.map((x) => ({ ...x }));
    const m1 = getMatcher(cat);
    const priced = cat.map((x) => (x.id === 'e-presa' ? { ...x, price: 99 } : x));
    expect(getMatcher(priced)).toBe(m1);
    expect(parseDictation('due prese', priced).lines[0].unitPrice).toBe(99);
    const renamed = cat.map((x) => (x.id === 'e-presa' ? { ...x, aliases: [...x.aliases, 'schuko'] } : x));
    expect(getMatcher(renamed)).not.toBe(m1);
    expect(parseDictation('tre schuko', renamed).lines[0].catalogItemId).toBe('e-presa');
  });

  it('costruzione a freddo dell\'indice (2000 voci) in tempi accettabili', () => {
    const cold = bigCatalog(2000).map((x, i) => ({ ...x, id: `cold-${i}`, name: `${x.name} z${i}` }));
    expect(time(() => prepareCatalog(cold))).toBeLessThan(1500);
  });

  it('un testo di 10.000 caratteri si analizza in tempi ragionevoli', () => {
    const text = ('per il signor Rossi due prese tre interruttori sei faretti led venti metri di cavo 2,5 un quadro elettrico otto ore di manodopera '.repeat(100)).slice(0, 10000);
    parseDictation('due prese', CAT_ELETTRICISTA); // indice caldo
    expect(time(() => parseDictation(text, CAT_ELETTRICISTA))).toBeLessThan(1500);
  });

  it('i risultati con catalogo grande sono coerenti con quelli del catalogo piccolo', () => {
    const small = parseDictation('cinque prese usb tre magnetotermici da sedici', CAT_ELETTRICISTA).lines.map((l) => [l.catalogItemId, l.qty]);
    expect(small).toEqual([['e-presausb', 5], ['e-mt16', 3]]);
    const lg = parseDictation('cinque prese usb tre magnetotermici da sedici', big).lines.map((l) => [l.catalogItemId?.split('#')[0], l.qty]);
    expect(lg).toEqual(small);
  });
});
