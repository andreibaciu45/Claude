// Fatti fiscali dichiarati dal client: catena di hash per tenant sulle emissioni + regola «stato emesso => lockedAt».
import { beforeEach, describe, expect, it } from 'vitest';
import { call, docOp, freshEnv, invoice, login, push, quote } from '../core/helpers';
import { all, getDb, one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { setEntitlement } from '../../src/db/entitlements';
import { appendEmission, backfillChain, verifyChain } from '../../src/db/chain';
import { upsertDocument } from '../../src/documents/repo';
import { checkIntegrity } from '../../src/ops/integrity';
import { housekeeping } from '../../src/db/housekeeping';

beforeEach(freshEnv);
async function setup(email = 'a@x.it') {
  const a = await login(email);
  setEntitlement(a.tenantId, { plan: 'pro' });
  return a;
}
const chain = (t: string) => all<any>('SELECT * FROM fiscal_chain WHERE tenant_id=? ORDER BY n', t);

describe('catena di hash delle emissioni', () => {
  it('ogni emissione accettata aggiunge una riga concatenata, con l\'orologio del SERVER', async () => {
    const T = 1_800_000_000_000; setClock(() => T);
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1)), docOp(invoice('f2', 2)), docOp(invoice('f3', 3))]);
    const rows = chain(a.tenantId);
    expect(rows.map((r) => [r.n, r.doc_id, r.seq])).toEqual([[1, 'f1', 1], [2, 'f2', 2], [3, 'f3', 3]]);
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    expect(rows[2].prev_hash).toBe(rows[1].hash);
    expect(rows.every((r) => r.received_at === T && r.client_locked_at === 5000)).toBe(true); // lockedAt dichiarato (5000) ≠ orario attestato
    const v = verifyChain(getDb());
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bozze, ripetizioni, aggiornamenti di stato/pagamenti e rinvio dopo scarto NON aggiungono righe; tenant diversi hanno catene indipendenti', async () => {
    const a = await setup(); const b = await setup('b@x.it');
    await push(a.token, [docOp(quote('q1')), docOp(invoice('b1', 1, {}, false)), docOp(invoice('f1', 1))]);
    const f1 = invoice('f1', 1, { status: 'inviata', updatedAt: 2000 });
    await push(a.token, [docOp(f1), docOp(invoice('f1', 1))]);
    await push(b.token, [docOp(invoice('g1', 1))]);
    expect(chain(a.tenantId)).toHaveLength(1);
    expect(chain(b.tenantId)).toHaveLength(1);
    expect(chain(b.tenantId)[0].prev_hash).not.toBe(chain(a.tenantId)[0].prev_hash); // genesi per tenant
  });

  it('i trigger rendono la catena append-only', async () => {
    const a = await setup();
    await push(a.token, [docOp(invoice('f1', 1))]);
    expect(() => run('UPDATE fiscal_chain SET seq=9')).toThrow(/append-only/);
    expect(() => run('DELETE FROM fiscal_chain')).toThrow(/append-only/);
  });

  describe('manomissione a DB spento (trigger aggirati da chi ha accesso al file)', () => {
    async function three() {
      const a = await setup();
      await push(a.token, [docOp(invoice('f1', 1)), docOp(invoice('f2', 2)), docOp(invoice('f3', 3))]);
      return a;
    }
    it('fattura emessa cancellata', async () => {
      await three();
      run('DROP TRIGGER trg_documents_no_delete_locked');
      run("DELETE FROM documents WHERE id='f2'");
      expect(verifyChain(getDb()).errors.join('|')).toMatch(/non risulta piu' emessa/);
      expect(checkIntegrity(getDb()).ok).toBe(false);
    });
    it('fattura rinumerata', async () => {
      await three();
      run('DROP TRIGGER trg_documents_locked_update');
      run("UPDATE documents SET inv_seq=7, number='7/2026' WHERE id='f2'");
      expect(verifyChain(getDb()).errors.join('|')).toMatch(/diversi da quanto attestato/);
    });
    it('riga della catena cancellata o modificata', async () => {
      const a = await three();
      run('DROP TRIGGER trg_fiscal_chain_no_delete');
      run('DELETE FROM fiscal_chain WHERE n=2');
      expect(verifyChain(getDb()).errors.join('|')).toMatch(/manca la voce 2/);
      run('DROP TRIGGER trg_fiscal_chain_no_update');
      run('UPDATE fiscal_chain SET received_at=1 WHERE n=3');
      expect(verifyChain(getDb()).errors.join('|')).toMatch(/contenuto manomesso/);
      expect(a.tenantId).toBeTruthy();
    });
    it('catena riscritta per intero: il sigillo esterno non coincide più', async () => {
      const a = await three();
      const seal = verifyChain(getDb()).digest;
      run('DROP TRIGGER trg_fiscal_chain_no_delete');
      run('DELETE FROM fiscal_chain WHERE n=3');
      const rows = chain(a.tenantId);
      expect(rows).toHaveLength(2);
      expect(verifyChain(getDb()).digest).not.toBe(seal);
    });
    it('integrity-check espone il sigillo', async () => {
      await three();
      const rep = checkIntegrity(getDb());
      expect(rep.chain!.rows).toBe(3);
      expect(rep.chain!.digest).toBe(verifyChain(getDb()).digest);
      expect(rep.errors).toEqual([]);
    });
  });

  it('fatture emesse prima della catena: avviso finché non vengono agganciate (avvio/manutenzione), poi contrassegnate legacy', async () => {
    const a = await setup();
    upsertDocument(a.tenantId, invoice('vecchia', 1) as any, 1000); // emessa «fuori catena» (come prima della migrazione)
    expect(verifyChain(getDb()).warnings.join('|')).toMatch(/non ancora agganciate/);
    expect(housekeeping().fiscal_chain_backfilled).toBe(1);
    expect(chain(a.tenantId).map((r) => [r.doc_id, r.legacy])).toEqual([['vecchia', 1]]);
    expect(verifyChain(getDb())).toMatchObject({ errors: [], warnings: [] });
    expect(backfillChain()).toBe(0);
    expect(appendEmission(a.tenantId, { docId: 'vecchia', sectional: 'FT', year: 2026, seq: 1, lockedAt: 5000 })).toBe(false); // idempotente
  });
});

