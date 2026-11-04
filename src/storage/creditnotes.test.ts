import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { __resetStorageForTests, createCreditNote, getDocument, issueInvoice, recordPayment, saveDocument, listDocuments } from './index';
import { creditResidual, effectiveCreditNotes } from './creditResidual';
import { invoiceTotalsCents } from './invoiceTotals';
import { draftData, lineData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// fattura da 300 €: A 100 + B 2x50 + C 100
const lines = () => [lineData('A', 100), lineData('B', 50, 2), lineData('C', 100)];

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
  await saveDocument(draftData('f', today(), lines(), {}, { stampDuty: true, stampAmount: 2 }));
  await issueInvoice('f');
});

const pick = (id: string, qty?: number) => {
  const l = lines().find((x) => x.id === id)!;
  return { ...l, qty: qty ?? l.qty };
};

describe('note di credito: storni parziali multipli e residuo', () => {
  it('più storni parziali successivi fino a coprire la fattura; lo stato cambia solo all\'ultimo', async () => {
    const n1 = await createCreditNote('f', { reason: 'reso A', lines: [pick('A')] });
    expect((await getDocument('f'))!.status).toBe('emessa');
    const n2 = await createCreditNote('f', { reason: 'metà B', lines: [pick('B', 1)] });
    expect((await getDocument('f'))!.status).toBe('emessa');
    const all = await listDocuments();
    const res = creditResidual((await getDocument('f'))!, effectiveCreditNotes(all, 'f'));
    expect(res).toMatchObject({ originalCents: 30000, creditedCents: 15000, residualCents: 15000 });
    expect(res.lines.map((l) => [l.id, l.qty])).toEqual([['B', 1], ['C', 1]]);
    const n3 = await createCreditNote('f', { reason: 'resto' }); // = residuo
    expect(n3.lines.map((l) => [l.description, l.qty])).toEqual([['Lavoro B', 1], ['Lavoro C', 1]]);
    expect((await getDocument('f'))!.status).toBe('stornata');
    expect([n1, n2, n3].map((n) => n.invoice!.number)).toEqual(['NC1/' + new Date().getFullYear(), 'NC2/' + new Date().getFullYear(), 'NC3/' + new Date().getFullYear()]);
    await expect(createCreditNote('f', { reason: 'ancora' })).rejects.toThrow(/stornata/);
  });

  it('rifiuta di superare il residuo (importo) o la quantità della singola riga', async () => {
    await createCreditNote('f', { reason: 'reso', lines: [pick('A'), pick('C')] }); // 200 stornati, residuo 100 (B x2)
    await expect(createCreditNote('f', { reason: 'troppo', lines: [{ ...pick('B', 2), unitPrice: 50 }, pick('A')] })).rejects.toMatchObject({ name: 'InvoiceValidationError' });
    await expect(createCreditNote('f', { reason: 'riga', lines: [pick('A')] })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'exceeds_line' })] });
    await expect(createCreditNote('f', { reason: 'sconto', lines: [lineData('x', 150, 1, { description: 'Sconto' })] })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'exceeds_original' })] });
    // una riga libera (sconto) entro il residuo è ammessa
    const ok = await createCreditNote('f', { reason: 'sconto', lines: [lineData('y', 40, 1, { description: 'Sconto commerciale' })] });
    expect(ok.invoice!.number).toMatch(/^NC2\//);
    const res = creditResidual((await getDocument('f'))!, effectiveCreditNotes(await listDocuments(), 'f'));
    expect(res.residualCents).toBe(6000);
  });

  it('l\'ultimo storno "libero" che azzera il residuo porta la fattura a stornata', async () => {
    await createCreditNote('f', { reason: 'a', lines: [lineData('free1', 299.99, 1, { description: 'Storno forfait' })] });
    expect((await getDocument('f'))!.status).toBe('emessa');
    await createCreditNote('f', { reason: 'b', lines: [lineData('free2', 0.01, 1, { description: 'Resto' })] });
    expect((await getDocument('f'))!.status).toBe('stornata');
  });

  it('storni simultanei: la somma non supera mai la fattura', async () => {
    const r = await Promise.allSettled([1, 2, 3, 4].map((i) => createCreditNote('f', { reason: `r${i}`, lines: [lineData(`p${i}`, 100, 1, { description: `Storno ${i}` })] })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    const res = creditResidual((await getDocument('f'))!, effectiveCreditNotes(await listDocuments(), 'f'));
    expect(res.residualCents).toBe(0);
    expect((await getDocument('f'))!.status).toBe('stornata');
  });
});

