/**
 * Lessici del motore: parole di LUOGO (stanze, piani, qualificatori) che descrivono DOVE si lavora e non COSA.
 * Servono a: (1) non farle pesare nel matching col catalogo, (2) usarle come nota di riga,
 * (3) riconoscere righe ellittiche ("... 50 mq e camera 30 mq" = stessa voce, altra stanza).
 * Tutte senza accenti e minuscole.
 */
export const LOCATION_WORDS = new Set([
  'soggiorno', 'salone', 'salotto', 'sala', 'camera', 'camere', 'cameretta', 'camerette', 'letto', 'matrimoniale',
  'cucina', 'cucinotto', 'bagno', 'bagni', 'antibagno', 'corridoio', 'ingresso', 'disimpegno', 'stanza',
  'stanze', 'locale', 'locali', 'appartamento', 'casa', 'villa', 'villetta', 'ufficio', 'uffici', 'negozio', 'magazzino',
  'garage', 'cantina', 'taverna', 'mansarda', 'soffitta', 'ripostiglio', 'lavanderia', 'terrazzo', 'terrazza', 'balcone',
  'balconi', 'giardino', 'piano', 'padronale', 'ospiti', 'ospite',
  'notte', 'giorno', 'zona', 'sottotetto', 'studio', 'studiolo', 'pranzo', 'lato', 'nord', 'sud', 'est', 'ovest',
  'davanti', 'dietro', 'sopra', 'sotto', 'fondo', 'interno', 'esterno', 'destra', 'sinistra',
]);

/** Connettivi di luogo che accompagnano le parole sopra ("camera DA letto", "bagno DI servizio", "al piano terra"). */
export const LOCATION_GLUE = new Set(['da', 'di', 'del', 'della', 'al', 'alla', 'nel', 'nella', 'in', 'sul', 'sulla', 'zona', 'e']);

/** Parole d'azione/rumore che non vanno mai in una nota di riga. */
export const NOTE_NOISE = new Set([
  'installazione', 'sostituzione', 'fornitura', 'montaggio', 'posa', 'rifacimento', 'lavori', 'lavoro', 'compresa',
  'compreso', 'incluso', 'inclusa', 'installata', 'installato', 'nuovo', 'nuova', 'nuovi', 'nuove', 'vecchio', 'vecchia',
  'vecchi', 'vecchie', 'completo', 'completa', 'totale', 'circa', 'tipo', 'ancora', 'altro', 'altra', 'altri', 'altre',
  'tinteggiare', 'imbiancare', 'pitturare', 'dipingere', 'verniciare', 'stuccare', 'rasare', 'intonacare', 'demolire',
  'sostituire', 'montare', 'installare', 'fare', 'rifare', 'cambiare', 'cambio', 'da', 'per', 'su', 'con', 'senza',
  'euro', 'cadauno', 'cadauna', 'ciascuno', 'ciascuna', 'uno', 'una', 'un',
]);
