/**
 * Anteprima di un ripristino da backup (modulo PURO): conteggi, avvisi di versione e di sostituzione dei dati esistenti.
 * Usata da BackupPage prima di `importBackup`.
 */
import { BACKUP_VERSION, type ParsedBackup, type StorageSummary } from './index';

export interface BackupPreview {
  counts: { catalog: number; documents: number; invoicesIssued: number; customers: number; audit: number };
  /** Frase con i conteggi, es. "12 voci di listino, 30 documenti (di cui 4 fatture emesse), 8 clienti, azienda «X»". */
  summary: string;
  /** Avvisi sul formato/età del file. */
  versionNotes: string[];
  /** Avvisi sulla sostituzione dei dati attuali. */
  replaceNotes: string[];
  /** true = sul dispositivo ci sono già dati che verrebbero sostituiti: serve una conferma esplicita in più. */
  replacesExisting: boolean;
  /** Descrizione dei dati attuali (vuota se non c'è nulla). */
  currentSummary: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function describeCounts(c: { catalog: number; documents: number; invoicesIssued: number; customers: number }, businessName?: string): string {
  const docs = `${plural(c.documents, 'documento', 'documenti')}${c.invoicesIssued ? ` (di cui ${plural(c.invoicesIssued, 'fattura/nota emessa', 'fatture/note emesse')})` : ''}`;
  return `${plural(c.catalog, 'voce di listino', 'voci di listino')}, ${docs}, ${plural(c.customers, 'cliente', 'clienti')}${businessName ? `, azienda «${businessName}»` : ''}`;
}

export function describeBackup(b: ParsedBackup, current: StorageSummary | null): BackupPreview {
  const counts = {
    catalog: b.catalog.length,
    documents: b.documents.length,
    invoicesIssued: b.documents.filter((d) => d.type === 'fattura' && !!d.invoice?.lockedAt).length,
    customers: b.customers.length,
    audit: b.audit.length,
  };
  const versionNotes: string[] = [];
  if (b.version < BACKUP_VERSION) {
    versionNotes.push(`Il file è in un formato più vecchio (v${b.version}; l'app usa il v${BACKUP_VERSION}): viene convertito automaticamente.`);
  }
  if (b.version < 2 && b.documents.some((d) => d.type === 'fattura')) {
    versionNotes.push('Formato v1: le fatture contenute diventano "di cortesia" (non fiscali, senza numero fiscale).');
  }
  if (b.customersDerived) {
    versionNotes.push(`Il file non contiene la rubrica clienti: ne verrà creata una dai clienti dei documenti (${b.customers.length}).`);
  }
  if (!b.exportedAt) versionNotes.push('Nel file non c\'è la data di creazione: non si può sapere quanto sia vecchio.');

  const replaceNotes: string[] = [];
  const hasCurrent = !!current && (current.documents + current.catalog + current.customers > 0 || current.hasProfile);
  if (current && hasCurrent) {
    if (current.invoicesIssued > counts.invoicesIssued) {
      replaceNotes.push(`Su questo dispositivo ci sono ${plural(current.invoicesIssued, 'fattura/nota emessa', 'fatture/note emesse')}, il backup ne contiene ${counts.invoicesIssued}: quelle in più verrebbero sostituite. I contatori di numerazione non vengono abbassati, ma ripristinare un backup vecchio può lasciare buchi nelle numerazioni: verifica con il tuo commercialista.`);
    }
    const t = b.exportedAt ? Date.parse(b.exportedAt) : NaN;
    if (Number.isFinite(t) && current.lastDocumentAt && current.lastDocumentAt > t) {
      replaceNotes.push(`Il backup è stato creato il ${new Date(t).toLocaleDateString('it-IT')}, ma sul dispositivo ci sono modifiche più recenti (${new Date(current.lastDocumentAt).toLocaleDateString('it-IT')}): andrebbero perse.`);
    }
    if (current.customers > counts.customers) replaceNotes.push(`La rubrica attuale ha ${plural(current.customers, 'cliente', 'clienti')}, il backup ${counts.customers}.`);
    if (current.catalog > counts.catalog) replaceNotes.push(`Il listino attuale ha ${plural(current.catalog, 'voce', 'voci')}, il backup ${counts.catalog}.`);
  }
  return {
    counts,
    summary: describeCounts(counts, b.profile.businessName),
    versionNotes,
    replaceNotes,
    replacesExisting: hasCurrent,
    currentSummary: hasCurrent && current ? describeCounts(current) : '',
  };
}
