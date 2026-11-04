import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../types';
import {
  __resetConsumedForTests, CARD_MAX_LIFETIME_MS, confirmByHold, confirmByTap, confirmByVoice, consumeConfirmation, ConfirmationRequiredError,
  createConfirmation, VOICE_CONFIRM_TTL_MS, type ConfirmSummary,
} from './index';

const issue: Command = { type: 'issue_invoice', ref: { kind: 'number', number: 12 } };
const paid: Command = { type: 'mark_paid', ref: { kind: 'number', number: 12 } };
const FULL: ConfirmSummary = {
  headline: 'Emettere?', fields: [{ label: 'Documento', value: 'Fattura' }, { label: 'Cliente', value: 'Rossi' }, { label: 'Importo', value: '€ 1,00' }], warnings: [],
};
beforeEach(() => __resetConsumedForTests());

describe('scadenza e uso unico dei gettoni di conferma', () => {
  it('la scheda scade dopo CARD_MAX_LIFETIME_MS: né pressione prolungata né tocco generano più un gettone', () => {
    const p = createConfirmation(issue, FULL, 0);
    expect(confirmByHold(p, 1500, CARD_MAX_LIFETIME_MS - 1)).not.toBeNull();
    expect(confirmByHold(p, 1500, CARD_MAX_LIFETIME_MS + 1)).toBeNull();
    const t = createConfirmation(paid, FULL, 0);
    expect(confirmByTap(t, CARD_MAX_LIFETIME_MS - 1)).not.toBeNull();
    expect(confirmByTap(t, CARD_MAX_LIFETIME_MS + 1)).toBeNull();
  });
  it('la frase vocale vale solo entro VOICE_CONFIRM_TTL_MS dalla comparsa della scheda', () => {
    const p = createConfirmation(issue, FULL, 0);
    const heard = { command: { type: 'confirm', what: 'issue' } as Command, confidence: 0.97 };
    expect(confirmByVoice(p, heard, { now: VOICE_CONFIRM_TTL_MS - 1, screenVisible: true })).not.toBeNull();
    expect(confirmByVoice(p, heard, { now: VOICE_CONFIRM_TTL_MS + 1, screenVisible: true })).toBeNull();
  });
  it('un gettone si consuma una sola volta, anche se la scheda genera più gettoni (doppio tocco / doppia frase)', () => {
    const p = createConfirmation(issue, FULL, 0);
    const a = confirmByHold(p, 1500, 10)!;
    const b = confirmByHold(p, 1500, 20)!; // stessa scheda, stessa idempotencyKey
    expect(() => consumeConfirmation(a, issue)).not.toThrow();
    expect(() => consumeConfirmation(a, issue)).toThrow(ConfirmationRequiredError);
    expect(() => consumeConfirmation(b, issue)).toThrow(/già eseguita/);
  });
  it('un gettone non vale per un altro comando né per un riferimento diverso', () => {
    const t = confirmByHold(createConfirmation(issue, FULL, 0), 1500, 10)!;
    expect(() => consumeConfirmation(t, { type: 'issue_invoice', ref: { kind: 'number', number: 13 } })).toThrow(ConfirmationRequiredError);
    expect(() => consumeConfirmation(t, issue)).not.toThrow();
  });
});
