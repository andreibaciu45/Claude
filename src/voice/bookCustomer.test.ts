import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';

vi.mock('../pdf', () => ({ generateDocumentPdf: async () => new Blob(['%PDF']) }));

import { __resetStorageForTests, saveCustomer } from '../storage';
import { findBookCustomer } from './executor';

beforeEach(async () => { await __resetStorageForTests(); await deleteDB('vocepreventivo'); });

describe('«nuova fattura per <cliente>»: aggancio alla rubrica', () => {
  it('aggancia un cliente sicuro con tutti i dati fiscali', async () => {
    await saveCustomer({ id: 'c1', name: 'Mario Rossi', vatNumber: '02345678904', city: 'Milano' });
    const c = await findBookCustomer('mario rossi');
    expect(c).toMatchObject({ id: 'c1', vatNumber: '02345678904', city: 'Milano' });
    expect(c).not.toHaveProperty('createdAt');
  });
  it('non aggancia se ambiguo o sconosciuto', async () => {
    await saveCustomer({ id: 'c1', name: 'Mario Rossi' });
    await saveCustomer({ id: 'c2', name: 'Mario Rossini' });
    expect(await findBookCustomer('Giuseppe Verdi')).toBeUndefined();
    expect(await findBookCustomer('Maria Rosi')).toBeUndefined();
  });
});
