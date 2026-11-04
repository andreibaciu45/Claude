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
  fillMissing, findDuplicate, normalizeCustomerRecord, normCf, normName, normVat, sameCustomer, seedCustomersFromDocuments,
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

type UpsertTx = { all<T>(s: 'customers'): Promise<T[]>; put<T extends { id: string }>(s: 'customers', v: T): Promise<void> };

/**
 * Indice della rubrica per trovare i duplicati senza confrontare ogni scheda con ogni riga (REV2-C2: l'importazione di 2000 righe
 * rileggeva tutta la rubrica a ogni riga e confrontava tutte le coppie: 16 s, interfaccia ferma). Un duplicato ha per forza la
 * stessa P.IVA, lo stesso CF o lo stesso nome normalizzato: si confrontano (con `sameCustomer`) solo quelle schede, nell'ordine originale.
 */
class BookIndex {
  private order = new Map<string, number>();
  private recs = new Map<string, StoredCustomer>();
  private keys = new Map<string, Set<string>>();
  private seq = 0;
  constructor(list: StoredCustomer[]) { for (const c of list) this.set(c); }
  private keysOf(c: Customer): string[] {
    const k: string[] = [];
    const v = normVat(c.vatNumber ?? c.vatOrFiscalCode); if (v) k.push(`v:${v}`);
    const f = normCf(c.fiscalCode); if (f) k.push(`f:${f}`);
    const n = normName(c.name ?? ''); if (n) k.push(`n:${n}`);
    return k;
  }
  private unindex(c: StoredCustomer): void { for (const k of this.keysOf(c)) this.keys.get(k)?.delete(c.id); }
  set(c: StoredCustomer): void {
    const old = this.recs.get(c.id);
    if (old) this.unindex(old); else this.order.set(c.id, this.seq++);
    this.recs.set(c.id, c);
    for (const k of this.keysOf(c)) (this.keys.get(k) ?? this.keys.set(k, new Set()).get(k)!).add(c.id);
  }
  find(c: Customer): StoredCustomer | undefined {
    const ids = new Set<string>();
    for (const k of this.keysOf(c)) for (const id of this.keys.get(k) ?? []) ids.add(id);
    // 'vatOrFiscalCode' legacy non smistato: raro, ripiego sul confronto completo
    if (c.vatOrFiscalCode && !ids.size) return findDuplicate(c, [...this.recs.values()]);
    let best: StoredCustomer | undefined;
    for (const id of ids) {
      const r = this.recs.get(id)!;
      if (sameCustomer(c, r) && (!best || this.order.get(id)! < this.order.get(best.id)!)) best = r;
    }
    return best;
  }
}

const upsertWith = async (t: UpsertTx, index: BookIndex, c: Customer): Promise<UpsertResult> => {
  const clean = normalizeCustomerRecord(c);
  const dup = index.find(clean);
  const now = Date.now();
  if (dup) {
    const { value, changed } = fillMissing(dup, clean);
    if (!changed) return { customer: dup, created: false, updated: false };
    const rec = { ...value, updatedAt: now };
    await t.put('customers', rec);
    index.set(rec);
    return { customer: rec, created: false, updated: true };
  }
  const rec: StoredCustomer = { ...clean, id: clean.id || uid(), createdAt: now, updatedAt: now };
  await t.put('customers', rec);
  index.set(rec);
  return { customer: rec, created: true, updated: false };
};

const upsertIn = async (t: UpsertTx, c: Customer): Promise<UpsertResult> => upsertWith(t, new BookIndex(await t.all<StoredCustomer>('customers')), c);

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
    const index = new BookIndex(await t.all<StoredCustomer>('customers'));
    for (const c of list) {
      if (!normalizeCustomerRecord(c).name) { skipped++; continue; }
      const r = await upsertWith(t, index, c);
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
