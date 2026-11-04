import { describe, expect, it } from 'vitest';
import { buildItems, guessMapping, itemsToCsv, parseCsv, parseNumber } from './csv';
import { sampleItems } from './samples';

describe('csv', () => {
  it('parsa ; con decimali a virgola', () => {
    const rows = parseCsv('nome;prezzo;unita;iva\r\n"Tubo; rame";1.234,50;mt;10\r\nX;abc;pz;22\r\n');
    expect(rows[1][0]).toBe('Tubo; rame');
    const map = guessMapping(rows[0]);
    const res = buildItems(rows, map, 22, 1);
    expect(res[0].item).toMatchObject({ name: 'Tubo; rame', price: 1234.5, unit: 'm', vat: 10 });
    expect(res[1].errors).toContain('prezzo non valido');
  });
  it('parsa , e numeri', () => {
    expect(parseCsv('a,b\n1,2')[1]).toEqual(['1', '2']);
    expect(parseNumber('12,5 €')).toBe(12.5);
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber('x')).toBeNull();
  });
  it('round-trip export/import', () => {
    const items = sampleItems('idraulico');
    expect(items).toHaveLength(20);
    const rows = parseCsv(itemsToCsv(items));
    const res = buildItems(rows, guessMapping(rows[0]), 22, 1);
    expect(res.every((r) => r.item)).toBe(true);
    expect(res[2].item?.price).toBe(items[2].price);
    expect(res[0].item?.aliases).toEqual(items[0].aliases);
  });
  it('20 voci per ogni mestiere', () => {
    for (const t of ['elettricista', 'imbianchino'] as const) expect(sampleItems(t)).toHaveLength(20);
  });
});
