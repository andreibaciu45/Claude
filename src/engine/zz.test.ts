import { it } from 'vitest';
import { lex } from './text';
import { extractCustomer } from './customer';
import { createMatcher } from './match';
import { DEFAULT_CATALOG } from './cases';
it('d', () => {
  const m = createMatcher(DEFAULT_CATALOG);
  const r = extractCustomer(lex('lavori per la famiglia Mancini due prese'), (w) => m.vocab.has(w));
  console.log(JSON.stringify(r.name), r.rest.map(t=>t.w).join(' '));
});
