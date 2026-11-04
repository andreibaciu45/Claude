import { parseDictation } from '../parse';
import { catalogOf, judge, type BCase } from './types';

export interface Report {
  cases: number;
  casesOk: number;
  lines: number;
  linesOk: number;
  byTrade: Record<string, [number, number]>;
  byTag: Record<string, [number, number]>;
  fails: string[];
}

export function runSet(set: BCase[], parse: (t: string, c: ReturnType<typeof catalogOf>) => ReturnType<typeof parseDictation> = parseDictation): Report {
  const rep: Report = { cases: 0, casesOk: 0, lines: 0, linesOk: 0, byTrade: {}, byTag: {}, fails: [] };
  for (const c of set) {
    const r = parse(c.t, catalogOf(c.trade));
    const o = judge(c, r as never);
    rep.cases++;
    rep.lines += o.lineTotal;
    rep.linesOk += o.lineOk;
    if (o.ok) rep.casesOk++;
    else rep.fails.push(`[${c.trade}] "${c.t}"\n     ${o.errs.join('; ')}\n     -> ${r.lines.map((l) => `${l.catalogItemId ?? '?'}×${l.qty}${l.unit}`).join(' | ')}${r.customerName ? ` cli=${r.customerName}` : ''}${r.leftovers.length ? ` lo=[${r.leftovers.join('|')}]` : ''}`);
    for (const [bucket, key] of [[rep.byTrade, c.trade], [rep.byTag, c.tag ?? 'base']] as const) {
      const b = (bucket[key] ??= [0, 0]);
      b[1]++;
      if (o.ok) b[0]++;
    }
  }
  return rep;
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '-') + '%';
export function format(name: string, r: Report, withFails = true): string {
  const fmt = (m: Record<string, [number, number]>) => Object.entries(m).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', ');
  return [
    `== ${name}: frasi ${r.casesOk}/${r.cases} (${pct(r.casesOk, r.cases)}), righe ${r.linesOk}/${r.lines} (${pct(r.linesOk, r.lines)})`,
    `   per mestiere: ${fmt(r.byTrade)}`,
    `   per categoria: ${fmt(r.byTag)}`,
    ...(withFails ? r.fails : []),
  ].join('\n');
}
