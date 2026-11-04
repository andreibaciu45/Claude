/** Utilità SOLO per i test (dati FITTIZI con checksum validi). Non importare dal codice dell'app. */
import type { Customer, DocLine, InvoiceFiscal, Profile, QuoteDocument } from '../types';
import { saveProfile, getProfile } from './index';

export const profileData = (over: Partial<Profile> = {}): Profile => ({
  businessName: 'Bianchi Mario Impianti', ownerName: 'Mario Bianchi', vatNumber: '01234567897', fiscalCode: 'BNCMRA80A01H501A',
  address: 'Via Roma 1', zip: '00100', city: 'Roma', province: 'RM', phone: '3331234567', email: 'mario.bianchi@example.test',
  iban: 'IT60X0542811101000000123456', regimeForfettario: true, defaultVat: 22, quotePrefix: 'PRev-', invoicePrefix: 'FT-',
  nextQuoteNumber: 1, nextInvoiceNumber: 1, quoteValidityDays: 30, paymentTerms: 'Bonifico a 30 giorni', ...over,
});

export const customerData = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1', name: 'Rossi Costruzioni Srl', vatNumber: '02345678904', address: 'Via Milano 10', zip: '20100', city: 'Milano', province: 'MI',
  codiceDestinatario: 'ABCDEF1', ...over,
});

export const lineData = (id: string, price = 100, qty = 1, over: Partial<DocLine> = {}): DocLine => ({
  id, description: `Lavoro ${id}`, qty, unit: 'pz', unitPrice: price, vat: 0, natura: 'N2.2', ...over,
});

export const draftData = (id: string, date: string, lines: DocLine[] = [lineData('l1', 100), lineData('l2', 50)], over: Partial<QuoteDocument> = {}, inv: Partial<InvoiceFiscal> = {}): QuoteDocument => ({
  id, type: 'fattura', number: '', date, customer: customerData(), lines, status: 'bozza',
  invoice: {
    tipoDocumento: 'TD01', year: Number(date.slice(0, 4)), sectional: 'FT', operationDate: date, stampDuty: false, stampDutyChargedToCustomer: false,
    stampAmount: 0, customerChannel: 'codice', sdiEvents: [], paymentStatus: 'non_pagata', payments: [], ...inv,
  },
  createdAt: 1, updatedAt: 1, ...over,
});

export async function seedProfile(over: Partial<Profile> = {}): Promise<void> {
  const p = await getProfile();
  await saveProfile({ ...p, ...profileData(over) });
}
