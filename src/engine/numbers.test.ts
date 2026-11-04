import { describe, expect, it } from 'vitest';
import { matchCatalog, normalizeText, parseItalianNumber } from './index';
import { SAMPLE_CATALOG } from './fixtures';

describe('parseItalianNumber', () => {
  it.each([
    ['zero', 0], ['uno', 1], ['un', 1], ['una', 1], ['due', 2], ['sedici', 16], ['diciassette', 17], ['venti', 20],
    ['ventuno', 21], ['ventitre', 23], ['ventitré', 23], ['ventotto', 28], ['trentuno', 31], ['novantanove', 99],
    ['cento', 100], ['centouno', 101], ['centotto', 108], ['centoventi', 120], ['centottanta', 180], ['duecento', 200],
    ['novecentonovantanove', 999], ['mille', 1000], ['milleuno', 1001], ['duemila', 2000], ['duemilacinquecento', 2500],
    ['mille e cinquecento', 1500], ['cento venti', 120], ['venti cinque', 25], ['due mila', 2000], ['venti mila', 20000],
    ['mezzo', 0.5], ['mezza', 0.5], ['un paio', 2], ['un paio di', null], ['una decina', 10], ['una dozzina', 12],
    ['due virgola cinque', 2.5], ['uno virgola venticinque', 1.25], ['zero virgola cinque', 0.5], ['tre punto due', 3.2],
    ['due virgola zero cinque', 2.05], ['due e mezzo', 2.5], ['2,5', 2.5], ['2.5', 2.5], ['16', 16], ['1.500', 1500],
    ['1.500,50', 1500.5], ['0,5', 0.5], ['ciao', null], ['', null], ['tre cani', null],
  ])('%s -> %s', (s, n) => {
    expect(parseItalianNumber(s)).toBe(n);
  });
  it('non fonde numeri distinti', () => {
    expect(parseItalianNumber('sedici dodici')).toBeNull();
    expect(parseItalianNumber('due tre')).toBeNull();
  });
});

describe('normalizeText', () => {
  it.each([
    ['Due virgola cinque metri quadri di Cavo', '2.5 mq di cavo'],
    ['TRE METRI DI TUBO', '3 m di tubo'],
    ['Quattro ore, di Manodopera!', '4 h di manodopera'],
    ['mezza giornata', '0.5 gg'],
    ['16mm', '16 mm'],
    ['dieci emme cubi', '10 mc'],
    ['Perché è così', 'perche è cosi'],
  ])('%s', (a, b) => {
    expect(normalizeText(a)).toBe(b);
  });
});

describe('matchCatalog', () => {
  it('trova la voce giusta e rifiuta il non correlato', () => {
    expect(matchCatalog('tubo rame sedici', SAMPLE_CATALOG)?.item.id).toBe('tubo-rame-16');
    expect(matchCatalog('tubo rame 22', SAMPLE_CATALOG)?.item.id).toBe('tubo-rame-22');
    expect(matchCatalog('lavatrice', SAMPLE_CATALOG)).toBeNull();
    expect(matchCatalog('', SAMPLE_CATALOG)).toBeNull();
    expect(matchCatalog('tubo', [])).toBeNull();
  });
  it('segnala ambiguità quando 16 e 22 sono indistinguibili', () => {
    expect(matchCatalog('tubo rame', SAMPLE_CATALOG)?.ambiguous).toBe(true);
    expect(matchCatalog('tubo rame sedici', SAMPLE_CATALOG)?.ambiguous).toBe(false);
  });
});
