/**
 * Rubrica clienti (store IndexedDB 'customers', schema v3).
 *
 * SOLO LOCALE: l'entità 'customer' non esiste nel contratto di sync (shared/api.ts), quindi la rubrica NON viene
 * sincronizzata col server: vive nel dispositivo e nel backup JSON (versione 3). Le fatture e i preventivi
 * contengono sempre una COPIA dei dati cliente: modificare o eliminare un cliente in rubrica non tocca mai i documenti già creati.
 */
import type { Customer, QuoteDocument } from '../types';
import { uid } from '../types';
import { getBackend } from './db';
import {
  fillMissing, findDuplicate, normalizeCustomerRecord, seedCustomersFromDocuments,
  type StoredCustomer,
} from './customerModel';

export type { StoredCustomer } from './customerModel';
export { docBelongsTo, findDuplicate, normName, normVat, normCf, normalizeCustomerRecord, sameCustomer, searchCustomers } from './customerModel';

/** Esiste già un altro cliente con la stessa P.IVA / CF / nome. */
export class DuplicateCustomerError extends Error {
  constructor(readonly existing: StoredCustomer) {
    super(`Esiste già un cliente "${existing.name}" con gli stessi dati.`);
    this.name = 'DuplicateCustomerError';
  }
}

const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });

export const listCustomers = async (): Promise<StoredCustomer[]> =>
  (await getBackend().transact('readonly', (t) => t.all<StoredCustomer>('customers'))).sort(byName);

export const getCustomer = async (id: string): Promise<StoredCustomer | undefined> =>
  getBackend().transact('readonly', (t) => t.get<StoredCustomer>('customers', id));

/** Crea o aggiorna (per id). Lancia `DuplicateCustomerError` se un ALTRO cliente coincide per P.IVA/CF/nome. */
export async function saveCustomer(c: Customer): Promise<StoredCustomer> {
  const clean = normalizeCustomerRecord(c);
  if (!clean.name) throw new Error('Il nome del cliente è obbligatorio.');
  return getBackend().transact('readwrite', async (t) => {
    const all = await t.all<StoredCustomer>('customers');
    const dup = findDuplicate(clean, all, clean.id);
    if (dup) throw new DuplicateCustomerError(dup);
    const now = Date.now();
    const prev = all.find((x) => x.id === clean.id);
    const rec: StoredCustomer = { ...clean, id: clean.id || uid(), createdAt: prev?.createdAt ?? now, updatedAt: now };
    await t.put('customers', rec);
    return rec;
  });
}

export interface UpsertResult { customer: StoredCustomer; created: boolean; updated: boolean }

const upsertIn = async (t: { all<T>(s: 'customers'): Promise<T[]>; put<T extends { id: string }>(s: 'customers', v: T): Promise<void> }, c: Customer): Promise<UpsertResult> => {
  const clean = normalizeCustomerRecord(c);
  const all = await t.all<StoredCustomer>('customers');
  const dup = findDuplicate(clean, all);
  const now = Date.now();
  if (dup) {
    const { value, changed } = fillMissing(dup, clean);
    if (!changed) return { customer: dup, created: false, updated: false };
    const rec = { ...value, updatedAt: now };
    await t.put('customers', rec);
    return { customer: rec, created: false, updated: true };
  }
  const rec: StoredCustomer = { ...clean, id: clean.id || uid(), createdAt: now, updatedAt: now };
  await t.put('customers', rec);
  return { customer: rec, created: true, updated: false };
};

/**
 * Inserisce il cliente se nuovo; se esiste già (stessa P.IVA/CF/nome) completa SOLO i campi vuoti della scheda
 * esistente, senza sovrascrivere nulla. Usato al salvataggio di un documento e dall'importazione CSV.
 */
export const upsertCustomer = async (c: Customer): Promise<UpsertResult> => {
  if (!normalizeCustomerRecord(c).name) throw new Error('Il nome del cliente è obbligatorio.');
  return getBackend().transact('readwrite', (t) => upsertIn(t, c));
};

/** Importa molti clienti in una sola transazione (righe senza nome ignorate). */
export async function upsertCustomers(list: Customer[]): Promise<{ created: number; merged: number; skipped: number }> {
  return getBackend().transact('readwrite', async (t) => {
    let created = 0; let merged = 0; let skipped = 0;
    for (const c of list) {
      if (!normalizeCustomerRecord(c).name) { skipped++; continue; }
      const r = await upsertIn(t, c);
      if (r.created) created++; else merged++;
    }
    return { created, merged, skipped };
  });
}

/** Elimina SOLO la scheda in rubrica: i documenti già creati non vengono toccati (hanno la loro copia dei dati). */
export const deleteCustomer = async (id: string): Promise<void> => {
  await getBackend().transact('readwrite', (t) => t.del('customers', id));
};

/**
 * Unisce duplicati: i dati di `keepId` hanno la precedenza, i campi che mancano vengono presi dagli altri (nell'ordine dato);
 * le schede `removeIds` vengono eliminate. I documenti non cambiano: il collegamento avviene per id, P.IVA/CF o nome.
 */
export async function mergeCustomers(keepId: string, removeIds: string[]): Promise<StoredCustomer> {
  return getBackend().transact('readwrite', async (t) => {
    const keep = await t.get<StoredCustomer>('customers', keepId);
    if (!keep) throw new Error('Cliente da mantenere non trovato.');
    let cur: StoredCustomer = keep;
    for (const id of removeIds) {
      if (id === keepId) continue;
      const other = await t.get<StoredCustomer>('customers', id);
      if (!other) continue;
      cur = { ...fillMissing(cur, other).value, createdAt: Math.min(cur.createdAt, other.createdAt) };
      await t.del('customers', id);
    }
    cur = { ...cur, updatedAt: Date.now() };
    await t.put('customers', cur);
    return cur;
  });
}

/**
 * (Ri)popola la rubrica dai clienti dei documenti. Idempotente: non duplica, completa solo i campi vuoti.
 * Si esegue da sola una volta alla migrazione a v3 e all'import di un backup precedente; qui è esposta per l'azione manuale.
 */
export async function importCustomersFromDocuments(): Promise<number> {
  return getBackend().transact('readwrite', async (t) => {
    const docs = await t.all<QuoteDocument>('documents');
    const existing = await t.all<StoredCustomer>('customers');
    const changes = seedCustomersFromDocuments(docs, existing);
    for (const c of changes) await t.put('customers', c);
    return changes.length;
  });
}
