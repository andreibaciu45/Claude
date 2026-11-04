/**
 * Helper SOLO per i test UI: attende che il DOM si stabilizzi (stesso HTML per `stable` controlli consecutivi),
 * invece di un numero fisso di "tick". Le attese fisse sono la causa tipica dei test che passano da soli e falliscono
 * a macchina carica (IndexedDB finto, promise concatenate): qui si aspetta lo stato, con un tetto di sicurezza.
 */
import { act } from 'react';

export async function settleUi(opts: { stable?: number; stepMs?: number; maxMs?: number; minTicks?: number } = {}): Promise<void> {
  const { stable = 3, stepMs = 10, maxMs = 8000, minTicks = 12 } = opts;
  const end = Date.now() + maxMs;
  let prev = '';
  let same = 0;
  for (let i = 0; ; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, i < minTicks ? 0 : stepMs)); });
    const cur = document.body.innerHTML;
    same = cur === prev ? same + 1 : 0;
    prev = cur;
    if (i >= minTicks && same >= stable) return;
    if (Date.now() > end) return; // tetto: non blocca mai la suite, sarà l'asserzione a dire cosa manca
  }
}
