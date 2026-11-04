// Property test deterministico (PRNG con seed) del round-trip della bozza locale: serializza -> parsa == originale,
// per qualunque combinazione di numeri speciali (-0, NaN, ±Infinity, estremi), testi ostili e campi opzionali.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DocLine } from '../../types';
import { clearDraft, loadDraft, parseDraft, saveDraft, serializeDraft, type Draft } from './draft';

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const SPECIAL = [-0, 0, NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 1e21, 1e-7, 0.1 + 0.2, 22, 0.5];
const TEXTS = ['', 'Posa piastrelle', '{"$num":"NaN"}', '"quote" \\ backslash', 'àèìòù € 😀', 'riga\nnuova\ttab', '</script><b>x</b>', '$num', '\u0000nul', ' sep'];

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];
const num = (r: () => number): number => (r() < 0.35 ? pick(r, SPECIAL) : Math.round((r() - 0.3) * 1e6) / 100);

function randomDraft(r: () => number): Draft {
  const lines: DocLine[] = Array.from({ length: Math.floor(r() * 9) }, (_, i) => {
    const l: DocLine = { id: `l${i}`, description: pick(r, TEXTS), qty: num(r), unit: pick(r, ['pz', 'm', 'h', 'corpo']), unitPrice: num(r), vat: pick(r, [0, 4, 10, 22]) };
    if (r() < 0.4) l.discountPct = num(r);
    return l;
  });
  return {
    stage: r() < 0.5 ? 'input' : 'edit', type: r() < 0.5 ? 'preventivo' : 'fattura', transcript: pick(r, TEXTS),
    customer: { id: `c${Math.floor(r() * 9)}`, name: pick(r, TEXTS) }, lines, notes: pick(r, TEXTS), savedAt: Math.floor(r() * 2e12),
  };
}

/** toEqual tratta -0 == 0 e NaN == NaN: qui serve l'uguaglianza stretta (Object.is) su ogni numero. */
function expectSame(a: unknown, b: unknown, path = '$'): void {
  if (typeof a === 'number' || typeof b === 'number') { expect(Object.is(a, b), `${path}: ${String(a)} vs ${String(b)}`).toBe(true); return; }
  if (Array.isArray(a)) { expect(Array.isArray(b), path).toBe(true); expect((b as unknown[]).length, path).toBe(a.length); a.forEach((x, i) => expectSame(x, (b as unknown[])[i], `${path}[${i}]`)); return; }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a).sort(); const kb = Object.keys(b as object).sort();
    expect(kb, path).toEqual(ka);
    for (const k of ka) expectSame((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(b, path).toBe(a);
}

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe('bozza locale: round-trip su bozze casuali (seed fissi)', () => {
  it('serializeDraft -> parseDraft restituisce la bozza identica (numeri compresi -0, NaN, ±Infinity)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const d = randomDraft(rng(seed));
      expectSame(d, parseDraft(serializeDraft(d)), `seed ${seed}`);
    }
  });

  it('saveDraft -> loadDraft via localStorage è identico, e clearDraft svuota', () => {
    for (let seed = 1000; seed < 1060; seed++) {
      const d = randomDraft(rng(seed));
      saveDraft(d);
      expectSame(d, loadDraft(), `seed ${seed}`);
    }
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('la serializzazione è idempotente (parse -> serialize dà la stessa stringa)', () => {
    for (let seed = 2000; seed < 2100; seed++) {
      const s = serializeDraft(randomDraft(rng(seed)));
      expect(serializeDraft(parseDraft(s)!)).toBe(s);
    }
  });

  it('input corrotti non lanciano mai: restituiscono null', () => {
    const r = rng(9);
    const base = serializeDraft(randomDraft(rng(5)));
    for (let i = 0; i < 100; i++) {
      const cut = base.slice(0, Math.floor(r() * base.length));
      expect(() => parseDraft(cut)).not.toThrow();
    }
    for (const bad of ['', 'null', '[]', '{}', '{"lines":"x"}', '{"lines":[null],"customer":{}}', '{"lines":[],"customer":null}', '123']) expect(parseDraft(bad)).toBeNull();
  });
});
