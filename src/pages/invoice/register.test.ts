import { describe, expect, it } from 'vitest';
import type { QuoteDocument } from '../../types';
import { fakeCreditNote, fakeInvoice } from '../../pdf/fixtures';
import { FORFETTARIO_THRESHOLD, cashCollectedCents, csvText, invoiceRegisterCsv, stampsByQuarter, thresholdStatus } from './register';
import { availableActions, lastIssuedIso, previewNumber, resubmitUntil, windowExpired } from './model';

const line = (price: number) => ({ id: 'l', description: 'Lavoro', qty: 1, unit: 'pz' as const, unitPrice: price, vat: 0, natura: 'N2.2' as const });
const inv = (id: string, over: Partial<QuoteDocument> = {}, i: Partial<NonNullable<QuoteDocument['invoice']>> = {}): QuoteDocument => {
  const b = fakeInvoice();
  return { ...b, id, lines: [line(100)], ...over, invoice: { ...b.invoice!, ...i } };
};

describe('soglia forfettario (ricavi per cassa)', () => {
  it('somma solo gli incassi registrati nell\'anno su fatture emesse; ignora bozze, scartate, stornate, note di credito e altri anni', () => {
    const docs = [
      inv('a', {}, { payments: [{ date: '2026-03-01', amount: 40000 }, { date: '2025-12-31', amount: 999 }], paymentStatus: 'parziale' }),
      inv('b', {}, { payments: [{ date: '2026-05-01', amount: 28000.5 }] }),
      inv('c', { status: 'scartata' }, { payments: [{ date: '2026-05-01', amount: 5000 }] }),
      inv('d', { status: 'stornata' }, { payments: [{ date: '2026-05-01', amount: 5000 }] }),
      inv('e', { status: 'bozza' }, { lockedAt: undefined, payments: [{ date: '2026-05-01', amount: 5000 }] }),
      { ...fakeCreditNote(), id: 'nc', invoice: { ...fakeCreditNote().invoice!, payments: [{ date: '2026-05-01', amount: 7 }] } },
    ];
    expect(cashCollectedCents(docs, 2026)).toBe(6_800_050);
    expect(cashCollectedCents(docs, 2025)).toBe(99_900);
  });
  it('livelli: ok < 80% <= warn < 100% <= over; barra e residuo', () => {
    const mk = (amount: number) => [inv('a', {}, { payments: [{ date: '2026-02-02', amount }] })];
    expect(thresholdStatus(mk(67_999.99), 2026).level).toBe('ok');
    expect(thresholdStatus(mk(68_000), 2026)).toMatchObject({ level: 'warn', remainingCents: 1_700_000 });
    expect(thresholdStatus(mk(84_999.99), 2026).level).toBe('warn');
    expect(thresholdStatus(mk(85_000), 2026)).toMatchObject({ level: 'over', remainingCents: 0 });
    expect(thresholdStatus(mk(90_000), 2026).ratio).toBeGreaterThan(1);
    expect(FORFETTARIO_THRESHOLD).toBe(85_000);
  });
});

describe('bolli per trimestre', () => {
  it('conta fatture E note di credito con bollo dovuto (> 77,47 €), per data operazione; non le bozze né le scartate', () => {
    const docs = [
      inv('q1', { lines: [line(100)] }, { operationDate: '2026-01-15' }),
      inv('q1b', { lines: [line(77.47)] }, { operationDate: '2026-02-15' }), // soglia: non dovuto
      inv('q2', { lines: [line(500)] }, { operationDate: '2026-04-01' }),
      inv('q2x', { lines: [line(500)], status: 'scartata' }, { operationDate: '2026-04-02' }),
      inv('q4', { lines: [line(78)] }, { operationDate: '2026-11-03' }),
      { ...fakeCreditNote(), id: 'nc', lines: [line(100)], invoice: { ...fakeCreditNote().invoice!, operationDate: '2026-11-04' } },
      inv('old', { lines: [line(100)] }, { operationDate: '2025-11-03' }),
    ];
    expect(stampsByQuarter(docs, 2026, true)).toEqual([{ count: 1, cents: 200 }, { count: 1, cents: 200 }, { count: 0, cents: 0 }, { count: 2, cents: 400 }]);
  });
});