describe('stato «emessa» senza lockedAt', () => {
  it('prima il server la accettava e la teneva modificabile; ora è invalid (bozza e fattura di cortesia legacy ok)', async () => {
    const a = await setup();
    const noLock = invoice('x1', 1);
    delete (noLock.invoice as any).lockedAt; delete (noLock.invoice as any).seq;
    const r = await push(a.token, [docOp({ ...noLock, status: 'consegnata' })]);
    expect(r.json.conflicts[0].reason).toBe('invalid');
    expect(r.json.conflicts[0].message).toMatch(/lockedAt/);
    expect(one('SELECT 1 AS x FROM documents WHERE id=?', 'x1')).toBeUndefined();
    const legacy = invoice('x2', 1);
    delete (legacy.invoice as any).lockedAt; delete (legacy.invoice as any).seq; (legacy.invoice as any).legacy = true;
    expect((await push(a.token, [docOp(legacy)])).json.conflicts).toEqual([]);
    expect((await push(a.token, [docOp(invoice('x3', 2, {}, false))])).json.conflicts).toEqual([]);
    expect(chain(a.tenantId)).toHaveLength(0);
  });
});

describe('integrity-check: trigger della catena', () => {
  it('trigger mancante = errore', async () => {
    await setup();
    run('DROP TRIGGER trg_fiscal_chain_no_delete');
    expect(checkIntegrity(getDb()).errors.join('|')).toContain('trg_fiscal_chain_no_delete');
  });
  it('/health e API non sono toccate', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
  });
});
