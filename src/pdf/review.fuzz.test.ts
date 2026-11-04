/**
 * REVISIONE INDIPENDENTE (docs/CODE-REVIEW-FATTURE.md): fuzzer deterministico, 160 documenti casuali con testi "cattivi".
 * Per ogni documento si controlla che XML, PDF e totali siano coerenti tra loro e con i vincoli dello schema FatturaPA
 * (secondo la nostra lettura [DA VERIFICARE sull'XSD]: ordine/obbligatori, pattern numerici, lunghezze, caratteri ammessi).
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Customer, DocLine, QuoteDocument } from '../types';
import { generateFatturaPA, validateInvoiceForIssue } from '../../shared/fatturapa';
import { find, parseXml, textOf, validateStructure, type XmlNode } from '../../shared/fatturapa/__tests__/xmlTools';
import { company, consumer, makeDoc, makeProfile } from '../../shared/fatturapa/__tests__/factories';
import { toCents } from '../../shared/fiscal/money';
import { invoiceTotalsCents } from '../storage/invoiceTotals';
import { documentTotals, fmtNum } from './index';
import { renderDocumentPdf } from './render';

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];

const NASTY = [
  'Posa & collaudo', 'Tubo <rame> 16 "mm"', "Valvola d'arresto", 'Cavo ]]> fine', '&amp; già escapato', 'Prezzo € 10 – “scontato”',
  'Riga\ncon a capo\te tab', 'Controllo\u0001\u0007 caratteri', 'Łódź żółć ñ ü è à', 'Emoji 😀 lavoro', 'Percentuale 100% <b>x</b>', '=SUM(A1)',
  'Riparazione impianto di riscaldamento con sostituzione completa delle valvole termostatiche e bilanciamento dei circuiti',
  'x'.repeat(1200), '   spazi   multipli   ', 'Gen eri', ' nbsp', 'Ampère µ © ® ½',
];
const QTYS = [1, 2, 3, 0.5, 1.25, 2.333, 7, 10, 0.125, 12.5, 0.001, 33.333, 1000, 0.1, 4.5];
const PRICES = [0.01, 0.125, 1.005, 2.675, 3.3333, 9.99, 12.5, 77.47, 77.46, 35, 120.456, 999.99, 0.3, 4.5, 15.255, 1234.5678];
const DISCOUNTS = [0, 0, 0, 5, 10, 12.5, 33.33, 7, 25, 12.25, 0.5];

function randomDoc(i: number): { doc: QuoteDocument; profileOver: Record<string, unknown> } {
  const r = rng(77_000 + i * 104_729);
  const n = 1 + Math.floor(r() * 6);
  const lines: DocLine[] = Array.from({ length: n }, (_, k) => ({
    id: `l${k}`, description: pick(r, NASTY), qty: pick(r, QTYS), unit: pick(r, ['pz', 'm', 'h', 'corpo'] as const), unitPrice: pick(r, PRICES), vat: pick(r, [0, 22]),
    natura: pick(r, ['N2.2', 'N2.2', 'N2.2', 'N1'] as const),
    ...(pick(r, DISCOUNTS) ? { discountPct: pick(r, DISCOUNTS) } : {}),
  }));
  if (r() < 0.3) {
    const gross = lines.reduce((t, l) => t + toCents(l.qty * l.unitPrice), 0);
    lines.push({ id: 'sc', description: 'Sconto', qty: 1, unit: 'corpo', unitPrice: -Math.max(1, Math.floor(gross * (0.05 + r() * 0.3))) / 100, vat: 0, natura: lines[0].natura });
  }
  const kind = pick(r, ['consumer', 'company', 'pec', 'foreign'] as const);
  const customer: Customer =
    kind === 'consumer' ? consumer({ name: pick(r, ['Luigia Verdi', 'Maria De Luca', "Dell'Orto Anna", 'Ente & Figli <test>']) })
    : kind === 'company' ? company({ name: pick(r, ['Bianchi S.r.l.', 'Società "Alfa" & C.', 'x'.repeat(95)]) })
    : kind === 'pec' ? company({ codiceDestinatario: '', pec: 'fatture@pec.example.it' })
    : { id: 'f', name: 'Müller GmbH', country: 'DE', vatNumber: 'DE123456789', address: 'Hauptstr. 1', city: 'Berlin', zip: '10115' };
  const nc = i % 5 === 4;
  const charged = r() < 0.5;
  const doc = makeDoc({
    id: `f${i}`, customer, lines, status: 'emessa',
    invoice: {
      tipoDocumento: nc ? 'TD04' : 'TD01', sectional: nc ? 'NC' : 'FT', seq: i + 1, number: nc ? `NC${i + 1}/2026` : `${i + 1}/2026`,
      operationDate: '2026-10-15', stampDutyChargedToCustomer: !nc && charged, lockedAt: 1, issuedAt: 1,
      customerChannel: 'codice',
      ...(nc ? { originalNumber: '1/2026', originalDate: '2026-10-01', creditNoteReason: pick(r, ['Reso merce', 'Errore & omissione <x>', 'z'.repeat(450)]) } : {}),
    },
  });
  return { doc, profileOver: { paymentTerms: pick(r, ['Bonifico a 30 giorni', 'Contanti alla consegna', 'Carta', 'Bonifico 30 giorni fine mese']) } };
}

const N = 160;
const skipped: Record<string, number> = {};
// XSD (secondo la nostra lettura): Amount2 = -?\d{1,11}\.\d{2}; Quantita/PrezzoUnitario/PrezzoTotale = -?\d{1,11}\.\d{2,8}
const AMOUNT2 = /^-?\d{1,11}\.\d{2}$/;
const DEC28 = /^-?\d{1,11}\.\d{2,8}$/;
// caratteri XML 1.0 ammessi dalla nostra lettura dello schema: Basic Latin + Latin-1
const ALLOWED = /^[ -~ -ÿ]*$/;

const textsOf = (n: XmlNode, out: { name: string; text: string }[] = []): { name: string; text: string }[] => {
  if (!n.children.length) out.push({ name: n.name, text: n.text }); else n.children.forEach((c) => textsOf(c, out));
  return out;
};
const c2 = (s: string | undefined): number => toCents(Number(s ?? 'NaN'));

describe(`fuzzer fatture: ${N} documenti casuali`, () => {
  afterAll(() => { console.log('FUZZ-SKIPPED', JSON.stringify(skipped)); });
  for (let i = 0; i < N; i++) {
    it(`doc #${i}: XML, PDF e totali coerenti`, () => {
      const { doc, profileOver } = randomDoc(i);
      const profile = makeProfile(profileOver);
      const issues = validateInvoiceForIssue(doc, profile, { now: new Date(2026, 9, 20, 12) });
      const errors = issues.filter((x) => x.severity === 'error');
      if (errors.length) { for (const e of errors) skipped[e.code] = (skipped[e.code] ?? 0) + 1; return; }
      const { xml, fileName } = generateFatturaPA(doc, profile, 'ABC12', { now: new Date(2026, 9, 20, 12) });

      // (c) buona formazione, ordine, obbligatori, BOM, caratteri
      expect(xml.charCodeAt(0)).not.toBe(0xfeff);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
      const root = parseXml(xml);
      expect(validateStructure(root)).toEqual([]);
      for (const t of textsOf(root)) {
        expect(ALLOWED.test(t.text), `${t.name}: caratteri non ammessi ${JSON.stringify(t.text.slice(0, 40))}`).toBe(true);
        expect(t.text, `${t.name} vuoto`).not.toBe('');
        expect(t.text, `${t.name}: spazi iniziali/finali`).toBe(t.text.trim());
      }
      expect(fileName).toMatch(/^IT\d{11}_[A-Z0-9]{5}\.xml$/);

      // lunghezze (Descrizione<=1000, Causale<=200, Denominazione<=80, Numero<=20, RiferimentoNormativo<=100, UnitaMisura<=10)
      for (const [name, max] of [['Descrizione', 1000], ['Causale', 200], ['Denominazione', 80], ['Nome', 60], ['Cognome', 60], ['Numero', 20], ['RiferimentoNormativo', 100], ['UnitaMisura', 10], ['IdDocumento', 20], ['Indirizzo', 60], ['Comune', 60]] as const) {
        for (const n of find(root, name)) expect(n.text.length, `${name} troppo lungo`).toBeLessThanOrEqual(max);
      }
      // formati numerici
      for (const name of ['ImportoTotaleDocumento', 'ImponibileImporto', 'Imposta', 'ImportoPagamento', 'ImportoBollo']) {
        for (const n of find(root, name)) expect(n.text, name).toMatch(AMOUNT2);
      }
      for (const name of ['Quantita', 'PrezzoUnitario', 'PrezzoTotale']) {
        for (const n of find(root, name)) expect(n.text, name).toMatch(DEC28);
      }

      // (d) totali: righe -> riepilogo -> ImportoTotaleDocumento -> DatiPagamento -> scheda/PDF
      const forf = true;
      const t = invoiceTotalsCents(doc.lines, { forfettario: forf, stampChargedToCustomer: !!doc.invoice!.stampDutyChargedToCustomer && doc.invoice!.tipoDocumento !== 'TD04' });
      const linee = find(root, 'DettaglioLinee');
      const stampLine = linee.filter((l) => textOf(l, 'Descrizione') === 'Rimborso imposta di bollo');
      const sumLines = linee.reduce((s, l) => s + c2(textOf(l, 'PrezzoTotale')), 0);
      const riep = find(root, 'DatiRiepilogo');
      const sumRiep = riep.reduce((s, r) => s + c2(textOf(r, 'ImponibileImporto')), 0);
      expect(sumLines, 'somma PrezzoTotale righe = somma imponibili').toBe(sumRiep);
      expect(c2(textOf(root, 'ImportoTotaleDocumento')), 'ImportoTotaleDocumento').toBe(t.grossCents);
      expect(sumRiep).toBe(t.grossCents);
      const pay = textOf(root, 'ImportoPagamento');
      if (pay !== undefined) expect(c2(pay)).toBe(c2(textOf(root, 'ImportoTotaleDocumento')));
      expect(stampLine.length).toBe(t.stampChargedCents > 0 ? 1 : 0);
      const bollo = find(root, 'DatiBollo');
      expect(bollo.length).toBe(t.stampDueCents > 0 ? 1 : 0);
      // PrezzoTotale = Quantita × PrezzoUnitario × (1 - sconto%) entro 1 centesimo (controllo 00423 dello SDI)
      for (const l of linee) {
        if (textOf(l, 'Descrizione') === 'Rimborso imposta di bollo') continue;
        const q = Number(textOf(l, 'Quantita')), p = Number(textOf(l, 'PrezzoUnitario'));
        const sc = find(l, 'Percentuale')[0] ? Number(find(l, 'Percentuale')[0].text) : 0;
        const expected = q * p * (1 - sc / 100);
        expect(Math.abs(expected - Number(textOf(l, 'PrezzoTotale'))), `riga ${textOf(l, 'NumeroLinea')}`).toBeLessThanOrEqual(0.0100001);
      }
      // numerazione linee consecutiva
      linee.forEach((l, k) => expect(textOf(l, 'NumeroLinea')).toBe(String(k + 1)));
      // TD04: importi positivi, riferimento alla fattura originale
      if (doc.invoice!.tipoDocumento === 'TD04') {
        expect(find(root, 'DatiFattureCollegate').length).toBe(1);
        expect(find(root, 'DatiPagamento').length).toBe(0);
        for (const n of [...find(root, 'ImportoTotaleDocumento'), ...find(root, 'ImponibileImporto')]) expect(Number(n.text)).toBeGreaterThan(0);
      }

      // (f) PDF: totale, imponibile e importi di riga come nella scheda; prezzo unitario leggibile come nell'XML
      const dt = documentTotals(doc, forf);
      expect(toCents(dt.gross)).toBe(t.grossCents);
      const txt = renderDocumentPdf(doc, profile, { compress: false }).output();
      expect(txt).toContain(fmtNum(dt.gross));
      for (const l of doc.lines) {
        if (l.unitPrice <= 0) continue;
        // il prezzo unitario mostrato nel PDF deve essere quello usato per il calcolo (fino a 8 decimali, come l'XML)
        const shown = fmtNum(l.unitPrice, 2);
        const exact = String(l.unitPrice).replace('.', ',');
        const decimals = (String(l.unitPrice).split('.')[1] ?? '').length;
        if (decimals > 2) expect(txt.includes(exact) || txt.includes(fmtNum(l.unitPrice, decimals)), `PDF: prezzo ${l.unitPrice} mostrato come ${shown}`).toBe(true);
      }
    });
  }
});
