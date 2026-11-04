import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FatturaPAValidationError, buildCausali, formatProgressivoInvio, generateFatturaPA } from './index';
import { find, parseXml, textOf, toPlain, validateStructure, type XmlNode } from './__tests__/xmlTools';
import { NOW, company, consumer, docExampleA, docExampleB, line, makeDoc, makeProfile } from './__tests__/factories';

const opts = { now: NOW };
const gen = (doc = docExampleA(), profile = makeProfile(), prog = '00001') =>
  generateFatturaPA(doc, profile, prog, opts);
const tree = (xml: string): XmlNode => parseXml(xml);
const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

/** Toglie ciò che il generatore sceglie di non emettere (vedi commenti) per confrontare con i fixture. */
const normalizeForGolden = (n: XmlNode): XmlNode => {
  const { 'xsi:schemaLocation': _omit, ...attrs } = n.attrs; // URL XSD non verificato: omesso di proposito
  return {
    ...n,
    attrs,
    // RiferimentoNumeroLinea è facoltativo e non è nel modello dati (InvoiceFiscal)
    children: n.children.filter((c) => c.name !== 'RiferimentoNumeroLinea').map(normalizeForGolden),
  };
};

describe('golden: esempi di FISCAL-SPEC §2.5', () => {
  it('fixture A (TD01, consumatore, bollo a carico cliente) coincide strutturalmente', () => {
    const out = tree(gen(docExampleA(), makeProfile(), '00001').xml);
    expect(toPlain(normalizeForGolden(out))).toEqual(toPlain(normalizeForGolden(tree(fixture('esempio-A-TD01-consumatore-bollo.xml')))));
    expect(out.attrs).toMatchObject({ versione: 'FPR12', 'xmlns:p': 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2' });
  });
  it('fixture B (TD04 parziale) coincide strutturalmente', () => {
    const out = tree(gen(docExampleB(), makeProfile(), '00002').xml);
    expect(toPlain(normalizeForGolden(out))).toEqual(toPlain(normalizeForGolden(tree(fixture('esempio-B-TD04-parziale.xml')))));
  });
  it('i fixture stessi superano il validatore strutturale', () => {
    expect(validateStructure(tree(fixture('esempio-A-TD01-consumatore-bollo.xml')))).toEqual([]);
    expect(validateStructure(tree(fixture('esempio-B-TD04-parziale.xml')))).toEqual([]);
  });
});

describe('forma del file', () => {
  it('dichiarazione UTF-8, nessun BOM, nome file corretto', () => {
    const r = gen();
    expect(r.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(r.fileName).toBe('IT01234567897_00001.xml');
    expect(r.progressivoInvio).toBe('00001');
    expect(textOf(tree(r.xml), 'ProgressivoInvio')).toBe('00001');
  });
  it('struttura valida (ordine + obbligatori) per tutti gli scenari', () => {
    const scenarios = [
      gen(docExampleA()),
      gen(docExampleB(), makeProfile(), '00002'),
      gen(makeDoc({ lines: [line({ discountPct: 10, qty: 3, unitPrice: 19.99 })] }), makeProfile({ reaOffice: 'RM', reaNumber: '123456', phone: '06 1234567', email: 'a@studio.it' })),
      gen(makeDoc({ customer: company({ country: 'DE', vatNumber: 'DE123456789', zip: '', province: '' }) })),
      gen(makeDoc({ customer: company({ codiceDestinatario: undefined, pec: 'cliente@pec.it' }) })),
    ];
    for (const s of scenarios) expect(validateStructure(tree(s.xml))).toEqual([]);
  });
  it('il validatore strutturale individua errori di ordine e mancanze', () => {
    const bad = gen().xml.replace('<Divisa>EUR</Divisa>', '').replace(/<CAP>00100<\/CAP>/, '');
    expect(validateStructure(tree(bad))).toEqual(expect.arrayContaining([expect.stringContaining('manca <Divisa>'), expect.stringContaining('manca <CAP>')]));
    const swapped = gen().xml.replace(/(<Data>[^<]*<\/Data>)(\s*)(<Numero>[^<]*<\/Numero>)/, '$3$2$1');
    expect(validateStructure(tree(swapped)).some((p) => p.includes('fuori ordine'))).toBe(true);
  });
  it('il parser rifiuta XML malformato', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('<a>x & y</a>')).toThrow();
  });
});

describe('destinatario', () => {
  it('consumatore: 0000000 senza PEC', () => {
    const t = tree(gen(makeDoc({ customer: consumer() })).xml);
    expect(textOf(t, 'CodiceDestinatario')).toBe('0000000');
    expect(find(t, 'PECDestinatario')).toHaveLength(0);
    expect(find(find(t, 'CessionarioCommittente')[0], 'IdFiscaleIVA')).toHaveLength(0);
    expect(textOf(find(t, 'CessionarioCommittente')[0], 'Nome')).toBe('Luigia');
    expect(textOf(find(t, 'CessionarioCommittente')[0], 'Cognome')).toBe('Verdi');
  });
  it('azienda con codice SDI', () => {
    const t = tree(gen(makeDoc({ customer: company() })).xml);
    expect(textOf(t, 'CodiceDestinatario')).toBe('ABC1234');
    expect(textOf(find(t, 'CessionarioCommittente')[0], 'Denominazione')).toBe('Bianchi Costruzioni S.r.l.');
  });
  it('azienda con sola PEC: 0000000 + PECDestinatario', () => {
    const t = tree(gen(makeDoc({ customer: company({ codiceDestinatario: undefined, pec: 'cliente@pec.it' }) })).xml);
    expect(textOf(t, 'CodiceDestinatario')).toBe('0000000');
    expect(textOf(t, 'PECDestinatario')).toBe('cliente@pec.it');
  });
  it('codice destinatario in minuscolo viene normalizzato', () => {
    const t = tree(gen(makeDoc({ customer: company({ codiceDestinatario: 'abc1234' }) })).xml);
    expect(textOf(t, 'CodiceDestinatario')).toBe('ABC1234');
  });
  it('estero: XXXXXXX, IdPaese del cliente, CAP 00000, niente Provincia', () => {
    const t = tree(gen(makeDoc({ customer: company({ country: 'de', vatNumber: 'DE123456789', zip: '10115', province: 'BE', city: 'Berlin', address: 'Strasse 1' }) })).xml);
    const c = find(t, 'CessionarioCommittente')[0];
    expect(textOf(t, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(textOf(find(c, 'IdFiscaleIVA')[0], 'IdPaese')).toBe('DE');
    expect(textOf(find(c, 'IdFiscaleIVA')[0], 'IdCodice')).toBe('DE123456789');
    expect(textOf(c, 'CAP')).toBe('00000');
    expect(find(c, 'Provincia')).toHaveLength(0);
    expect(textOf(c, 'Nazione')).toBe('DE');
  });
});

describe('importi, sconti, arrotondamenti', () => {
  it('sconto di riga: ScontoMaggiorazione e PrezzoTotale arrotondato', () => {
    const t = tree(gen(makeDoc({ lines: [line({ qty: 3, unitPrice: 19.99, discountPct: 10 })] })).xml);
    const d = find(t, 'DettaglioLinee')[0];
    expect(textOf(d, 'PrezzoUnitario')).toBe('19.99');
    expect(textOf(d, 'Tipo')).toBe('SC');
    expect(textOf(d, 'Percentuale')).toBe('10.00');
    expect(textOf(d, 'PrezzoTotale')).toBe('53.97');
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('53.97');
  });
  it('nessuno sconto: nessun blocco ScontoMaggiorazione', () => {
    const t = tree(gen().xml);
    expect(find(t, 'ScontoMaggiorazione')).toHaveLength(0);
  });
  it('arrotondamento half-up e somma dei PrezzoTotale = ImponibileImporto', () => {
    const doc = makeDoc({
      lines: [line({ qty: 3, unitPrice: 1.005 }), line({ qty: 1.5, unitPrice: 0.01 }), line({ qty: 7, unitPrice: 9.99 })],
    });
    const t = tree(gen(doc).xml);
    const totals = find(t, 'DettaglioLinee').map((d) => textOf(d, 'PrezzoTotale'));
    expect(totals).toEqual(['3.02', '0.02', '69.93']);
    expect(textOf(find(t, 'DatiRiepilogo')[0], 'ImponibileImporto')).toBe('72.97');
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('72.97');
  });
  it('quantità frazionarie con 3 decimali', () => {
    const t = tree(gen(makeDoc({ lines: [line({ qty: 2.125, unitPrice: 10 })] })).xml);
    expect(textOf(t, 'Quantita')).toBe('2.125');
    expect(textOf(t, 'PrezzoTotale')).toBe('21.25');
  });
  it('multi-aliquota non ammessa: tutto a 0.00 con un solo riepilogo', () => {
    const t = tree(gen(makeDoc({ lines: [line({ vat: 22, unitPrice: 50 }), line({ vat: 10, unitPrice: 60 })] })).xml);
    expect(find(t, 'AliquotaIVA').every((a) => a.text === '0.00')).toBe(true);
    expect(find(t, 'Imposta').every((a) => a.text === '0.00')).toBe(true);
    expect(find(t, 'DatiRiepilogo')).toHaveLength(1);
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('110.00');
  });
});

describe('bollo', () => {
  const docWith = (price: number, charged: boolean) =>
    makeDoc({ lines: [line({ unitPrice: price })], invoice: { stampDutyChargedToCustomer: charged } });
  it('77,47: nessun bollo', () => {
    const t = tree(gen(docWith(77.47, true)).xml);
    expect(find(t, 'DatiBollo')).toHaveLength(0);
    expect(find(t, 'DettaglioLinee')).toHaveLength(1);
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('77.47');
  });
  it('77,48: bollo + rimborso N1 nel totale', () => {
    const t = tree(gen(docWith(77.48, true)).xml);
    expect(textOf(find(t, 'DatiBollo')[0], 'BolloVirtuale')).toBe('SI');
    expect(textOf(find(t, 'DatiBollo')[0], 'ImportoBollo')).toBe('2.00');
    const lines = find(t, 'DettaglioLinee');
    expect(lines).toHaveLength(2);
    expect(textOf(lines[1], 'Natura')).toBe('N1');
    expect(textOf(lines[1], 'NumeroLinea')).toBe('2');
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('79.48');
    expect(find(t, 'DatiRiepilogo').map((r) => textOf(r, 'Natura'))).toEqual(['N2.2', 'N1']);
    expect(textOf(find(t, 'DettaglioPagamento')[0], 'ImportoPagamento')).toBe('79.48');
  });
  it('bollo a carico del cedente: DatiBollo ma nessuna riga e totale invariato', () => {
    const t = tree(gen(docWith(100, false)).xml);
    expect(find(t, 'DatiBollo')).toHaveLength(1);
    expect(find(t, 'DettaglioLinee')).toHaveLength(1);
    expect(find(t, 'DatiRiepilogo')).toHaveLength(1);
    expect(textOf(t, 'ImportoTotaleDocumento')).toBe('100.00');
  });
  it('il bollo è ricalcolato, non letto da invoice.stampDuty', () => {
    const doc = makeDoc({ lines: [line({ unitPrice: 50 })], invoice: { stampDuty: true, stampAmount: 2, stampDutyChargedToCustomer: true } });
    expect(find(tree(gen(doc).xml), 'DatiBollo')).toHaveLength(0);
  });
});

describe('nota di credito TD04', () => {
  it('riferimenti, causali, nessun pagamento', () => {
    const t = tree(gen(docExampleB(), makeProfile(), '00002').xml);
    expect(textOf(t, 'TipoDocumento')).toBe('TD04');
    const f = find(t, 'DatiFattureCollegate')[0];
    expect(textOf(f, 'IdDocumento')).toBe('12/2026');
    expect(textOf(f, 'Data')).toBe('2026-10-15');
    expect(find(t, 'DatiPagamento')).toHaveLength(0);
  });
  it('motivo breve: viene anteposto il riferimento alla fattura originale', () => {
    const doc = docExampleB();
    doc.invoice = { ...doc.invoice!, creditNoteReason: 'reso merce' };
    expect(buildCausali(doc)[0]).toBe('Storno della fattura n. 12/2026 del 15/10/2026: reso merce');
  });
  it('storno totale con bollo proprio se > 77,47', () => {
    const doc = docExampleB();
    doc.lines = [line({ description: 'Storno totale', unitPrice: 300 })];
    const t = tree(gen(doc, makeProfile(), '00002').xml);
    expect(find(t, 'DatiBollo')).toHaveLength(1);
  });
  it('senza riferimento all\'originale: errore bloccante', () => {
    const doc = docExampleB();
    doc.invoice = { ...doc.invoice!, originalNumber: undefined };
    expect(() => gen(doc)).toThrow(FatturaPAValidationError);
  });
});

describe('testi: escape, pulizia, lunghezze', () => {
  it('escape di & < > " \' nelle descrizioni (round-trip)', () => {
    const desc = `Tubo "A" & <B> 'C'`;
    const r = gen(makeDoc({ lines: [line({ description: desc })] }));
    expect(r.xml).toContain('Tubo &quot;A&quot; &amp; &lt;B&gt; &apos;C&apos;');
    expect(textOf(tree(r.xml), 'Descrizione')).toBe(desc);
  });
  it('caratteri non ammessi ripuliti', () => {
    const r = gen(makeDoc({ lines: [line({ description: 'Posa “top” – 10 € 😀\u0000' })] }));
    expect(textOf(tree(r.xml), 'Descrizione')).toBe('Posa "top" - 10 EUR ?');
  });
  it('descrizione di 1500 caratteri troncata a 1000 (e segnalata in validazione)', () => {
    const doc = makeDoc({ lines: [line({ description: 'x'.repeat(1500) })] });
    expect(textOf(tree(gen(doc).xml), 'Descrizione')).toHaveLength(1000);
  });
  it('Causale: ogni blocco <= 200 caratteri anche con motivo lunghissimo', () => {
    const doc = docExampleB();
    doc.invoice = { ...doc.invoice!, creditNoteReason: 'Storno fattura 12/2026 per ' + 'motivo lungo '.repeat(60) };
    const blocks = find(tree(gen(doc, makeProfile(), '00002').xml), 'Causale').map((c) => c.text);
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.every((b) => b.length > 0 && b.length <= 200)).toBe(true);
  });
  it('nome lungo troncato a 80 caratteri', () => {
    const doc = makeDoc({ customer: company({ name: 'A'.repeat(120) }) });
    expect(textOf(find(tree(gen(doc).xml), 'CessionarioCommittente')[0], 'Denominazione')).toHaveLength(80);
  });
});

describe('cedente', () => {
  it('ditta individuale: Nome + Cognome; società: Denominazione', () => {
    const a = find(tree(gen().xml), 'CedentePrestatore')[0];
    expect(textOf(a, 'Nome')).toBe('Mario');
    expect(textOf(a, 'RegimeFiscale')).toBe('RF19');
    const s = find(tree(gen(makeDoc(), makeProfile({ ownerName: undefined, fiscalCode: '09876543217' })).xml), 'CedentePrestatore')[0];
    expect(textOf(s, 'Denominazione')).toBe('Rossi Idraulica');
  });
  it('REA e contatti presenti solo se validi', () => {
    const t = tree(gen(makeDoc(), makeProfile({ reaOffice: 'rm', reaNumber: '123456', phone: '06 123-4567', email: 'info@rossi.it' })).xml);
    expect(textOf(t, 'Ufficio')).toBe('RM');
    expect(textOf(t, 'StatoLiquidazione')).toBe('LN');
    expect(textOf(t, 'Telefono')).toBe('061234567');
    expect(textOf(t, 'Email')).toBe('info@rossi.it');
    const none = tree(gen().xml);
    expect(find(none, 'IscrizioneREA')).toHaveLength(0);
    expect(find(none, 'Contatti')).toHaveLength(0);
  });
});

describe('pagamento', () => {
  it('bonifico a 30 giorni: MP05, scadenza, IBAN', () => {
    const t = tree(gen().xml);
    const p = find(t, 'DettaglioPagamento')[0];
    expect(textOf(p, 'ModalitaPagamento')).toBe('MP05');
    expect(textOf(p, 'DataScadenzaPagamento')).toBe('2026-11-14');
    expect(textOf(p, 'IBAN')).toBe('IT60X0542811101000000123456');
  });
  it('contanti: MP01 senza IBAN; nessun metodo e nessun IBAN: niente DatiPagamento', () => {
    const cash = tree(gen(makeDoc(), makeProfile({ paymentTerms: 'Contanti alla consegna' })).xml);
    expect(textOf(cash, 'ModalitaPagamento')).toBe('MP01');
    expect(find(cash, 'IBAN')).toHaveLength(0);
    const none = tree(gen(makeDoc(), makeProfile({ paymentTerms: '', iban: undefined })).xml);
    expect(find(none, 'DatiPagamento')).toHaveLength(0);
  });
  it('scadenza esplicita da opzioni', () => {
    const r = generateFatturaPA(makeDoc(), makeProfile(), '00001', { ...opts, paymentDueDate: '2026-12-31' });
    expect(textOf(tree(r.xml), 'DataScadenzaPagamento')).toBe('2026-12-31');
  });
});

describe('errori e progressivo', () => {
  it('formatProgressivoInvio base-36 maiuscolo a 5 caratteri', () => {
    expect(formatProgressivoInvio(1)).toBe('00001');
    expect(formatProgressivoInvio(36)).toBe('00010');
    expect(formatProgressivoInvio(35)).toBe('0000Z');
    expect(formatProgressivoInvio(36 ** 5 - 1)).toBe('ZZZZZ');
    expect(() => formatProgressivoInvio(36 ** 5)).toThrow(RangeError);
    expect(() => formatProgressivoInvio(-1)).toThrow(RangeError);
    expect(() => formatProgressivoInvio(1.5)).toThrow(RangeError);
  });
  it('progressivo non valido', () => {
    for (const bad of ['1', '000001', 'abcde', '0000-']) expect(() => gen(docExampleA(), makeProfile(), bad)).toThrow(/progressivo/i);
  });
  it('errori di validazione bloccano la generazione e sono esposti', () => {
    try {
      gen(makeDoc(), makeProfile({ vatNumber: '123' }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FatturaPAValidationError);
      expect((e as FatturaPAValidationError).issues.some((i) => i.code === 'invalid_vat')).toBe(true);
    }
  });
  it('numero non assegnato: non si genera', () => {
    expect(() => gen(makeDoc({ status: 'bozza', invoice: { number: undefined } }))).toThrow(/numero/i);
  });
});

// ---- validazione contro XSD (opzionale) ------------------------------------------------------
const xsdDir = new URL('../../docs/xsd/', import.meta.url);
const findXsd = (): string | null => {
  if (!existsSync(xsdDir)) return null;
  const f = readdirSync(xsdDir).find((n) => /fattura.*\.xsd$/i.test(n) || /Schema_del_file.*\.xsd$/i.test(n));
  return f ? new URL(f, xsdDir).pathname : null;
};
const hasXmllint = (): boolean => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const xsdPath = findXsd();
const xsdReady = xsdPath !== null && hasXmllint();
const xsdSkipReason = xsdPath === null
  ? 'SKIP: nessun file .xsd in docs/xsd/ (scaricare lo schema ufficiale a mano: la rete verso i siti ufficiali non è raggiungibile)'
  : 'SKIP: xmllint non disponibile';

describe('validazione XSD ufficiale', () => {
  (xsdReady ? it : it.skip)(`l'XML generato valida contro lo schema${xsdReady ? '' : ` [${xsdSkipReason}]`}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'fatturapa-'));
    const docs = [gen(docExampleA()), gen(docExampleB(), makeProfile(), '00002')];
    docs.forEach((d, i) => {
      const file = join(dir, `f${i}.xml`);
      writeFileSync(file, d.xml);
      execFileSync('xmllint', ['--noout', '--schema', xsdPath as string, file], { stdio: 'pipe' });
    });
  });
});

describe('xmllint (se presente): buona formazione', () => {
  (hasXmllint() ? it : it.skip)('XML generati ben formati', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fatturapa-'));
    const file = join(dir, 'a.xml');
    writeFileSync(file, gen(makeDoc({ lines: [line({ description: `Q"&<>'` })] })).xml);
    execFileSync('xmllint', ['--noout', file], { stdio: 'pipe' });
  });
});
