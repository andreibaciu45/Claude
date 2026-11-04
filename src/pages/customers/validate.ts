import type { Customer } from '../../types';
import {
  isValidCapIt, isValidCodiceDestinatario, isValidCodiceFiscale, isValidEmail, isValidPartitaIva, isValidPec, isValidProvinciaIt,
} from '../../../shared/fiscal';
import { normCf, normVat } from '../../storage/customerModel';

export type CustomerField = 'name' | 'vatNumber' | 'fiscalCode' | 'zip' | 'province' | 'country' | 'codiceDestinatario' | 'pec' | 'email';
export type CustomerErrors = Partial<Record<CustomerField, string>>;

const t = (v: string | undefined) => (v ?? '').trim();

/** Validazione della scheda cliente (validatori di shared/fiscal). I controlli italiani (CAP, provincia, P.IVA) valgono solo per country IT. */
export function validateCustomer(c: Customer): CustomerErrors {
  const e: CustomerErrors = {};
  const it = !t(c.country) || t(c.country).toUpperCase() === 'IT';
  if (!t(c.name)) e.name = 'Inserisci il nome o la ragione sociale.';
  const vat = t(c.vatNumber).replace(/\s/g, '').toUpperCase().replace(/^IT(?=\d)/, '');
  if (vat && it && !isValidPartitaIva(vat)) e.vatNumber = 'Partita IVA non valida: servono 11 cifre corrette.';
  const cf = normCf(c.fiscalCode);
  if (cf && it && !isValidCodiceFiscale(cf)) e.fiscalCode = 'Codice fiscale non valido.';
  if (t(c.zip) && it && !isValidCapIt(t(c.zip))) e.zip = 'Il CAP ha 5 cifre.';
  if (t(c.province) && it && !isValidProvinciaIt(t(c.province).toUpperCase())) e.province = 'Sigla di 2 lettere (es. MI).';
  if (t(c.country) && !/^[A-Za-z]{2}$/.test(t(c.country))) e.country = 'Codice paese di 2 lettere (es. IT).';
  if (t(c.codiceDestinatario) && !isValidCodiceDestinatario(t(c.codiceDestinatario).toUpperCase())) e.codiceDestinatario = 'Servono 7 caratteri (lettere e cifre).';
  if (t(c.pec) && !isValidPec(t(c.pec))) e.pec = 'PEC non valida.';
  if (t(c.email) && !isValidEmail(t(c.email))) e.email = 'Email non valida.';
  return e;
}

export const hasIdentifiers = (c: Customer): boolean => !!normVat(c.vatNumber) || !!normCf(c.fiscalCode);
