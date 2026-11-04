import { describe, expect, it } from 'vitest';
import type { Customer, DocLine, QuoteDocument } from '../../types';
import { customerStats } from './stats';

const cust = (over: Partial<Customer> = {}): Customer => ({ id: 'c1', name: 'Rossi Costruzioni Srl', vatNumber: '02345678904', ...over });
const line = (id: string, price: number, qty = 1, over: Partial<DocLine> = {}): DocLine => ({ id, description: `Lavoro ${id}`, qty, unit: 'pz', unitPrice: price, vat: 22, ...over });

let n = 0;
interface Opt { status?: QuoteDocument['status']; date?: string; credit?: boolean; locked?: boolean; customer?: Customer; stamp?: boolean; type?: 'fattura' | 'preventivo'; legacy?: boolean }
const doc = (lines: DocLine[], o: Opt = {}): QuoteDocument => {
  const id = `d${++n}`;
  const date = o.date ?? '2026-03-10';
  const type = o.type ?? 'fattura';
  const base: QuoteDocument = { id, type, number: `N${n}`, date, customer: o.customer ?? cust(), lines, status: o.status ?? 'emessa', createdAt: n, updatedAt: n };
  if (type === 'preventivo') return { ...base, status: o.status ?? 'inviato' };
  if (o.legacy) return { ...base, invoice: { tipoDocumento: 'TD01', year: 2026, sectional: 'FT', operationDate: date, stampDuty: false, stampDutyChargedToCustomer: false, stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [], legacy: true } };
  return {
    ...base,
    invoice: {
      tipoDocumento: o.credit ? 'TD04' : 'TD01', year: Number(date.slice(0, 4)), sectional: o.credit ? 'NC' : 'FT', seq: n, number: `${n}/${date.slice(0, 4)}`, operationDate: date,
      lockedAt: (o.locked ?? true) ? 1000 + n : undefined, stampDuty: !!o.stamp, stampDutyChargedToCustomer: !!o.stamp, stampAmount: o.stamp ? 2 : 0,
      customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [],
    },
  };
};

describe('customerStats: fatturato per cliente', () => {
  it('somma le fatture emesse con importi lordi (IVA inclusa)', () => {
    const all = [doc([line('a', 100)]), doc([line('b', 50, 2)])];
    const s = customerStats(cust(), all, false);
    expect(s.invoiced).toBe(244); // (100 + 100) * 1,22
    expect(s.invoices).toBe(2);
  });

  it('forfettario: nessuna IVA, importi netti', () => {
    const s = customerStats(cust(), [doc([line('a', 100, 1, { vat: 0 })])], true);
    expect(s.invoiced).toBe(100);
  });

  it('le note di credito si sottraggono; fattura stornata per intero = 0', () => {
    const f = doc([line('a', 100)], { status: 'stornata' });
    const nc = doc([line('a', 100)], { credit: true, date: '2026-04-01' });
    const s = customerStats(cust(), [f, nc], false);
    expect(s).toMatchObject({ invoiced: 0, invoices: 2 });
  });

  it('nota di credito parziale: sottrae solo la parte stornata', () => {
    const f = doc([line('a', 100), line('b', 100)]);
    const nc = doc([line('b', 100)], { credit: true });
    expect(customerStats(cust(), [f, nc], false).invoiced).toBe(122);
  });

  it('più note parziali successive', () => {
    const f = doc([line('a', 300)]);
    const ncs = [doc([line('a', 100)], { credit: true }), doc([line('a', 50)], { credit: true })];
    expect(customerStats(cust(), [f, ...ncs], false).invoiced).toBe(183); // 366 - 122 - 61
  });

  it('fatture scartate dallo SDI e bozze non contano; una nota scartata non sottrae', () => {
    const ok = doc([line('a', 100)]);
    const scartata = doc([line('b', 1000)], { status: 'scartata' });
    const bozza = doc([line('c', 1000)], { status: 'bozza', locked: false });
    const ncScartata = doc([line('a', 100)], { credit: true, status: 'scartata' });
    const s = customerStats(cust(), [ok, scartata, bozza, ncScartata], false);
    expect(s).toMatchObject({ invoiced: 122, invoices: 1, drafts: 1, rejected: 2 });
  });

  it('fatture "di cortesia" v1 (legacy) non sono fatturato: contano come bozze', () => {
    const s = customerStats(cust(), [doc([line('a', 100)], { legacy: true, status: 'bozza' })], false);
    expect(s).toMatchObject({ invoiced: 0, invoices: 0, drafts: 1 });
  });

  it('preventivi contati a parte e mai nel fatturato', () => {
    const s = customerStats(cust(), [doc([line('a', 999)], { type: 'preventivo' }), doc([line('b', 100)])], false);
    expect(s).toMatchObject({ quotes: 1, invoices: 1, invoiced: 122 });
  });

  it('bollo: entra nel lordo solo se addebitato al cliente; la nota di credito non lo restituisce', () => {
    // forfettario, 100 € > 77,47 € => bollo 2 €
    const l = [line('a', 100, 1, { vat: 0 })];
    const addebitato = doc(l, { stamp: true });
    expect(customerStats(cust(), [addebitato], true).invoiced).toBe(102);
    const aCarico = doc(l);
    aCarico.invoice!.stampDuty = true; aCarico.invoice!.stampDutyChargedToCustomer = false;
    expect(customerStats(cust(), [aCarico], true).invoiced).toBe(100);
    // storno totale: il bollo versato dal cliente (2 €) non viene stornato (regola di invoiceTotals)
    const nc = doc(l, { credit: true });
    expect(customerStats(cust(), [addebitato, nc], true).invoiced).toBe(2);
  });

  it('somma in centesimi: nessuna deriva dei decimali', () => {
    const all = Array.from({ length: 300 }, () => doc([line('a', 0.1, 1, { vat: 0 })]));
    expect(customerStats(cust(), all, true).invoiced).toBe(30);
    const all2 = Array.from({ length: 1000 }, () => doc([line('a', 19.99, 1, { vat: 0 })]));
    expect(customerStats(cust(), all2, true).invoiced).toBe(19990);
  });

  it('importi non validi (NaN/Infinity) non azzerano il fatturato del cliente', () => {
    const bad = doc([line('x', NaN)]);
    const worse = doc([line('y', Infinity)]);
    const ok = doc([line('a', 100)]);
    const s = customerStats(cust(), [bad, worse, ok], false);
    expect(Number.isFinite(s.invoiced)).toBe(true);
    expect(s.invoiced).toBeGreaterThanOrEqual(122);
    expect(s.invoices).toBe(3);
  });

  it('nessun valore -0', () => {
    expect(Object.is(customerStats(cust(), [], false).invoiced, 0)).toBe(true);
    const f = doc([line('a', 100)]); const nc = doc([line('a', 100)], { credit: true });
    expect(Object.is(customerStats(cust(), [f, nc], false).invoiced, 0)).toBe(true);
  });
});

