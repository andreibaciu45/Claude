import { beforeEach, describe, expect, it } from 'vitest';
import { classifyCommand } from '../intents';
import { CORPUS } from '../intents/corpus';
import { HELDOUT } from '../intents/corpus-heldout';
import type { Classification, Command, CommandType } from '../types';
import {
  __resetConsumedForTests, ConfirmationRequiredError, consumeConfirmation, confirmByHold, confirmByTap, confirmByVoice, createConfirmation,
  decideIntent, gate, riskOf, type ConfirmSummary,
} from './index';

const ref = { kind: 'number', number: 12, docType: 'fattura' } as const;
const SAMPLE: Record<CommandType, Command> = {
  new_document: { type: 'new_document', docType: 'preventivo', dictation: 'preventivo per rossi' },
  convert_quote: { type: 'convert_quote', ref: { kind: 'number', number: 8, docType: 'preventivo' } },
  issue_invoice: { type: 'issue_invoice', ref },
  credit_note: { type: 'credit_note', ref },
  mark_paid: { type: 'mark_paid', ref },
  mark_sent: { type: 'mark_sent', ref },
  quote_status: { type: 'quote_status', ref: { kind: 'current' }, status: 'accettato' },
  duplicate: { type: 'duplicate', ref },
  open: { type: 'open', ref },
  list: { type: 'list' },
  add_line: { type: 'add_line', dictation: 'due ore', ref: { kind: 'current' } },
  delete_draft: { type: 'delete_draft', ref },
  download: { type: 'download', format: 'pdf', ref },
  confirm: { type: 'confirm', what: 'issue' },
  affirm: { type: 'affirm' },
  dismiss: { type: 'dismiss' },
  undo: { type: 'undo' },
};
const FULL: ConfirmSummary = {
  headline: 'Emettere la fattura?',
  fields: [{ label: 'Documento', value: 'Fattura (bozza)' }, { label: 'Cliente', value: 'Rossi' }, { label: 'Importo', value: '€ 372,00' }],
  warnings: [],
};
const cls = (command: Command | null, confidence: number, alternatives?: Classification['alternatives']): Classification => ({ command, confidence, alternatives });

beforeEach(() => __resetConsumedForTests());

describe('rischio', () => {
  it('ogni intent ha una classe di rischio; solo emettere/stornare sono irreversibili', () => {
    const irr = Object.values(SAMPLE).filter((c) => riskOf(c) === 'irreversible').map((c) => c.type).sort();
    expect(irr).toEqual(['credit_note', 'issue_invoice']);
    expect(riskOf(SAMPLE.open)).toBe('read');
    expect(riskOf(SAMPLE.add_line)).toBe('reversible');
  });
});

describe('gate: nessuna azione irreversibile senza conferma esplicita', () => {
  it('emettere e stornare -> sempre scheda esplicita', () => {
    expect(gate(SAMPLE.issue_invoice)).toMatchObject({ kind: 'confirm', level: 'explicit', what: 'issue', phrase: 'conferma emissione' });
    expect(gate(SAMPLE.credit_note)).toMatchObject({ kind: 'confirm', level: 'explicit', what: 'credit_note', phrase: 'conferma storno' });
  });
  it('mai "execute" per un comando irreversibile, con qualunque informazione sul bersaglio', () => {
    for (const c of Object.values(SAMPLE).filter((c) => riskOf(c) === 'irreversible')) {
      for (const t of [{}, { hasLines: true }, { hasLines: false }]) expect(gate(c, t).kind).toBe('confirm');
    }
  });
  it('reversibili: undo; non annullabili o consolidanti: riepilogo con tocco', () => {
    expect(gate(SAMPLE.add_line)).toEqual({ kind: 'execute', undo: true });
    expect(gate(SAMPLE.new_document)).toEqual({ kind: 'execute', undo: true });
    expect(gate(SAMPLE.mark_paid)).toEqual({ kind: 'confirm', level: 'tap' });
    expect(gate(SAMPLE.mark_sent)).toEqual({ kind: 'confirm', level: 'tap' });
    expect(gate(SAMPLE.convert_quote)).toEqual({ kind: 'confirm', level: 'tap' });
    expect(gate(SAMPLE.delete_draft, { hasLines: true })).toEqual({ kind: 'confirm', level: 'tap' });
    expect(gate(SAMPLE.delete_draft, { hasLines: false })).toEqual({ kind: 'execute', undo: true });
  });
  it('lettura: immediata, senza undo', () => {
    for (const k of ['open', 'list', 'download'] as const) expect(gate(SAMPLE[k])).toEqual({ kind: 'execute', undo: false });
  });
});

