import { UNITS, uid } from '../../types';
import type { CatalogItem, ItemKind, Unit } from '../../types';

/** Parser CSV minimale (virgolette, separatore , ; o tab, righe vuote ignorate). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const sep = [';', '\t', ','].reduce((best, c) => (count(c) > count(best) ? c : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export type CsvField = 'name' | 'price' | 'unit' | 'vat' | 'category' | 'kind' | 'stock' | 'aliases';
export const CSV_FIELDS: { key: CsvField; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Nome', required: true },
  { key: 'price', label: 'Prezzo', required: true },
  { key: 'unit', label: 'Unità' },
  { key: 'vat', label: 'IVA %' },
  { key: 'category', label: 'Categoria' },
  { key: 'kind', label: 'Tipo' },
  { key: 'stock', label: 'Giacenza' },
  { key: 'aliases', label: 'Sinonimi' },
];

const SYN: Record<CsvField, string[]> = {
  name: ['nome', 'descrizione', 'articolo', 'voce', 'name', 'prodotto'],
  price: ['prezzo', 'importo', 'price', 'costo', 'prezzonetto', 'prezzounitario'],
  unit: ['unita', 'um', 'unitadimisura', 'unit', 'u.m.'],
  vat: ['iva', 'aliquota', 'vat', 'aliquotaiva'],
  category: ['categoria', 'category', 'gruppo', 'famiglia'],
  kind: ['tipo', 'kind', 'tipologia'],
  stock: ['giacenza', 'scorta', 'stock', 'quantita', 'qta', 'magazzino'],
  aliases: ['alias', 'sinonimi', 'aliases', 'sinonimo'],
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '');

/** Prova a riconoscere le colonne dalla riga di intestazione. */
export function guessMapping(header: string[]): Partial<Record<CsvField, number>> {
  const map: Partial<Record<CsvField, number>> = {};
  header.forEach((h, idx) => {
    const n = norm(h);
    for (const f of Object.keys(SYN) as CsvField[]) {
      if (map[f] === undefined && SYN[f].some((s) => norm(s) === n)) { map[f] = idx; break; }
    }
  });
  return map;
}

/** Numero italiano/inglese: "1.234,50", "1234.5", "12,5 €". */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const UNIT_ALIAS: Record<string, Unit> = {
  pz: 'pz', pezzo: 'pz', pezzi: 'pz', nr: 'pz', n: 'pz', cad: 'pz', cadauno: 'pz',
  m: 'm', mt: 'm', ml: 'm', metro: 'm', metri: 'm',
  mq: 'mq', 'm2': 'mq', metriquadri: 'mq', metroquadro: 'mq',
  mc: 'mc', m3: 'mc', metricubi: 'mc',
  kg: 'kg', kili: 'kg', chili: 'kg', chilogrammi: 'kg',
  l: 'l', lt: 'l', litro: 'l', litri: 'l',
  h: 'h', ora: 'h', ore: 'h',
  gg: 'gg', giorno: 'gg', giorni: 'gg',
  corpo: 'corpo', forfait: 'corpo', 'acorpo': 'corpo',
};
export function parseUnit(raw: string): Unit | null {
  const k = raw.toLowerCase().replace(/[.\s]/g, '').replace('²', '2').replace('³', '3');
  if (UNIT_ALIAS[k]) return UNIT_ALIAS[k];
  return (UNITS as string[]).includes(k) ? (k as Unit) : null;
}

export function parseKind(raw: string): ItemKind | null {
  const k = norm(raw);
  if (k.startsWith('mater') || k === 'prodotto' || k === 'articolo') return 'materiale';
  if (k.startsWith('man') || k.startsWith('lavor')) return 'manodopera';
  if (k.startsWith('serv')) return 'servizio';
  return null;
}

export interface CsvRowResult { line: number; item?: CatalogItem; errors: string[]; warnings: string[] }

export function buildItems(rows: string[][], mapping: Partial<Record<CsvField, number>>, defaultVat: number, firstDataRow: number): CsvRowResult[] {
  const out: CsvRowResult[] = [];
  const cell = (r: string[], f: CsvField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim());
  for (let i = firstDataRow; i < rows.length; i++) {
    const r = rows[i];
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = cell(r, 'name');
    if (!name) errors.push('nome mancante');
    const price = parseNumber(cell(r, 'price'));
    if (price === null || price < 0) errors.push('prezzo non valido');
    let unit: Unit = 'pz';
    const u = cell(r, 'unit');
    if (u) { const pu = parseUnit(u); if (pu) unit = pu; else warnings.push(`unità "${u}" sconosciuta, uso "pz"`); }
    let vat = defaultVat;
    const v = cell(r, 'vat');
    if (v) { const pv = parseNumber(v.replace('%', '')); if (pv !== null && pv >= 0 && pv <= 100) vat = pv; else warnings.push(`IVA "${v}" non valida, uso ${defaultVat}%`); }
    let kind: ItemKind = unit === 'h' ? 'manodopera' : 'materiale';
    const k = cell(r, 'kind');
    if (k) { const pk = parseKind(k); if (pk) kind = pk; else warnings.push(`tipo "${k}" sconosciuto`); }
    const sRaw = cell(r, 'stock');
    let stock: number | undefined;
    if (sRaw) { const ps = parseNumber(sRaw); if (ps !== null) stock = ps; else warnings.push(`giacenza "${sRaw}" non valida`); }
    const aliases = cell(r, 'aliases').split(/[|]/).map((a) => a.trim()).filter(Boolean);
    const now = Date.now();
    out.push({
      line: i + 1, errors, warnings,
      item: errors.length ? undefined : {
        id: uid(), name, aliases, unit, price: price!, vat, kind,
        category: cell(r, 'category') || undefined, stock, createdAt: now, updatedAt: now,
      },
    });
  }
  return out;
}

const esc = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV con separatore ; e decimali con virgola (apribile direttamente in Excel italiano). */
export function itemsToCsv(items: CatalogItem[]): string {
  const head = ['nome', 'prezzo', 'unita', 'iva', 'categoria', 'tipo', 'giacenza', 'sinonimi'];
  const lines = items.map((i) => [
    i.name, String(i.price).replace('.', ','), i.unit, i.vat, i.category, i.kind,
    i.stock === undefined ? '' : String(i.stock).replace('.', ','), i.aliases.join('|'),
  ].map(esc).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
}
