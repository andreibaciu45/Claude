import { describe, expect, it } from 'vitest';
import { classifyCommand } from './classify';
import { CORPUS, type CorpusCase } from './corpus';
import { HELDOUT } from './corpus-heldout';

const IRREVERSIBLE = new Set(['issue_invoice', 'credit_note']);

function subset(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) => subset((actual as Record<string, unknown>)[k], v));
  }
  if (typeof expected === 'string' && typeof actual === 'string') return actual.toLowerCase() === expected.toLowerCase();
  return actual === expected;
}

function judge(c: CorpusCase): { ok: boolean; why?: string } {
  const r = classifyCommand(c.t, c.ctx ?? {});
  if (c.kind === 'pos') {
    if (!r.command) return { ok: false, why: `nessun comando (atteso ${c.type})` };
    if (r.command.type !== c.type) return { ok: false, why: `tipo ${r.command.type} (atteso ${c.type})` };
    if (r.confidence < 0.8) return { ok: false, why: `confidenza ${r.confidence} < 0.8` };
    if (c.args && !subset(r.command, c.args)) return { ok: false, why: `argomenti ${JSON.stringify(r.command)} (attesi ${JSON.stringify(c.args)})` };
    return { ok: true };
  }
  if (c.kind === 'neg') return r.command === null ? { ok: true } : { ok: false, why: `comando inatteso ${JSON.stringify(r)}` };
  // ambigua: mai irreversibile con confidenza alta
  if (r.command && IRREVERSIBLE.has(r.command.type) && r.confidence >= 0.8) return { ok: false, why: `irreversibile con conf ${r.confidence}` };
  if (r.command && r.confidence >= 0.8) return { ok: false, why: `troppo sicura (${r.confidence}) ${r.command.type}` };
  return { ok: true };
}

function runAll(set: CorpusCase[]) {
  const results = set.map((c) => ({ c, ...judge(c) }));
  const ok = results.filter((r) => r.ok).length;
  return { results, ok, acc: ok / Math.max(1, set.length), fails: results.filter((r) => !r.ok) };
}

describe('set cieco (generalizzazione)', () => {
  it('misura e stampa l\'accuratezza', () => {
    const r = runAll(HELDOUT);
    // eslint-disable-next-line no-console
    console.log(`[heldout] ${HELDOUT.length} frasi: accuratezza ${(r.acc * 100).toFixed(1)}% (${r.ok}/${HELDOUT.length})` + (r.fails.length ? `\n  errori:\n${r.fails.map((f) => `   - "${f.c.t}": ${f.why}`).join('\n')}` : ''));
    expect(r.acc).toBeGreaterThanOrEqual(0.95);
    // sicurezza: nessun irreversibile sicuro in casi non positivi
    for (const f of r.fails) expect(f.why ?? '', f.c.t).not.toMatch(/irreversibile/);
  });
});

describe('corpus classificatore comandi', () => {
  const results = CORPUS.map((c) => ({ c, ...judge(c) }));
  const by = (k: CorpusCase['kind']) => results.filter((r) => r.c.kind === k);
  const acc = (rs: typeof results) => (rs.filter((r) => r.ok).length / Math.max(1, rs.length));

  it('ha almeno 80 frasi tra positive, negative e ambigue', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(80);
    expect(by('pos').length).toBeGreaterThan(50);
    expect(by('neg').length).toBeGreaterThanOrEqual(10);
    expect(by('amb').length).toBeGreaterThanOrEqual(10);
  });

  it('accuratezza misurata e soglie minime', () => {
    const fails = results.filter((r) => !r.ok);
    // eslint-disable-next-line no-console
    console.log(
      `[corpus] totale ${CORPUS.length}: accuratezza ${(acc(results) * 100).toFixed(1)}% | positive ${(acc(by('pos')) * 100).toFixed(1)}% (${by('pos').length}) | negative ${(acc(by('neg')) * 100).toFixed(1)}% (${by('neg').length}) | ambigue ${(acc(by('amb')) * 100).toFixed(1)}% (${by('amb').length})` +
        (fails.length ? `\n  errori:\n${fails.map((f) => `   - "${f.c.t}": ${f.why}`).join('\n')}` : ''),
    );
    expect(acc(results)).toBeGreaterThanOrEqual(0.93);
    expect(acc(by('pos'))).toBeGreaterThanOrEqual(0.93);
    expect(acc(by('neg'))).toBeGreaterThanOrEqual(0.9);
  });

  it('nessuna frase (di qualunque tipo) produce un comando irreversibile con confidenza >= 0.8 se non è un comando chiaro', () => {
    for (const r of results.filter((x) => x.c.kind !== 'pos')) {
      const out = classifyCommand(r.c.t);
      if (out.command && IRREVERSIBLE.has(out.command.type)) expect(out.confidence, r.c.t).toBeLessThan(0.8);
    }
  });
});
