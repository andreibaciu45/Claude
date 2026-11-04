import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { BLIND_SET } from './blind';
import { FINAL_SET } from './final';
import { format, runSet } from './runner';

describe('banco di prova cieco', () => {
  it('misura', () => {
    const r = runSet(BLIND_SET);
    const out = process.env.ENGINE_BENCH_OUT;
    const f = runSet(FINAL_SET);
    if (out) writeFileSync(out, format('CIECO', r) + '\n\n' + format('FINALE', f));
    expect(BLIND_SET.length).toBeGreaterThanOrEqual(250);
  });
});
