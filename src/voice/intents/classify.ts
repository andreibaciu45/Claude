/**
 * Classificatore DETERMINISTICO di comandi in italiano (nessun LLM).
 *
 *   trascrizione -> token (numeri a parole inclusi) -> correzione errori di riconoscimento sulle parole chiave
 *   -> regole per intent con punteggio -> { command, confidence, alternatives }
 *
 * Soglie (ARCHITECTURE-V2 §4.1): >= 0.8 eseguibile (la policy decide comunque conferme/undo),
 * 0.5-0.8 "Intendevi…?", < 0.5 non capito (command = null).
 * Regola di prudenza: gli intent IRREVERSIBILI perdono confidenza se il verbo è stato "indovinato" per somiglianza
 * (es. "emeti"), se non è all'inizio della frase, se la frase è una domanda o contiene negazioni.
 */
import type { ClassifyContext, Classification, Command, DocKind, DocRef, ScoredCommand } from '../types';
import { canonicalize, tokenize, type Tok } from './tokens';

/* ------------------------------------------------------------------ lessico */

const w = (s: string) => s.split(/\s+/);
const PREV = new Set(w('preventivo preventivi offerta offerte prev preventivino'));
const FATT = new Set(w('fattura fatture ft'));
const DOC_WORDS = new Set([...PREV, ...FATT, ...w('documento documenti bozza bozze nota credito')]);
const PLURAL = new Set(w('preventivi offerte fatture documenti bozze tutti tutte'));

const V_ISSUE = new Set(w('emetti emettere emettila emettilo emetta emissione'));
const V_CREDIT = new Set(w('storna stornare stornala stornalo storno stornare annulla annullare annullala annullalo annullamento rettifica'));
const V_DELETE = new Set(w('elimina eliminare eliminala eliminalo cancella cancellare cancellala cancellalo rimuovi rimuovere togli butta buttare'));
const V_NEW = new Set(w('nuovo nuova crea creami creare fai fammi facci prepara preparami genera generare redigi scrivi'));
const V_CONV = new Set(w('converti convertire convertilo convertila trasforma trasformare trasformalo trasformala'));
const V_OPEN = new Set(w('apri aprire aprimi mostra mostrami mostrare visualizza vedere vedi vai leggi'));
const V_DUP = new Set(w('duplica duplicare duplicala duplicalo duplicami clona'));
const V_ADD = new Set(w('aggiungi aggiungere aggiungimi inserisci inserire mettici'));
const V_DOWN = new Set(w('scarica scaricare scaricami esporta esportare salva stampa stampare condividi'));
const PAID = new Set(w('pagata pagato pagate pagati incassata incassato incassate saldata saldato pagamento incasso'));
const SENT = new Set(w('inviata inviato inviate inviati spedita spedito mandata mandato trasmessa trasmesso'));
const ACCEPT = new Set(w('accettato accettata approvato approvata'));
const REJECT = new Set(w('rifiutato rifiutata respinto respinta'));
const CONFIRM = new Set(w('conferma confermo confermare'));
const LAST = new Set(w('ultima ultimo ultime ultimi recente'));
const CURRENT = new Set(w('corrente attuale aperto aperta questo questa qui stesso stessa'));
const EURO = new Set(w('euro euri eur'));

/** Parole chiave la cui deformazione è tipica del riconoscimento vocale (corrette per somiglianza). */
const KEYWORDS: ReadonlySet<string> = new Set([
  'metti', 
  ...V_ISSUE, ...V_CREDIT, ...V_DELETE, ...V_CONV, ...V_DUP, ...V_ADD, ...V_DOWN, ...V_OPEN,
  ...PAID, ...SENT, ...ACCEPT, ...REJECT, ...CONFIRM, ...PREV, ...FATT, ...w('documento documenti conferma credito corrente attuale ultima ultimo emissione annullamento nuovo nuova crea prepara genera'),
]);
/** Parole il cui "indovinare" per somiglianza rende pericolosa un'azione (penalità sulla confidenza). */
const RISKY_VERBS = new Set([...V_ISSUE, ...V_CREDIT, ...CONFIRM, ...w('credito storno emissione annullamento')]);

