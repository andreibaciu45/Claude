/**
 * Esempi mostrati in "Cosa posso dire?". Devono essere frasi che il classificatore riconosce davvero:
 * `examples.test.ts` le esegue contro `classifyCommand` (tipo atteso, confidenza >= 0.8, nessuna ambiguità).
 */
import type { CommandType } from './types';

export interface VoiceExample { say: string; type: CommandType; note?: string }
export interface VoiceExampleGroup { title: string; items: VoiceExample[] }

export const EXAMPLE_GROUPS: VoiceExampleGroup[] = [
  {
    title: 'Documenti',
    items: [
      { say: 'Nuovo preventivo per Rossi, tre metri di tubo rame', type: 'new_document' },
      { say: 'Converti il preventivo 8 in fattura', type: 'convert_quote' },
    ],
  },
  {
    title: 'Fatture',
    items: [
      { say: 'Nuova fattura per Bianchi, due ore di manodopera', type: 'new_document' },
      { say: 'Emetti la fattura', type: 'issue_invoice', note: 'Chiede sempre una conferma esplicita' },
    ],
  },
  {
    title: 'Note di credito',
    items: [
      { say: 'Fai la nota di credito della fattura 9', type: 'credit_note', note: 'Chiede sempre una conferma esplicita' },
      { say: 'Emetti una nota di credito per la fattura 3', type: 'credit_note', note: 'Chiede sempre una conferma esplicita' },
    ],
  },
  {
    title: 'Incassi',
    items: [
      { say: 'Segna la fattura 12 come pagata', type: 'mark_paid' },
      { say: 'Segna come incassata la fattura dodici', type: 'mark_paid' },
    ],
  },
  {
    title: 'Ricerca',
    items: [
      { say: 'Apri l’ultimo preventivo', type: 'open' },
      { say: 'Mostra le fatture di Rossi', type: 'list' },
    ],
  },
];

export const ALL_EXAMPLES: VoiceExample[] = EXAMPLE_GROUPS.flatMap((g) => g.items);
