/** Dati di test FITTIZI (P.IVA, CF, IBAN con checksum valido, non appartengono a nessuno). */
import type { Customer, DocLine, InvoiceFiscal, Profile, QuoteDocument } from '../../types';

export const NOW = new Date(2026, 9, 20, 12, 0, 0); // 2026-10-20 locale

export const makeProfile = (over: Partial<Profile> = {}): Profile => ({
  businessName: 'Rossi Idraulica',
  ownerName: 'Mario Rossi',
  vatNumber: '01234567897',
  fiscalCode: 'RSSMRA80A01H501U',
  address: 'Via Roma 10',
  zip: '00100',
  city: 'Roma',
  province: 'RM',
  phone: '',
  email: '',
  iban: 'IT60X0542811101000000123456',
  regimeForfettario: true,
  defaultVat: 22,
  quotePrefix: 'PRev-',
  invoicePrefix: 'FT-',
  nextQuoteNumber: 1,
  nextInvoiceNumber: 1,
  quoteValidityDays: 30,
  paymentTerms: 'Bonifico a 30 giorni',
  ...over,
});

export const consumer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Luigia Verdi',
  fiscalCode: 'VRDLGI85M41F205H',
  address: 'Via Milano 5',
  zip: '20100',
  city: 'Milano',
  province: 'MI',
  ...over,
});

export const company = (over: Partial<Customer> = {}): Customer => ({
  id: 'c2',
  name: 'Bianchi Costruzioni S.r.l.',
  vatNumber: '09876543217',
  codiceDestinatario: 'ABC1234',
  address: 'Via Torino 3',
  zip: '10100',
  city: 'Torino',
  province: 'TO',
  ...over,
});

export const line = (over: Partial<DocLine> = {}): DocLine => ({
  id: 'l1',
  description: 'Prestazione',
  qty: 1,
  unit: 'pz',
  unitPrice: 100,
  vat: 0,
  ...over,
});

export const fiscal = (over: Partial<InvoiceFiscal> = {}): InvoiceFiscal => ({
  tipoDocumento: 'TD01',
  year: 2026,
  sectional: 'FT',
  seq: 12,
  number: '12/2026',
  operationDate: '2026-10-15',
  stampDuty: false,
  stampDutyChargedToCustomer: false,
  stampAmount: 0,
  customerChannel: 'consumatore',
  sdiEvents: [],
  paymentStatus: 'non_pagata',
  payments: [],
  ...over,
});

export const makeDoc = (over: Partial<QuoteDocument> & { invoice?: Partial<InvoiceFiscal> } = {}): QuoteDocument => {
  const { invoice, ...rest } = over;
  return {
    id: 'd1',
    type: 'fattura',
    number: '12/2026',
    date: '2026-10-15',
    customer: consumer(),
    lines: [line()],
    status: 'emessa',
    createdAt: 0,
    updatedAt: 0,
    ...rest,
    invoice: fiscal(invoice),
  };
};

/** Documento dell'Esempio A di FISCAL-SPEC §2.5. */
export const docExampleA = (): QuoteDocument =>
  makeDoc({
    customer: consumer(),
    lines: [
      line({ id: '1', description: 'Manodopera idraulica - sostituzione rubinetto cucina', qty: 8, unit: 'h', unitPrice: 35 }),
      line({ id: '2', description: 'Tubo rame 16 mm', qty: 12, unit: 'm', unitPrice: 4.5 }),
      line({ id: '3', description: 'Rubinetto miscelatore cucina', qty: 1, unit: 'pz', unitPrice: 36 }),
    ],
    invoice: { stampDuty: true, stampDutyChargedToCustomer: true, stampAmount: 2 },
  });

/** Documento dell'Esempio B di FISCAL-SPEC §2.5. */
export const docExampleB = (): QuoteDocument =>
  makeDoc({
    customer: company(),
    lines: [line({ id: '1', description: 'Storno: Rubinetto miscelatore cucina (reso)', qty: 1, unit: 'pz', unitPrice: 36 })],
    invoice: {
      tipoDocumento: 'TD04',
      sectional: 'NC',
      seq: 1,
      number: 'NC1/2026',
      operationDate: '2026-10-20',
      customerChannel: 'codice',
      originalNumber: '12/2026',
      originalDate: '2026-10-15',
      creditNoteReason: 'Storno parziale della fattura n. 12/2026 del 15/10/2026: reso rubinetto miscelatore.',
    },
  });
