import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from './cases';
import { matchCustomer, parseDictationWithContext } from './index';

const RUBRICA = [
  { id: 'c1', name: 'Mario Rossi' },
  { id: 'c2', name: 'Luigi Rossi' },
  { id: 'c3', name: 'Anna Bianchi' },
  { id: 'c4', name: 'Condominio Aurora' },
  { id: 'c5', name: "Famiglia Dell'Orto" },
  { id: 'c6', name: 'Giuseppe Esposito' },
  { id: 'c7', name: 'Pellegrini Costruzioni Srl' },
  { id: 'c8', name: "Marco D'Angelo" },
];

describe('matchCustomer', () => {
  it('nome e cognome esatti', () => {
    const r = matchCustomer('Mario Rossi', RUBRICA);
    expect(r.match).toMatchObject({ status: 'matched', id: 'c1', name: 'Mario Rossi' });
  });
  it('maiuscole/accenti/ordine diversi', () => {
    expect(matchCustomer('rossi mario', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c1' });
    expect(matchCustomer('GIUSEPPE ESPOSITO', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c6' });
  });
  it('solo cognome univoco', () => {
    expect(matchCustomer('Esposito', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c6' });
    expect(matchCustomer('Bianchi', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c3' });
  });
  it('solo cognome ambiguo: segnala, non sceglie', () => {
    const r = matchCustomer('Rossi', RUBRICA);
    expect(r.match.status).toBe('ambiguous');
    expect(r.match.id).toBeUndefined();
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });
  it('refusi di riconoscimento vocale', () => {
    expect(matchCustomer('Maria Rosi', RUBRICA).match.status).not.toBe('matched'); // nome diverso: non forzare
    expect(matchCustomer('Esposto', RUBRICA).match.status).not.toBe('new'); // refuso: almeno un suggerimento
    expect(matchCustomer('Pellegrino Costruzioni', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c7' });
  });
  it('apostrofi e spazi', () => {
    expect(matchCustomer('Dell Orto', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c5' });
    expect(matchCustomer('D Angelo', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c8' });
    expect(matchCustomer("Famiglia Dell'Orto", RUBRICA).match).toMatchObject({ status: 'matched', id: 'c5' });
  });
  it('titoli e sigle societarie non pesano', () => {
    expect(matchCustomer('Pellegrini Costruzioni', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c7' });
    expect(matchCustomer('Condominio Aurora', RUBRICA).match).toMatchObject({ status: 'matched', id: 'c4' });
  });
  it('sconosciuto = nuovo', () => {
    const r = matchCustomer('Franco Verdi', RUBRICA);
    expect(r.match).toMatchObject({ status: 'new', name: 'Franco Verdi' });
    expect(r.candidates).toEqual([]);
  });
  it('rubrica vuota o nome vuoto', () => {
    expect(matchCustomer('Rossi', []).match.status).toBe('new');
    expect(matchCustomer('', RUBRICA).match.status).toBe('new');
  });
  it('due voci identiche in rubrica = ambiguo', () => {
    const r = matchCustomer('Mario Rossi', [...RUBRICA, { id: 'c9', name: 'Mario Rossi' }]);
    expect(r.match.status).toBe('ambiguous');
  });
  it('un nome completo vince su un omonimo parziale', () => {
    const r = matchCustomer('Mario Rossi', [{ id: 'a', name: 'Mario Rossi' }, { id: 'b', name: 'Mario Rossi Costruzioni' }]);
    expect(r.match).toMatchObject({ status: 'matched', id: 'a' });
  });
  it('rubrica con voci malformate non lancia', () => {
    expect(() => matchCustomer('Rossi', [null as never, { id: 'x' } as never, { id: 'y', name: 5 } as never, ...RUBRICA])).not.toThrow();
  });
});

describe('parseDictationWithContext', () => {
  it('aggancia il cliente alla rubrica e usa il nome canonico', () => {
    const r = parseDictationWithContext('preventivo per giuseppe esposito due prese', DEFAULT_CATALOG, { customers: RUBRICA });
    expect(r.customerId).toBe('c6');
    expect(r.customerName).toBe('Giuseppe Esposito');
    expect(r.customerMatch?.status).toBe('matched');
    expect(r.lines).toHaveLength(1);
  });
  it('cognome ambiguo: nome detto invariato + candidati + avviso', () => {
    const r = parseDictationWithContext('per il signor Rossi due prese', DEFAULT_CATALOG, { customers: RUBRICA });
    expect(r.customerId).toBeUndefined();
    expect(r.customerName).toBe('Rossi');
    expect(r.customerMatch?.status).toBe('ambiguous');
    expect(r.customerCandidates?.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(r.warnings?.join(' ')).toMatch(/più corrispondenze/);
  });
  it('cliente nuovo: resta come detto, nessun id', () => {
    const r = parseDictationWithContext('per Franco Verdi due prese', DEFAULT_CATALOG, { customers: RUBRICA });
    expect(r.customerName).toBe('Franco Verdi');
    expect(r.customerId).toBeUndefined();
    expect(r.customerMatch?.status).toBe('new');
  });
  it('il cognome in rubrica che è anche parola di catalogo viene comunque letto come nome', () => {
    const cat = DEFAULT_CATALOG;
    const r = parseDictationWithContext('per gesso mario tre prese', cat, { customers: [{ id: 'g', name: 'Mario Gesso' }] });
    expect(r.customerName).toBeDefined();
  });
  it('senza contesto si comporta come parseDictation', () => {
    const r = parseDictationWithContext('per Mario Rossi due prese', DEFAULT_CATALOG);
    expect(r.customerName).toBe('Mario Rossi');
    expect(r.customerMatch).toBeUndefined();
  });
  it('senza cliente detto non tocca la rubrica', () => {
    const r = parseDictationWithContext('due prese', DEFAULT_CATALOG, { customers: RUBRICA });
    expect(r.customerName).toBeUndefined();
    expect(r.customerMatch).toBeUndefined();
  });
  it('rubrica grande: veloce', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ id: `k${i}`, name: `Nome${i} Cognome${i % 700}` }));
    // Miglior tempo su 5 prove: i picchi di carico della macchina (CI, suite in parallelo) non devono dare falsi rossi,
    // mentre una regressione di complessità (O(n^2)) peggiora TUTTE le prove.
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      parseDictationWithContext('per Nome42 Cognome42 due prese', DEFAULT_CATALOG, { customers: big });
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(150);
  });
});
