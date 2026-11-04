// Concorrenza del sync: due dispositivi con gli stessi numeri fattura, emissioni in parallelo, race sulla stessa fattura.
import { beforeEach, describe, expect, it } from 'vitest';
import { call, docOp, freshEnv, invoice, login, push } from './helpers';
import { all, one } from '../../src/db';
import { setEntitlement } from '../../src/db/entitlements';

beforeEach(freshEnv);
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

describe('numerazione fatture con più dispositivi', () => {
  it('due dispositivi emettono gli STESSI numeri in parallelo: per ogni numero vince uno solo, l\'altro riceve duplicate_invoice_number', async () => {
    const A = await login('a@x.it', 'devA');
    setEntitlement(A.tenantId, { plan: 'pro' });
    const N = 100;
    const opsA = Array.from({ length: N }, (_, i) => docOp(invoice(`a-${i + 1}`, i + 1)));
    const opsB = Array.from({ length: N }, (_, i) => docOp(invoice(`b-${i + 1}`, i + 1)));
    // interleave: i pacchetti dei due dispositivi partono insieme
    const results = await Promise.all([...chunk(opsA, 10).map((c) => push(A.token, c, 'devA')), ...chunk(opsB, 10).map((c) => push(A.token, c, 'devB'))]);
    const accepted = results.flatMap((r) => r.json.accepted as string[]);
    const conflicts = results.flatMap((r) => r.json.conflicts as any[]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(accepted).toHaveLength(N);
    expect(conflicts).toHaveLength(N);
    expect(new Set(conflicts.map((c) => c.reason))).toEqual(new Set(['duplicate_invoice_number']));
    // nessun buco, nessun doppione: 1..N una volta sola
    const seqs = all<{ inv_seq: number }>("SELECT inv_seq FROM documents WHERE inv_sectional='FT' AND inv_year=2026 ORDER BY inv_seq").map((r) => r.inv_seq);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    // il perdente non ha lasciato nulla: né documento, né quota consumata, né log di sync
    const docs = one<{ n: number }>('SELECT COUNT(*) n FROM documents')!.n;
    expect(docs).toBe(N);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM changes')!.n).toBe(N);
    // idempotenza: ripetere le stesse operazioni dà gli stessi esiti e non cambia nulla
    const again = await Promise.all(chunk(opsA, 50).map((c) => push(A.token, c, 'devA')));
    expect(again.flatMap((r) => r.json.accepted).length + again.flatMap((r) => r.json.conflicts).length).toBe(N);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM documents')!.n).toBe(N);
  });

  it('1.000 emissioni concorrenti da due dispositivi con numeri disgiunti: sequenza 1..1000 senza buchi né doppioni', async () => {
    const A = await login('a@x.it');
    setEntitlement(A.tenantId, { plan: 'pro' });
    const all1000 = Array.from({ length: 1000 }, (_, i) => docOp(invoice(`f-${i + 1}`, i + 1)));
    const odd = all1000.filter((_, i) => i % 2 === 0), even = all1000.filter((_, i) => i % 2 === 1);
    const results = await Promise.all([...chunk(odd, 10).map((c) => push(A.token, c, 'devA')), ...chunk(even, 10).map((c) => push(A.token, c, 'devB'))]);
    expect(results.flatMap((r) => r.json.conflicts)).toEqual([]);
    expect(results.flatMap((r) => r.json.accepted)).toHaveLength(1000);
    const seqs = all<{ inv_seq: number }>('SELECT inv_seq FROM documents ORDER BY inv_seq').map((r) => r.inv_seq);
    expect(seqs).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  });

  it('sezionali e anni diversi non collidono (FT/NC, 2026/2027)', async () => {
    const A = await login('a@x.it');
    setEntitlement(A.tenantId, { plan: 'pro' });
    const nc: any = invoice('nc-1', 1, { id: 'nc-1' }); nc.invoice.sectional = 'NC'; nc.invoice.tipoDocumento = 'TD04';
    const y27: any = invoice('ft27-1', 1); y27.invoice.year = 2027;
    const r = await push(A.token, [docOp(invoice('ft-1', 1)), docOp(nc), docOp(y27)]);
    expect(r.json.conflicts).toEqual([]);
    expect(r.json.accepted).toHaveLength(3);
  });

  it('due dispositivi emettono LA STESSA bozza con numeri diversi: vince il primo, il secondo trova una fattura immutabile', async () => {
    const A = await login('a@x.it');
    const draft = invoice('f1', 1, {}, false);
    await push(A.token, [docOp(draft)]);
    const [r1, r2] = await Promise.all([
      push(A.token, [docOp(invoice('f1', 5, { updatedAt: 2000 }))], 'devA'),
      push(A.token, [docOp(invoice('f1', 6, { updatedAt: 2001 }))], 'devB'),
    ]);
    const outcomes = [...r1.json.accepted.map(() => 'ok'), ...r1.json.conflicts.map((c: any) => c.reason), ...r2.json.accepted.map(() => 'ok'), ...r2.json.conflicts.map((c: any) => c.reason)];
    expect(outcomes.sort()).toEqual(['locked_document', 'ok']);
    expect(all("SELECT inv_seq FROM documents WHERE id='f1'")).toHaveLength(1);
  });

  it('modifiche concorrenti della stessa bozza: vince updatedAt più recente, l\'altra è stale con serverVersion', async () => {
    const A = await login('a@x.it');
    await push(A.token, [docOp({ ...invoice('f1', 1, {}, false), updatedAt: 1000 })]);
    const [a, b] = await Promise.all([
      push(A.token, [docOp({ ...invoice('f1', 1, { notes: 'A' }, false), updatedAt: 3000 })], 'devA'),
      push(A.token, [docOp({ ...invoice('f1', 1, { notes: 'B' }, false), updatedAt: 2000 })], 'devB'),
    ]);
    expect(JSON.parse(one<{ data: string }>('SELECT data FROM documents')!.data).notes).toBe('A');
    const stale = [...a.json.conflicts, ...b.json.conflicts];
    // se B è arrivata dopo A è stale; se è arrivata prima, A la sovrascrive senza conflitto: in entrambi i casi lo stato finale è A
    for (const c of stale) expect(c.reason).toBe('stale');
    expect((await call('GET', '/v1/documents/f1', { token: A.token })).json.notes).toBe('A');
  });

  it('due tenant con gli stessi numeri non interferiscono', async () => {
    const A = await login('a@x.it'), B = await login('b@x.it');
    for (const t of [A, B]) setEntitlement(t.tenantId, { plan: 'pro' });
    const [ra, rb] = await Promise.all([push(A.token, [docOp(invoice('f1', 1))]), push(B.token, [docOp(invoice('f1', 1))])]);
    expect(ra.json.conflicts).toEqual([]);
    expect(rb.json.conflicts).toEqual([]);
  });
});
