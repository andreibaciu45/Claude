import { beforeEach, describe, expect, it } from 'vitest';
import { computeAllowance } from './allowance';
import { parseCheckoutReturn, stripCheckoutParam } from './checkoutReturn';
import {
  CACHE_TTL_MS, CLOCK_SKEW_MS, OFFLINE_GRACE_MS, cacheFromMe, canCreateDocument, clearPlanCache, readPlanCache, remainingFreeDocs,
  resolvePlan, writePlanCache, type PlanCache,
} from './entitlement';
import { FREE_DOCS_PER_MONTH, PRO_PRICE_MONTH, PRO_PRICE_YEAR, PRO_YEARLY_SAVING } from './pricing';
import { countDocsInMonth, ledgerIdsForMonth, monthKey, nextMonthStart, recordDocumentCreated } from './usage';

const DAY = 24 * 3600_000;
const at = (iso: string) => Date.parse(iso);

describe('pricing', () => {
  it('valori coerenti con docs/PRICING.md', () => {
    expect([FREE_DOCS_PER_MONTH, PRO_PRICE_MONTH, PRO_PRICE_YEAR, PRO_YEARLY_SAVING]).toEqual([3, 15, 120, 60]);
  });
});

describe('funzioni pure sui limiti', () => {
  it('Free: 3 documenti al mese', () => {
    expect([0, 1, 2].map((n) => canCreateDocument('free', n))).toEqual([true, true, true]);
    expect(canCreateDocument('free', 3)).toBe(false);
    expect(canCreateDocument('free', 10)).toBe(false);
  });
  it('Pro: sempre illimitato', () => {
    expect(canCreateDocument('pro', 0)).toBe(true);
    expect(canCreateDocument('pro', 9999)).toBe(true);
    expect(remainingFreeDocs('pro', 5)).toBeNull();
  });
  it('remainingFreeDocs non va mai sotto zero e ignora conteggi negativi', () => {
    expect(remainingFreeDocs('free', 0)).toBe(3);
    expect(remainingFreeDocs('free', 2)).toBe(1);
    expect(remainingFreeDocs('free', 3)).toBe(0);
    expect(remainingFreeDocs('free', 7)).toBe(0);
    expect(remainingFreeDocs('free', -4)).toBe(3);
  });
  it('computeAllowance prende il conteggio più alto tra locale e server (solo Free)', () => {
    expect(computeAllowance('free', 1, 3)).toMatchObject({ used: 3, remaining: 0, canCreate: false });
    expect(computeAllowance('free', 2, undefined)).toMatchObject({ used: 2, remaining: 1, canCreate: true, limit: 3 });
    expect(computeAllowance('pro', 2, 50)).toMatchObject({ used: 2, remaining: null, canCreate: true, limit: null });
  });
});

