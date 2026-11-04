import type { CatalogItem, Unit } from '../types';
import { CATALOG_IDRAULICO, SAMPLE_CATALOG } from './fixtures';

/** Riga attesa. `id` = voce di catalogo (o lista di alternative accettabili); `free` = riga libera con questo testo nella descrizione. */
export interface ExpLine {
  id?: string | string[];
  free?: string;
  qty: number;
  unit?: Unit;
  review?: boolean;
  price?: number;
}
export interface Case {
  name: string;
  text: string;
  catalog?: CatalogItem[];
  /** undefined = non verificare; null = nessun cliente atteso */
  customer?: string | null;
  lines: ExpLine[];
  leftovers?: string[];
}

const C = SAMPLE_CATALOG;

export const CASES: Case[] = [
  // ---------- numeri in lettere / cifre / decimali
  { name: 'numero in lettere semplice', text: 'tre metri di tubo rame da sedici', lines: [{ id: 'tubo-rame-16', qty: 3, unit: 'm', review: false }] },
  { name: 'venti + ventidue', text: 'venti metri di tubo di rame ventidue', lines: [{ id: 'tubo-rame-22', qty: 20, unit: 'm' }] },
  { name: 'composto centoventi', text: 'centoventi metri di cavo 1,5', lines: [{ id: 'cavo-1-5', qty: 120, unit: 'm' }] },
  { name: 'mille e cinquecento', text: 'mille e cinquecento metri di corrugato', lines: [{ id: 'corrugato', qty: 1500, unit: 'm' }] },
  { name: 'duemilacinquecento unito', text: 'duemilacinquecento metri di tubo corrugato', lines: [{ id: 'corrugato', qty: 2500, unit: 'm' }] },
  { name: 'decimale a parole', text: 'due virgola cinque metri di tubo rame 16', lines: [{ id: 'tubo-rame-16', qty: 2.5, unit: 'm' }] },
  { name: 'decimale con virgola in cifre', text: '2,5 metri di tubo multistrato', lines: [{ id: 'multistrato-16', qty: 2.5, unit: 'm' }] },
  { name: 'decimale con punto in cifre', text: '2.5 metri di tubo multistrato', lines: [{ id: 'multistrato-16', qty: 2.5, unit: 'm' }] },
  { name: 'punto decimale a parole', text: 'due punto cinque metri quadri di rasatura pareti', lines: [{ id: 'rasatura', qty: 2.5, unit: 'mq' }] },
  { name: 'cifre attaccate 16mm', text: '5 metri di tubo rame 16mm', lines: [{ id: 'tubo-rame-16', qty: 5, unit: 'm' }] },
  { name: 'mezzo metro', text: 'mezzo metro di tubo scarico pvc', lines: [{ id: 'scarico-pvc', qty: 0.5, unit: 'm' }] },
  { name: 'mezza giornata', text: 'mezza giornata di lavoro', lines: [{ id: 'giornata-operaio', qty: 0.5 }] },
  { name: 'una giornata e mezza', text: 'una giornata e mezza di lavoro', lines: [{ id: 'giornata-operaio', qty: 1.5 }] },
  { name: 'due ore e mezza', text: 'due ore e mezza di manodopera', lines: [{ id: 'man-idraulico', qty: 2.5, unit: 'h' }] },
  { name: "un'ora e mezza", text: "un'ora e mezza di manodopera", lines: [{ id: 'man-idraulico', qty: 1.5, unit: 'h' }] },
  { name: 'un paio di', text: 'un paio di rubinetti lavabo', lines: [{ id: 'rubinetto-lavabo', qty: 2 }] },
  { name: 'una decina', text: 'una decina di faretti', lines: [{ id: 'faretto', qty: 10 }] },
  { name: 'un metro + cavo 4', text: 'un metro di cavo 4', lines: [{ id: 'cavo-4', qty: 1, unit: 'm' }] },
  { name: 'cavo da quattro (sezione)', text: 'otto metri di cavo da quattro', lines: [{ id: 'cavo-4', qty: 8, unit: 'm' }] },
  { name: 'cavo 3x2,5 (notazione)', text: 'venti metri di cavo 3x2,5', lines: [{ id: 'cavo-2-5', qty: 20, unit: 'm' }] },
  // ---------- unità / sinonimi
  { name: 'emme quadri', text: 'dieci emme quadri di cartongesso', lines: [{ id: 'cartongesso', qty: 10, unit: 'mq', review: false }] },
  { name: 'mq sigla', text: 'quindici mq di tinteggiatura', lines: [{ id: 'tinteggiatura', qty: 15, unit: 'mq' }] },
  { name: 'metri quadrati', text: 'trenta metri quadrati di piastrelle', lines: [{ id: 'piastrelle', qty: 30, unit: 'mq' }] },
  { name: 'litri', text: 'venti litri di smalto', lines: [{ id: 'smalto', qty: 20, unit: 'l' }] },
  { name: 'chili', text: 'cinque chili di stucco', lines: [{ id: 'stucco', qty: 5, unit: 'kg' }] },
  { name: 'ore elettricista', text: 'otto ore di lavoro elettricista', lines: [{ id: 'man-elettricista', qty: 8, unit: 'h' }] },
  { name: 'giornate', text: 'tre giornate di lavoro', lines: [{ id: 'giornata-operaio', qty: 3, unit: 'gg' }] },
  { name: 'a corpo', text: 'trasporto a corpo', lines: [{ id: 'trasporto', qty: 1, unit: 'corpo' }] },
  { name: 'unità non a catalogo -> review', text: 'dieci metri quadri di idropittura', lines: [{ id: 'idropittura', qty: 10, unit: 'l', review: true }] },
  { name: 'moltiplicazione 3 per 4', text: 'tre per quattro metri di cartongesso', lines: [{ id: 'cartongesso', qty: 12, unit: 'mq', review: true }] },
  { name: 'spec litri nel nome (80 litri)', text: 'uno scaldabagno 80 litri', lines: [{ id: 'scaldabagno', qty: 1, unit: 'pz' }] },
  // ---------- cliente
  { name: 'cliente: cliente X', text: 'cliente Luigi Verdi dieci metri di cavo 2,5', customer: 'Luigi Verdi', lines: [{ id: 'cavo-2-5', qty: 10 }] },
  { name: 'cliente: intestato a', text: 'intestato a Anna Neri quattro prese', customer: 'Anna Neri', lines: [{ id: 'presa', qty: 4 }] },
  { name: 'cliente: per la signora', text: 'per la signora Gialli sei interruttori', customer: 'Gialli', lines: [{ id: 'interruttore', qty: 6 }] },
  { name: 'cliente: minuscolo', text: 'preventivo per mario rossi tre metri di tubo rame sedici', customer: 'Mario Rossi', lines: [{ id: 'tubo-rame-16', qty: 3 }] },
  { name: 'cliente: condominio', text: 'preventivo per condominio Aurora due salvavita', customer: 'Condominio Aurora', lines: [{ id: 'salvavita', qty: 2 }] },
  { name: 'cliente: nessuno', text: 'quattro faretti led', customer: null, lines: [{ id: 'faretto', qty: 4 }] },
  { name: 'cliente: a fine frase', text: 'quattro prese per il signor Ferrari', customer: 'Ferrari', lines: [{ id: 'presa', qty: 4 }] },
  { name: 'cliente: punteggiatura', text: 'Per il Signor Rossi: 3 punti luce; 12 metri di cavo 1,5.', customer: 'Rossi', lines: [{ id: 'punto-luce', qty: 3 }, { id: 'cavo-1-5', qty: 12 }] },
  { name: 'cliente: "per" non cliente', text: 'tre metri di tubo rame sedici per acqua calda', customer: null, lines: [{ id: 'tubo-rame-16', qty: 3 }] },
  // ---------- multi riga
  { name: 'multi: senza separatori', text: 'quattro prese tre interruttori due salvavita', lines: [{ id: 'presa', qty: 4 }, { id: 'interruttore', qty: 3 }, { id: 'salvavita', qty: 2 }] },
  { name: 'multi: virgole', text: 'sei faretti, due prese, un quadro elettrico', lines: [{ id: 'faretto', qty: 6 }, { id: 'presa', qty: 2 }, { id: 'quadro', qty: 1 }] },
  { name: 'multi: congiunzione e', text: 'tre rubinetti miscelatori lavabo e due sifoni', lines: [{ id: 'rubinetto-lavabo', qty: 3 }, { id: 'sifone', qty: 2 }] },
  { name: 'multi: esempio 1 (tubo, raccordi, ore, caldaia)', text: 'preventivo per Mario Rossi rifacimento bagno tre metri di tubo rame da sedici dodici raccordi a gomito quattro ore di manodopera una caldaia vaillant', customer: 'Mario Rossi', lines: [{ id: 'tubo-rame-16', qty: 3, unit: 'm' }, { id: 'raccordo-gomito', qty: 12, unit: 'pz' }, { id: 'man-idraulico', qty: 4, unit: 'h' }, { id: 'caldaia-vaillant', qty: 1, unit: 'pz' }], leftovers: ['rifacimento bagno'] },
  { name: 'multi: esempio 2 (punti luce, cavo, mezza giornata)', text: 'per il signor Bianchi due punti luce otto metri di cavo 2,5 e mezza giornata di lavoro', customer: 'Bianchi', lines: [{ id: 'punto-luce', qty: 2 }, { id: 'cavo-2-5', qty: 8, unit: 'm' }, { id: 'giornata-operaio', qty: 0.5, unit: 'gg' }] },
  { name: 'multi: esempio 3 (dipingere, mani, idropittura)', text: 'dipingere cucina quaranta metri quadri due mani, dieci litri di idropittura', lines: [{ id: 'tinteggiatura', qty: 40, unit: 'mq' }, { id: 'idropittura', qty: 10, unit: 'l' }], leftovers: [] },
  { name: 'multi: elettricista lungo', text: 'per il signor Colombo quattro prese tre interruttori sei faretti led venti metri di cavo 2,5 venti metri di cavo 1,5 un quadro elettrico e otto ore di manodopera elettrica', customer: 'Colombo', lines: [{ id: 'presa', qty: 4 }, { id: 'interruttore', qty: 3 }, { id: 'faretto', qty: 6 }, { id: 'cavo-2-5', qty: 20 }, { id: 'cavo-1-5', qty: 20 }, { id: 'quadro', qty: 1 }, { id: 'man-elettricista', qty: 8, unit: 'h' }] },
  { name: 'multi: imbianchino a catena (nome prima)', text: 'per la signora Greco rimozione carta da parati trenta metri quadri stuccatura trenta metri quadri tinteggiatura trenta metri quadri venti litri di idropittura due giornate di lavoro', customer: 'Greco', lines: [{ id: 'rimozione-carta', qty: 30, unit: 'mq' }, { id: 'rasatura', qty: 30, unit: 'mq' }, { id: 'tinteggiatura', qty: 30, unit: 'mq' }, { id: 'idropittura', qty: 20, unit: 'l' }, { id: 'giornata-operaio', qty: 2, unit: 'gg' }] },
  { name: 'multi: piastrelle + posa', text: 'per Giuseppe Esposito 25 mq di piastrelle e 25 mq di posa piastrelle', customer: 'Giuseppe Esposito', lines: [{ id: 'piastrelle', qty: 25 }, { id: 'posa-piastrelle', qty: 25 }] },
  { name: 'multi: idraulico completo', text: 'per Francesca Marino uno scaldabagno 80 litri due ore di manodopera idraulico e un sifone', customer: 'Francesca Marino', lines: [{ id: 'scaldabagno', qty: 1 }, { id: 'man-idraulico', qty: 2, unit: 'h' }, { id: 'sifone', qty: 1 }] },
  { name: 'multi: litri e litri', text: 'dieci litri di idropittura e cinque litri di smalto', lines: [{ id: 'idropittura', qty: 10 }, { id: 'smalto', qty: 5 }] },
  // ---------- matching: ordine parole, stopword, plurali, refusi
  { name: 'match: ordine diverso', text: 'dieci metri di rame tubo sedici', lines: [{ id: 'tubo-rame-16', qty: 10, unit: 'm' }] },
  { name: 'match: stopword', text: 'dieci metri del tubo di rame da ventidue', lines: [{ id: 'tubo-rame-22', qty: 10, unit: 'm' }] },
  { name: 'match: maiuscolo', text: 'TRE METRI DI TUBO RAME 22', lines: [{ id: 'tubo-rame-22', qty: 3, unit: 'm' }] },
  { name: 'match: refuso', text: 'due rubinneti lavabo', lines: [{ id: 'rubinetto-lavabo', qty: 2 }] },
  { name: 'match: composto salva vita', text: 'un salva vita', lines: [{ id: 'salvavita', qty: 1 }] },
  { name: 'match: plurale/singolare', text: 'cinque punti luce', lines: [{ id: 'punto-luce', qty: 5 }] },
  { name: 'match: solo marca', text: 'una caldaia vaillant', lines: [{ id: 'caldaia-vaillant', qty: 1, review: false }] },
  // ---------- ambiguità / non trovati / review
  { name: 'ambiguo: 16 o 22', text: 'dieci metri di tubo rame', lines: [{ id: ['tubo-rame-16', 'tubo-rame-22'], qty: 10, unit: 'm', review: true }] },
  { name: 'non trovato: lavatrice', text: 'una lavatrice samsung', lines: [{ free: 'lavatrice', qty: 1, unit: 'pz', review: true, price: 0 }] },
  { name: 'non trovato con unità', text: 'tre metri di grondaia in alluminio', lines: [{ free: 'grondaia', qty: 3, unit: 'm', review: true, price: 0 }] },
  { name: 'misto trovato + non trovato', text: 'due punti luce e un citofono video', lines: [{ id: 'punto-luce', qty: 2 }, { free: 'citofono', qty: 1, review: true }] },
  { name: 'qty senza unità, catalogo in metri', text: 'dieci tubo rame sedici', lines: [{ id: 'tubo-rame-16', qty: 10, review: true }] },
  { name: 'quantità mancante -> assume 1, review', text: 'metri di tubo rame sedici', lines: [{ id: 'tubo-rame-16', qty: 1, review: true }] },
  // ---------- prezzi parlati
  { name: 'prezzo parlato su voce catalogo', text: 'una caldaia vaillant a 1200 euro', lines: [{ id: 'caldaia-vaillant', qty: 1, price: 1200 }] },
  { name: 'prezzo parlato su voce libera', text: 'un citofono a 90 euro', lines: [{ free: 'citofono', qty: 1, review: true, price: 90 }] },
  { name: 'libera a corpo con prezzo', text: 'pulizia finale a corpo cento euro', lines: [{ free: 'pulizia', qty: 1, unit: 'corpo', price: 100 }] },
  // ---------- rumore / vuoto / leftover
  { name: 'rumore: filler', text: 'allora ok metti due prese poi aggiungi tre interruttori grazie', lines: [{ id: 'presa', qty: 2 }, { id: 'interruttore', qty: 3 }], leftovers: [] },
  { name: 'rumore: ehm', text: 'ehm diciamo quattro faretti insomma', lines: [{ id: 'faretto', qty: 4 }], leftovers: [] },
  { name: 'mani annotate sulla riga (non nei frammenti)', text: 'quaranta metri quadri di tinteggiatura due mani', lines: [{ id: 'tinteggiatura', qty: 40, unit: 'mq', review: false }], leftovers: [] },
  { name: 'solo titolo lavoro -> leftover', text: 'rifacimento bagno completo', lines: [], leftovers: ['rifacimento bagno completo'] },
  { name: 'vuoto', text: '', lines: [], leftovers: [] },
  { name: 'solo rumore', text: 'ok grazie', lines: [], leftovers: [] },
  // ---------- catalogo ridotto
  { name: 'catalogo ridotto: manodopera unica', text: 'sei ore di manodopera', catalog: CATALOG_IDRAULICO, lines: [{ id: 'man-idraulico', qty: 6, unit: 'h', review: false }] },
  { name: 'catalogo vuoto: tutto libero', text: 'tre metri di tubo rame sedici', catalog: [], lines: [{ free: 'tubo rame', qty: 3, unit: 'm', review: true, price: 0 }] },
];

