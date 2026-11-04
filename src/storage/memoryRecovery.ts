/**
 * Recupero dei dati scritti in memoria quando l'apertura iniziale di IndexedDB era fallita (REV2-A1).
 * Logica PURA: dato lo snapshot della memoria e il contenuto dell'archivio persistente, calcola cosa scrivere.
 * Si trasferiscono SOLO dati non fiscali (preventivi, bozze, rubrica, listino): le fatture emesse non devono esistere in
 * memoria (le emissioni sono bloccate) e, se per un errore comparissero, NON vengono mai trasferite.
 * Id preservati; se l'id esiste già nell'archivio persistente con contenuto diverso, si tengono ENTRAMBI (la copia in arrivo prende un nuovo id).
 */
import type { AuditEntry, CatalogItem, QuoteDocument } from '../types';
import { uid } from '../types';
import type { StoredCustomer } from './customerModel';

export interface MemorySnapshot {
  catalog: CatalogItem[];
  customers: StoredCustomer[];
  documents: QuoteDocument[];
  audit: AuditEntry[];
}

export interface RecoveryPlan extends MemorySnapshot {
  /** Id (di memoria) di tutto ciò che è stato preso in carico, per ripulire la memoria dopo il successo. */
  taken: { catalog: string[]; customers: string[]; documents: string[]; audit: string[] };
  /** Documenti non fiscali che verranno scritti (copie già identiche non contano). */
  documentCount: number;
  itemCount: number;
}

/** Fattura emessa o comunque con numerazione fiscale: non va MAI trasferita. */
export const isFiscalRecord = (d: QuoteDocument): boolean => {
  const i = d.invoice;
  return !!i && (!!i.lockedAt || i.seq !== undefined || !!i.number);
};

export const snapshotSize = (s: MemorySnapshot): number => s.catalog.length + s.customers.length + s.documents.length;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function planRecovery(mem: MemorySnapshot, existing: MemorySnapshot): RecoveryPlan {
  const have = {
    catalog: new Map(existing.catalog.map((x) => [x.id, x])),
    customers: new Map(existing.customers.map((x) => [x.id, x])),
    documents: new Map(existing.documents.map((x) => [x.id, x])),
    audit: new Set(existing.audit.map((x) => x.id)),
  };
  const taken = { catalog: [] as string[], customers: [] as string[], documents: [] as string[], audit: [] as string[] };
  const out: RecoveryPlan = { catalog: [], customers: [], documents: [], audit: [], taken, documentCount: 0, itemCount: 0 };
  const pick = <T extends { id: string }>(list: T[], known: Map<string, T>, into: T[], takenIds: string[], remap?: Map<string, string>): number => {
    let n = 0;
    for (const x of list) {
      takenIds.push(x.id);
      const prev = known.get(x.id);
      if (prev && same(prev, x)) continue; // già presente (tentativo ripetuto): niente duplicati
      if (!prev) { into.push(x); known.set(x.id, x); n++; continue; }
      const nid = uid();
      remap?.set(x.id, nid);
      into.push({ ...x, id: nid });
      n++;
    }
    return n;
  };
  const docRemap = new Map<string, string>();
  const docs = mem.documents.filter((d) => !isFiscalRecord(d));
  for (const d of mem.documents) if (isFiscalRecord(d)) { /* ignorata: resta in memoria e non viene cancellata */ }
  out.documentCount = pick(docs, have.documents, out.documents, taken.documents, docRemap);
  out.itemCount = pick(mem.customers, have.customers, out.customers, taken.customers)
    + pick(mem.catalog, have.catalog, out.catalog, taken.catalog) + out.documentCount;
  const keptDocIds = new Set(docs.map((d) => d.id));
  for (const a of mem.audit) {
    if (!keptDocIds.has(a.docId)) continue;
    taken.audit.push(a.id);
    if (have.audit.has(a.id)) continue;
    have.audit.add(a.id);
    out.audit.push({ ...a, docId: docRemap.get(a.docId) ?? a.docId });
  }
  return out;
}
