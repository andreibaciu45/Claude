import type { Unit } from '../types';
import type { RawTok } from './text';

const SQ = new Set(['quadro', 'quadri', 'quadrato', 'quadrati', 'quadra']);
const CUBE = new Set(['cubo', 'cubi', 'cubico', 'cubici']);

export type UnitRead =
  | { kind: 'unit'; u: Unit; next: number }
  | { kind: 'spec'; next: number };

/**
 * Legge un'unità di misura subito dopo una quantità.
 * 'unit' = unità fatturabile; 'spec' = misura di specifica (mm, cm: fa parte della descrizione).
 */
export function readUnit(R: RawTok[], j: number): UnitRead | null {
  const t = R[j];
  if (!t || t.kind !== 'word') return null;
  const w = t.w;
  const n1 = R[j + 1]?.kind === 'word' ? R[j + 1].w : undefined;
  if (w === 'metro' || w === 'metri' || w === 'mt' || w === 'm' || w === 'ml' || w === 'mtl' || w === 'emme') {
    if (n1 && SQ.has(n1)) return { kind: 'unit', u: 'mq', next: j + 2 };
    if (n1 && CUBE.has(n1)) return { kind: 'unit', u: 'mc', next: j + 2 };
    if (w === 'emme') return null;
    if (n1 === 'lineare' || n1 === 'lineari') return { kind: 'unit', u: 'm', next: j + 2 };
    return { kind: 'unit', u: 'm', next: j + 1 };
  }
  switch (w) {
    case 'mq':
    case 'metriquadri':
    case 'metriquadrati':
      return { kind: 'unit', u: 'mq', next: j + 1 };
    case 'mc':
    case 'metricubi':
      return { kind: 'unit', u: 'mc', next: j + 1 };
    case 'kg':
    case 'kilo':
    case 'kili':
    case 'chilo':
    case 'chili':
    case 'chilogrammo':
    case 'chilogrammi':
    case 'kilogrammi':
      return { kind: 'unit', u: 'kg', next: j + 1 };
    case 'l':
    case 'lt':
    case 'litro':
    case 'litri':
      return { kind: 'unit', u: 'l', next: j + 1 };
    case 'h':
    case 'ora':
    case 'ore':
    case 'oretta':
    case 'orette':
      return { kind: 'unit', u: 'h', next: j + 1 };
    case 'gg':
    case 'giorno':
    case 'giorni':
    case 'giornata':
    case 'giornate':
      return { kind: 'unit', u: 'gg', next: j + 1 };
    case 'pz':
    case 'pezzo':
    case 'pezzi':
    case 'nr':
      return { kind: 'unit', u: 'pz', next: j + 1 };
    case 'corpo':
      return { kind: 'unit', u: 'corpo', next: j + 1 };
    case 'cm':
    case 'mm':
    case 'mmq':
    case 'centimetro':
    case 'centimetri':
    case 'millimetro':
    case 'millimetri':
      return { kind: 'spec', next: j + 1 };
    default:
      return null;
  }
}

export const UNIT_LABEL: Record<Unit, string> = {
  pz: 'pz', m: 'm', mq: 'mq', mc: 'mc', kg: 'kg', l: 'l', h: 'h', gg: 'gg', corpo: 'a corpo',
};
