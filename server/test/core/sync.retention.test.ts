// Retention dei tombstone e device offline oltre la finestra: la pulizia periodica NON deve far risorgere voci cancellate.
// Finestra = TOMBSTONE_RETENTION_DAYS (default 180, la stessa per bozze e catalogo). Oltre: `resync_required` (vedi sync/service.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncOp } from '../../../shared/api';
import { catalogItem, docOp, freshEnv, invoice, login, opId, quote } from './helpers';
import { pushOps } from '../../src/sync/service';
import { getDocument } from '../../src/documents/repo';
import { one } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { housekeeping } from '../../src/db/housekeeping';
import { setEntitlement } from '../../src/db/entitlements';

const DAY = 86_400_000;
const T = 1_800_000_000_000;
beforeEach(freshEnv);
afterEach(() => { setClock(null); delete process.env.TOMBSTONE_RETENTION_DAYS; });

const del = (entity: 'catalog' | 'document', id: string, ts: number): SyncOp => ({ opId: opId(), entity, entityId: id, op: 'delete', clientTs: ts });
const upCat = (id: string, ts: number): SyncOp => ({ opId: opId(), entity: 'catalog', entityId: id, op: 'upsert', payload: catalogItem(id, { updatedAt: ts }), clientTs: ts });
// Chiamata diretta al servizio: con l'orologio spostato di mesi il token di sessione (emesso in tempo reale) sarebbe scaduto.
let ctx: { tenantId: string; userId: string } = { tenantId: '', userId: '' };
const push = async (_token: string, ops: SyncOp[], deviceId = 'dev-1') => ({ json: pushOps({ ...ctx, deviceId }, ops) });
const lg = async (email: string) => { const l = await login(email); ctx = { tenantId: l.tenantId, userId: one<{ id: string }>('SELECT id FROM users WHERE email=?', email)!.id }; return l; };
const reasons = (r: any) => r.json.conflicts.map((c: any) => c.reason);

describe('retention tombstone', () => {
  it('device offline oltre la finestra: l\'upsert vecchia su voce purgata è `resync_required` e non fa risorgere nulla (catalogo e bozze)', async () => {
    const { token, tenantId } = await lg('r@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    setClock(() => T);
    // un altro dispositivo cancella (voci mai viste dal server) al tempo T
    await push(token, [del('catalog', 'c1', T), del('document', 'q1', T)], 'dev-B');
    setClock(() => T + 100 * DAY);
    housekeeping();
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_items')!.n).toBe(1); // 100 < 180 giorni: tombstone ancora presenti
    // in finestra: la upsert vecchia viene ancora scartata dal tombstone (stale)
    expect(reasons(await push(token, [upCat('c1', T - 5)], 'dev-A'))).toEqual(['stale']);
    setClock(() => T + 200 * DAY);
    const hk = housekeeping();
    expect(hk.catalog_tombstones).toBe(1);
    expect(hk.documents_tombstones).toBe(1);
    expect(one('SELECT 1 AS x FROM catalog_items')).toBeUndefined(); // tombstone purgati
    // il dispositivo A torna dopo 200 giorni con le sue vecchie modifiche
    const back = await push(token, [upCat('c1', T - 5), docOp(quote('q1', { updatedAt: T - 5 }))], 'dev-A');
    expect(back.json.accepted).toHaveLength(0);
    expect(reasons(back)).toEqual(['resync_required', 'resync_required']);
    expect(one('SELECT 1 AS x FROM catalog_items')).toBeUndefined();
    expect(one('SELECT 1 AS x FROM documents')).toBeUndefined();
    // una delete vecchia su voce assente è un no-op accettato (nessun tombstone da ripulire ogni ora)
    expect((await push(token, [del('catalog', 'c1', T - 1)])).json.accepted).toHaveLength(1);
    expect(one('SELECT 1 AS x FROM catalog_items')).toBeUndefined();
    // dopo il full resync il dispositivo riparte con modifiche NUOVE (ts oltre il confine): accettate
    const fresh = await push(token, [upCat('c1', T + 200 * DAY - 1000), docOp(quote('q1', { updatedAt: T + 200 * DAY - 1000 }))], 'dev-A');
    expect(fresh.json.accepted).toHaveLength(2);
  });

  it('il confine è solo crescente e si applica solo a voci ASSENTI: una voce viva con ts vecchio si aggiorna con le regole LWW', async () => {
    const { token } = await lg('r2@x.it');
    setClock(() => T);
    await push(token, [upCat('c2', T - 300 * DAY)]);
    setClock(() => T + 10 * DAY);
    housekeeping();
    expect((await push(token, [upCat('c2', T - 299 * DAY)])).json.accepted).toHaveLength(1); // voce esistente: LWW normale
    expect(reasons(await push(token, [upCat('nuova', T - 299 * DAY)]))).toEqual([]); // mai esistita (nessuna riga in `changes`): non puo' essere una risurrezione (revisione 2)
    setClock(() => T); // un orologio indietro non abbassa il confine
    housekeeping();
    expect(one<{ value: number }>("SELECT value FROM sync_meta WHERE key='tombstone_floor'")!.value).toBe(T + 10 * DAY - 180 * DAY);
  });

  it('finestra allineata e configurabile (TOMBSTONE_RETENTION_DAYS) per catalogo e bozze', async () => {
    process.env.TOMBSTONE_RETENTION_DAYS = '30';
    const { token } = await lg('r3@x.it');
    setClock(() => T);
    await push(token, [del('catalog', 'c3', T), del('document', 'q3', T)]);
    setClock(() => T + 31 * DAY);
    const hk = housekeeping();
    expect([hk.catalog_tombstones, hk.documents_tombstones]).toEqual([1, 1]);
    expect(reasons(await push(token, [upCat('c3', T - 1)]))).toEqual(['resync_required']);
  });

  it('le fatture emesse non sono mai toccate dalla pulizia né dal confine', async () => {
    const { token, tenantId } = await lg('r4@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    setClock(() => T);
    await push(token, [docOp(invoice('f9', 1, { updatedAt: T - 400 * DAY }))]);
    setClock(() => T + 400 * DAY);
    housekeeping();
    expect(one('SELECT 1 AS x FROM documents WHERE id=\'f9\'')).toBeTruthy();
    expect(getDocument(tenantId, 'f9')).toBeTruthy();
  });
});
