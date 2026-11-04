/**
 * POLICY dei comandi vocali (CONTRACT-V2, ARCHITECTURE-V2 §4.3, FISCAL-SPEC §6). Decisa dal CODICE, mai dal modello.
 *
 *  - lettura       -> esecuzione immediata
 *  - reversibile   -> esecuzione + toast "Annulla" (6 s). Se non annullabile (pagamenti, segnalazioni SDI) o se agisce su
 *                     dati già consolidati (conversione, eliminazione bozza con righe) -> scheda di riepilogo con tocco
 *  - IRREVERSIBILE -> (emettere, stornare) SEMPRE scheda di conferma esplicita: pressione prolungata (>= 1 s) oppure frase
 *                     "conferma emissione"/"conferma storno" entro 15 s con scheda visibile. MAI "sì"/"ok".
 *
 * Il "gettone" di conferma (`Confirmation`) può essere creato SOLO da questo modulo (registro privato): l'executor lo esige
 * per i comandi irreversibili, quindi nessun percorso di codice esegue un'emissione/storno senza aver passato di qui.
 */
import type { Classification, Command, CommandType, ScoredCommand } from '../types';

export type Risk = 'read' | 'reversible' | 'irreversible';

export const UNDO_WINDOW_MS = 6000;
export const VOICE_CONFIRM_TTL_MS = 15_000;
export const HOLD_CONFIRM_MS = 1000;
/** la scheda si chiude da sola dopo questo tempo (nessuna conferma "a ritroso") */
export const CARD_MAX_LIFETIME_MS = 60_000;
export const CONFIDENCE_EXECUTE = 0.8;
export const CONFIDENCE_ASK = 0.5;

interface Profile { risk: Risk; undo: boolean; readback: boolean }
const PROFILES: Record<CommandType, Profile> = {
  open: { risk: 'read', undo: false, readback: false },
  list: { risk: 'read', undo: false, readback: false },
  download: { risk: 'read', undo: false, readback: false },
  confirm: { risk: 'read', undo: false, readback: false },
  affirm: { risk: 'read', undo: false, readback: false },
  dismiss: { risk: 'read', undo: false, readback: false },
  undo: { risk: 'read', undo: false, readback: false },
  new_document: { risk: 'reversible', undo: true, readback: false },
  duplicate: { risk: 'reversible', undo: true, readback: false },
  add_line: { risk: 'reversible', undo: true, readback: false },
  quote_status: { risk: 'reversible', undo: true, readback: false },
  delete_draft: { risk: 'reversible', undo: true, readback: false },
  convert_quote: { risk: 'reversible', undo: true, readback: true },
  // correggibili solo con annotazione, non annullabili dal toast: riepilogo e tocco prima di agire
  mark_paid: { risk: 'reversible', undo: false, readback: true },
  mark_sent: { risk: 'reversible', undo: false, readback: true },
  issue_invoice: { risk: 'irreversible', undo: false, readback: true },
  credit_note: { risk: 'irreversible', undo: false, readback: true },
};

export const riskOf = (c: Command): Risk => PROFILES[c.type].risk;
export const isControl = (c: Command): boolean => c.type === 'confirm' || c.type === 'affirm' || c.type === 'dismiss' || c.type === 'undo';

/* ------------------------------------------------------------------ 1. dall'enunciato all'intento */

export type IntentDecision =
  /** comando chiaro: si passa a `gate` */
  | { kind: 'proceed'; command: Command }
  /** "Intendevi…?": l'utente sceglie tra le opzioni (la scelta passa comunque da `gate`) */
  | { kind: 'disambiguate'; options: ScoredCommand[]; reason: 'low-confidence' | 'conflicting-intent' }
  | { kind: 'unrecognized' };

