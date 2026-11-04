// REV2-C3: codifica dei file CSV importati nella rubrica.
import { describe, expect, it } from 'vitest';
import { customersToCsv, decodeCsvBytes, parseCustomersCsv } from './csv';

const win1252 = (s: string) => Uint8Array.from([...s].map((c) => { const n = c.charCodeAt(0); if (n > 255) throw new Error('fuori Latin-1'); return n; }));

describe('decodeCsvBytes', () => {
  it('Windows-1252 (Excel italiano): le lettere accentate restano tali', () => {
    const csv = decodeCsvBytes(win1252('Nome;Comune\r\nCaffè Società Snc;Forlì\r\n'));
    const r = parseCustomersCsv(csv);
    expect(r.customers[0]).toMatchObject({ name: 'Caffè Società Snc', city: 'Forlì' });
    expect(csv).not.toContain('�');
  });
  it('UTF-8 (anche con BOM e simboli fuori Latin-1) invariato', () => {
    const text = '﻿Nome;Comune\r\nÈlite € Café;Forlì\r\n';
    const csv = decodeCsvBytes(new TextEncoder().encode(text));
    expect(csv).toBe(text.slice(1)); // il BOM viene tolto dal decodificatore
    expect(parseCustomersCsv(csv).customers[0].name).toBe('Èlite € Café');
  });
  it('round trip dell\'esportazione dell\'app', () => {
    const out = customersToCsv([{ id: '1', name: 'D\'Angelo "Il Rosso"; Snc', phone: '+39 333 1234567', city: 'Forlì' }]);
    const back = parseCustomersCsv(decodeCsvBytes(new TextEncoder().encode(out))).customers[0];
    expect(back).toMatchObject({ name: 'D\'Angelo "Il Rosso"; Snc', phone: '+39 333 1234567', city: 'Forlì' });
  });
  it('righe con formule: importate come testo, mai eseguite; separatori diversi', () => {
    const r = parseCustomersCsv('Nome,Email\n"=HYPERLINK(""http://x"")",a@b.it\n');
    expect(r.customers[0].name).toBe('=HYPERLINK("http://x")');
    expect(customersToCsv(r.customers)).toContain("'=HYPERLINK");
    expect(parseCustomersCsv('Nome\tTelefono\nRossi\t333\n').customers[0].phone).toBe('333');
  });
  it('file senza righe valide o con riga enorme: nessuna eccezione', () => {
    expect(parseCustomersCsv('Nome\n').customers).toEqual([]);
    const big = 'Nome\n' + 'x'.repeat(2_000_000) + '\n';
    expect(parseCustomersCsv(big).customers[0].name.length).toBe(2_000_000);
  });
});
