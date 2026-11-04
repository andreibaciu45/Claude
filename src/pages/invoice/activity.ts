/**
 * Registro attività: trasforma le voci del registro (audit, append-only) in righe leggibili da un non tecnico, con filtri ed esportazione CSV.
 * Logica PURA (nessun accesso allo storage). Le voci non si modificano mai: qui si leggono soltanto.
 */
import type { AuditEntry, QuoteDocument } from '../../types';
import { AUDIT_LABEL, displayNumber, kindLabel } from './model';
import { csvText } from './register';

export type ActivityCategory = 'tutto' | 'emissioni' | 'sdi' | 'incassi' | 'modifiche' | 'numerazione' | 'voce';

export const ACTIVITY_CATEGORIES: { value: ActivityCategory; label: string }[] = [
  { value: 'tutto', label: 'Tutte le attività' },
  { value: 'emissioni', label: 'Emissioni e note di credito' },
  { value: 'sdi', label: 'Invio allo SDI e XML' },
  { value: 'incassi', label: 'Incassi' },
  { value: 'modifiche', label: 'Creazioni, modifiche ed eliminazioni' },
  { value: 'numerazione', label: 'Numerazione e backup' },
  { value: 'voce', label: 'Comandi vocali' },
];

/** Pseudo-documenti del registro: la numerazione (`counter:FT-2026`) e i ripristini di backup (`-`). */
export const isCounterEntry = (e: Pick<AuditEntry, 'docId'>): boolean => e.docId.startsWith('counter:');
export const isBackupEntry = (e: Pick<AuditEntry, 'docId'>): boolean => e.docId === '-';

export function categoryOf(e: AuditEntry): Exclude<ActivityCategory, 'tutto'> {
  if (isCounterEntry(e) || isBackupEntry(e)) return 'numerazione';
  switch (e.action) {
    case 'issue': case 'credit_note': return 'emissioni';
    case 'download_xml': case 'mark_sent': case 'sdi_event': return 'sdi';
    case 'payment': return 'incassi';
    case 'voice_command': return 'voce';
    default: return 'modifiche';
  }
}

/** Titolo breve in italiano semplice. */
export function titleOf(e: AuditEntry): string {
  if (isCounterEntry(e)) return 'Numero di partenza impostato';
  if (isBackupEntry(e)) return 'Backup ripristinato';
  return AUDIT_LABEL[e.action] ?? e.action;
}

const COUNTER_RE = /^counter:(FT|NC)-(\d{4})$/;

/** A cosa si riferisce la voce: "Fattura 12/2026 · Rossi Srl", "Numerazione fatture 2026"... */
export function subjectOf(e: AuditEntry, docs: Pick<QuoteDocument, 'id' | 'type' | 'invoice' | 'number' | 'status' | 'customer'>[]): string {
  const c = COUNTER_RE.exec(e.docId);
  if (c) return `Numerazione ${c[1] === 'NC' ? 'note di credito' : 'fatture'} ${c[2]}`;
  if (isBackupEntry(e)) return 'Tutti i dati';
  const d = docs.find((x) => x.id === e.docId);
  if (!d) return e.action === 'delete_draft' ? 'Bozza eliminata' : 'Documento non più presente';
  return `${kindLabel(d)} ${displayNumber(d)}${d.customer?.name ? ` · ${d.customer.name}` : ''}`;
}

export const fmtDateTime = (ms: number): string => new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

export interface ActivityFilter {
  category: ActivityCategory;
  /** testo libero: cerca in documento, cliente, titolo e dettagli (senza accenti né maiuscole) */
  text: string;
  /** ISO yyyy-mm-dd inclusi (giorno locale) */
  from?: string;
  to?: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const dayEnd = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime();

/** Filtra e ordina dal più recente. */
export function filterActivity(entries: AuditEntry[], docs: Parameters<typeof subjectOf>[1], f: ActivityFilter): AuditEntry[] {
  const t = norm(f.text.trim());
  const from = f.from ? dayStart(f.from) : -Infinity;
  const to = f.to ? dayEnd(f.to) : Infinity;
  return entries
    .filter((e) => (f.category === 'tutto' || categoryOf(e) === f.category) && e.at >= from && e.at <= to)
    .filter((e) => !t || norm(`${subjectOf(e, docs)} ${titleOf(e)} ${e.detail ?? ''} ${e.voiceTranscript ?? ''}`).includes(t))
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

export const ACTIVITY_CSV_HEADER = ['Data e ora', 'Documento', 'Tipo di attività', 'Descrizione', 'Impronta XML (SHA-256)'] as const;

/** CSV (separatore ';', Excel italiano) delle voci già filtrate. Una riga per voce, dal più recente. */
export function activityCsv(entries: AuditEntry[], docs: Parameters<typeof subjectOf>[1]): string {
  const lines: string[] = [ACTIVITY_CSV_HEADER.join(';')];
  for (const e of entries) {
    lines.push([
      fmtDateTime(e.at),
      csvText(subjectOf(e, docs)),
      csvText(titleOf(e)),
      csvText([e.detail, e.voiceTranscript && `Detto a voce: "${e.voiceTranscript}"`].filter(Boolean).join(' — ')),
      csvText(e.xmlSha256 ?? ''), // REV-H1: arriva anche da backup/sync, non è garantito esadecimale
    ].join(';'));
  }
  return lines.join('\r\n') + '\r\n';
}
