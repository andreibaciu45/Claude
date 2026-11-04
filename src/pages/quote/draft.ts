import type { Customer, DocLine, DocType } from '../../types';

const KEY = 'vocepreventivo:draft:v1';

export interface Draft {
  stage: 'input' | 'edit';
  type: DocType;
  transcript: string;
  customer: Customer;
  lines: DocLine[];
  notes: string;
  savedAt: number;
}

export const loadDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.lines) || !d.customer) return null;
    return d;
  } catch { return null; }
};
export const saveDraft = (d: Draft): void => {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota o storage disattivato */ }
};
export const clearDraft = (): void => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