const NOISE_LEAD = new Set(w('ok okay allora senti scusa scusami ehi ehy hey dunque adesso ora comunque ecco bene mh eh ah uhm beh vorrei voglio devo dovrei puoi potresti vuoi riesci mi ti ci dai prego gentilmente favore piacere'));
const NOISE_ANY = new Set(w('grazie gentilmente subito ecco'));
const ART = new Set(w('il lo la l i gli le un uno una un'));
const QUESTION = new Set(w('posso possiamo come quando perche quanto cosa quale dove'));
const AFFIRM = [
  'si', 'ok', 'okay', 'va bene', 'certo', 'esatto', 'giusto', 'procedi', 'vai', 'avanti', 'confermo', 'conferma', 'yes', 'perfetto', 'd accordo', 'si grazie', 'ok grazie',
];
const DISMISS = ['no', 'no grazie', 'niente', 'lascia stare', 'lascia perdere', 'chiudi', 'stop', 'basta', 'ferma', 'fermo', 'esci', 'annulla tutto non voglio', 'non voglio', 'sbagliato', 'non e questo', 'cancella la richiesta'];
const UNDO = [
  'annulla', 'annulla tutto', 'annulla ultima azione', 'annulla l ultima azione', 'annulla ultima operazione', 'annulla l ultima operazione',
  'annulla l ultima modifica', 'annulla ultima modifica', 'annulla l ultima', 'annulla ultima', 'torna indietro', 'indietro', 'undo', 'disfa', 'ripristina', 'annulla azione', 'annulla operazione', 'annulla questa azione',
];

/* ------------------------------------------------------------------ riferimenti a documenti */

const docTypeOf = (ws: string[]): DocKind | undefined => {
  const p = ws.findIndex((x) => PREV.has(x));
  const f = ws.findIndex((x) => FATT.has(x));
  if (p >= 0 && f < 0) return 'preventivo';
  if (f >= 0 && p < 0) return 'fattura';
  const nc = ws.findIndex((x, i) => x === 'nota' && ws[i + 1] === 'di' && ws[i + 2] === 'credito');
  if (nc >= 0) return 'fattura';
  if (p >= 0 && f >= 0) return p < f ? 'preventivo' : 'fattura';
  return undefined;
};

const STRONG_BEFORE_NUM = new Set(w('numero n nr num preventivo fattura offerta documento bozza prev ft nc credito uno'));
const NOT_NUM_AFTER = new Set(w('euro euri eur percento per ore ora metri metro mq mc kg litri pezzi pz'));
const NAME_MARK = new Set(w('di del dello della dei degli per a da intestata intestato cliente signor signora sig ditta studio societa azienda ai agli'));
const NAME_SKIP = new Set([...ART, ...w('cliente signor signora sig ditta studio societa azienda dottor dottore dottoressa ingegner geometra avvocato spettabile spett')]);
const NAME_STOP = new Set([
  ...DOC_WORDS, ...ART, ...LAST, ...CURRENT, ...EURO, ...PAID, ...SENT, ...ACCEPT, ...REJECT,
  ...w('nuovo nuova con come in e ed che ha ho hanno non motivo perche causale causa dovuto numero n nr pdf xml mese anno oggi ieri tutti tutte al alla allo nel nella sul sulla su pagamento riga righe voce voci da di del della dei per a'),
]);

function findDocNumber(t: Tok[]): { number: number; year?: number } | null {
  const isYear = (x?: Tok) => !!x && x.n !== undefined && Number.isInteger(x.n) && x.n >= 1990 && x.n <= 2100;
  const cands: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.n === undefined || !Number.isInteger(x.n) || x.n <= 0 || x.n >= 100000) continue;
    const next = t[i + 1];
    if (next && NOT_NUM_AFTER.has(next.w)) continue;
    const prev = t[i - 1];
    // anno dopo il numero ("12 2026", "12 del 2026"): non è un candidato
    if (isYear(x) && prev && prev.n !== undefined) continue;
    if (isYear(x) && prev && ['del', 'barra', 'slash', 'anno'].includes(prev.w) && t[i - 2]?.n !== undefined) continue;
    cands.push(i);
  }
  const pickIdx = cands.find((i) => {
    const p = t[i - 1];
    return p && (STRONG_BEFORE_NUM.has(p.w) || (p.w === 'il' && DOC_WORDS.has(t[i - 2]?.w ?? '')));
  }) ?? (cands.length === 1 ? cands[0] : undefined);
  if (pickIdx === undefined) {
    // "fattura uno"
    const u = t.findIndex((x, i) => x.w === 'uno' && DOC_WORDS.has(t[i - 1]?.w ?? ''));
    return u >= 0 ? { number: 1 } : null;
  }
  const number = t[pickIdx].n as number;
  let year: number | undefined;
  const a = t[pickIdx + 1];
  const b = t[pickIdx + 2];
  if (isYear(a)) year = a?.n;
  else if (a && ['del', 'barra', 'slash', 'anno'].includes(a.w) && isYear(b)) year = b?.n;
  return { number, year };
}