export function decideIntent(c: Classification): IntentDecision {
  const alts = (c.alternatives ?? []).filter((a) => !isControl(a.command));
  if (!c.command) {
    const options = alts.slice(0, 3);
    return options.length ? { kind: 'disambiguate', options, reason: 'low-confidence' } : { kind: 'unrecognized' };
  }
  const top = c.command;
  if (isControl(top)) return c.confidence >= CONFIDENCE_EXECUTE ? { kind: 'proceed', command: top } : { kind: 'unrecognized' };
  if (c.confidence < CONFIDENCE_ASK) return { kind: 'unrecognized' };
  if (c.confidence < CONFIDENCE_EXECUTE) {
    return { kind: 'disambiguate', options: [{ command: top, confidence: c.confidence }, ...alts].slice(0, 3), reason: 'low-confidence' };
  }
  // §4.3: un intent distruttivo con alternative di intent diverso (es. "emetti" vs "metti") viene scartato: si chiede l'intento
  if (riskOf(top) === 'irreversible' && alts.length > 0) {
    return { kind: 'disambiguate', options: [{ command: top, confidence: c.confidence }, ...alts].slice(0, 3), reason: 'conflicting-intent' };
  }
  return { kind: 'proceed', command: top };
}

/* ------------------------------------------------------------------ 2. porta di esecuzione */

export interface TargetInfo {
  /** il documento bersaglio ha righe (eliminare una bozza con righe chiede conferma) */
  hasLines?: boolean;
}

export type GateDecision =
  | { kind: 'execute'; undo: boolean }
  /** scheda con riepilogo: basta un tocco su "Conferma" */
  | { kind: 'confirm'; level: 'tap' }
  /** scheda bloccante: pressione prolungata o frase esplicita */
  | { kind: 'confirm'; level: 'explicit'; what: 'issue' | 'credit_note'; phrase: string };

export function gate(command: Command, target: TargetInfo = {}): GateDecision {
  const p = PROFILES[command.type];
  if (p.risk === 'irreversible') {
    const issue = command.type === 'issue_invoice';
    return { kind: 'confirm', level: 'explicit', what: issue ? 'issue' : 'credit_note', phrase: issue ? 'conferma emissione' : 'conferma storno' };
  }
  if (command.type === 'delete_draft') return target.hasLines ? { kind: 'confirm', level: 'tap' } : { kind: 'execute', undo: true };
  if (p.readback) return { kind: 'confirm', level: 'tap' };
  return { kind: 'execute', undo: p.undo };
}

/* ------------------------------------------------------------------ 3. conferme */

export interface ConfirmSummary {
  headline: string;
  fields: { label: string; value: string }[];
  warnings: string[];
  /** avviso sulle conseguenze ("dopo l'emissione non si può modificare…") */
  consequence?: string;
  /**
   * Versione del documento mostrata nel riepilogo (id + updatedAt). Il gettone la porta fino all'esecuzione: se nel frattempo il
   * documento è cambiato (altra scheda, sync, modifica a mano) l'azione NON parte — si esegue solo ciò che l'utente ha visto.
   */
  docVersion?: { id: string; updatedAt: number };
}

export interface PendingConfirmation {
  id: string;
  command: Command;
  level: 'tap' | 'explicit';
  what?: 'issue' | 'credit_note';
  summary: ConfirmSummary;
  createdAt: number;
  expiresAt: number;
  /** legata alla scheda: doppio comando/doppio tap = una sola emissione */
  idempotencyKey: string;
}

declare const brand: unique symbol;
/** Gettone di conferma: non costruibile fuori da questo modulo. */
export interface Confirmation {
  readonly [brand]: true;
  readonly pendingId: string;
  readonly idempotencyKey: string;
  readonly command: Command;
  readonly via: 'hold' | 'voice' | 'tap';
  readonly docVersion?: { id: string; updatedAt: number };
}

