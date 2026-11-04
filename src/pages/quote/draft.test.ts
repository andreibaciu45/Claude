import { beforeEach, describe, expect, it } from 'vitest';
import type { DocLine } from '../../types';
import { clearDraft, loadDraft, parseDraft, saveDraft, serializeDraft, type Draft } from './draft';

const line = (id: string, over: Partial<DocLine> = {}): DocLine => ({ id, description: `Riga ${id}`, qty: 1, unit: 'pz', unitPrice: 10, vat: 22, ...over });
const draft = (lines: DocLine[]): Draft => ({ stage: 'edit', type: 'fattura', transcript: 'sconto', customer: { id: 'c', name: 'Rossi' }, lines, notes: '', savedAt: 1 });

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe('bozza locale: round-trip', () => {
  it('una riga di sconto con importo -0 conserva il segno', () => {
    const d = draft([line('s', { description: 'Sconto', unitPrice: -0 })]);
    expect(Object.is(d.lines[0].unitPrice, -0)).toBe(true);
    // il difetto originale: JSON.stringify scrive "0"
    expect(Object.is(JSON.parse(JSON.stringify(d)).lines[0].unitPrice, -0)).toBe(false);
    saveDraft(d);
    const back = loadDraft()!;
    expect(Object.is(back.lines[0].unitPrice, -0)).toBe(true);
    expect(Object.is(parseDraft(serializeDraft(d))!.lines[0].unitPrice, -0)).toBe(true);
  });

  it('NaN, Infinity, -Infinity e -0 in qualunque campo numerico', () => {
    const d = draft([line('a', { qty: NaN, unitPrice: Infinity, vat: -Infinity, discountPct: -0 })]);
    const b = parseDraft(serializeDraft(d))!.lines[0];
    expect(Number.isNaN(b.qty)).toBe(true);
    expect(b.unitPrice).toBe(Infinity);
    expect(b.vat).toBe(-Infinity);
    expect(Object.is(b.discountPct, -0)).toBe(true);
  });

  it('valori enormi, minuscoli e normali restano identici', () => {
    const vals = [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, -123456.789, 0, 1e21, 1e-7, 0.1 + 0.2];
    const d = draft(vals.map((v, i) => line(`v${i}`, { unitPrice: v, qty: v })));
    const b = parseDraft(serializeDraft(d))!;
    b.lines.forEach((l, i) => { expect(Object.is(l.unitPrice, vals[i])).toBe(true); expect(Object.is(l.qty, vals[i])).toBe(true); });
    expect(b).toEqual(d);
  });

  it('testi, cliente e date passano invariati (anche testo che somiglia al marcatore)', () => {
    const d = draft([line('a', { description: '{"$num":"NaN"} "quote" \\ àèì 😀\n' })]);
    d.notes = '$num';
    d.customer = { id: 'c', name: '$num', address: '{"$num":"-0"}' } as never;
    const b = parseDraft(serializeDraft(d))!;
    expect(b.lines[0].description).toBe(d.lines[0].description);
    expect(b.notes).toBe('$num');
    expect(b.customer.name).toBe('$num');
    expect(b.customer.address).toBe('{"$num":"-0"}');
  });

  it('compatibile con le bozze salvate dalla versione precedente (JSON semplice)', () => {
    const old = JSON.stringify(draft([line('a', { unitPrice: -5 })]));
    expect(parseDraft(old)!.lines[0].unitPrice).toBe(-5);
    localStorage.setItem('vocepreventivo:draft:v1', old);
    expect(loadDraft()!.lines[0].id).toBe('a');
  });

  it('dati corrotti o non validi: null, nessuna eccezione', () => {
    for (const raw of ['', '{', 'null', '[]', '{"lines":5,"customer":{}}', '{"lines":[],"customer":null}', '{"lines":[null],"customer":{}}', '{"lines":[],"customer":"x"}']) {
      expect(parseDraft(raw)).toBeNull();
    }
    localStorage.setItem('vocepreventivo:draft:v1', '{rotto');
    expect(loadDraft()).toBeNull();
  });

  it('clearDraft svuota; localStorage che lancia non rompe nulla', () => {
    saveDraft(draft([line('a')]));
    clearDraft();
    expect(loadDraft()).toBeNull();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try { expect(() => saveDraft(draft([]))).not.toThrow(); } finally { Storage.prototype.setItem = orig; }
  });
});