export { C as DEFAULT_CATALOG };

/**
 * Set "holdout": scritto dopo il primo giro di sviluppo, su frasi nuove, per misurare
 * la generalizzazione (vedi accuracy.test.ts).
 */
export const HOLDOUT: Case[] = [
  { name: 'ho: cavo due e mezzo', text: 'dieci metri di cavo due e mezzo', lines: [{ id: 'cavo-2-5', qty: 10, unit: 'm' }] },
  { name: 'ho: nome prima della quantità', text: 'tubo rame sedici dieci metri', lines: [{ id: 'tubo-rame-16', qty: 10, unit: 'm' }] },
  { name: 'ho: caldaia + scaldabagni', text: 'una caldaia vaillant e due scaldabagni', lines: [{ id: 'caldaia-vaillant', qty: 1 }, { id: 'scaldabagno', qty: 2 }] },
  { name: 'ho: geometra', text: 'per il geometra Pellegrini tre metri quadri di cartongesso', customer: 'Pellegrini', lines: [{ id: 'cartongesso', qty: 3, unit: 'mq' }] },
  { name: 'ho: cognome con particella', text: 'preventivo per Antonio De Luca due faretti', customer: 'Antonio De Luca', lines: [{ id: 'faretto', qty: 2 }] },
  { name: 'ho: fattura', text: 'fattura per Sara Conti 3 ore di manodopera', customer: 'Sara Conti', lines: [{ id: 'man-idraulico', qty: 3, unit: 'h' }] },
  { name: 'ho: multistrato + raccordi a T', text: 'quindici metri di multistrato sedici e dieci raccordi a T', lines: [{ id: 'multistrato-16', qty: 15 }, { id: 'raccordo-t', qty: 10 }] },
  { name: 'ho: titolo lavoro + sifone', text: 'sostituzione sifone un sifone bagno', lines: [{ id: 'sifone', qty: 1 }] },
  { name: 'ho: alias tubo di scarico', text: 'due metri di tubo di scarico', lines: [{ id: 'scarico-pvc', qty: 2, unit: 'm' }] },
  { name: 'ho: due righe a metri quadri', text: 'venti metri quadri di tinteggiatura e dieci metri quadri di rasatura', lines: [{ id: 'tinteggiatura', qty: 20 }, { id: 'rasatura', qty: 10 }] },
  { name: 'ho: trentacinque + 1,5', text: 'trentacinque metri di cavo uno virgola cinque', lines: [{ id: 'cavo-1-5', qty: 35 }] },
  { name: 'ho: ventuno', text: 'ventuno metri di corrugato', lines: [{ id: 'corrugato', qty: 21 }] },
  { name: 'ho: centottanta', text: 'centottanta metri di cavo 4', lines: [{ id: 'cavo-4', qty: 180 }] },
  { name: 'ho: novantanove', text: 'novantanove faretti', lines: [{ id: 'faretto', qty: 99 }] },
  { name: 'ho: mille', text: 'mille metri di cavo 2,5', lines: [{ id: 'cavo-2-5', qty: 1000 }] },
  { name: 'ho: due mila', text: 'due mila metri di corrugato', lines: [{ id: 'corrugato', qty: 2000 }] },
  { name: 'ho: un chilo', text: 'un chilo di stucco', lines: [{ id: 'stucco', qty: 1, unit: 'kg' }] },
  { name: 'ho: mezzo chilo', text: 'mezzo chilo di stucco', lines: [{ id: 'stucco', qty: 0.5, unit: 'kg' }] },
  { name: 'ho: smalto lucido', text: 'dieci litri di smalto lucido', lines: [{ id: 'smalto', qty: 10, unit: 'l' }] },
  { name: 'ho: ore elettricista senza di', text: 'tre ore elettricista', lines: [{ id: 'man-elettricista', qty: 3, unit: 'h' }] },
  { name: 'ho: giornata + ore', text: 'una giornata di lavoro e due ore di manodopera', lines: [{ id: 'giornata-operaio', qty: 1 }, { id: 'man-idraulico', qty: 2 }] },
  { name: 'ho: rame 22 + raccordi T', text: 'sei metri di tubo rame ventidue e quattro raccordi a T', lines: [{ id: 'tubo-rame-22', qty: 6 }, { id: 'raccordo-t', qty: 4 }] },
  { name: 'ho: senza quantità', text: 'cambio rubinetto lavabo', lines: [{ id: 'rubinetto-lavabo', qty: 1, review: true }] },
  { name: 'ho: faretti led da incasso', text: 'dieci faretti led da incasso', lines: [{ id: 'faretto', qty: 10 }] },
  { name: 'ho: "è per"', text: 'il preventivo è per Giulia Romano tre prese', customer: 'Giulia Romano', lines: [{ id: 'presa', qty: 3 }] },
  { name: 'ho: famiglia', text: 'lavori per la famiglia Mancini due prese', customer: 'Famiglia Mancini', lines: [{ id: 'presa', qty: 2 }] },
  { name: 'ho: prezzo "l\'uno"', text: "tre punti luce a 60 euro l'uno", lines: [{ id: 'punto-luce', qty: 3, price: 60 }] },
  { name: 'ho: prezzo al metro', text: 'venti metri di cavo 2,5 a 1 euro al metro', lines: [{ id: 'cavo-2-5', qty: 20, price: 1 }] },
  { name: 'ho: non trovato', text: 'una pompa di calore', lines: [{ free: 'pompa', qty: 1, review: true, price: 0 }] },
  { name: 'ho: trovato + non trovato', text: 'due ore di manodopera e una lavatrice', lines: [{ id: 'man-idraulico', qty: 2 }, { free: 'lavatrice', qty: 1 }] },
  { name: 'ho: punti presa', text: 'quattro punti presa', lines: [{ id: 'presa', qty: 4 }] },
  { name: 'ho: giornata sola', text: 'tre giornate', lines: [{ id: 'giornata-operaio', qty: 3, unit: 'gg' }] },
  { name: 'ho: pavimento gres', text: 'dieci mq di pavimento gres', lines: [{ id: 'piastrelle', qty: 10, unit: 'mq' }] },
  { name: 'ho: smaltimento a corpo', text: 'smaltimento macerie a corpo', lines: [{ id: 'trasporto', qty: 1, unit: 'corpo' }] },
  { name: 'ho: quadro + salvavita', text: 'un quadro elettrico e un salvavita', lines: [{ id: 'quadro', qty: 1 }, { id: 'salvavita', qty: 1 }] },
  { name: 'ho: cifre e lettere', text: '3 metri di tubo rame sedici e quattro raccordi a gomito', lines: [{ id: 'tubo-rame-16', qty: 3 }, { id: 'raccordo-gomito', qty: 4 }] },
  { name: 'ho: tre stufe non a catalogo', text: 'per Rossi tre stufe a pellet e due prese', customer: 'Rossi', lines: [{ free: 'stufe', qty: 3, review: true }, { id: 'presa', qty: 2 }] },
  { name: 'ho: sig. abbreviato', text: 'sig. Moretti due interruttori', customer: 'Moretti', lines: [{ id: 'interruttore', qty: 2 }] },
  { name: 'ho: virgole e poi', text: 'quattro faretti, poi tre prese, poi un interruttore', lines: [{ id: 'faretto', qty: 4 }, { id: 'presa', qty: 3 }, { id: 'interruttore', qty: 1 }] },
  { name: 'ho: m² simbolo', text: '12 m² di piastrelle', lines: [{ id: 'piastrelle', qty: 12, unit: 'mq' }] },
];

