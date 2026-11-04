import { describe, expect, it } from 'vitest';
import { bigCatalog } from './bench/bigCatalog';
import { CAT_ELETTRICISTA } from './bench/catalogs';
import { DEFAULT_CATALOG } from './cases';
import { computeTotals, MAX_TRANSCRIPT_CHARS, parseDictation, parseDictationWithContext, type ParseResultV2 } from './index';

const P = (t: string, c = DEFAULT_CATALOG) => parseDictation(t, c) as ParseResultV2;
const noMarkup = (s: string) => !/[<>&"`]/.test(s);
const allStrings = (r: ParseResultV2): string[] => [r.customerName ?? '', ...r.lines.map((l) => l.description), ...r.leftovers, ...(r.warnings ?? [])];

describe('robustezza: input degeneri', () => {
  it('vuoto, spazi, solo punteggiatura', () => {
    for (const t of ['', '   ', '\n\t', ';;;,,,...!!!', '— — —']) {
      expect(P(t)).toEqual({ lines: [], leftovers: [] });
    }
  });
  it('tipi sbagliati non lanciano', () => {
    for (const t of [undefined, null, 0, {}, []] as never[]) expect(() => parseDictation(t, DEFAULT_CATALOG)).not.toThrow();
    expect(() => parseDictation('due prese', undefined as never)).not.toThrow();
    expect(() => parseDictation('due prese', null as never)).not.toThrow();
    expect(() => parseDictation('due prese', [null, undefined, { id: 5 }] as never)).not.toThrow();
    expect(parseDictation('due prese', []).lines[0].description.toLowerCase()).toContain('prese');
  });
  it('catalogo con voci incomplete (senza alias, alias non stringhe)', () => {
    const cat = [{ id: 'a', name: 'Presa', unit: 'pz', price: 5, vat: 22, kind: 'materiale', createdAt: 0, updatedAt: 0 } as never, { id: 'b', name: 'Cavo', aliases: [null, 7, 'filo'], unit: 'm', price: 1, vat: 22, kind: 'materiale', createdAt: 0, updatedAt: 0 } as never];
    expect(() => parseDictation('due prese e tre metri di filo', cat)).not.toThrow();
  });
  it('testo lunghissimo (10.000 caratteri) senza errori e con righe coerenti', () => {
    const unit = 'due prese tre interruttori sei faretti led venti metri di cavo 2,5 ';
    const text = unit.repeat(Math.ceil(10000 / unit.length)).slice(0, 10000);
    const t0 = performance.now();
    const r = P(text, CAT_ELETTRICISTA);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.lines.length).toBeGreaterThan(100);
    expect(r.lines.every((l) => Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.unitPrice))).toBe(true);
    expect(new Set(r.lines.map((l) => l.id)).size).toBe(r.lines.length);
  });
  it('oltre il limite il testo è troncato con avviso', () => {
    const r = P('due prese '.repeat(MAX_TRANSCRIPT_CHARS / 5));
    expect(r.warnings?.join(' ')).toMatch(/lungo/);
  });
  it('un solo token lunghissimo', () => {
    expect(() => P('a'.repeat(10000))).not.toThrow();
    expect(() => P('9'.repeat(10000) + ' metri di cavo')).not.toThrow();
  });
  it('catalogo da 2000 voci + testo lungo', () => {
    const big = bigCatalog(2000);
    const text = ('per il signor Rossi tre metri di tubo rame sedici dodici raccordi a gomito quattro ore di manodopera '.repeat(100)).slice(0, 10000);
    const t0 = performance.now();
    const r = parseDictation(text, big);
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(r.lines.length).toBeGreaterThan(50);
  });
});

describe('robustezza: caratteri speciali, emoji, markup', () => {
  it('emoji e simboli sono ignorati', () => {
    const r = P('😀 tre metri di tubo rame sedici 🔧🔧 due prese ❤️');
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['tubo-rame-16', 3], ['presa', 2]]);
  });
  it('unicode strano non lancia', () => {
    for (const t of ['tre pręse ünïcode', '〇〇 ٣ prese', '\u0000\u0001 prese', 'ǅ ǈ ǋ', '𝕡𝕣𝕖𝕤𝕖 due', ' due prese', "d'''''angelo", "'"]) {
      expect(() => P(t)).not.toThrow();
    }
  });
  it('HTML/JS nel dettato non viene mai riportato come markup', () => {
    const attacks = [
      '<script>alert(1)</script> per <b>Mario</b> Rossi tre prese <img src=x onerror=alert(1)>',
      'per <svg/onload=alert(1)> due prese "><script>alert(2)</script>',
      "cliente <a href='javascript:alert(1)'>Rossi</a> tre prese",
      'due prese &lt;b&gt;grassetto&lt;/b&gt; &amp; &quot;',
      '{{constructor.constructor("alert(1)")()}} tre prese ${process.env.SECRET}',
      '`rm -rf /` due prese; DROP TABLE clienti;--',
    ];
    for (const a of attacks) {
      const r = P(a);
      for (const s of allStrings(r)) expect(noMarkup(s), `"${s}" da "${a}"`).toBe(true);
    }
  });
  it('anche con rubrica e catalogo con markup, il testo dettato resta pulito', () => {
    const r = parseDictationWithContext('per <i>Rossi</i> due prese', DEFAULT_CATALOG, { customers: [{ id: '1', name: 'Mario Rossi' }] });
    for (const s of allStrings(r)) expect(noMarkup(s)).toBe(true);
  });
});