describe('bollo sulle note di credito [DA VERIFICARE]', () => {
  it('oltre 77,47 € la nota ha il proprio bollo (a carico dell\'emittente, mai addebitato); sotto soglia no', async () => {
    const big = await createCreditNote('f', { reason: 'grande', lines: [pick('A')] }); // 100 €
    expect(big.invoice).toMatchObject({ stampDuty: true, stampAmount: 2, stampDutyChargedToCustomer: false });
    expect(big.invoice!.xml).toContain('<ImportoBollo>2.00</ImportoBollo>');
    expect(big.invoice!.xml).not.toContain('Rimborso imposta di bollo');
    const small = await createCreditNote('f', { reason: 'piccola', lines: [lineData('s', 77.47, 1, { description: 'Piccolo storno' })] }); // 77,47 esatti: non dovuto
    expect(small.invoice).toMatchObject({ stampDuty: false, stampAmount: 0 });
    expect(small.invoice!.xml).not.toContain('DatiBollo');
  });
  it('il bollo della fattura originale non viene stornato: la fattura resta con il suo bollo', async () => {
    await createCreditNote('f', { reason: 'tutto' });
    const o = (await getDocument('f'))!;
    expect(o.invoice).toMatchObject({ stampDuty: true, stampAmount: 2 });
    expect(o.invoice!.xml).toContain('<ImportoBollo>2.00</ImportoBollo>');
  });
});

describe('incassi e bollo non addebitato', () => {
  it('con il bollo a carico dell\'emittente la fattura è "pagata" incassando il solo imponibile', async () => {
    await recordPayment('f', { date: today(), amount: 300 });
    expect((await getDocument('f'))!.invoice!.paymentStatus).toBe('pagata');
  });
  it('con il bollo addebitato il totale da incassare include i 2 €', async () => {
    await saveDocument(draftData('g', today(), lines(), {}, { stampDuty: true, stampAmount: 2, stampDutyChargedToCustomer: true }));
    await issueInvoice('g');
    await recordPayment('g', { date: today(), amount: 300 });
    expect((await getDocument('g'))!.invoice!.paymentStatus).toBe('parziale');
    await recordPayment('g', { date: today(), amount: 2 });
    expect((await getDocument('g'))!.invoice!.paymentStatus).toBe('pagata');
  });
});

describe('invoiceTotalsCents', () => {
  it('una sola aritmetica: arrotondamento per riga half-up, bollo soltanto sopra soglia', () => {
    const t = invoiceTotalsCents([lineData('a', 0.335, 3)], { forfettario: true, stampChargedToCustomer: true });
    expect(t.lineCents).toEqual([101]); // 1,005 -> 1,01
    expect(t.stampDueCents).toBe(0);
    expect(invoiceTotalsCents([lineData('a', 77.47)], { forfettario: true, stampChargedToCustomer: true }).stampDueCents).toBe(0);
    const over = invoiceTotalsCents([lineData('a', 77.48)], { forfettario: true, stampChargedToCustomer: true });
    expect(over).toMatchObject({ stampDueCents: 200, stampChargedCents: 200, grossCents: 7948 });
    expect(invoiceTotalsCents([lineData('a', 77.48)], { forfettario: true, stampChargedToCustomer: false }).grossCents).toBe(7748);
  });
});