function findCustomer(t: Tok[]): string | null {
  for (let i = 0; i < t.length; i++) {
    if (!NAME_MARK.has(t[i].w) || t[i].n !== undefined) continue;
    // "nota di credito": non è un marcatore di nome
    if (t[i].w === 'di' && t[i - 1]?.w === 'nota') continue;
    let j = i + 1;
    while (j < t.length && NAME_SKIP.has(t[j].w)) j++;
    const parts: string[] = [];
    while (j < t.length && parts.length < 4) {
      const x = t[j];
      if (x.n !== undefined || NAME_STOP.has(x.w) || x.w.length < 2) break;
      parts.push(x.raw);
      j++;
    }
    if (parts.length) return parts.join(' ');
  }
  return null;
}

const cap = (s: string) => s.split(' ').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

function parseRef(t: Tok[], hint?: DocKind): DocRef {
  const ws = t.map((x) => x.w);
  const docType = hint ?? docTypeOf(ws);
  const draftOnly = ws.includes('bozza') || ws.includes('bozze') ? true : undefined;
  const base = (r: DocRef): DocRef => {
    const o = r as Record<string, unknown>;
    if (docType === undefined) delete o.docType; else o.docType = docType;
    if (draftOnly && r.kind !== 'number' && r.kind !== 'current') o.draftOnly = true;
    return r;
  };
  const num = findDocNumber(t);
  if (num) {
    const ref: DocRef = { kind: 'number', number: num.number, docType };
    if (num.year) ref.year = num.year;
    return base(ref);
  }
  const isLast = ws.some((x) => LAST.has(x));
  const cust = findCustomer(t);
  if (cust) {
    const ref: DocRef = { kind: 'customer', name: cap(cust), docType };
    if (isLast) ref.latest = true;
    return base(ref);
  }
  if (isLast) return base({ kind: 'last', docType });
  return base({ kind: 'current', docType });
}

/* ------------------------------------------------------------------ regole */

interface Cand extends ScoredCommand { risky?: boolean }

interface P {
  t: Tok[];
  ws: string[];
  has: (...x: string[]) => boolean;
  hasIn: (s: ReadonlySet<string>) => boolean;
  idxIn: (s: ReadonlySet<string>) => number;
  fuzzyAt: (i: number) => boolean;
  /** testo ripulito (minuscolo, apostrofi come spazi) per le regex che estraggono dettati */
  text: string;
  question: boolean;
  negated: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));
const joinWords = (t: Tok[]) => t.map((x) => x.raw).join(' ');

function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´']/g, ' ')
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prepare(input: string): P | null {
  let toks = tokenize(input);
  // rumore: "per favore", saluti, premesse
  toks = toks.filter((x, i) => !(x.w === 'per' && (toks[i + 1]?.w === 'favore' || toks[i + 1]?.w === 'piacere')) && !(x.w === 'favore' && toks[i - 1]?.w === 'per') && !(x.w === 'piacere' && toks[i - 1]?.w === 'per'));
  toks = toks.filter((x) => !NOISE_ANY.has(x.w));
  while (toks.length && NOISE_LEAD.has(toks[0].w)) toks = toks.slice(1);
  // sigle dettate lettera per lettera: "x m l", "p d f"
  const spelled: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tri = toks.slice(i, i + 3).map((x) => x.w).join('');
    if (tri === 'xml' && toks[i].w === 'x') { spelled.push({ w: 'xml', raw: 'xml' }); i += 2; continue; }
    if (tri === 'pdf' && toks[i].w === 'p') { spelled.push({ w: 'pdf', raw: 'pdf' }); i += 2; continue; }
    if (toks[i].w === 'pi' && toks[i + 1]?.w === 'di' && toks[i + 2]?.w === 'effe') { spelled.push({ w: 'pdf', raw: 'pdf' }); i += 2; continue; }
    spelled.push(toks[i]);
  }
  toks = canonicalize(spelled, KEYWORDS);
  if (!toks.length) return null;
  const ws = toks.map((x) => x.w);
  const set = new Set(ws);
  return {
    t: toks,
    ws,
    has: (...x) => x.some((y) => set.has(y)),
    hasIn: (s) => ws.some((y) => s.has(y)),
    idxIn: (s) => ws.findIndex((y) => s.has(y)),
    fuzzyAt: (i) => !!toks[i]?.fuzzy,
    text: cleanText(input),
    question: QUESTION.has(ws[0]) || (ws[0] === 'si' && ws[1] === 'puo') || /\?\s*$/.test(input),
    negated: ws.includes('non') || ws.includes('mai'),
  };
}