describe('robustezza: numeri estremi', () => {
  const sane = (r: ParseResultV2) =>
    r.lines.every((l) => Number.isFinite(l.qty) && l.qty > 0 && l.qty <= 1e7 && Number.isFinite(l.unitPrice) && l.unitPrice <= 1e7 && Number.isFinite(l.vat));
  it('numeri enormi: limitati e segnalati', () => {
    for (const t of ['99999999999999999999 prese', '9'.repeat(400) + ' metri di cavo 2,5', 'novecentonovantanove mila miliardi di prese', 'una caldaia vaillant a 99999999999999999 euro']) {
      const r = P(t);
      expect(sane(r), t).toBe(true);
      expect(r.lines.some((l) => l.needsReview), t).toBe(true);
    }
    expect(P('99999999999999999999 prese').warnings?.join(' ')).toMatch(/enorme/);
  });
  it('quantità negative: valore assoluto + revisione + avviso', () => {
    for (const t of ['meno cinque metri di cavo 2,5', '-5 prese', 'tre prese e -2 faretti']) {
      const r = P(t);
      expect(r.lines.every((l) => l.qty > 0), t).toBe(true);
      expect(r.lines.some((l) => l.needsReview), t).toBe(true);
    }
    expect(P('-5 prese').warnings?.join(' ')).toMatch(/negativa/);
  });
  it('zero e NaN', () => {
    expect(P('zero prese').lines[0]).toMatchObject({ qty: 1, needsReview: true });
    expect(P('0 metri di cavo').lines[0]).toMatchObject({ qty: 1, needsReview: true });
    const r = P('NaN prese Infinity metri undefined null');
    expect(sane(r)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|null/i.source === 'x' ? /$^/ : /"(qty|unitPrice|vat)":(null|"NaN")/);
  });
  it('i risultati alimentano computeTotals senza NaN', () => {
    for (const t of ['99999999999999999999 prese a 99999999999999999999 euro', '-5 prese sconto 99999999999 euro', 'due prese sconto del 500 per cento', '3 prese iva al 100']) {
      const r = P(t);
      const tot = computeTotals(r.lines, { forfettario: false, type: 'preventivo' });
      expect(Number.isFinite(tot.net) && Number.isFinite(tot.vat) && Number.isFinite(tot.gross), t).toBe(true);
    }
  });
  it('sconto in percentuale oltre il 100 è limitato', () => {
    const r = P('due prese sconto del 500 per cento');
    expect(r.lines.every((l) => (l.discountPct ?? 0) <= 100)).toBe(true);
  });
  it('sconto in euro enorme non rompe i totali', () => {
    const r = P('due prese sconto 99999999999999 euro');
    expect(r.lines.every((l) => Number.isFinite(l.unitPrice))).toBe(true);
  });
  it('decimali strani', () => {
    expect(() => P('1,2,3,4 prese')).not.toThrow();
    expect(() => P('1.000.000.000 prese')).not.toThrow();
    expect(() => P('0,0000001 metri di cavo')).not.toThrow();
  });
});

describe('proprietà generali delle righe', () => {
  const phrases = [
    'per Mario Rossi tre metri di tubo rame sedici, dodici raccordi a gomito e quattro ore di manodopera',
    'tinteggiare soggiorno 50 mq e camera 30 mq due mani sconto 10% iva al dieci',
    'quattro prese tre interruttori cavo 4 venti metri a corpo 100 euro',
    'e e e e', 'a corpo', '€ 100', 'per per per', 'cliente', 'virgola', 'mezzo',
  ];
  it('id unici, valori finiti, descrizioni non vuote, unità valide', () => {
    const units = new Set(['pz', 'm', 'mq', 'mc', 'kg', 'l', 'h', 'gg', 'corpo']);
    for (const p of phrases) {
      const r = P(p);
      expect(new Set(r.lines.map((l) => l.id)).size, p).toBe(r.lines.length);
      for (const l of r.lines) {
        expect(l.description.trim().length, p).toBeGreaterThan(0);
        expect(units.has(l.unit), p).toBe(true);
        expect(Number.isFinite(l.qty) && Number.isFinite(l.unitPrice) && Number.isFinite(l.vat), p).toBe(true);
      }
    }
  });
  it('non muta catalogo, rubrica né oggetti in ingresso', () => {
    const cat = JSON.stringify(DEFAULT_CATALOG);
    const cust = [{ id: '1', name: 'Mario Rossi' }];
    const custS = JSON.stringify(cust);
    parseDictationWithContext('per Rossi tinteggiare soggiorno 50 mq e camera 30 mq sconto 10%', DEFAULT_CATALOG, { customers: cust });
    expect(JSON.stringify(DEFAULT_CATALOG)).toBe(cat);
    expect(JSON.stringify(cust)).toBe(custS);
  });
  it('deterministico (a parte gli id)', () => {
    const strip = (t: string) => JSON.stringify(P(t).lines.map(({ id: _i, ...x }) => x));
    for (const p of phrases) expect(strip(p)).toBe(strip(p));
  });
});
