import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../types';
import { levBounded, matchCatalog } from './match';
import { levenshtein } from './text';
import { DEFAULT_CATALOG } from './cases';

describe('levBounded', () => {
  it('coincide con Levenshtein entro la soglia, e oltre restituisce max+1', () => {
    const words = ['rame', 'rami', 'ramo', 'tubo', 'tubi', 'rubinetto', 'rubinneto', 'rubinetti', 'sifone', 'sifonne', 'caldaia', 'caldaie', 'caldaja', 'condensazione', 'condensazzione', 'salvavita', 'salvvita', 'a', 'ab', '', 'multistrato', 'multistratto', 'montaggio', 'smontaggio'];
    for (const a of words) for (const b of words) for (const max of [1, 2]) {
      const d = levenshtein(a, b);
      const e = levBounded(a, b, max);
      expect(e, `${a}/${b}/${max}`).toBe(d <= max ? d : max + 1);
    }
  });
  it('proprietà su stringhe casuali', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const rs = (n: number) => Array.from({ length: n }, () => 'abcde'[Math.floor(rnd() * 5)]).join('');
    for (let i = 0; i < 400; i++) {
      const a = rs(Math.floor(rnd() * 10));
      const b = rs(Math.floor(rnd() * 10));
      const d = levenshtein(a, b);
      for (const max of [1, 2, 3]) expect(levBounded(a, b, max)).toBe(d <= max ? d : max + 1);
    }
  });
});

describe('matchCatalog', () => {
  it('la s privativa non confonde (smontaggio != montaggio, scarico != carico)', () => {
    const mk = (id: string, name: string): CatalogItem => ({ id, name, aliases: [], unit: 'pz', price: 1, vat: 22, kind: 'servizio', createdAt: 0, updatedAt: 0 });
    const cat = [mk('a', 'Montaggio finestra'), mk('b', 'Smontaggio finestra')];
    expect(matchCatalog('smontaggio finestre', cat)?.item.id).toBe('b');
    expect(matchCatalog('montaggio finestre', cat)?.item.id).toBe('a');
  });
  it('restituisce il prezzo del catalogo passato, non quello dell\'indice in cache', () => {
    matchCatalog('un sifone', DEFAULT_CATALOG);
    const changed = DEFAULT_CATALOG.map((x) => (x.id === 'sifone' ? { ...x, price: 77 } : x));
    expect(matchCatalog('un sifone', changed)?.item.price).toBe(77);
  });
  it('nulla di plausibile = null', () => {
    expect(matchCatalog('lavatrice samsung', DEFAULT_CATALOG)).toBeNull();
  });
});
