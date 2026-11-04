import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../types';
import { CAT_ELETTRICISTA, CAT_IMBIANCHINO, CAT_SERRAMENTISTA } from './bench/catalogs';
import { DEFAULT_CATALOG } from './cases';
import { parseDictation, type ParseResultV2 } from './index';
import { computeTotals } from './index';

const P = (t: string, c: CatalogItem[] = DEFAULT_CATALOG) => parseDictation(t, c) as ParseResultV2;
const mk = (id: string, name: string, unit: CatalogItem['unit'], price = 10, kind: CatalogItem['kind'] = 'materiale', aliases: string[] = []): CatalogItem => ({
  id, name, aliases, unit, price, vat: 22, kind, createdAt: 0, updatedAt: 0,
});

describe('stessa voce su più righe -> righe distinte con nota', () => {
  it('tinteggiare soggiorno 50 mq e camera 30 mq', () => {
    const r = P('tinteggiare soggiorno 50 mq e camera 30 mq');
    expect(r.lines.map((l) => [l.catalogItemId, l.qty, l.unit])).toEqual([['tinteggiatura', 50, 'mq'], ['tinteggiatura', 30, 'mq']]);
    expect(r.lines[0].description).toMatch(/soggiorno/);
    expect(r.lines[1].description).toMatch(/camera/);
    expect(r.lineMeta![r.lines[0].id].note).toBe('soggiorno');
    expect(r.lineMeta![r.lines[1].id].note).toBe('camera');
    expect(r.leftovers).toEqual([]);
  });
  it('"le pareti del soggiorno ... e della camera"', () => {
    const r = P('tinteggiare le pareti del soggiorno cinquanta mq e della camera trenta mq', CAT_IMBIANCHINO);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['m-tint-pareti', 50], ['m-tint-pareti', 30]]);
    expect(r.lines[1].description).toMatch(/camera/);
  });
  it('tre stanze senza congiunzioni', () => {
    const r = P('tinteggiatura salone 60 mq camera da letto 25 mq bagno 10 mq', CAT_IMBIANCHINO);
    expect(r.lines.map((l) => l.qty)).toEqual([60, 25, 10]);
    expect(new Set(r.lines.map((l) => l.catalogItemId)).size).toBe(1);
    expect(r.lines[1].description).toMatch(/camera da letto/);
  });
  it('senza note distintive non inventa note', () => {
    const r = P('due prese e tre prese');
    expect(r.lines.every((l) => !/\(/.test(l.description))).toBe(true);
  });
  it('una sola riga per voce: nessuna nota sul luogo', () => {
    const r = P('tinteggiatura appartamento 80 mq', CAT_IMBIANCHINO);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].description).toBe('Tinteggiatura pareti');
  });
});

describe('"N mani" annotate, quantità invariata', () => {
  it('due mani', () => {
    const r = P('quaranta metri quadri di tinteggiatura due mani');
    expect(r.lines[0].qty).toBe(40);
    expect(r.lineMeta![r.lines[0].id].coats).toBe(2);
    expect(r.lines[0].description).toMatch(/2 mani/);
    expect(r.leftovers).toEqual([]);
  });
  it('si attacca alla riga che la precede, non a quella dopo', () => {
    const r = P('dipingere cucina quaranta metri quadri due mani, dieci litri di idropittura');
    expect(r.lineMeta![r.lines[0].id].coats).toBe(2);
    expect(r.lineMeta![r.lines[1].id]?.coats).toBeUndefined();
  });
  it('una mano al singolare', () => {
    const r = P('trenta metri quadri di tinteggiatura una mano');
    expect(r.lines[0].description).toMatch(/1 mano/);
  });
});

describe('numero dopo il nome senza unità: quantità o specifica', () => {
  it('quantità consecutive', () => {
    const r = P('quattro prese tre interruttori', CAT_ELETTRICISTA);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-presa', 4], ['e-int', 3]]);
  });
  it('specifica di catalogo (cavo 4, tubo da 16)', () => {
    expect(P('cavo 4 venti metri', CAT_ELETTRICISTA).lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-fs4', 20]]);
    expect(P('venti metri di cavo da quattro', CAT_ELETTRICISTA).lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-fs4', 20]]);
  });
  it('cavo 4 + quantità dopo', () => {
    const r = P('quattro prese tre interruttori cavo 4 venti metri', CAT_ELETTRICISTA);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-presa', 4], ['e-int', 3], ['e-fs4', 20]]);
  });
  it('"di tre vetri", "a due condizionatori": la preposizione non fa una specifica', () => {
    expect(P('sostituzione di tre vetri', CAT_SERRAMENTISTA).lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['s-sost-vetro', 3]]);
  });
  it('numero a fine frase dopo un nome noto', () => {
    const r = P('sensori di movimento tre', CAT_ELETTRICISTA);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-sensore', 3]]);
  });
  it('riga ellittica "uno da trentadue"', () => {
    const r = P('due magnetotermici da dieci e uno da trentadue', CAT_ELETTRICISTA);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['e-mt10', 2], ['e-mt32', 1]]);
  });
});

