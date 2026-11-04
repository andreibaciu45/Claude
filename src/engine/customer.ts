/**
 * Estrazione del cliente dalla dettatura:
 * "preventivo per Mario Rossi", "per il signor Bianchi", "cliente X", "intestato a X", "a nome di X".
 */
import { wordValue } from './numbers';
import type { RawTok } from './text';

export const CONJ = new Set(['e', 'ed', 'poi', 'piu', 'inoltre', 'ancora', 'anche', 'dopo', 'quindi']);
export const FILLER = new Set([
  'allora', 'dunque', 'ok', 'okay', 'bene', 'vediamo', 'ecco', 'senti', 'scusa', 'grazie', 'fine', 'basta',
  'fatto', 'ehm', 'eh', 'cioe', 'diciamo', 'praticamente', 'insomma', 'scrivi', 'scrivere', 'metti', 'mettere', 'mettici', 'aggiungi', 'aggiungere', 'aggiungici',
  'inserisci', 'inserire', 'segna', 'segnare', 'servono', 'serve', 'occorrono', 'occorre', 'vorrei', 'voglio',
  'devo', 'dobbiamo', 'vogliono', 'vuole', 'preventivo', 'preventivi', 'fattura', 'fatture', 'prego', 'ci',
]);

const DOC_WORDS = new Set([
  'preventivo', 'preventivi', 'fattura', 'fatture', 'offerta', 'ordine', 'stima', 'proforma', 'computo',
  'lavoro', 'lavori', 'intervento', 'fai', 'fare', 'fammi', 'crea', 'creare', 'nuovo', 'nuova', 'un', 'una',
  'il', 'questo', 'scrivi', 'è', 'allora', 'dunque', 'ok',
]);
const ARTICLES = new Set(['il', 'lo', 'la', 'l', 'i', 'gli', 'le', 'al', 'alla', 'allo']);
const TITLES = new Set([
  'signor', 'signore', 'signora', 'signori', 'signorina', 'sig', 'sigra', 'dottor', 'dottore', 'dottoressa',
  'dott', 'dr', 'ing', 'ingegner', 'ingegnere', 'geom', 'geometra', 'avvocato', 'avv', 'professor', 'professore',
  'professoressa', 'prof', 'ditta', 'studio', 'condominio', 'famiglia', 'azienda', 'societa', 'cliente', 'arch',
  'architetto', 'ragionier', 'ragioniere', 'impresa', 'don',
]);
const PARTICLES = new Set(['de', 'del', 'della', 'dello', 'dei', 'degli', 'dal', 'dalla', 'di', 'd', 'da', 'lo', 'la', 'le', 'mc', 'mac', 'van', 'von', 'dall', 'dell']);
const ORG_TITLES = new Set(['ditta', 'studio', 'condominio', 'famiglia', 'azienda', 'societa', 'impresa']);
const COMPANY = new Set(['srl', 'spa', 'snc', 'sas', 'sa', 'sdf', 'ss']);
const PREPS = new Set(['di', 'da', 'a', 'ad', 'per', 'con', 'in', 'su', 'tra', 'fra', 'che', 'il', 'lo', 'la', 'le', 'i', 'gli', 'un', 'uno', 'una', 'del', 'della', 'dei', 'delle', 'al', 'alla']);
const WORK_WORDS = new Set([
  'rifacimento', 'lavori', 'lavoro', 'installazione', 'fornitura', 'montaggio', 'posa', 'sostituzione',
  'ristrutturazione', 'manutenzione', 'riparazione', 'impianto', 'impianti', 'bagno', 'cucina', 'camera',
  'casa', 'appartamento', 'tinteggiatura', 'pittura', 'dipingere', 'imbiancare', 'imbiancatura', 'preventivo',
  'fattura', 'tubo', 'tubi', 'cavo', 'cavi', 'caldaia', 'punto', 'punti', 'metri', 'metro', 'ore', 'ora',
  'giornata', 'giornate', 'intervento', 'opere', 'opera', 'controsoffitto', 'cartongesso', 'pavimento',
  'pavimenti', 'tetto', 'giardino', 'terrazzo', 'balcone', 'scala', 'scale', 'sopralluogo', 'riparare',
  'sistemare', 'cambiare', 'rifare', 'montare', 'installare', 'sostituire', 'fare', 'pitturare', 'stuccare',
]);

const FIRST_NAMES = new Set(
  ('mario luigi giuseppe giovanni antonio francesco marco luca paolo andrea roberto stefano alessandro davide ' +
    'simone matteo lorenzo fabio massimo claudio giorgio sergio enrico carlo pietro franco bruno gianni angelo ' +
    'michele vincenzo salvatore domenico daniele riccardo federico giulio alberto maurizio fabrizio gabriele ' +
    'nicola filippo emanuele edoardo tommaso giacomo maria anna giulia francesca laura paola elena sara chiara ' +
    'silvia valentina roberta marta elisa monica patrizia antonella rosa lucia giovanna angela teresa carla ' +
    'daniela simona cristina federica alessandra barbara sandra giancarlo gianluca gianpaolo pierluigi ' +
    'pierpaolo piero renato romano rocco ettore ivan ugo vittorio walter emilio dario cesare aldo').split(' '),
);