/** Penalità comuni agli intent irreversibili. */
function irreversible(p: P, base: number, trigIdx: number): number {
  let c = base;
  if (p.fuzzyAt(trigIdx)) c -= 0.22;
  if (trigIdx > 2) c -= 0.15;
  if (p.question) c -= 0.3;
  if (p.t.length > 12) c -= 0.1;
  return c;
}

type Rule = (p: P) => Cand[];

const ruleControl: Rule = (p) => {
  const s = p.ws.join(' ');
  const out: Cand[] = [];
  if (CONFIRM.has(p.ws[0] ?? '') && p.t.length <= 4) {
    const fz = p.t.some((x) => x.fuzzy);
    if (p.has('emissione', 'emetti', 'emettere')) out.push({ command: { type: 'confirm', what: 'issue' }, confidence: fz ? 0.7 : 0.97 });
    else if (p.has('storno', 'stornare', 'storna', 'annullamento', 'annullare', 'annulla') || (p.has('nota') && p.has('credito'))) out.push({ command: { type: 'confirm', what: 'credit_note' }, confidence: fz ? 0.7 : 0.97 });
  }
  if (UNDO.includes(s)) out.push({ command: { type: 'undo' }, confidence: 0.95 });
  if (AFFIRM.includes(s)) out.push({ command: { type: 'affirm' }, confidence: 0.95 });
  if (DISMISS.includes(s)) out.push({ command: { type: 'dismiss' }, confidence: 0.93 });
  return out;
};

const ruleNew: Rule = (p) => {
  const hasPrev = p.hasIn(PREV);
  const hasFatt = p.hasIn(FATT);
  if (!hasPrev && !hasFatt) return [];
  if (hasPrev && hasFatt) return []; // conversione
  if (p.hasIn(V_CONV) || p.hasIn(V_ISSUE) || p.hasIn(V_DOWN) || p.hasIn(V_DUP) || p.hasIn(V_DELETE) || p.hasIn(V_ADD) || p.hasIn(PAID) || p.hasIn(SENT) || p.hasIn(ACCEPT) || p.hasIn(REJECT)) return [];
  if (p.has('credito') || PLURAL_LIST(p)) return [];
  const docIdx = p.idxIn(hasPrev ? PREV : FATT);
  const docType: DocKind = hasPrev ? 'preventivo' : 'fattura';
  const lead = p.t.slice(0, docIdx).every((x) => ART.has(x.w) || V_NEW.has(x.w) || ['altro', 'altra', 'bel', 'piccolo', 'veloce', 'rapido', 'breve'].includes(x.w));
  const after = p.ws[docIdx + 1];
  const withVerb = p.t.slice(0, docIdx).some((x) => V_NEW.has(x.w));
  const hasNum = p.t.some((x, i) => x.n !== undefined && STRONG_BEFORE_NUM.has(p.ws[i - 1] ?? '') && i > docIdx);
  if (hasNum && !withVerb) return [];
  let c = 0;
  if (!lead) c = 0.45;
  else if (['per', 'a', 'intestata', 'intestato', 'di'].includes(after ?? '')) c = withVerb ? 0.95 : 0.9;
  else if (withVerb && p.t.length === docIdx + 1) c = 0.88; // "nuovo preventivo"
  else if (withVerb) c = 0.8;
  else if (p.t.slice(docIdx + 1).some((x) => x.n !== undefined)) c = 0.62; // "preventivo tre metri di tubo"
  else c = 0;
  if (p.negated) c -= 0.3;
  if (p.question) c -= 0.2;
  if (c <= 0) return [];
  // il dettato (cliente + voci) lo interpreta parseDictation: gli passiamo la frase privata del verbo iniziale
  const dictation = p.text.replace(/^(?:(?:nuovo|nuova|crea|creami|creare|fai|fammi|facci|prepara|preparami|genera|generare|redigi|scrivi)\s+)?(?:(?:un|una|uno|il|la|lo|l)\s+)?(?:(?:altro|altra|bel|piccolo|veloce|rapido)\s+)?/, '');
  return [{ command: { type: 'new_document', docType, dictation: dictation || p.text }, confidence: clamp(c) }];
};