describe('conversioni di unità', () => {
  const cat = [
    mk('tubo', 'Tubo rame', 'm', 8, 'materiale', ['tubo di rame']),
    mk('vern', 'Vernice', 'l', 12),
    mk('sale', 'Sale grosso', 'kg', 1, 'materiale', ['sale']),
    mk('man', 'Manodopera', 'h', 35, 'manodopera'),
  ];
  it('cm -> m (esatto, nessuna revisione)', () => {
    const l = P('cinquanta centimetri di tubo di rame', cat).lines[0];
    expect(l).toMatchObject({ catalogItemId: 'tubo', qty: 0.5, unit: 'm', needsReview: false });
  });
  it('cm come specifica dopo una parola resta specifica', () => {
    const l = P('tre metri di tubo 16 cm', cat).lines;
    expect(l).toHaveLength(1);
    expect(l[0].qty).toBe(3);
  });
  it('ml -> l, g -> kg, quintali -> kg', () => {
    expect(P('500 ml di vernice', cat).lines[0]).toMatchObject({ catalogItemId: 'vern', qty: 0.5, unit: 'l' });
    expect(P('800 grammi di sale', cat).lines[0]).toMatchObject({ catalogItemId: 'sale', qty: 0.8, unit: 'kg' });
    expect(P('due quintali di sale', cat).lines[0]).toMatchObject({ catalogItemId: 'sale', qty: 200, unit: 'kg' });
  });
  it('minuti -> ore; non esatto => da rivedere', () => {
    expect(P('trenta minuti di manodopera', cat).lines[0]).toMatchObject({ qty: 0.5, unit: 'h', needsReview: false });
    expect(P('quarantacinque minuti di manodopera', cat).lines[0]).toMatchObject({ qty: 0.75, unit: 'h' });
    const l = P('quaranta minuti di manodopera', cat).lines[0];
    expect(l.qty).toBeCloseTo(0.667, 3);
    expect(l.needsReview).toBe(true);
  });
  it('mezz\'ora', () => {
    expect(P("mezz'ora di manodopera", cat).lines[0]).toMatchObject({ qty: 0.5, unit: 'h' });
  });
  it('ore -> giornate (8 h) con revisione quando il catalogo ha solo giornate', () => {
    const gg = [mk('g', 'Giornata operaio', 'gg', 240, 'manodopera', ['manodopera'])];
    const r = P('quattro ore di manodopera', gg);
    expect(r.lines[0]).toMatchObject({ catalogItemId: 'g', qty: 0.5, unit: 'gg', needsReview: true });
    expect(r.lineMeta![r.lines[0].id].converted).toMatch(/8 ore/);
  });
  it('giornate -> ore (x8) con revisione quando il catalogo ha solo ore', () => {
    expect(P('due giornate di manodopera', cat).lines[0]).toMatchObject({ catalogItemId: 'man', qty: 16, unit: 'h', needsReview: true });
  });
  it('ore e giornate esistenti nel catalogo non si convertono', () => {
    expect(P('tre giornate di lavoro').lines[0]).toMatchObject({ catalogItemId: 'giornata-operaio', qty: 3, unit: 'gg' });
    expect(P('otto ore di manodopera').lines[0]).toMatchObject({ catalogItemId: 'man-idraulico', qty: 8, unit: 'h' });
  });
});