describe('customerStats: anno e periodo', () => {
  const all = () => [
    doc([line('a', 100)], { date: '2025-12-31' }),
    doc([line('b', 100)], { date: '2026-01-01' }),
    doc([line('c', 100)], { date: '2026-06-15' }),
    doc([line('d', 100)], { date: '2026-12-31' }),
    doc([line('e', 100)], { date: '2026-03-01', credit: true }),
    doc([line('q', 100)], { date: '2026-02-01', type: 'preventivo' }),
  ];
  it('senza periodo: tutto', () => expect(customerStats(cust(), all(), false).invoiced).toBe(366));
  it('anno: solo documenti dell\'anno (incluso il 31/12 e l\'1/1), le note di credito dell\'anno sottraggono', () => {
    const s = customerStats(cust(), all(), false, { year: 2026 });
    expect(s.invoiced).toBe(244); // 3 fatture - 1 nota = 2 * 122
    expect(s.invoices).toBe(4);
    expect(s.quotes).toBe(1);
    expect(customerStats(cust(), all(), false, { year: 2025 }).invoiced).toBe(122);
    expect(customerStats(cust(), all(), false, { year: 2024 })).toMatchObject({ invoiced: 0, invoices: 0, docs: [] });
  });
  it('periodo from/to inclusivo', () => {
    const s = customerStats(cust(), all(), false, { from: '2026-01-01', to: '2026-06-15' });
    expect(s.invoices).toBe(3);
    expect(s.invoiced).toBe(122); // 2 fatture - 1 nota
    expect(customerStats(cust(), all(), false, { year: 2026, from: '2026-07-01' }).invoiced).toBe(122);
  });
  it('si usa la data operazione della fattura, non la data del documento', () => {
    const d = doc([line('a', 100)], { date: '2026-01-02' });
    d.date = '2025-12-30';
    expect(customerStats(cust(), [d], false, { year: 2026 }).invoices).toBe(1);
  });
});

describe('customerStats: attribuzione ai clienti e omonimi', () => {
  it('stessa P.IVA = stesso cliente anche con nome diverso; P.IVA diversa = clienti diversi anche se omonimi', () => {
    const a = cust({ id: 'a', name: 'Bianchi Srl', vatNumber: '02345678904' });
    const b = cust({ id: 'b', name: 'Bianchi Srl', vatNumber: '01234567897' });
    const all = [doc([line('x', 100)], { customer: a }), doc([line('y', 200)], { customer: b }), doc([line('z', 50)], { customer: { ...a, id: 'zzz', name: 'Bianchi S.r.l.' } })];
    expect(customerStats(a, all, false).invoiced).toBe(183);
    expect(customerStats(b, all, false).invoiced).toBe(244);
  });
  it('omonimi senza P.IVA/CF: senza rubrica non distinguibili, con la rubrica si separano per id', () => {
    const a: Customer = { id: 'a', name: 'Mario Rossi' };
    const b: Customer = { id: 'b', name: 'Mario Rossi' };
    const all = [doc([line('x', 100)], { customer: a }), doc([line('y', 200)], { customer: b })];
    expect(customerStats(a, all, false).invoices).toBe(2); // limite noto: stesso nome e nessun identificativo
    expect(customerStats(a, all, false, { book: [a, b] })).toMatchObject({ invoices: 1, invoiced: 122 });
    expect(customerStats(b, all, false, { book: [a, b] })).toMatchObject({ invoices: 1, invoiced: 244 });
  });
  it('documenti precedenti alla rubrica (id non in rubrica) restano attribuiti per nome', () => {
    const a: Customer = { id: 'a', name: 'Mario Rossi' };
    const old = doc([line('x', 100)], { customer: { id: 'vecchio', name: 'mario  rossi' } });
    expect(customerStats(a, [old], false, { book: [a] }).invoices).toBe(1);
  });
  it('un documento senza cliente non manda in errore', () => {
    const d = doc([line('x', 100)]);
    (d as { customer?: unknown }).customer = undefined;
    expect(customerStats(cust(), [d], false).invoices).toBe(0);
  });
});