const PLURAL_LIST = (p: P) => p.ws.some((x) => PLURAL.has(x)) && !p.t.some((x) => x.n !== undefined);

const ruleConvert: Rule = (p) => {
  const hasPrev = p.hasIn(PREV);
  const hasFatt = p.hasIn(FATT);
  const verb = p.hasIn(V_CONV);
  if (!verb && !(hasPrev && hasFatt)) return [];
  if (verb && !hasFatt && !hasPrev) return [];
  if (hasPrev && hasFatt) {
    const c = verb ? 0.94 : p.has('da', 'dal', 'dallo', 'partire') || p.has('in') ? 0.86 : 0;
    if (!c) return [];
    // il riferimento è quello del preventivo: se "preventivo" precede "fattura" si ignora ciò che segue "in fattura"
    const f = p.t.findIndex((x) => FATT.has(x.w));
    const pr = p.t.findIndex((x) => PREV.has(x.w));
    const ref = parseRef(pr < f ? p.t.slice(0, f) : p.t, 'preventivo');
    return [{ command: { type: 'convert_quote', ref }, confidence: c }];
  }
  if (verb && hasFatt) return [{ command: { type: 'convert_quote', ref: { kind: 'current', docType: 'preventivo' } }, confidence: 0.82 }];
  return [];
};

const ruleIssue: Rule = (p) => {
  if (p.negated || p.hasIn(CONFIRM)) return [];
  const out: Cand[] = [];
  const hasCredit = p.has('credito') || p.hasIn(V_CREDIT);
  const i = p.idxIn(V_ISSUE);
  if (i >= 0 && !hasCredit) {
    const docRef = parseRef(p.t, undefined);
    if ('docType' in docRef && docRef.docType === 'preventivo') {
      // un preventivo non si emette: forse voleva convertirlo
      out.push({ command: { type: 'issue_invoice', ref: docRef }, confidence: 0.55, risky: true });
      out.push({ command: { type: 'convert_quote', ref: docRef }, confidence: 0.5 });
      return out;
    }
    out.push({ command: { type: 'issue_invoice', ref: docRef }, confidence: clamp(irreversible(p, p.hasIn(FATT) || p.has('bozza', 'documento') ? 0.94 : 0.9, i)), risky: true });
  } else if (i < 0 && !hasCredit && p.has('metti') && p.has('fattura', 'bozza') && !p.hasIn(PAID) && !p.hasIn(SENT) && !p.t.some((x) => x.n !== undefined) && !p.has('riga', 'voce', 'dentro', 'nel', 'nella')) {
    // "emetti" sentito come "metti": ambiguo per costruzione
    out.push({ command: { type: 'issue_invoice', ref: parseRef(p.t, 'fattura') }, confidence: 0.58, risky: true });
  }
  return out;
};

const REASON_MARK = new Set(w('motivo perche causale causa dovuto'));

const ruleCredit: Rule = (p) => {
  if (p.negated || p.hasIn(CONFIRM)) return [];
  const hasNC = p.has('nota') && p.has('credito');
  const i = p.idxIn(V_CREDIT);
  const hasDoc = p.hasIn(FATT) || hasNC || p.t.some((x) => x.n !== undefined) || p.has('documento');
  if (i < 0 && !hasNC) return [];
  if (p.hasIn(PREV) && !p.hasIn(FATT)) return []; // "annulla il preventivo": gestito da delete
  if (p.has('bozza', 'bozze') && !hasNC) return []; // una bozza non si storna
  if (i >= 0 && !hasDoc) return []; // "annulla" generico = undo
  if (i >= 0 && p.t[i].w === 'annullamento' && !hasDoc) return [];
  const rm = p.idxIn(REASON_MARK);
  const refToks = rm >= 0 ? p.t.slice(0, rm) : p.t;
  const reasonRaw = rm >= 0 ? joinWords(p.t.slice(rm + 1)) : '';
  const reason = reasonRaw ? reasonRaw.charAt(0).toUpperCase() + reasonRaw.slice(1) : undefined;
  const ref = parseRef(refToks, 'fattura');
  const trig = i >= 0 ? i : p.t.findIndex((x) => x.w === 'nota');
  // "emetti/fai/crea una nota di credito" è comunque un'azione sullo storno
  let c = irreversible(p, hasNC ? 0.94 : p.hasIn(FATT) ? 0.9 : 0.7, trig);
  if (i >= 0 && p.ws[i] === 'storno') c -= 0.25; // prima persona: non è un ordine
  if (!hasNC && ref.kind === 'current' && !p.hasIn(CURRENT)) c -= 0.12; // "annulla la fattura" senza riferimento: troppo generico
  const command: Command = { type: 'credit_note', ref, ...(reason ? { reason } : {}) };
  return [{ command, confidence: clamp(c), risky: true }];
};

