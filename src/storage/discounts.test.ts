import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { __resetStorageForTests, createCreditNote, getDocument, issueInvoice, saveDocument, listDocuments } from './index';
import { creditResidual, effectiveCreditNotes } from './creditResidual';
import { invoiceTotalsCents } from './invoiceTotals';
import { draftData, lineData, seedProfile } from './testkit';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const disc = (euro: number) => lineData('sc', -euro, 1, { description: 'Sconto', unit: 'corpo' });

beforeEach(async () => {
  await __resetStorageForTests();
  await deleteDB('vocepreventivo');
  await seedProfile();
});

describe('sconto in euro (riga a prezzo negativo): emissione e note di credito', () => {
  it('emette: XML con riga negativa, totale dopo sconto, bollo valutato dopo lo sconto', async () => {
    await saveDocument(draftData('f', today(), [lineData('A', 100), disc(30)], {}, { stampDuty: false, stampAmount: 0 }));
    const d = await issueInvoice('f');
    expect(d.invoice!.xml).toContain('<PrezzoUnitario>-30.00</PrezzoUnitario>');
    expect(d.invoice!.xml).toContain('<ImportoTotaleDocumento>70.00</ImportoTotaleDocumento>');
    expect(d.invoice!.xml).not.toContain('<DatiBollo>'); // 70 € <= 77,47 €
  });

  it('rifiuta l\'emissione se lo sconto supera il totale (errore in italiano con campo)', async () => {
    await saveDocument(draftData('f', today(), [lineData('A', 100), disc(150)], {}, { stampDuty: false, stampAmount: 0 }));
    await expect(issueInvoice('f')).rejects.toMatchObject({ issues: [expect.objectContaining({ field: 'lines', code: 'discount_exceeds_total' })] });
  });

  it('storno totale: la nota ha lo stesso imponibile della fattura (sconto incluso)', async () => {
    await saveDocument(draftData('f', today(), [lineData('A', 100), lineData('B', 50), disc(30)], {}, { stampDuty: true, stampAmount: 2 }));
    await issueInvoice('f');
    const nc = await createCreditNote('f', { reason: 'annullo' });
    expect(invoiceTotalsCents(nc.lines, { forfettario: true, stampChargedToCustomer: false }).netCents).toBe(12000);
    expect(nc.invoice!.xml).toContain('<ImportoTotaleDocumento>120.00</ImportoTotaleDocumento>');
    expect((await getDocument('f'))!.status).toBe('stornata');
  });

  it('storno parziale: lo sconto da solo non si storna (importo negativo); con la riga a cui si riferisce sì', async () => {
    await saveDocument(draftData('f', today(), [lineData('A', 100), lineData('B', 50), disc(30)], {}, { stampDuty: true, stampAmount: 2 }));
    await issueInvoice('f');
    await expect(createCreditNote('f', { reason: 'solo sconto', lines: [disc(30)] })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'invalid_amount' })] });
    const ok = await createCreditNote('f', { reason: 'reso B con sconto', lines: [lineData('B', 50), disc(30)] });
    expect(ok.invoice!.number).toMatch(/^NC1\//);
    const res = creditResidual((await getDocument('f'))!, effectiveCreditNotes(await listDocuments(), 'f'));
    expect(res.residualCents).toBe(10000); // 120 (fattura) - 20 (B 50 con sconto 30)
  });
});
