/**
 * Controllo di integrità dell'archivio (sola lettura): numerazione, duplicati, XML e hash delle fatture emesse,
 * note di credito orfane, audit delle emissioni. Non modifica nulla. Messaggi in italiano per non tecnici.
 * Un esito "da verificare" non è una diagnosi fiscale: mostra solo ciò che nei dati locali non quadra [DA VERIFICARE col commercialista].
 */
import type { AuditEntry, InvoiceFiscal, QuoteDocument } from '../types';
import { getBackend, withDefaults } from './db';
import { creditResidual, effectiveCreditNotes } from './creditResidual';
import { formatInvoiceNumber, sha256Hex } from './invoices';

export type IntegrityCode =
  | 'numbering_gap' | 'numbering_gap_declared' | 'counter_behind'
  | 'duplicate_number' | 'duplicate_progressivo' | 'duplicate_file_name'
  | 'missing_xml' | 'missing_hash' | 'hash_mismatch' | 'history_hash_mismatch'
  | 'credit_note_orphan' | 'credit_note_exceeds'
  | 'missing_issue_audit' | 'audit_hash_mismatch';

export interface IntegrityIssue {
  code: IntegrityCode;
  /** 'error' = problema da risolvere; 'warning' = da controllare, può avere una spiegazione innocua. */
  severity: 'error' | 'warning';
  /** Frase comprensibile da un non tecnico. */
  message: string;
  docIds: string[];
}

