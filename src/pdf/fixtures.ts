import type { DocLine, Profile, QuoteDocument } from '../types';

export const fakeProfile = (over: Partial<Profile> = {}): Profile => ({
  businessName: 'Idraulica Bianchi di Luca Bianchi', ownerName: 'Luca Bianchi', vatNumber: '01234567890', fiscalCode: 'BNCLCU80A01H501X',
  address: 'Via dei Mille 12', zip: '20100', city: 'Milano', province: 'MI', phone: '+39 333 1234567', email: 'info@idraulicabianchi.it',
  pec: 'bianchi@pec.it', iban: 'IT60X0542811101000000123456', artigianiNumber: 'MI-123456', regimeForfettario: false, defaultVat: 22,
  quotePrefix: 'PRev-', invoicePrefix: 'FT-', nextQuoteNumber: 1, nextInvoiceNumber: 1, quoteValidityDays: 30,
  paymentTerms: 'Bonifico bancario a 30 giorni data fattura', footerNotes: 'Lavori eseguiti a regola d’arte. Garanzia 24 mesi sui materiali.', ...over,
});

export const fakeLines = (n = 3): DocLine[] => {
  const base: DocLine[] = [
    { id: 'l1', description: 'Tubo rame 16 mm', qty: 3, unit: 'm', unitPrice: 8.5, vat: 22 },
    { id: 'l2', description: 'Manodopera idraulico specializzato, sostituzione sifone e verifica tenuta impianto, comprensiva di pulizia dell’area di lavoro e smaltimento', qty: 2, unit: 'h', unitPrice: 35, vat: 22, discountPct: 10 },
    { id: 'l3', description: 'Rubinetto miscelatore cucina è cromato', qty: 1, unit: 'pz', unitPrice: 1234.5, vat: 10 },
  ];
  const out: DocLine[] = [];
  for (let i = 0; i < n; i++) out.push({ ...base[i % 3], id: `l${i}`, description: i < 3 ? base[i].description : `${base[i % 3].description} (${i + 1})` });
  return out;
};

export const fakeDoc = (over: Partial<QuoteDocument> = {}, lines = 3): QuoteDocument => ({
  id: 'd1', type: 'preventivo', number: 'PRev-0012', date: '2026-11-04',
  customer: { id: 'c1', name: 'Mario Rossi', address: 'Via Roma 1, 20121 Milano (MI)', email: 'mario@example.it', phone: '347 1112223', vatOrFiscalCode: 'RSSMRA70A01F205Z' },
  lines: fakeLines(lines), notes: 'Il prezzo non comprende opere murarie. Inizio lavori da concordare.', status: 'bozza', createdAt: 0, updatedAt: 0, ...over,
});