const issued = new WeakSet<object>();
const consumedKeys = new Set<string>();
let seq = 0;
const newId = () => `c${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Campi minimi del riepilogo per le azioni irreversibili: documento, cliente, importo. */
const REQUIRED_LABELS = ['Documento', 'Cliente', 'Importo'];

export function createConfirmation(command: Command, summary: ConfirmSummary, now = Date.now()): PendingConfirmation {
  const g = gate(command);
  if (g.kind !== 'confirm') throw new Error('createConfirmation: il comando non richiede conferma');
  if (g.level === 'explicit') {
    const have = new Set(summary.fields.map((f) => f.label));
    const missing = REQUIRED_LABELS.filter((l) => !have.has(l));
    if (missing.length) throw new Error(`Riepilogo incompleto per un'azione irreversibile: manca ${missing.join(', ')}`);
  }
  return {
    id: newId(), command, level: g.level, what: g.level === 'explicit' ? g.what : undefined, summary,
    createdAt: now, expiresAt: now + (g.level === 'explicit' ? CARD_MAX_LIFETIME_MS : CARD_MAX_LIFETIME_MS), idempotencyKey: newId(),
  };
}

function mint(p: PendingConfirmation, via: Confirmation['via']): Confirmation {
  const token = Object.freeze({ pendingId: p.id, idempotencyKey: p.idempotencyKey, command: p.command, via, docVersion: p.summary.docVersion }) as unknown as Confirmation;
  issued.add(token);
  return token;
}

/** Conferma con tocco semplice: valida SOLO per le schede di livello 'tap'. */
export function confirmByTap(p: PendingConfirmation, now = Date.now()): Confirmation | null {
  if (p.level !== 'tap' || now > p.expiresAt) return null;
  return mint(p, 'tap');
}

/** Pressione prolungata (>= 1 s) sul pulsante della scheda. */
export function confirmByHold(p: PendingConfirmation, heldMs: number, now = Date.now()): Confirmation | null {
  if (now > p.expiresAt || !(heldMs >= HOLD_CONFIRM_MS)) return null;
  return mint(p, 'hold');
}

/**
 * Frase esplicita ("conferma emissione" / "conferma storno"): solo con scheda a schermo e visibile, entro 15 s,
 * stessa azione della scheda, riconoscimento sicuro. "sì"/"ok"/"conferma" da soli NON bastano.
 */
export function confirmByVoice(p: PendingConfirmation, heard: Classification, opts: { now?: number; screenVisible: boolean }): Confirmation | null {
  const now = opts.now ?? Date.now();
  if (p.level !== 'explicit' || !opts.screenVisible) return null;
  if (now > p.createdAt + VOICE_CONFIRM_TTL_MS || now > p.expiresAt) return null;
  const c = heard.command;
  if (!c || c.type !== 'confirm' || c.what !== p.what || heard.confidence < 0.9) return null;
  if ((heard.alternatives ?? []).length > 0) return null;
  return mint(p, 'voice');
}

export class ConfirmationRequiredError extends Error {
  constructor(message = 'Questa azione richiede una conferma esplicita.') { super(message); this.name = 'ConfirmationRequiredError'; }
}

/**
 * Usata dall'executor: verifica che il gettone sia autentico, riferito a QUESTO comando e non già usato.
 * Il gettone si consuma (idempotenza: un secondo tentativo con la stessa scheda non rieseguirebbe l'emissione).
 */
export function consumeConfirmation(token: Confirmation | undefined, command: Command): Confirmation {
  if (!token || typeof token !== 'object' || !issued.has(token)) throw new ConfirmationRequiredError();
  if (JSON.stringify(token.command) !== JSON.stringify(command)) throw new ConfirmationRequiredError('La conferma non corrisponde all’azione richiesta.');
  if (consumedKeys.has(token.idempotencyKey)) throw new ConfirmationRequiredError('Azione già eseguita con questa conferma.');
  consumedKeys.add(token.idempotencyKey);
  return token;
}

/** Solo per i test. */
export const __resetConsumedForTests = (): void => consumedKeys.clear();