const isCap = (raw: string) => /^\p{Lu}/u.test(raw);
const isNumLike = (t: RawTok) => t.kind === 'digit' || (t.kind === 'word' && wordValue(t.w) !== undefined);
const SUFFIX_WORK = /(zione|zioni|mento|menti|aggio|aggi|are|ere|ire|ismo)$/;

function isStopWord(t: RawTok): boolean {
  const w = t.w;
  if (CONJ.has(w) || FILLER.has(w) || PREPS.has(w) || WORK_WORDS.has(w)) return true;
  if (!isCap(t.raw) && SUFFIX_WORK.test(w) && w.length > 5) return true;
  return false;
}

const titleCase = (t: RawTok): string => {
  const base = isCap(t.raw) ? t.raw : t.raw.charAt(0).toUpperCase() + t.raw.slice(1).toLowerCase();
  return base;
};

export interface CustomerResult {
  name?: string;
  rest: RawTok[];
}

export function extractCustomer(R: RawTok[], isCatalogWord: (w: string) => boolean): CustomerResult {
  for (let i = 0; i < R.length; i++) {
    const t = R[i];
    if (t.kind !== 'word') continue;
    const w = t.w;
    let k = -1;
    let hasTitle = false;

    if ((w === 'intestato' || w === 'intestata') && R[i + 1]?.w === 'a') k = i + 2;
    else if (w === 'a' && R[i + 1]?.w === 'nome' && R[i + 2]?.w === 'di') k = i + 3;
    else if (w === 'cliente') {
      k = i + 1;
      while (R[k] && ['è', 'si', 'chiama', 'sarebbe', 'e', 'chiamato'].includes(R[k].w)) k++;
    }
    else if (w === 'per') {
      const prev = R[i - 1];
      const cond = i === 0 || prev.kind === 'punct' || DOC_WORDS.has(prev.w);
      let q = i + 1;
      while (R[q] && ARTICLES.has(R[q].w)) q++;
      while (R[q] && TITLES.has(R[q].w)) {
        hasTitle = true;
        q++;
      }
      q = i + 1; // i titoli vengono riletti sotto (per conservare quelli di tipo "ditta")
      while (R[q] && ARTICLES.has(R[q].w)) q++;
      if (cond || hasTitle) k = q;
    }
    else if (TITLES.has(w) && w !== 'cliente' && (i === 0 || R[i - 1].kind === 'punct' || DOC_WORDS.has(R[i - 1].w))) k = i;
    if (k < 0) continue;
    // salta articoli/titoli residui (le forme "ditta/condominio/studio..." restano nel nome)
    const orgPrefix: RawTok[] = [];
    while (R[k] && R[k].kind === 'word' && (ARTICLES.has(R[k].w) || TITLES.has(R[k].w))) {
      if (TITLES.has(R[k].w)) hasTitle = true;
      if (ORG_TITLES.has(R[k].w)) orgPrefix.push(R[k]);
      k++;
    }
    const first = R[k];
    if (!first || first.kind !== 'word' || isNumLike(first)) continue;
    if (isStopWord(first) && !isCap(first.raw)) continue;
    if (isStopWord(first) && WORK_WORDS.has(first.w)) continue;
    if (!isCap(first.raw) && isCatalogWord(first.w)) continue;

    const words: RawTok[] = [first];
    let j = k + 1;
    const caps = isCap(first.raw);
    const firstIsGiven = FIRST_NAMES.has(first.w);
    const maxWords = caps ? 4 : hasTitle && !firstIsGiven ? 1 : 2;
    while (j < R.length && words.length < maxWords) {
      const x = R[j];
      if (x.kind !== 'word' || isNumLike(x)) break;
      const nx = R[j + 1];
      if (PARTICLES.has(x.w) && nx && nx.kind === 'word' && !isNumLike(nx) && !isStopWord(nx) && !isCatalogWord(nx.w)) {
        words.push(x, nx);
        j += 2;
        continue;
      }
      if (COMPANY.has(x.w)) {
        words.push(x);
        j++;
        break;
      }
      if (caps) {
        if (!isCap(x.raw)) break;
      } else if (isStopWord(x) || isCatalogWord(x.w)) break;
      words.push(x);
      j++;
    }
    const name = [...orgPrefix, ...words].map((x) => (COMPANY.has(x.w) ? x.raw.toUpperCase() : titleCase(x))).join(' ');
    return { name, rest: [...R.slice(0, i), ...R.slice(j)] };
  }
  return { rest: R };
}
