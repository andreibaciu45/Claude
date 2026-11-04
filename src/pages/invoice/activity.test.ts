import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../types';
import { fakeInvoice } from '../../pdf/fixtures';
import { ACTIVITY_CSV_HEADER, activityCsv, categoryOf, filterActivity, subjectOf, titleOf } from './activity';

const at = (iso: string) => new Date(`${iso}T10:00:00`).getTime();
const e = (id: string, when: string, action: AuditEntry['action'], docId: string, extra: Partial<AuditEntry> = {}): AuditEntry => ({ id, at: at(when), docId, action, actor: 'user', ...extra });
const inv = fakeInvoice({ id: 'd1' });
const docs = [inv];
const entries: AuditEntry[] = [
  e('1', '2026-03-01', 'create', 'd1', { detail: 'Bozza fattura creata' }),
  e('2', '2026-03-02', 'issue', 'd1', { detail: 'Emessa 12/2026 (IT01234567897_00001.xml)', xmlSha256: 'abc123' }),
  e('3', '2026-03-03', 'download_xml', 'd1', { detail: 'Scaricato IT01234567897_00001.xml' }),
  e('4', '2026-03-05', 'payment', 'd1', { detail: 'Pagamento di 100.00 € il 2026-03-05' }),
  e('5', '2026-03-06', 'edit', 'counter:FT-2026', { detail: 'Numero di partenza impostato: ultimo numero usato 14' }),
  e('6', '2026-03-07', 'voice_command', 'd1', { detail: 'Creata bozza', voiceTranscript: 'fai una fattura a Rossi' }),
  e('7', '2026-03-08', 'edit', '-', { detail: 'Ripristino backup v2' }),
  e('8', '2026-03-09', 'delete_draft', 'gone', { detail: 'Eliminata bozza fattura per Bianchi' }),
];

describe('registro attività: lettura', () => {
  it('categorie e titoli in italiano semplice', () => {
    expect(entries.map(categoryOf)).toEqual(['modifiche', 'emissioni', 'sdi', 'incassi', 'numerazione', 'voce', 'numerazione', 'modifiche']);
    expect(titleOf(entries[1])).toBe('Emessa');
    expect(titleOf(entries[4])).toBe('Numero di partenza impostato');
    expect(titleOf(entries[6])).toBe('Backup ripristinato');
  });
  it('a cosa si riferisce ogni voce', () => {
    expect(subjectOf(entries[1], docs)).toMatch(/^Fattura .* · /);
    expect(subjectOf(entries[4], docs)).toBe('Numerazione fatture 2026');
    expect(subjectOf(e('x', '2026-03-06', 'edit', 'counter:NC-2027'), docs)).toBe('Numerazione note di credito 2027');
    expect(subjectOf(entries[6], docs)).toBe('Tutti i dati');
    expect(subjectOf(entries[7], docs)).toBe('Bozza eliminata');
    expect(subjectOf(e('y', '2026-03-06', 'edit', 'sparito'), docs)).toBe('Documento non più presente');
  });
});

describe('registro attività: filtri', () => {
  const f = (over = {}) => filterActivity(entries, docs, { category: 'tutto', text: '', ...over }).map((x) => x.id);
  it('dal più recente; senza filtri le mostra tutte', () => {
    expect(f()).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
  });
  it('per categoria', () => {
    expect(f({ category: 'emissioni' })).toEqual(['2']);
    expect(f({ category: 'numerazione' })).toEqual(['7', '5']);
    expect(f({ category: 'voce' })).toEqual(['6']);
  });
  it('per date (giorni inclusi)', () => {
    expect(f({ from: '2026-03-03', to: '2026-03-05' })).toEqual(['4', '3']);
    expect(f({ from: '2026-03-09' })).toEqual(['8']);
    expect(f({ to: '2026-03-01' })).toEqual(['1']);
  });
  it('testo libero: senza accenti né maiuscole, anche nel parlato', () => {
    expect(f({ text: 'BIANCHI' })).toEqual(['8']);
    expect(f({ text: 'fai una fattura' })).toEqual(['6']);
    expect(f({ text: 'numero di partenza' })).toEqual(['5']);
    expect(f({ text: 'xyz-nessuno' })).toEqual([]);
  });
  it('filtri combinati', () => {
    expect(f({ category: 'sdi', text: 'xml', from: '2026-03-01', to: '2026-03-31' })).toEqual(['3']);
  });
});

describe('registro attività: CSV', () => {
  it('intestazione, una riga per voce, protezione da formule, impronta XML', () => {
    const csv = activityCsv(filterActivity(entries, docs, { category: 'emissioni', text: '' }), docs).trim().split('\r\n');
    expect(csv[0]).toBe(ACTIVITY_CSV_HEADER.join(';'));
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain(';Emessa;');
    expect(csv[1].endsWith(';abc123')).toBe(true);
    const evil = activityCsv([e('z', '2026-03-01', 'edit', 'd1', { detail: '=HYPERLINK("x")' })], docs);
    expect(evil).toContain("'=HYPERLINK");
  });
  it('il parlato è nel CSV', () => {
    expect(activityCsv([entries[5]], docs)).toContain('Detto a voce: ""fai una fattura a Rossi""');
  });
});
