import type { Customer } from '../../types';
import { uid } from '../../types';
import { parseCsv } from '../catalog/csv';

type K = 'name' | 'vatNumber' | 'fiscalCode' | 'address' | 'zip' | 'city' | 'province' | 'country' | 'codiceDestinatario' | 'pec' | 'email' | 'phone';
export const CUSTOMER_CSV_COLUMNS: { key: K; label: string; syn: string[] }[] = [
  { key: 'name', label: 'Nome', syn: ['nome', 'ragionesociale', 'cliente', 'denominazione', 'name'] },
  { key: 'vatNumber', label: 'Partita IVA', syn: ['partitaiva', 'piva', 'p.iva', 'vat', 'partitaiva'] },
  { key: 'fiscalCode', label: 'Codice fiscale', syn: ['codicefiscale', 'cf', 'c.f.', 'fiscalcode'] },
  { key: 'address', label: 'Indirizzo', syn: ['indirizzo', 'via', 'address'] },
  { key: 'zip', label: 'CAP', syn: ['cap', 'zip'] },
  { key: 'city', label: 'Comune', syn: ['comune', 'citta', 'city'] },
  { key: 'province', label: 'Provincia', syn: ['provincia', 'prov', 'province'] },
  { key: 'country', label: 'Paese', syn: ['paese', 'nazione', 'country'] },
  { key: 'codiceDestinatario', label: 'Codice destinatario', syn: ['codicedestinatario', 'codicesdi', 'sdi', 'destinatario'] },
  { key: 'pec', label: 'PEC', syn: ['pec'] },
  { key: 'email', label: 'Email', syn: ['email', 'mail', 'e-mail'] },
  { key: 'phone', label: 'Telefono', syn: ['telefono', 'tel', 'cellulare', 'phone'] },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9.]/g, '');
// protezione "CSV injection": le celle che iniziano con = + - @ vengono precedute da apostrofo (rimosso in importazione)
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const unsafe = (v: string) => v.replace(/^'(?=[=+\-@\t\r])/, '');
const q = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV (separatore ;, UTF-8 con BOM: si apre in Excel italiano). */
export function customersToCsv(list: Customer[]): string {
  const head = CUSTOMER_CSV_COLUMNS.map((c) => c.label).join(';');
  const rows = list.map((c) => CUSTOMER_CSV_COLUMNS.map((col) => q(safe(String((c as unknown as Record<string, unknown>)[col.key] ?? '')))).join(';'));
  return '﻿' + [head, ...rows].join('\r\n') + '\r\n';
}

export interface CsvImport { customers: Customer[]; error?: string; ignored: number }

/** Legge un CSV con intestazione. Righe senza nome ignorate. */
export function parseCustomersCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  if (!rows.length) return { customers: [], ignored: 0, error: 'Il file è vuoto.' };
  const map: Partial<Record<K, number>> = {};
  rows[0].forEach((h, i) => {
    const n = norm(h);
    for (const c of CUSTOMER_CSV_COLUMNS) if (map[c.key] === undefined && c.syn.some((s) => norm(s) === n)) { map[c.key] = i; break; }
  });
  if (map.name === undefined) return { customers: [], ignored: 0, error: 'Non trovo la colonna «Nome» nella prima riga del file.' };
  const customers: Customer[] = [];
  let ignored = 0;
  for (const r of rows.slice(1)) {
    const get = (k: K) => unsafe((map[k] !== undefined ? r[map[k]!] : '') ?? '').trim();
    if (!get('name')) { ignored++; continue; }
    const c: Customer = { id: uid(), name: get('name') };
    for (const col of CUSTOMER_CSV_COLUMNS) if (col.key !== 'name' && get(col.key)) (c as unknown as Record<string, string>)[col.key] = get(col.key);
    customers.push(c);
  }
  return { customers, ignored };
}