const ruleDelete: Rule = (p) => {
  if (p.negated) return [];
  const i = p.idxIn(V_DELETE);
  const annullaDoc = p.idxIn(V_CREDIT) >= 0 && (p.has('bozza', 'bozze') || (p.hasIn(PREV) && !p.hasIn(FATT)));
  if (i < 0 && !annullaDoc) return [];
  if (p.has('riga', 'righe', 'voce', 'voci', 'ultima riga', 'sconto')) return [];
  const hasDoc = p.hasIn(DOC_WORDS);
  if (!hasDoc) return [];
  const ref = parseRef(p.t);
  let c = i >= 0 ? 0.92 : 0.7;
  if (p.fuzzyAt(i)) c -= 0.1;
  if (p.question) c -= 0.3;
  return [{ command: { type: 'delete_draft', ref }, confidence: clamp(c) }];
};

const amountOf = (t: Tok[]): number | undefined => {
  for (let i = 0; i < t.length - 1; i++) if (t[i].n !== undefined && EURO.has(t[i + 1].w)) return t[i].n;
  return undefined;
};

const rulePaid: Rule = (p) => {
  if (!p.hasIn(PAID) || p.negated) return [];
  if (p.has('da', 'ancora', 'quando') && !p.has('ha', 'ho', 'e', 'segna', 'segnala', 'metti')) return [];
  const amount = amountOf(p.t);
  const ref = parseRef(p.t.filter((x, i) => !(x.n !== undefined && EURO.has(p.ws[i + 1] ?? ''))), 'fattura');
  let ref2: DocRef = ref;
  // "Rossi ha pagato 300 euro" -> cliente prima del verbo
  const ha = p.ws.findIndex((x, i) => (x === 'ha' || x === 'hanno') && i > 0 && PAID.has(p.ws[i + 1] ?? ''));
  if (ha > 0 && ref.kind === 'current') {
    const parts = p.t.slice(0, ha).filter((x) => !ART.has(x.w) && !NAME_SKIP.has(x.w) && x.n === undefined && !NAME_STOP.has(x.w)).map((x) => x.raw);
    if (parts.length) ref2 = { kind: 'customer', name: cap(parts.join(' ')), docType: 'fattura', latest: true };
  }
  const explicit = p.has('segna', 'segnala', 'imposta', 'metti', 'marca', 'registra', 'ho', 'ha', 'hanno', 'risulta', 'e', 'è', 'stata', 'stato', 'come', 'registrami');
  let c = explicit ? 0.9 : 0.62;
  if (p.hasIn(PREV) && !p.hasIn(FATT)) c -= 0.4;
  if (p.question) c -= 0.3;
  const command: Command = { type: 'mark_paid', ref: ref2, ...(amount !== undefined ? { amount } : {}) };
  return [{ command, confidence: clamp(c) }];
};

const ruleSent: Rule = (p) => {
  if (!p.hasIn(SENT) || p.negated || p.hasIn(PAID)) return [];
  if (p.has('inviata', 'inviato', 'inviate', 'inviati', 'spedita', 'spedito', 'mandata', 'mandato', 'trasmessa', 'trasmesso') === false) return [];
  const explicit = p.has('segna', 'segnala', 'imposta', 'metti', 'marca', 'registra', 'ho', 'ha', 'e', 'è', 'stata', 'stato', 'come', 'risulta');
  if (!explicit) return [];
  if (p.hasIn(ACCEPT) || p.hasIn(REJECT)) return [];
  let c = 0.9;
  if (p.question) c -= 0.3;
  return [{ command: { type: 'mark_sent', ref: parseRef(p.t) }, confidence: clamp(c) }];
};

