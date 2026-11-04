// RIFINITURE-3: CSV (neutralizzazione \r \n \t in tutti gli export, decodifica Windows-1252 e velocità del listino).
import { describe, expect, it } from 'vitest';
import type { AuditEntry, CatalogItem } from '../../types';
import { fakeInvoice } from '../../pdf/fixtures';
import { activityCsv } from '../invoice/activity';
import { csvText, invoiceRegisterCsv } from '../invoice/register';
import { customersToCsv, parseCustomersCsv } from '../customers/csv';
import { MAX_CSV_BYTES, decodeCsvBytes } from '../../storage/csvDecode';
import { buildItems, guessMapping, itemsToCsv, parseCsv } from './csv';

const win1252 = (s: string) => Uint8Array.from([...s].map((c) => { const n = c.charCodeAt(0); if (n > 255) throw new Error('fuori Latin-1'); return n; }));
const importCsv = (text: string) => { const rows = parseCsv(text); return buildItems(rows, guessMapping(rows[0]), 22, 1); };

describe('neutralizzazione di \\r \\n \\t', () => {
  it('csvText: nessun \\r, \\n, \\t isolato o a inizio campo sopravvive; le formule restano protette', () => {
    for (const v of ['a\rb', 'a\nb', 'a\tb', '\rcmd', '\tcmd', '\ncmd', 'a\r\nb', 'x\r']) expect(csvText(v)).not.toMatch(/[\r\n\t]/);
    expect(csvText('a\rb')).toBe('a b');
    expect(csvText('\r=CMD()')).toBe("'=CMD()");
    expect(csvText('=CMD()')).toBe("'=CMD()");
    expect(csvText('  @x')).toBe("'@x");
  });
  it('registro fatture: un \\r nel nome cliente non rompe la riga', () => {
    const d = fakeInvoice({ id: 'a', customer: { id: 'c', name: 'Rossi\rMario\tSrl' } });
    const csv = invoiceRegisterCsv([d], true);
    const body = csv.slice(0, -2); // senza l'ultimo CRLF
    expect(body.split('\r\n')).toHaveLength(2);
    expect(body).not.toMatch(/\r(?!\n)/);
    expect(body).toContain('Rossi Mario Srl');
  });
  it('registro attività, rubrica e listino: stessa regola', () => {
    const docs = [fakeInvoice({ id: 'd1' })];
    const e: AuditEntry = { id: 'z', at: 1, docId: 'd1', action: 'edit', actor: 'user', detail: 'riga1\rriga2\tx' };
    const act = activityCsv([e], docs).slice(0, -2);
    expect(act.split('\r\n')).toHaveLength(2);
    expect(act).not.toMatch(/\r(?!\n)/);
    const cust = customersToCsv([{ id: '1', name: 'Mario\rRossi', address: '\tVia\nRoma' }]);
    expect(cust.slice(0, -2).split('\r\n')).toHaveLength(2);
    expect(cust).not.toMatch(/\r(?!\n)|\t/);
    const item: CatalogItem = { id: 'i', name: 'Tubo\r=1+1', aliases: ['a\tb'], unit: 'm', price: 1.5, vat: 22, kind: 'materiale', category: '\r+cmd', createdAt: 1, updatedAt: 1 };
    const cat = itemsToCsv([item]);
    expect(cat.split('\r\n')).toHaveLength(2);
    expect(cat.split('\r\n')[1]).not.toMatch(/[\r\t]/);
    expect(cat).toContain("'+cmd");
  });
  it('round trip del listino con nome che inizia per "="', () => {
    const item: CatalogItem = { id: 'i', name: '=Tubo', aliases: [], unit: 'm', price: 1.5, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1 };
    expect(importCsv(itemsToCsv([item]))[0].item?.name).toBe('=Tubo');
  });
});

describe('importazione listino: codifica, separatori, decimali', () => {
  it('Windows-1252 di Excel: «Caffè» non diventa «Caff�»', () => {
    const csv = decodeCsvBytes(win1252('nome;prezzo;unita\r\nCaffè macinato;4,50;kg\r\nPerlina à €;1;pz\r\n'.replace('€', '\u0080')));
    const r = importCsv(csv);
    expect(r[0].item?.name).toBe('Caffè macinato');
    expect(csv).not.toContain('�');
    expect(csv).toContain('à €'); // 0x80 in Windows-1252 = euro
  });
  it('UTF-8 con BOM e senza', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('﻿nome;prezzo\nCaffè;1')).startsWith('nome')).toBe(true);
    expect(importCsv(decodeCsvBytes(new TextEncoder().encode('nome;prezzo\nCaffè;1,5')))[0].item).toMatchObject({ name: 'Caffè', price: 1.5 });
  });
  it('esportazione -> byte UTF-8 -> importazione = stessi dati', () => {
    const item: CatalogItem = { id: 'i', name: 'Caffè "speciale"; 1kg', aliases: ['moka'], unit: 'kg', price: 1234.5, vat: 10, kind: 'materiale', category: 'Bar', stock: 2.5, createdAt: 1, updatedAt: 1 };
    const back = importCsv(decodeCsvBytes(new TextEncoder().encode(itemsToCsv([item]))))[0].item!;
    expect(back).toMatchObject({ name: item.name, price: 1234.5, vat: 10, unit: 'kg', stock: 2.5, aliases: ['moka'], category: 'Bar' });
  });
  it.each([[';'], [','], ['\t']])('separatore %j con decimali a virgola (campi tra virgolette)', (sep) => {
    const q = (s: string) => `"${s}"`;
    const csv = [['nome', 'prezzo', 'iva'].join(sep), [q('Tubo'), q('1.234,50'), '22'].join(sep), [q('Raccordo'), q('0,75'), '10'].join(sep)].join('\n');
    const r = importCsv(csv);
    expect(r.map((x) => x.item?.price)).toEqual([1234.5, 0.75]);
    expect(r[1].item?.vat).toBe(10);
  });
  it('limite di dimensione condiviso', () => { expect(MAX_CSV_BYTES).toBe(5 * 1024 * 1024); });
  it('5.000 righe: lettura e costruzione in meno di 1 s', () => {
    const lines = ['nome;prezzo;unita;iva;categoria'];
    for (let i = 0; i < 5000; i++) lines.push(`Voce ${i};${(i % 97) + 0.5}`.replace('.', ',') + `;pz;22;Cat ${i % 20}`);
    const csv = decodeCsvBytes(new TextEncoder().encode(lines.join('\r\n')));
    const t0 = performance.now();
    const r = importCsv(csv);
    const ms = performance.now() - t0;
    expect(r.filter((x) => x.item)).toHaveLength(5000);
    expect(ms).toBeLessThan(1000);
  });
});

describe('rubrica: round trip dopo la neutralizzazione', () => {
  it('formule ancora protette e ripristinate', () => {
    const csv = customersToCsv([{ id: '1', name: '=HYPERLINK("x")' }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(parseCustomersCsv(csv).customers[0].name).toBe('=HYPERLINK("x")');
  });
});