describe('mese di calendario', () => {
  it('chiave del mese in un fuso esplicito (cambio mese a mezzanotte locale)', () => {
    const t = at('2026-10-31T23:30:00Z'); // 00:30 del 1 novembre in Italia (CET)
    expect(monthKey(t, 'UTC')).toBe('2026-10');
    expect(monthKey(t, 'Europe/Rome')).toBe('2026-11');
    expect(monthKey(t, 'America/Los_Angeles')).toBe('2026-10');
  });
  it('ora legale: 31 marzo notte', () => {
    expect(monthKey(at('2026-03-31T22:30:00Z'), 'Europe/Rome')).toBe('2026-04'); // 00:30 CEST del 1 aprile
    expect(monthKey(at('2026-03-31T21:30:00Z'), 'Europe/Rome')).toBe('2026-03');
  });
  it('anno bisestile e cambio anno', () => {
    expect(monthKey(at('2028-02-29T12:00:00Z'), 'UTC')).toBe('2028-02');
    expect(monthKey(at('2026-12-31T23:59:59Z'), 'UTC')).toBe('2026-12');
    expect(monthKey(at('2027-01-01T00:00:00Z'), 'UTC')).toBe('2027-01');
  });
  it('senza fuso usa quello del dispositivo ed è coerente con Date', () => {
    const t = at('2026-06-15T12:00:00Z');
    expect(monthKey(t)).toBe('2026-06');
  });
  it('nextMonthStart è il 1 del mese dopo', () => {
    const d = nextMonthStart(at('2026-12-15T12:00:00Z'));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('conteggio documenti del mese', () => {
  const now = at('2026-11-10T10:00:00Z');
  const doc = (id: string, iso: string, extra: object = {}) => ({ id, createdAt: at(iso), ...extra });

  it('conta solo i documenti creati nel mese corrente', () => {
    const docs = [doc('a', '2026-11-02T09:00:00Z'), doc('b', '2026-10-30T09:00:00Z'), doc('c', '2026-11-09T09:00:00Z')];
    expect(countDocsInMonth(docs, [], now, 'UTC')).toBe(2);
  });
  it('le bozze eliminate non rimborsano: restano contate dal registro', () => {
    const docs = [doc('a', '2026-11-02T09:00:00Z')];
    expect(countDocsInMonth(docs, ['a', 'cancellata1', 'cancellata2'], now, 'UTC')).toBe(3);
  });
  it('nessun doppio conteggio dello stesso id', () => {
    expect(countDocsInMonth([doc('a', '2026-11-02T09:00:00Z')], ['a'], now, 'UTC')).toBe(1);
  });
  it('le note di credito non contano', () => {
    const nc = doc('nc', '2026-11-03T09:00:00Z', { invoice: { tipoDocumento: 'TD04' } });
    const ft = doc('ft', '2026-11-03T09:00:00Z', { invoice: { tipoDocumento: 'TD01' } });
    expect(countDocsInMonth([nc, ft], ['nc'], now, 'UTC')).toBe(1);
  });
  it('cambio mese: il contatore riparte', () => {
    const docs = [doc('a', '2026-11-02T09:00:00Z'), doc('b', '2026-11-03T09:00:00Z'), doc('c', '2026-11-04T09:00:00Z')];
    expect(countDocsInMonth(docs, [], at('2026-11-30T20:00:00Z'), 'UTC')).toBe(3);
    expect(countDocsInMonth(docs, [], at('2026-12-01T00:00:01Z'), 'UTC')).toBe(0);
  });
  it('fuso orario: un documento delle 00:30 italiane del 1 novembre è di novembre per l’utente', () => {
    const docs = [doc('a', '2026-10-31T23:30:00Z')];
    expect(countDocsInMonth(docs, [], at('2026-11-05T10:00:00Z'), 'Europe/Rome')).toBe(1);
    expect(countDocsInMonth(docs, [], at('2026-11-05T10:00:00Z'), 'UTC')).toBe(0);
  });
  it('documenti importati con createdAt non valido non rompono il conteggio', () => {
    expect(countDocsInMonth([{ id: 'x', createdAt: undefined as unknown as number }], [], now, 'UTC')).toBe(0);
  });
});

describe('registro locale', () => {
  beforeEach(() => { localStorage.clear(); });
  it('registra in modo idempotente per mese', () => {
    const t = at('2026-11-02T09:00:00Z');
    recordDocumentCreated('a', t, 'UTC');
    recordDocumentCreated('a', t, 'UTC');
    recordDocumentCreated('b', t, 'UTC');
    expect(ledgerIdsForMonth(t, 'UTC').sort()).toEqual(['a', 'b']);
    expect(ledgerIdsForMonth(at('2026-12-02T09:00:00Z'), 'UTC')).toEqual([]);
  });
  it('tiene solo gli ultimi 3 mesi', () => {
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) recordDocumentCreated(`d-${m}`, at(`${m}-10T10:00:00Z`), 'UTC');
    expect(ledgerIdsForMonth(at('2026-06-10T10:00:00Z'), 'UTC')).toEqual([]);
    expect(ledgerIdsForMonth(at('2026-09-10T10:00:00Z'), 'UTC')).toEqual(['d-2026-09']);
  });
  it('un registro corrotto non lancia', () => {
    localStorage.setItem('vp:billing:ledger', '{non json');
    expect(ledgerIdsForMonth(at('2026-11-02T09:00:00Z'), 'UTC')).toEqual([]);
    expect(() => recordDocumentCreated('a', at('2026-11-02T09:00:00Z'), 'UTC')).not.toThrow();
  });
});

describe('piano con cache, scadenza e tolleranza offline', () => {
  const t0 = at('2026-11-04T10:00:00Z');
  const pro = (verifiedAt: number, extra: Partial<PlanCache> = {}): PlanCache => ({ plan: 'pro', verifiedAt, ...extra });

  it('senza account è sempre Free, anche con una cache Pro', () => {
    expect(resolvePlan(pro(t0), false, t0)).toMatchObject({ plan: 'free', reason: 'anonymous' });
  });
  it('account mai verificato: Free e da verificare', () => {
    expect(resolvePlan(null, true, t0)).toMatchObject({ plan: 'free', reason: 'unverified', needsRefresh: true });
  });
  it('Pro verificato da poco', () => {
    expect(resolvePlan(pro(t0), true, t0 + 1000)).toMatchObject({ plan: 'pro', reason: 'server-pro', needsRefresh: false });
  });
  it('Pro oltre la scadenza della cache ma dentro la tolleranza: resta Pro e chiede di riverificare', () => {
    const s = resolvePlan(pro(t0), true, t0 + CACHE_TTL_MS + 1);
    expect(s).toMatchObject({ plan: 'pro', reason: 'cache-pro', needsRefresh: true });
    expect(s.proValidUntil).toBe(t0 + OFFLINE_GRACE_MS);
  });
  it('tolleranza di 14 giorni: l’ultimo istante è ancora Pro, subito dopo no', () => {
    expect(resolvePlan(pro(t0), true, t0 + OFFLINE_GRACE_MS).plan).toBe('pro');
    expect(resolvePlan(pro(t0), true, t0 + 13 * DAY).plan).toBe('pro');
    expect(resolvePlan(pro(t0), true, t0 + OFFLINE_GRACE_MS + 1)).toMatchObject({ plan: 'free', reason: 'expired', needsRefresh: true });
    expect(resolvePlan(pro(t0), true, t0 + 30 * DAY).plan).toBe('free');
  });
  it('se il server dice Free il downgrade è immediato', () => {
    expect(resolvePlan({ plan: 'free', verifiedAt: t0 }, true, t0 + 1)).toMatchObject({ plan: 'free', reason: 'server-free' });
  });
  it('orologio spostato indietro: una verifica "dal futuro" non estende il Pro', () => {
    expect(resolvePlan(pro(t0 + CLOCK_SKEW_MS + 1000), true, t0)).toMatchObject({ plan: 'free', reason: 'unverified' });
    // piccolo scarto di orologio tollerato
    expect(resolvePlan(pro(t0 + 1000), true, t0).plan).toBe('pro');
  });
  it('cache di un altro account: ignorata', () => {
    expect(resolvePlan(pro(t0, { email: 'a@x.it' }), true, t0, 'b@x.it').plan).toBe('free');
    expect(resolvePlan(pro(t0, { email: 'A@x.it' }), true, t0, 'a@X.it').plan).toBe('pro');
  });
  it('verifiedAt non numerico: Free', () => {
    expect(resolvePlan(pro(NaN), true, t0).plan).toBe('free');
  });
});

describe('cache locale del piano', () => {
  beforeEach(() => { localStorage.clear(); });
  it('scrive, rilegge e cancella', () => {
    const c = cacheFromMe({ plan: 'pro', email: 'a@x.it', quota: { docsThisMonth: 4, docsLimit: null } }, 123);
    writePlanCache(c);
    expect(readPlanCache()).toEqual({ plan: 'pro', verifiedAt: 123, email: 'a@x.it', docsThisMonth: 4, docsLimit: null });
    clearPlanCache();
    expect(readPlanCache()).toBeNull();
  });
  it('contenuti non validi => null', () => {
    localStorage.setItem('vp:billing:plan', JSON.stringify({ plan: 'enterprise', verifiedAt: 1 }));
    expect(readPlanCache()).toBeNull();
    localStorage.setItem('vp:billing:plan', 'xx');
    expect(readPlanCache()).toBeNull();
  });
});

describe('ritorno dal pagamento', () => {
  it('riconosce il parametro nell’hash (HashRouter) o prima dell’hash', () => {
    expect(parseCheckoutReturn('', '#/account?checkout=success')).toBe('success');
    expect(parseCheckoutReturn('?checkout=cancel', '#/account')).toBe('cancel');
    expect(parseCheckoutReturn('?checkout=boh', '#/account')).toBeNull();
    expect(parseCheckoutReturn('', '#/account')).toBeNull();
  });
  it('toglie il parametro dall’URL', () => {
    expect(stripCheckoutParam('https://app.it/#/account?checkout=success')).toBe('https://app.it/#/account');
    expect(stripCheckoutParam('https://app.it/?checkout=success#/account')).toBe('https://app.it/#/account');
    expect(stripCheckoutParam('https://app.it/#/account?checkout=success&x=1')).toBe('https://app.it/#/account?x=1');
  });
});
