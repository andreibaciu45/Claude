import { describe, expect, it } from 'vitest';
import { classifyCommand } from './intents';
import { decideIntent } from './policy';
import { ALL_EXAMPLES, EXAMPLE_GROUPS } from './examples';

describe('«Cosa posso dire?»: gli esempi sono frasi che il classificatore riconosce davvero', () => {
  it('8-10 esempi in gruppi: documenti, fatture, note di credito, incassi, ricerca', () => {
    expect(ALL_EXAMPLES.length).toBeGreaterThanOrEqual(8);
    expect(ALL_EXAMPLES.length).toBeLessThanOrEqual(10);
    expect(EXAMPLE_GROUPS.map((g) => g.title)).toEqual(['Documenti', 'Fatture', 'Note di credito', 'Incassi', 'Ricerca']);
  });
  for (const ex of ALL_EXAMPLES) {
    it(`«${ex.say}» -> ${ex.type}`, () => {
      const c = classifyCommand(ex.say);
      expect(c.command?.type).toBe(ex.type);
      expect(c.confidence).toBeGreaterThanOrEqual(0.8);
      // esattamente la frase mostrata: nessuna ambiguità che porti a "Intendevi…?"
      expect(decideIntent(c).kind).toBe('proceed');
    });
  }
});