const ruleQuoteStatus: Rule = (p) => {
  const acc = p.hasIn(ACCEPT);
  const rej = p.hasIn(REJECT);
  if ((!acc && !rej) || p.negated) return [];
  const explicit = p.has('segna', 'segnala', 'imposta', 'metti', 'marca', 'ha', 'e', 'è', 'stato', 'come', 'risulta');
  let c = explicit ? 0.9 : 0.6;
  if (p.hasIn(FATT) && !p.hasIn(PREV)) c -= 0.35;
  if (p.question) c -= 0.3;
  return [{ command: { type: 'quote_status', ref: parseRef(p.t, 'preventivo'), status: acc ? 'accettato' : 'rifiutato' }, confidence: clamp(c) }];
};

const ruleDuplicate: Rule = (p) => {
  const i = p.idxIn(V_DUP);
  const copia = p.has('copia') && (p.hasIn(DOC_WORDS) || p.has('fanne', 'fammi'));
  if (i < 0 && !copia) return [];
  if (p.negated) return [];
  if (p.has('copia') && p.has('cortesia')) return [];
  let c = i >= 0 ? 0.93 : 0.8;
  if (p.fuzzyAt(i)) c -= 0.1;
  return [{ command: { type: 'duplicate', ref: parseRef(p.t) }, confidence: clamp(c) }];
};

const ruleOpenList: Rule = (p) => {
  const verb = p.hasIn(V_OPEN) || (p.has('fammi', 'fai') && p.has('vedere', 'vedi')) || p.has('cerca', 'trova', 'elenca');
  const hasDoc = p.hasIn(DOC_WORDS);
  const hasNum = p.t.some((x) => x.n !== undefined);
  if (p.hasIn(V_ADD) || p.hasIn(V_DOWN) || p.hasIn(V_CONV) || p.hasIn(V_DUP) || p.hasIn(V_DELETE) || p.hasIn(V_ISSUE)) return [];
  if (!hasDoc) return [];
  if (p.hasIn(PAID) || p.hasIn(SENT) || p.hasIn(ACCEPT) || p.hasIn(REJECT)) return [];
  if (p.has('credito') && !verb) return [];
  if (p.negated) return [];
  const docType = docTypeOf(p.ws);
  const cust = findCustomer(p.t);
  const isLast = p.hasIn(LAST);
  const plural = PLURAL_LIST(p) || (p.hasIn(PLURAL) && !hasNum && !isLast);
  // "mostra/apri le fatture (di Rossi)" -> elenco
  if (plural && (verb || cust || p.has('tutte', 'tutti'))) {
    const c = verb ? 0.9 : 0.82;
    const cmd: Command = { type: 'list', ...(docType ? { docType } : {}), ...(cust ? { customerName: cap(cust) } : {}) };
    return [{ command: cmd, confidence: c }];
  }
  if (p.has('bozza', 'bozze') && !hasNum && !cust && !isLast && !p.hasIn(CURRENT) && verb) {
    return [{ command: { type: 'list', ...(docType ? { docType } : {}) }, confidence: 0.6 }];
  }
  const ref = parseRef(p.t);
  if (ref.kind === 'current' && !p.hasIn(CURRENT) && !verb) return [];
  const strong = verb && (hasNum || isLast || cust || p.hasIn(CURRENT));
  const c = strong ? 0.93 : verb ? 0.75 : hasNum && p.hasIn(DOC_WORDS) && p.t.length <= 5 ? 0.62 : isLast && p.t.length <= 3 ? 0.7 : 0;
  if (!c) return [];
  return [{ command: { type: 'open', ref }, confidence: c }];
};

const ruleAddLine: Rule = (p) => {
  const i = p.idxIn(V_ADD);
  const metti = p.has('metti') && !p.hasIn(PAID) && !p.hasIn(SENT) && !p.has('fattura', 'bozza') && p.t.some((x) => x.n !== undefined);
  if (i < 0 && !metti) return [];
  if (p.negated) return [];
  // dettato = testo tra il verbo e la clausola finale "al/alla/nel … preventivo|fattura|documento|bozza"
  const m = /^(?:.*?\b)?(?:aggiungi|aggiungere|aggiungimi|inserisci|inserire|mettici|metti)\s+(?:(?:una|la|le|altre?|altra)\s+(?:riga|righe|voce|voci)\s+(?:di\s+)?)?(.*?)(\s+(?:al|alla|allo|nel|nella|sul|sulla|a)\s+(?:questo\s+|questa\s+|quel\s+|quella\s+|il\s+|la\s+)?(?:preventivo|fattura|documento|bozza|offerta)\b.*)?$/.exec(p.text);
  if (!m) return [];
  const dictation = (m[1] ?? '').trim();
  if (!dictation) return [];
  // se il "dettato" è solo un tipo di documento ("aggiungi un preventivo") non è una riga
  if (DOC_WORDS.has(dictation.replace(/^(?:un|una|il|la)\s+/, ''))) return [];
  const tail = (m[2] ?? '').trim();
  const ref: DocRef = tail ? parseRef(canonicalize(tokenize(tail), KEYWORDS)) : { kind: 'current' };
  const startsWithVerb = i >= 0 ? i <= 1 : true;
  const c = (i >= 0 ? 0.9 : 0.82) - (startsWithVerb ? 0 : 0.15) - (p.fuzzyAt(i) ? 0.1 : 0);
  return [{ command: { type: 'add_line', dictation, ref }, confidence: clamp(c) }];
};