export interface IntegrityReport {
  /** true = nessun errore (possono esserci avvisi). */
  ok: boolean;
  /** true = nessun errore e nessun avviso. */
  clean: boolean;
  checkedAt: number;
  counts: { documents: number; issuedInvoices: number; creditNotes: number; auditEntries: number };
  issues: IntegrityIssue[];
  /** Una riga di sintesi per l'interfaccia. */
  summary: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isIssued = (d: QuoteDocument): d is QuoteDocument & { invoice: InvoiceFiscal } =>
  d.type === 'fattura' && !!d.invoice && !d.invoice.legacy && !!d.invoice.lockedAt;
const label = (d: QuoteDocument): string => d.invoice?.number || d.number || d.id;
const list = (xs: string[], max = 6): string => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} e altri ${xs.length - max}`);

/** Calcola gli SHA-256 a gruppi per non bloccare l'interfaccia con migliaia di fatture. */
async function hashAll(items: { key: string; xml: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CHUNK = 64;
  for (let i = 0; i < items.length; i += CHUNK) {
    const part = items.slice(i, i + CHUNK);
    const hs = await Promise.all(part.map((p) => sha256Hex(p.xml)));
    part.forEach((p, k) => out.set(p.key, hs[k]));
    if (i + CHUNK < items.length) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return out;
}

export function integritySummary(issues: IntegrityIssue[]): string {
  const e = issues.filter((i) => i.severity === 'error').length;
  const w = issues.length - e;
  if (!issues.length) return 'Tutto in ordine: nessun problema trovato.';
  const parts: string[] = [];
  if (e) parts.push(`${e} problem${e === 1 ? 'a' : 'i'} da risolvere`);
  if (w) parts.push(`${w} cos${w === 1 ? 'a' : 'e'} da controllare`);
  return parts.join(' e ');
}

/** Esegue tutti i controlli. Sola lettura: una transazione `readonly`. */
export async function verifyStorageIntegrity(): Promise<IntegrityReport> {
  const { docs, audit, profile } = await getBackend().transact('readonly', async (t) => ({
    docs: await t.all<QuoteDocument>('documents'),
    audit: await t.all<AuditEntry>('audit'),
    profile: withDefaults(await t.getProfile()),
  }));
  const issues: IntegrityIssue[] = [];
  const add = (code: IntegrityCode, severity: IntegrityIssue['severity'], message: string, docIds: string[]) => issues.push({ code, severity, message, docIds });

  const issued = docs.filter(isIssued);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const auditByDoc = new Map<string, AuditEntry[]>();
  const counterAudit = new Set<string>(); // chiavi "FT-2026" con "numero di partenza" impostato a mano
  for (const a of audit) {
    (auditByDoc.get(a.docId) ?? auditByDoc.set(a.docId, []).get(a.docId)!).push(a);
    const m = /^counter:((?:FT|NC)-\d{4})$/.exec(a.docId);
    if (m) counterAudit.add(m[1]);
  }

  // 1) numerazione per sezionale/anno: duplicati e buchi
  const reportedDup = new Set<string>();
  const groups = new Map<string, (QuoteDocument & { invoice: InvoiceFiscal })[]>();
  for (const d of issued) {
    if (typeof d.invoice.seq !== 'number') continue;
    const k = `${d.invoice.sectional}-${d.invoice.year}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  for (const [key, ds] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const bySeq = new Map<number, typeof ds>();
    for (const d of ds) (bySeq.get(d.invoice.seq!) ?? bySeq.set(d.invoice.seq!, []).get(d.invoice.seq!)!).push(d);
    const [sec, yr] = key.split('-');
    for (const [seq, same] of bySeq) {
      if (same.length > 1) {
        same.forEach((d) => reportedDup.add(d.id));
        add('duplicate_number', 'error', `Il numero ${formatInvoiceNumber(sec, seq, Number(yr))} compare ${same.length} volte (${list(same.map(label))}). Due documenti non possono avere lo stesso numero.`, same.map((d) => d.id));
      }
    }
    const seqs = [...bySeq.keys()].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let i = 1; i < seqs.length; i++) for (let n = seqs[i - 1] + 1; n < seqs[i]; n++) { if (missing.length < 500) missing.push(n); }
    const declared = counterAudit.has(key);
    if (missing.length) {
      const nums = missing.map((n) => formatInvoiceNumber(sec, n, Number(yr)));
      add(declared ? 'numbering_gap_declared' : 'numbering_gap', declared ? 'warning' : 'error',
        declared
          ? `Nella numerazione ${key} mancano i numeri ${list(nums)}. Hai impostato a mano il numero di partenza, quindi potrebbe essere voluto: controlla.`
          : `Nella numerazione ${key} mancano i numeri ${list(nums)}: la sequenza ha dei buchi. Le fatture emesse non si cancellano, quindi potrebbero mancare dati (per esempio dopo un ripristino da un backup vecchio).`,
        ds.map((d) => d.id));
    } else if (seqs[0] > 1 && !declared) {
      // la serie non parte da 1 e nessun "numero di partenza" è stato impostato qui: può mancare l'inizio
      add('numbering_gap', 'warning', `La numerazione ${key} parte dal numero ${seqs[0]} e non dal 1. Se non l'hai voluto (numero di partenza), mancano le fatture precedenti.`, ds.map((d) => d.id));
    }
    const maxSeq = seqs[seqs.length - 1];
    const counter = Math.floor(profile.invoiceYearCounters?.[key] ?? 0);
    if (counter < maxSeq) {
      add('counter_behind', 'error', `Il contatore ${key} è fermo a ${counter} ma esiste già il numero ${maxSeq}: la prossima fattura rischia di riusare un numero già emesso.`, bySeq.get(maxSeq)!.map((d) => d.id));
    }
  }

  // 2) duplicati di progressivo invio / nome file tra i documenti emessi
  const dupBy = (pick: (d: QuoteDocument & { invoice: InvoiceFiscal }) => string | undefined, code: IntegrityCode, what: string, severity: IntegrityIssue['severity'] = 'warning') => {
    const m = new Map<string, QuoteDocument[]>();
    for (const d of issued) {
      const v = pick(d);
      if (v) (m.get(v) ?? m.set(v, []).get(v)!).push(d);
    }
    for (const [v, ds] of m) {
      if (ds.length > 1 && !ds.every((d) => reportedDup.has(d.id))) add(code, severity, `${what} ${v} è usato da ${ds.length} documenti (${list(ds.map(label))}).`, ds.map((d) => d.id));
    }
  };
  dupBy((d) => d.invoice.number, 'duplicate_number', 'Il numero', 'error');
  dupBy((d) => d.invoice.progressivoInvio, 'duplicate_progressivo', 'Il progressivo di invio');
  dupBy((d) => d.invoice.fileName, 'duplicate_file_name', 'Il nome file XML');

  // 3) XML e hash delle fatture emesse
  const noXml: typeof issued = [];
  const noHash: typeof issued = [];
  const toHash: { key: string; xml: string }[] = [];
  for (const d of issued) {
    if (!d.invoice.xml) { noXml.push(d); continue; }
    if (!d.invoice.xmlSha256) noHash.push(d);
    toHash.push({ key: d.id, xml: d.invoice.xml });
    (d.invoice.xmlHistory ?? []).forEach((h, i) => { if (h.xml && h.xmlSha256) toHash.push({ key: `${d.id}#${i}`, xml: h.xml }); });
  }
  const hashes = await hashAll(toHash);
  if (noXml.length) {
    add('missing_xml', 'error', `${noXml.length} document${noXml.length === 1 ? 'o emesso è' : 'i emessi sono'} senza il file XML (${list(noXml.map(label))}): il file della fattura elettronica non è più recuperabile da qui.`, noXml.map((d) => d.id));
  }
  if (noHash.length) {
    add('missing_hash', 'error', `${noHash.length} document${noHash.length === 1 ? 'o emesso è' : 'i emessi sono'} senza impronta di controllo (${list(noHash.map(label))}): non si può dimostrare che l'XML sia quello originale.`, noHash.map((d) => d.id));
  }
  const badHash: typeof issued = [];
  const badHist: typeof issued = [];
  for (const d of issued) {
    if (d.invoice.xml && d.invoice.xmlSha256 && hashes.get(d.id) !== d.invoice.xmlSha256) badHash.push(d);
    if ((d.invoice.xmlHistory ?? []).some((h, i) => h.xml && h.xmlSha256 && hashes.get(`${d.id}#${i}`) !== h.xmlSha256)) badHist.push(d);
  }
  if (badHash.length) {
    add('hash_mismatch', 'error', `${badHash.length} document${badHash.length === 1 ? 'o emesso ha' : 'i emessi hanno'} un XML diverso da quello originale (${list(badHash.map(label))}): il contenuto è stato alterato o danneggiato dopo l'emissione.`, badHash.map((d) => d.id));
  }
  if (badHist.length) {
    add('history_hash_mismatch', 'warning', `Nello storico delle versioni XML di ${list(badHist.map(label))} c'è un file che non corrisponde alla sua impronta.`, badHist.map((d) => d.id));
  }

  // 4) note di credito orfane / che superano la fattura
  const notes = issued.filter((d) => d.invoice.tipoDocumento === 'TD04');
  const orphans = notes.filter((n) => {
    const o = n.invoice.originalDocumentId ? byId.get(n.invoice.originalDocumentId) : undefined;
    return !o || o.invoice?.tipoDocumento !== 'TD01';
  });
  if (orphans.length) {
    add('credit_note_orphan', 'error', `${orphans.length} nota${orphans.length === 1 ? ' di credito non ha' : ' di credito non hanno'} più la fattura collegata (${list(orphans.map(label))}): la fattura stornata manca o il collegamento è rotto.`, orphans.map((d) => d.id));
  }
  const exceed: string[] = [];
  const exceedIds: string[] = [];
  for (const o of issued) {
    if (o.invoice.tipoDocumento !== 'TD01') continue;
    const eff = effectiveCreditNotes(docs, o.id);
    if (!eff.length) continue;
    const r = creditResidual(o, eff);
    if (r.creditedCents > r.originalCents + eff.length) { exceed.push(label(o)); exceedIds.push(o.id); }
  }
  if (exceed.length) {
    add('credit_note_exceeds', 'error', `Le note di credito su ${list(exceed)} superano l'importo della fattura.`, exceedIds);
  }

  // 5) audit delle emissioni
  const noIssueAudit: typeof issued = [];
  const auditHashBad: typeof issued = [];
  for (const d of issued) {
    const entries = auditByDoc.get(d.id) ?? [];
    const iss = entries.filter((a) => a.action === 'issue');
    if (!iss.length) { noIssueAudit.push(d); continue; }
    const hashesSeen = new Set(entries.map((a) => a.xmlSha256).filter((h): h is string => !!h && HEX64.test(h)));
    const cur = d.invoice.xmlSha256;
    if (cur && hashesSeen.size && !hashesSeen.has(cur)) auditHashBad.push(d);
  }
  if (noIssueAudit.length) {
    add('missing_issue_audit', 'warning', `Per ${noIssueAudit.length} document${noIssueAudit.length === 1 ? 'o emesso' : 'i emessi'} manca la registrazione dell'emissione nel registro delle operazioni (${list(noIssueAudit.map(label))}). Succede, per esempio, se il registro è stato svuotato o se il documento è stato emesso su un altro dispositivo.`, noIssueAudit.map((d) => d.id));
  }
  if (auditHashBad.length) {
    add('audit_hash_mismatch', 'warning', `Per ${list(auditHashBad.map(label))} l'impronta registrata nel registro delle operazioni non coincide con quella dell'XML attuale.`, auditHashBad.map((d) => d.id));
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return {
    ok, clean: issues.length === 0, checkedAt: Date.now(), issues,
    counts: { documents: docs.length, issuedInvoices: issued.length - notes.length, creditNotes: notes.length, auditEntries: audit.length },
    summary: integritySummary(issues),
  };
}
