// Stato di processo condiviso (arresto in corso). Separato per evitare import circolari.
let draining = false;
export const isDraining = (): boolean => draining;
export const setDraining = (v = true): void => { draining = v; };