describe('prezzi parlati', () => {
  it("a quaranta euro l'uno", () => {
    const l = P("quattro sifoni a quaranta euro l'uno").lines[0];
    expect(l).toMatchObject({ catalogItemId: 'sifone', qty: 4, unitPrice: 40 });
  });
  it('"un euro e venti" = 1,20', () => {
    const l = P("cinquecento mattoni a un euro e venti l'uno", [mk('m', 'Mattoni forati', 'pz', 1)]).lines[0];
    expect(l).toMatchObject({ qty: 500, unitPrice: 1.2 });
  });
  it('"venti euro e cinque prese": i centesimi non si confondono con una quantità', () => {
    const r = P('un citofono a venti euro e cinque prese');
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toContainEqual(['presa', 5]);
  });
  it('a corpo 1200 (senza "euro")', () => {
    const l = P('tinteggiatura appartamento a corpo 1200', CAT_IMBIANCHINO).lines[0];
    expect(l).toMatchObject({ qty: 1, unit: 'corpo', unitPrice: 1200 });
  });
  it('a corpo 1200 euro su una voce libera', () => {
    expect(P('pulizia finale a corpo 1200').lines[0]).toMatchObject({ qty: 1, unit: 'corpo', unitPrice: 1200 });
  });
  it('prezzo detto prima della quantità', () => {
    expect(P('ottocento euro a corpo per tinteggiatura vano scale', CAT_IMBIANCHINO).lines[0]).toMatchObject({ unit: 'corpo', unitPrice: 800 });
  });
  it('"a corpo" su voce a misura senza prezzo => da rivedere', () => {
    expect(P('tinteggiatura appartamento a corpo', CAT_IMBIANCHINO).lines[0]).toMatchObject({ unit: 'corpo', needsReview: true });
  });
});

describe('sconti', () => {
  it('percentuale: su ogni riga', () => {
    const r = P('tre rubinetti lavabo e due sifoni con sconto del dieci per cento');
    expect(r.discount).toEqual({ pct: 10 });
    expect(r.lines.every((l) => l.discountPct === 10)).toBe(true);
    expect(r.leftovers).toEqual([]);
  });
  it('"10%" in cifre', () => {
    const r = P('tre prese con sconto del 10%');
    expect(r.lines[0].discountPct).toBe(10);
  });
  it('euro: riga "Sconto" negativa che riduce davvero il totale', () => {
    const r = P('due caldaie vaillant sconto venti euro');
    expect(r.discount).toEqual({ amount: 20 });
    const sc = r.lines.at(-1)!;
    expect(sc).toMatchObject({ description: 'Sconto', qty: 1, unitPrice: -20 });
    const gross = computeTotals(r.lines.slice(0, -1), { forfettario: false, type: 'preventivo' }).net;
    expect(computeTotals(r.lines, { forfettario: false, type: 'preventivo' }).net).toBe(gross - 20);
  });
  it('"venti euro di sconto" (importo prima)', () => {
    const r = P('una caldaia vaillant venti euro di sconto');
    expect(r.discount?.amount).toBe(20);
    expect(r.lines).toHaveLength(2);
  });
  it('"sconto del cinque" senza unità = percentuale (con avviso se ambiguo)', () => {
    const r = P('due prese sconto del cinque');
    expect(r.discount?.pct).toBe(5);
    const r2 = P('due prese sconto cinque');
    expect(r2.discount?.pct).toBe(5);
    expect(r2.discount?.uncertain).toBe(true);
    expect(r2.warnings?.length).toBeGreaterThan(0);
  });
  it('senza righe non inventa nulla', () => {
    const r = P('sconto del dieci per cento');
    expect(r.lines).toEqual([]);
  });
});

describe('IVA', () => {
  it('più IVA: prezzi netti, nessun frammento', () => {
    const r = P('un quadro elettrico più iva');
    expect(r.vatMode).toBe('plus');
    expect(r.leftovers).toEqual([]);
    expect(r.lines[0].vat).toBe(22);
  });
  it('"piu iva" senza accento', () => {
    expect(P('un quadro elettrico piu iva').vatMode).toBe('plus');
  });
  it('IVA al dieci: aliquota su tutte le righe', () => {
    const r = P('otto punti luce iva al dieci per cento');
    expect(r.vatRate).toBe(10);
    expect(r.lines.every((l) => l.vat === 10)).toBe(true);
    expect(r.leftovers).toEqual([]);
  });
  it('"iva agevolata al 10" e "iva 4"', () => {
    expect(P('due prese iva agevolata al 10').vatRate).toBe(10);
    expect(P('due prese iva 4').vatRate).toBe(4);
  });
  it('IVA compresa: scorpora i prezzi detti e segnala', () => {
    const r = P('una caldaia vaillant a 1220 euro iva compresa');
    expect(r.vatMode).toBe('included');
    expect(r.lines[0].unitPrice).toBeCloseTo(1109.09, 2); // la caldaia ha IVA 10
    expect(r.lines[0].needsReview).toBe(true);
  });
  it('IVA esclusa', () => {
    expect(P('due prese iva esclusa').vatMode).toBe('plus');
  });
});