const ruleDownload: Rule = (p) => {
  const hasPdf = p.has('pdf');
  const hasXml = p.has('xml');
  const verb = p.hasIn(V_DOWN) || p.has('genera', 'esporta', 'dammi', 'mandami', 'manda');
  if (!hasPdf && !hasXml && !(p.has('stampa') && p.hasIn(DOC_WORDS))) return [];
  if (!verb && p.t.length > 3) return [];
  if (p.negated) return [];
  const format: 'pdf' | 'xml' = hasXml && !hasPdf ? 'xml' : 'pdf';
  let c = hasPdf || hasXml ? (verb ? 0.95 : 0.7) : 0.8;
  if (p.question) c -= 0.3;
  return [{ command: { type: 'download', format, ref: parseRef(p.t) }, confidence: clamp(c) }];
};

const RULES: Rule[] = [ruleControl, ruleNew, ruleConvert, ruleIssue, ruleCredit, ruleDelete, rulePaid, ruleSent, ruleQuoteStatus, ruleDuplicate, ruleOpenList, ruleAddLine, ruleDownload];

/* ------------------------------------------------------------------ API */

function candidates(input: string): Cand[] {
  const p = prepare(input);
  if (!p) return [];
  const all = RULES.flatMap((r) => r(p));
  return all.sort((a, b) => b.confidence - a.confidence);
}

const SOGLIA_ALT = 0.3;

function summarize(cands: Cand[]): Classification {
  if (!cands.length) return { command: null, confidence: 0 };
  const top = cands[0];
  const alts: ScoredCommand[] = [];
  for (const c of cands.slice(1)) {
    if (c.command.type === top.command.type) continue;
    if (c.confidence < SOGLIA_ALT) continue;
    if (alts.some((a) => a.command.type === c.command.type)) continue;
    alts.push({ command: c.command, confidence: c.confidence });
    if (alts.length >= 3) break;
  }
  const res: Classification = top.confidence >= 0.5
    ? { command: top.command, confidence: top.confidence }
    : { command: null, confidence: top.confidence };
  if (res.command === null && top.confidence >= SOGLIA_ALT) alts.unshift({ command: top.command, confidence: top.confidence });
  if (alts.length) res.alternatives = alts;
  return res;
}

/**
 * Classifica una trascrizione. Se `ctx.nBest` contiene ipotesi alternative del riconoscitore con un intent diverso,
 * queste compaiono tra le `alternatives` (la policy scarta gli intent irreversibili in presenza di alternative).
 */
export function classifyCommand(transcript: string, ctx: ClassifyContext = {}): Classification {
  const main = candidates(transcript);
  const res = summarize(main);
  const extra: ScoredCommand[] = [];
  for (const alt of ctx.nBest ?? []) {
    if (!alt || cleanText(alt) === cleanText(transcript)) continue;
    const c = candidates(alt)[0];
    if (!c || c.confidence < 0.5) continue;
    if (res.command && c.command.type === res.command.type) continue;
    extra.push({ command: c.command, confidence: clamp(c.confidence * 0.9) });
  }
  if (extra.length) {
    const merged = [...(res.alternatives ?? [])];
    for (const e of extra) if (!merged.some((m) => m.command.type === e.command.type)) merged.push(e);
    res.alternatives = merged.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
    if (!res.command) {
      const best = res.alternatives[0];
      if (best && best.confidence >= 0.5) { res.command = best.command; res.confidence = best.confidence; res.alternatives = res.alternatives.slice(1); if (!res.alternatives.length) delete res.alternatives; }
    }
  }
  return res;
}