/** Secondo holdout, volutamente più sporco (frasi lunghe, ordine invertito, abbreviazioni). */
export const HOLDOUT2: Case[] = [
  { name: 'h2: mi servono ... gomiti', text: 'mi servono venti metri di tubo di rame da sedici millimetri e tre gomiti', lines: [{ id: 'tubo-rame-16', qty: 20, unit: 'm' }, { id: 'raccordo-gomito', qty: 3 }] },
  { name: 'h2: rubinetti e sifone', text: 'metti dentro due rubinetti e un sifone', lines: [{ id: 'rubinetto-lavabo', qty: 2 }, { id: 'sifone', qty: 1 }] },
  { name: 'h2: sedici metri rame ventidue', text: 'sedici metri di tubo rame ventidue', lines: [{ id: 'tubo-rame-22', qty: 16, unit: 'm' }] },
  { name: 'h2: nome prima + quantità', text: 'tubo rame ventidue sei metri', lines: [{ id: 'tubo-rame-22', qty: 6, unit: 'm' }] },
  { name: 'h2: stessa voce due varianti', text: 'dieci metri di tubo rame 16 dieci metri di tubo rame 22', lines: [{ id: 'tubo-rame-16', qty: 10 }, { id: 'tubo-rame-22', qty: 10 }] },
  { name: 'h2: cavo e corrugato', text: 'tre metri di cavo 4 e quattro metri di corrugato', lines: [{ id: 'cavo-4', qty: 3 }, { id: 'corrugato', qty: 4 }] },
  { name: 'h2: 1,5 ore', text: 'uno virgola cinque ore di manodopera', lines: [{ id: 'man-idraulico', qty: 1.5, unit: 'h' }] },
  { name: 'h2: elenco con virgole e e', text: 'dodici punti luce, venti prese e otto interruttori', lines: [{ id: 'punto-luce', qty: 12 }, { id: 'presa', qty: 20 }, { id: 'interruttore', qty: 8 }] },
  { name: 'h2: 3h', text: '3h di manodopera', lines: [{ id: 'man-idraulico', qty: 3, unit: 'h' }] },
  { name: 'h2: 2 gg', text: '2 gg di lavoro', lines: [{ id: 'giornata-operaio', qty: 2, unit: 'gg' }] },
  { name: 'h2: 5 pz', text: '5 pz di interruttori', lines: [{ id: 'interruttore', qty: 5, unit: 'pz' }] },
  { name: 'h2: scaldabagni da ottanta litri', text: 'due scaldabagni da ottanta litri', lines: [{ id: 'scaldabagno', qty: 2 }] },
  { name: 'h2: cavo da due virgola cinque', text: 'venti metri di cavo da due virgola cinque', lines: [{ id: 'cavo-2-5', qty: 20, unit: 'm' }] },
  { name: 'h2: il cliente è', text: 'il cliente è Carlo Sala tre prese', customer: 'Carlo Sala', lines: [{ id: 'presa', qty: 3 }] },
  { name: 'h2: stesso lavoro due stanze', text: 'tinteggiare soggiorno cinquanta metri quadri e camera trenta metri quadri', lines: [{ id: 'tinteggiatura', qty: 50, unit: 'mq' }, { id: 'tinteggiatura', qty: 30, unit: 'mq' }] },
  { name: 'h2: fornitura e posa', text: 'posa piastrelle bagno venti metri quadri', lines: [{ id: 'posa-piastrelle', qty: 20, unit: 'mq' }] },
  { name: 'h2: intestato con cognome lungo', text: 'intestato a Maria Grazia Pellegrino quattro faretti', customer: 'Maria Grazia Pellegrino', lines: [{ id: 'faretto', qty: 4 }] },
  { name: 'h2: virgola decimale in euro', text: 'una lavatrice a 350 euro', lines: [{ free: 'lavatrice', qty: 1, price: 350, review: true }] },
  { name: 'h2: pulizia a corpo', text: 'trasporto e smaltimento a corpo', lines: [{ id: 'trasporto', qty: 1, unit: 'corpo' }] },
  { name: 'h2: tre quarti? (non supportato) -> leftover o riga libera', text: 'due mani di smalto', lines: [{ id: 'smalto', qty: 1, review: true }], leftovers: [] },
  { name: 'h2: rumore in mezzo', text: 'allora praticamente tre prese ehm e poi due interruttori ok', lines: [{ id: 'presa', qty: 3 }, { id: 'interruttore', qty: 2 }], leftovers: [] },
  { name: 'h2: numeri attaccati', text: '3mq di cartongesso', lines: [{ id: 'cartongesso', qty: 3, unit: 'mq' }] },
  { name: 'h2: salvavita differenziale', text: 'due interruttori differenziali', lines: [{ id: 'salvavita', qty: 2 }] },
  { name: 'h2: multistrato senza numero', text: 'dieci metri di tubo multistrato', lines: [{ id: 'multistrato-16', qty: 10, unit: 'm' }] },
];