describe('come da preventivo precedente', () => {
  it('rimando riconosciuto e tolto dal testo', () => {
    const r = P('come da preventivo precedente più due prese');
    expect(r.referencesPrevious).toBe(true);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['presa', 2]]);
    expect(r.leftovers).toEqual([]);
  });
  it('solo il rimando', () => {
    const r = P('uguale al preventivo di prima');
    expect(r.referencesPrevious).toBe(true);
    expect(r.lines).toEqual([]);
  });
  it('"preventivo per X" non è un rimando', () => {
    expect(P('preventivo per Mario Rossi due prese').referencesPrevious).toBeUndefined();
  });
});

describe('nomi cliente', () => {
  const c = (t: string) => P(t).customerName;
  it('minuscolo', () => {
    expect(c('preventivo per mario bianchi tre prese')).toBe('Mario Bianchi');
    expect(c('per giuseppe lo russo due prese')).toBe('Giuseppe Lo Russo');
  });
  it('titoli', () => {
    expect(c("per l'ingegner Ferri quattro prese")).toBe('Ferri');
    expect(c('per la signora Annamaria Trevisan due prese')).toBe('Annamaria Trevisan');
    expect(c('per il dott. Bruni due prese')).toBe('Bruni');
    expect(c("per l'architetto Neri due prese")).toBe('Neri');
  });
  it('organizzazioni: il tipo resta nel nome', () => {
    expect(c('per la ditta Idrotermica Bianchi due prese')).toBe('Ditta Idrotermica Bianchi');
    expect(c('studio associato Valli due prese')).toBe('Studio Associato Valli');
    expect(c('condominio Le Magnolie sei prese')).toBe('Condominio Le Magnolie');
    expect(c('per condominio i girasoli due prese')).toBe('Condominio I Girasoli');
    expect(c('per impresa edil verde srl due prese')).toBe('Impresa Edil Verde SRL');
    expect(c('per la famiglia Mancini due prese')).toBe('Famiglia Mancini');
  });
  it('apostrofi', () => {
    expect(c("per la famiglia Dell'Orto tre prese")).toBe("Famiglia Dell'Orto");
    expect(c("per il sig. D'Angelo tre prese")).toBe("D'Angelo");
    expect(c('per la signora Maria Pia Colombo due prese')).toBe('Maria Pia Colombo');
  });
  it('cognomi insoliti', () => {
    expect(c('per Gianfranco Zanzottera sei prese')).toBe('Gianfranco Zanzottera');
    expect(c('per Anna Maria De Rosa due prese')).toBe('Anna Maria De Rosa');
  });
  it('nome a fine frase con maiuscola', () => {
    expect(c('due plafoniere e quattro prese per Giulio Cesare Barbieri')).toBe('Giulio Cesare Barbieri');
  });
  it('"fattura a Mario Esposito", ma non "preventivo a corpo"', () => {
    expect(c('fai la fattura a Mario Esposito per quattro ore di manodopera')).toBe('Mario Esposito');
    expect(c('preventivo a corpo mille euro')).toBeUndefined();
  });
  it('il nome non ingloba la prima voce', () => {
    const r = P('condominio via Garibaldi pulizia finale');
    expect(r.customerName).toBe('Condominio Via Garibaldi');
    expect(r.leftovers.join(' ')).toMatch(/pulizia finale/);
  });
  it('"per" non è sempre un cliente', () => {
    expect(c('tre metri di tubo rame sedici per acqua calda')).toBeUndefined();
  });
});

describe('frammenti e righe unite/spezzate', () => {
  it('"sopralluogo e rilievo misure" è una sola voce', () => {
    expect(P('sopralluogo e rilievo misure', CAT_SERRAMENTISTA).lines).toHaveLength(1);
  });
  it('più voci senza quantità', () => {
    const r = P('manutenzione caldaia con analisi di combustione e bollino', [
      mk('m', 'Manutenzione caldaia', 'pz', 80), mk('a', 'Analisi di combustione', 'pz', 40), mk('b', 'Bollino', 'pz', 25),
    ]);
    expect(r.lines.map((l) => l.catalogItemId)).toEqual(['m', 'a', 'b']);
  });
  it('"con" aggiunge una voce di catalogo', () => {
    const r = P('controparete in cartongesso 14 metri quadri con lana di roccia', CAT_IMBIANCHINO);
    expect(r.lines.map((l) => [l.catalogItemId, l.qty])).toEqual([['m-cg-controparete', 14], ['m-lana', 1]]);
  });
  it('misura non a catalogo: nota, non penalizza il match', () => {
    const r = P('quattro finestre pvc 100 per 120', CAT_SERRAMENTISTA);
    expect(r.lines[0]).toMatchObject({ catalogItemId: 's-fin-pvc', qty: 4, needsReview: true });
    expect(r.lines[0].description).toMatch(/100x120/);
  });
});
