// Licenze Pro concesse a mano: precedenza rispetto a Stripe, scadenza, append-only, /v1/me, quota.
import { beforeEach, describe, expect, it } from 'vitest';
import { call, cli, docOp, freshEnv, login, push, quote } from './helpers';
import { all, one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { billingStatusOf, effectivePlan, getEntitlement, getPlan, setEntitlement } from '../../src/db/entitlements';
import { grantPro, manualGrantUntil, revokePro } from '../../src/db/grants';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';
import { billingService } from '../../src/billing/routes';
import { processStripeEvent } from '../../src/billing/webhook';
import { untilFromDate } from '../../scripts/admin';

const DAY = 86_400_000;
beforeEach(freshEnv);

describe('db/grants: stato di una concessione = ultima riga grant/revoke', () => {
  it('concessione attiva, scaduta, revocata, rinnovata', async () => {
    const { tenantId } = await login('a@x.it');
    const T = 1_800_000_000_000;
    setClock(() => T);
    expect(manualGrantUntil(tenantId)).toBeNull();
    grantPro(tenantId, T + 10 * DAY, 'amico');
    expect(manualGrantUntil(tenantId)).toBe(T + 10 * DAY);
    expect(getPlan(tenantId)).toBe('pro');
    setClock(() => T + 10 * DAY - 1);
    expect(getPlan(tenantId)).toBe('pro');
    setClock(() => T + 10 * DAY); // scade esattamente alla fine (esclusa)
    expect(getPlan(tenantId)).toBe('free');
    grantPro(tenantId, T + 20 * DAY);
    expect(getPlan(tenantId)).toBe('pro');
    revokePro(tenantId, 'errore');
    expect(getPlan(tenantId)).toBe('free');
    expect(all("SELECT action FROM admin_actions WHERE tenant_id=? ORDER BY id", tenantId).map((r: any) => r.action)).toEqual(['grant_pro', 'grant_pro', 'revoke_pro']);
  });

  it('admin_actions e\' append-only (trigger)', async () => {
    const { tenantId } = await login('a@x.it');
    grantPro(tenantId, Date.now() + DAY, 'x');
    expect(() => run('UPDATE admin_actions SET note=?', 'y')).toThrow(/append-only/);
    expect(() => run('DELETE FROM admin_actions')).toThrow(/append-only/);
    expect(() => run('INSERT OR REPLACE INTO admin_actions(id, at, actor, action) VALUES (1, 1, ?, ?)', 'z', 'z')).toThrow(/append-only/);
  });
});

describe('precedenza Stripe / manuale: vale il massimo, nessuna delle due sovrascrive l\'altra', () => {
  it('funzione pura effectivePlan', () => {
    const free = { plan: 'free' as const, status: 'active', currentPeriodEnd: null, graceUntil: null };
    const pro = { ...free, plan: 'pro' as const };
    expect(effectivePlan({ ...free, manualGrantUntil: 100 }, 99)).toBe('pro');
    expect(effectivePlan({ ...free, manualGrantUntil: 100 }, 100)).toBe('free');
    expect(effectivePlan({ ...pro, manualGrantUntil: 50 }, 99)).toBe('pro'); // concessione scaduta ma Stripe attivo
    expect(effectivePlan({ ...pro, status: 'canceled', manualGrantUntil: 100 }, 99)).toBe('pro'); // Stripe annullato ma concessione attiva
  });

  it('un evento Stripe (anche di annullamento) non cancella la concessione manuale', async () => {
    const { tenantId } = await login('a@x.it');
    grantPro(tenantId, Date.now() + 30 * DAY, 'omaggio');
    const store = new SqliteBillingStore();
    const ev = (id: string, type: string, obj: Record<string, unknown>) => ({ id, type, created: Math.floor(Date.now() / 1000), data: { object: { client_reference_id: tenantId, customer: 'cus_1', ...obj } } });
    await processStripeEvent(ev('e1', 'checkout.session.completed', { subscription: 'sub_1' }), store, Date.now());
    expect(getEntitlement(tenantId)).toMatchObject({ plan: 'pro', status: 'active' });
    await processStripeEvent(ev('e2', 'customer.subscription.deleted', {}), store, Date.now());
    expect(getEntitlement(tenantId)).toMatchObject({ plan: 'free', status: 'canceled' });
    expect(getPlan(tenantId)).toBe('pro');           // la concessione manuale regge
    expect(billingStatusOf(getEntitlement(tenantId), getPlan(tenantId))).toBe('canceled'); // ha avuto un abbonamento: l'interfaccia lo sa
    expect(manualGrantUntil(tenantId)).not.toBeNull();
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM admin_actions WHERE action='revoke_pro'")!.n).toBe(0);
  });

  it('la concessione non sovrascrive lo stato Stripe e revoke-pro lascia Pro chi paga', async () => {
    const { tenantId } = await login('a@x.it');
    setEntitlement(tenantId, { plan: 'pro', status: 'active', currentPeriodEnd: Date.now() + 20 * DAY, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
    const before = one('SELECT * FROM entitlements WHERE tenant_id=?', tenantId);
    grantPro(tenantId, Date.now() + DAY);
    revokePro(tenantId);
    expect(one('SELECT * FROM entitlements WHERE tenant_id=?', tenantId)).toEqual(before);
    expect(getPlan(tenantId)).toBe('pro'); // abbonamento Stripe intatto
  });

  it('GET /v1/me: Pro per concessione manuale, billingStatus none, quota illimitata; torna Free alla scadenza', async () => {
    const { token, tenantId } = await login('a@x.it');
    const T = Date.now();
    grantPro(tenantId, T + 5 * DAY);
    expect((await call('GET', '/v1/me', { token })).json).toMatchObject({ plan: 'pro', billingStatus: 'none', quota: { docsLimit: null } });
    setClock(() => T + 6 * DAY);
    expect((await call('GET', '/v1/me', { token })).json).toMatchObject({ plan: 'free', quota: { docsLimit: 3 } });
  });

  it('la quota Free dei documenti rispetta la concessione (sync) e anche billingService (voce)', async () => {
    const { token, tenantId } = await login('a@x.it');
    const ops = Array.from({ length: 4 }, (_, i) => docOp(quote(`q${i}`, { number: `P-${i}` })));
    expect((await push(token, ops.slice(0, 3))).json.conflicts).toEqual([]);
    expect((await push(token, [ops[3]!])).json.conflicts[0].reason).toBe('quota_exceeded');
    expect((await billingService.getEntitlement(tenantId)).plan).toBe('free');
    grantPro(tenantId, Date.now() + DAY);
    expect((await billingService.getEntitlement(tenantId))).toMatchObject({ plan: 'pro', docsLimit: null });
    expect((await push(token, [ops[3]!])).json.conflicts).toEqual([]);
  });
});

describe('CLI grant-pro / revoke-pro', () => {
  it('--giorni e --fino-al, validazione, tracciamento con nota', async () => {
    const { tenantId } = await login('Mario@X.it');
    let r = await cli(['grant-pro', 'mario@x.it']);
    expect(r.code).toBe(64);
    r = await cli(['grant-pro', 'mario@x.it', '--giorni', '5', '--fino-al', '2099-01-01']);
    expect(r.code).toBe(64);
    r = await cli(['grant-pro', 'mario@x.it', '--giorni', '0']);
    expect(r.code).toBe(64);
    r = await cli(['grant-pro', 'mario@x.it', '--fino-al', '2020-01-01']);
    expect(r.code).toBe(64);
    r = await cli(['grant-pro', 'mario@x.it', '--fino-al', '2099-02-30']);
    expect(r.code).toBe(64);
    r = await cli(['grant-pro', 'nessuno@x.it', '--giorni', '3']);
    expect(r.code).toBe(1);
    expect(getPlan(tenantId)).toBe('free');

    r = await cli(['grant-pro', 'MARIO@x.it', '--giorni', '30', '--nota', 'beta tester']);
    expect(r).toMatchObject({ code: 0 });
    expect(r.out).toContain('Piano effettivo ora: pro (manuale');
    expect(getPlan(tenantId)).toBe('pro');
    const row = one<any>("SELECT * FROM admin_actions WHERE action='grant_pro'")!;
    expect(row).toMatchObject({ tenant_id: tenantId, note: 'beta tester' });
    expect(Math.abs(row.until_at - row.at - 30 * DAY)).toBeLessThan(1000); // now() è letto due volte (calcolo scadenza e registrazione): possibili pochi ms di differenza
    expect(JSON.stringify(row)).not.toContain('mario'); // niente email nel registro

    const target = new Date(Date.now() + 400 * DAY).toISOString().slice(0, 10);
    r = await cli(['grant-pro', 'mario@x.it', '--fino-al', target]);
    expect(r.out).toContain('Sostituisce la concessione precedente');
    expect(manualGrantUntil(tenantId)).toBe(untilFromDate(target)); // "fino al" e' inclusivo: scade a mezzanotte UTC del giorno dopo
    expect(untilFromDate('2099-12-31')).toBe(Date.UTC(2100, 0, 1));
    expect((await cli(['grant-pro', 'mario@x.it', '--fino-al', '2099-12-31'])).code).toBe(64); // oltre 10 anni

    r = await cli(['revoke-pro', 'mario@x.it', '--nota', 'rimborso']);
    expect(r.code).toBe(0);
    expect(getPlan(tenantId)).toBe('free');
    r = await cli(['revoke-pro', 'mario@x.it']);
    expect(r.out).toContain('niente da revocare');
  });

  it('info mostra storico; tenants mostra la fonte del piano', async () => {
    await login('a@x.it');
    await cli(['grant-pro', 'a@x.it', '--giorni', '10']);
    const info = await cli(['info', 'a@x.it']);
    expect(info.out).toContain('pro (manuale fino al');
    expect(info.out).toContain('grant_pro');
    const list = await cli(['tenants', '--json']);
    const j = JSON.parse(list.out);
    expect(j[0]).toMatchObject({ email: 'a@x.it', piano: 'pro' });
  });
});