describe('decideIntent', () => {
  it('conf >= 0.8 senza ambiguità -> procede', () => {
    expect(decideIntent(cls(SAMPLE.open, 0.93)).kind).toBe('proceed');
  });
  it('0.5-0.8 -> disambiguazione con le alternative', () => {
    const d = decideIntent(cls(SAMPLE.open, 0.65, [{ command: SAMPLE.list, confidence: 0.4 }]));
    expect(d).toMatchObject({ kind: 'disambiguate', reason: 'low-confidence' });
    expect(d.kind === 'disambiguate' && d.options.map((o) => o.command.type)).toEqual(['open', 'list']);
  });
  it('< 0.5 -> non riconosciuto (o alternative se ce ne sono)', () => {
    expect(decideIntent(cls(null, 0.2)).kind).toBe('unrecognized');
    expect(decideIntent(cls(null, 0.4, [{ command: SAMPLE.open, confidence: 0.4 }])).kind).toBe('disambiguate');
  });
  it('irreversibile con confidenza alta MA alternativa di intent diverso (emetti vs metti) -> scartato', () => {
    const d = decideIntent(cls(SAMPLE.issue_invoice, 0.9, [{ command: SAMPLE.add_line, confidence: 0.5 }]));
    expect(d).toMatchObject({ kind: 'disambiguate', reason: 'conflicting-intent' });
  });
  it('irreversibile con confidenza < 0.8 -> mai proceed', () => {
    expect(decideIntent(cls(SAMPLE.credit_note, 0.72)).kind).toBe('disambiguate');
  });
  it('"sì" da solo non è un comando che esegue nulla: è controllo', () => {
    const d = decideIntent(classifyCommand('sì'));
    expect(d).toEqual({ kind: 'proceed', command: { type: 'affirm' } });
    expect(gate({ type: 'affirm' })).toEqual({ kind: 'execute', undo: false });
  });
});

describe('conferme esplicite', () => {
  const pend = (cmd = SAMPLE.issue_invoice, now = 1_000_000) => createConfirmation(cmd, FULL, now);

  it('riepilogo incompleto per azione irreversibile -> rifiutato', () => {
    expect(() => createConfirmation(SAMPLE.issue_invoice, { headline: 'x', fields: [{ label: 'Cliente', value: 'Rossi' }], warnings: [] })).toThrow(/manca/);
  });
  it('pressione prolungata: >= 1 s', () => {
    const p = pend();
    expect(confirmByHold(p, 999, 1_000_100)).toBeNull();
    expect(confirmByHold(p, 1000, 1_000_100)).not.toBeNull();
  });
  it('tocco semplice NON conferma una scheda esplicita', () => {
    expect(confirmByTap(pend())).toBeNull();
    expect(confirmByTap(createConfirmation(SAMPLE.mark_paid, FULL))).not.toBeNull();
  });
  it('voce: solo la frase esatta, entro 15 s, scheda visibile, stessa azione', () => {
    const p = pend(SAMPLE.issue_invoice, 1_000_000);
    const ok = classifyCommand('conferma emissione');
    expect(confirmByVoice(p, ok, { now: 1_005_000, screenVisible: true })).not.toBeNull();
    expect(confirmByVoice(p, ok, { now: 1_016_000, screenVisible: true })).toBeNull(); // scaduta
    expect(confirmByVoice(p, ok, { now: 1_005_000, screenVisible: false })).toBeNull(); // schermo non visibile
    expect(confirmByVoice(p, classifyCommand('conferma storno'), { now: 1_005_000, screenVisible: true })).toBeNull(); // azione diversa
  });
  it('"sì", "ok", "conferma", "va bene", "procedi" non confermano mai', () => {
    const p = pend();
    for (const t of ['sì', 'si', 'ok', 'okay', 'conferma', 'confermo', 'va bene', 'procedi', 'certo', 'emetti', 'emetti la fattura', 'vai']) {
      expect(confirmByVoice(p, classifyCommand(t), { now: 1_000_500, screenVisible: true }), t).toBeNull();
    }
  });
  it('frasi riconosciute con incertezza (n-best conflittuale o confidenza < 0.9) non confermano', () => {
    const p = pend();
    expect(confirmByVoice(p, { command: { type: 'confirm', what: 'issue' }, confidence: 0.7 }, { now: 1_000_500, screenVisible: true })).toBeNull();
    expect(confirmByVoice(p, { command: { type: 'confirm', what: 'issue' }, confidence: 0.97, alternatives: [{ command: SAMPLE.affirm, confidence: 0.4 }] }, { now: 1_000_500, screenVisible: true })).toBeNull();
  });
  it('il gettone è usa-e-getta, legato al comando e non falsificabile', () => {
    const p = pend();
    const t = confirmByHold(p, 1500, 1_000_100)!;
    expect(() => consumeConfirmation(undefined, SAMPLE.issue_invoice)).toThrow(ConfirmationRequiredError);
    expect(() => consumeConfirmation({ ...t } as never, SAMPLE.issue_invoice)).toThrow(ConfirmationRequiredError); // copia: non registrata
    expect(() => consumeConfirmation(t, SAMPLE.credit_note)).toThrow(ConfirmationRequiredError); // altro comando
    expect(() => consumeConfirmation(t, SAMPLE.issue_invoice)).not.toThrow();
    expect(() => consumeConfirmation(t, SAMPLE.issue_invoice)).toThrow(/già eseguita/); // idempotenza
  });
});

describe('proprietà sul corpus', () => {
  it('per nessuna frase del corpus un comando irreversibile arriva a "execute" o a "proceed" con confidenza bassa/ambigua', () => {
    for (const c of [...CORPUS, ...HELDOUT]) {
      const cl = classifyCommand(c.t);
      const d = decideIntent(cl);
      if (d.kind === 'proceed' && riskOf(d.command) === 'irreversible') {
        expect(cl.confidence, c.t).toBeGreaterThanOrEqual(0.8);
        expect(cl.alternatives ?? [], c.t).toHaveLength(0);
      }
      if (d.kind === 'proceed') expect(gate(d.command).kind === 'execute' && riskOf(d.command) === 'irreversible', c.t).toBe(false);
      if (d.kind === 'disambiguate') for (const o of d.options) expect(gate(o.command).kind === 'execute' && riskOf(o.command) === 'irreversible', c.t).toBe(false);
    }
  });
});
