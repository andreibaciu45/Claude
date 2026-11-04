// REV2-D1: la bozza locale proviene da localStorage (modificabile / vecchie versioni): la pagina non deve mai ricevere tipi sbagliati.
import { describe, expect, it } from 'vitest';
import { parseDraft, serializeDraft, type Draft } from './draft';

describe('parseDraft: forma minima valida ma campi mancanti o di tipo sbagliato', () => {
  it('campi mancanti -> valori di sicurezza (la pagina usa transcript.trim(), customer.name.trim(), lines.map)', () => {
    const d = parseDraft('{"lines":[],"customer":{}}')!;
    expect(typeof d.transcript).toBe('string');
    expect(typeof d.notes).toBe('string');
    expect(typeof d.customer.name).toBe('string');
    expect(typeof d.customer.id).toBe('string');
    expect(d.customer.id).not.toBe('');
    expect(d.stage).toBe('input');
    expect(d.type).toBe('preventivo');
  });

  it('tipi sbagliati (numeri al posto di stringhe, stringhe al posto di numeri, stage/type sconosciuti)', () => {
    const d = parseDraft(JSON.stringify({
      stage: 'boh', type: 'xxx', transcript: 5, notes: { a: 1 }, savedAt: 'ieri', customer: { id: 7, name: ['x'] },
      lines: [{ id: 3, description: null, qty: '2', unitPrice: 'abc', vat: null, unit: 9, discountPct: 'dieci' }],
    }))!;
    expect(d).toMatchObject({ stage: 'input', type: 'preventivo', transcript: '', notes: '', savedAt: 0 });
    expect(d.customer.name).toBe('');
    const l = d.lines[0];
    expect(typeof l.id).toBe('string');
    expect(l.description).toBe('');
    expect(l.unit).toBe('pz');
    expect([typeof l.qty, typeof l.unitPrice, typeof l.vat]).toEqual(['number', 'number', 'number']);
    expect(l.discountPct).toBeUndefined();
  });

  it('un cliente o una riga che è un array non è valido', () => {
    expect(parseDraft('{"lines":[],"customer":[]}')).toBeNull();
    expect(parseDraft('{"lines":[[]],"customer":{}}')).toBeNull();
  });

  it('una bozza valida resta identica (nessuna perdita, nemmeno di NaN/-0)', () => {
    const d: Draft = { stage: 'edit', type: 'fattura', transcript: 't', notes: 'n', savedAt: 5, customer: { id: 'c', name: 'Rossi', city: 'Roma' },
      lines: [{ id: 'a', description: 'x', qty: NaN, unit: 'pz', unitPrice: -0, vat: 22, discountPct: 10 }] };
    const b = parseDraft(serializeDraft(d))!;
    expect(Number.isNaN(b.lines[0].qty)).toBe(true);
    expect(Object.is(b.lines[0].unitPrice, -0)).toBe(true);
    expect(b).toMatchObject({ stage: 'edit', type: 'fattura', transcript: 't', customer: { name: 'Rossi', city: 'Roma' } });
  });
});
