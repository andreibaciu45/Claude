/** Regressioni della revisione indipendente (docs/CODE-REVIEW-CLIENT.md): billing / link di pagamento. */
import { describe, expect, it } from 'vitest';
import { serverUsedFor } from './allowance';
import { cacheFromMe, readPlanCache, writePlanCache } from './entitlement';
import { parseSafePaymentUrl } from './safeUrl';

const at = (iso: string) => Date.parse(iso);

describe('BILL-1 cambio mese: il conteggio del server vale solo per il suo mese UTC', () => {
  it('verifica del 31/10 alle 23:30 UTC (= 1/11 00:30 a Roma), ora è il 1/11 alle 10:00 UTC: il conteggio di ottobre non vale', () => {
    const cache = { verifiedAt: at('2026-10-31T23:30:00Z'), docsThisMonth: 3, periodKey: '2026-10' };
    expect(serverUsedFor(cache, at('2026-11-01T10:00:00Z'))).toBeUndefined();
    expect(serverUsedFor(cache, at('2026-10-31T23:59:00Z'))).toBe(3);
  });
  it('senza periodKey (cache vecchia) si usa il mese UTC della verifica, non quello locale', () => {
    const cache = { verifiedAt: at('2026-10-31T23:30:00Z'), docsThisMonth: 3 };
    expect(serverUsedFor(cache, at('2026-11-01T01:00:00Z'))).toBeUndefined();
  });
  it('periodKey viaggia dalla risposta di /me alla cache e torna in lettura', () => {
    localStorage.clear();
    writePlanCache(cacheFromMe({ plan: 'free', email: 'a@b.it', quota: { docsThisMonth: 2, docsLimit: 3, periodKey: '2026-11' } }, 5));
    expect(readPlanCache()?.periodKey).toBe('2026-11');
  });
});

describe('BILL-2 URL di pagamento: nessun javascript:, nessun host estraneo', () => {
  const ok = (u: string) => parseSafePaymentUrl(u, { appHost: 'app.example.it', allowInsecureLocalhost: false }).toString();
  it('accetta https su stripe.com e sottodomini e sull\'host dell\'app', () => {
    expect(ok('https://checkout.stripe.com/c/pay/abc')).toContain('checkout.stripe.com');
    expect(ok('https://billing.stripe.com/p/session/x')).toContain('billing.stripe.com');
    expect(ok('https://app.example.it/pay')).toContain('app.example.it');
  });
  it.each([
    'javascript://localhost/%0Aalert(1)',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'http://checkout.stripe.com/x',
    'https://evilstripe.com/x',
    'https://stripe.com.evil.test/x',
    'https://user:pw@checkout.stripe.com/x',
    '//evil.test/x',
    '/relativo',
    'http://localhost:3000/x',
  ])('rifiuta %s', (u) => { expect(() => ok(u)).toThrow(); });
});