describe('CSV registro fatture', () => {
  const docs: QuoteDocument[] = [
    inv('a', { customer: { id: 'c', name: 'Rossi; "Mario" Srl', vatNumber: '01234567897' }, lines: [line(1000)] }, { number: '1/2026', operationDate: '2026-02-01', seq: 1, payments: [{ date: '2026-02-20', amount: 400.5 }], paymentStatus: 'parziale' }),
    inv('b', { status: 'consegnata', customer: { id: 'c', name: '=CMD()' }, lines: [line(50.1)] }, { number: '2/2026', operationDate: '2026-03-01', seq: 2, stampDuty: false }),
    { ...fakeCreditNote(), id: 'nc', status: 'inviata', lines: [line(100)], invoice: { ...fakeCreditNote().invoice!, number: 'NC1/2026', seq: 1, operationDate: '2026-03-10' } },
    inv('bozza', { status: 'bozza' }, { number: undefined, lockedAt: undefined }),
    inv('vecchia', {}, { number: '9/2025', operationDate: '2025-12-30', seq: 9, year: 2025 }),
  ];
  it('intestazione, righe ordinate per data, decimali con la virgola, nota di credito negativa, bozze escluse', () => {
    const csv = invoiceRegisterCsv(docs, true, 2026);
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe('Numero;Data;Tipo;Cliente;Imponibile;Bollo;Stato SDI;Incassato');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toBe('1/2026;01/02/2026;Fattura;"Rossi; ""Mario"" Srl";1000,00;2,00;Emessa;400,50');
    expect(rows[2]).toBe("2/2026;01/03/2026;Fattura;'=CMD();50,10;0,00;Consegnata;0,00");
    expect(rows[3]).toBe('NC1/2026;10/03/2026;Nota di credito;Mario Rossi;-100,00;2,00;Inviata allo SDI;0,00');
  });
  it('senza anno esporta tutti gli anni; csvText neutralizza formule e virgolette', () => {
    expect(invoiceRegisterCsv(docs, true).trim().split('\r\n')).toHaveLength(5);
    expect(csvText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvText('a\nb')).toBe('a b');
    expect(csvText('ok')).toBe('ok');
  });
});

describe('scartata: azioni e finestra dei 5 giorni', () => {
  const rej = (ago: number): QuoteDocument => inv('r', { status: 'scartata' }, { sdiEvents: [{ at: 1_000_000_000_000 - ago, type: 'NS', channel: 'portale_ade' }] });
  const NOW = 1_000_000_000_000;
  it('entro 5 giorni: correggi e rinvia + nuova fattura; oltre: solo nuova fattura collegata', () => {
    const a = availableActions(rej(2 * 86_400_000), NOW);
    expect(a).toMatchObject({ correctAndResend: true, resubmitNew: true, markSent: true, downloadXml: true, recordPayment: false, creditNote: false });
    const b = availableActions(rej(6 * 86_400_000), NOW);
    expect(b).toMatchObject({ correctAndResend: false, resubmitNew: true, markSent: false });
    expect(windowExpired(rej(6 * 86_400_000), NOW)).toBe(true);
    expect(resubmitUntil(rej(86_400_000))).toBe(NOW - 86_400_000 + 5 * 86_400_000);
    expect(resubmitUntil(inv('x'))).toBeNull();
  });
  it('le altre fatture non hanno azioni di rinvio', () => {
    expect(availableActions(inv('x'), NOW)).toMatchObject({ correctAndResend: false, resubmitNew: false });
  });
});

describe('cronologia e anteprima numero', () => {
  it('lastIssuedIso: stessa serie e anno, esclude il documento stesso e le bozze', () => {
    const all = [inv('a', {}, { operationDate: '2026-03-05' }), inv('b', {}, { operationDate: '2026-03-20' }), inv('c', { status: 'bozza' }, { lockedAt: undefined, operationDate: '2026-04-01' }), inv('d', {}, { operationDate: '2025-12-01', year: 2025 })];
    const me = inv('me', { status: 'bozza' }, { lockedAt: undefined, operationDate: '2026-03-10', number: undefined });
    expect(lastIssuedIso(all, me)).toBe('2026-03-20');
    expect(lastIssuedIso(all, { ...me, id: 'b' })).toBe('2026-03-05');
  });
  it('previewNumber usa l\'anno della data operazione', () => {
    const d = inv('p', { status: 'bozza' }, { lockedAt: undefined, number: undefined, year: 2026, operationDate: '2027-01-04' });
    expect(previewNumber(d, { invoiceYearCounters: { 'FT-2026': 9 } })).toBe('1/2027');
  });
});
