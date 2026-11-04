// Regressioni di sicurezza: anti-DoS sull'OTP, IP/proxy, rate-limit generale, Termini/DPA, piano e periodo di grazia, clock skew, payload ostili.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, call, docOp, freshEnv, invoice, login, opId, push, quote, sent } from './helpers';
import { all, one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { effectivePlan, getPlan, setEntitlement } from '../../src/db/entitlements';
import { DbRateLimitStore, MemoryRateLimitStore } from '../../src/db/ratelimit';
import { clientIp, ipKey, isPrivateAddress } from '../../src/auth/ip';
import { tooComplex } from '../../src/sync/service';
import { SqliteBillingStore } from '../../src/billing/sqlite-store';

beforeEach(freshEnv);
afterEach(() => {
  for (const k of ['TRUST_PROXY', 'REQUIRE_TERMS', 'TERMS_CURRENT_VERSION', 'DPA_CURRENT_VERSION', 'TERMS_STORE_IP_HASH', 'RL_TENANT_PER_MIN', 'RL_TENANT_WRITES_PER_MIN', 'RL_IP_PER_MIN', 'SYNC_PULL_MAX_BYTES', 'RL_SYNC_OPS_HOUR', 'MAX_DOC_BYTES', 'MAX_CATALOG_ITEMS', 'CLOCK_SKEW_MAX_MS', 'RATE_LIMIT_STORE']) delete process.env[k];
  process.env.RL_IP_PER_MIN = '1000000'; process.env.RL_TENANT_PER_MIN = '1000000'; process.env.RL_TENANT_WRITES_PER_MIN = '1000000'; process.env.RL_SYNC_OPS_HOUR = '1000000';
});

const PROXY = '172.18.0.2'; // peer privato: come Caddy sulla rete docker
const reqOtp = (email: string, ip: string) => call('POST', '/v1/auth/request', { body: { email }, ip, peer: PROXY });
const ver = (email: string, code: string, ip: string, deviceId = 'd1', extra: object = {}) => call('POST', '/v1/auth/verify', { body: { email, code, deviceId, ...extra }, ip, peer: PROXY });
const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

describe('OTP: nessun DoS mirato sulla vittima', () => {
  it('un attaccante che sbaglia codici si blocca DA SOLO (backoff per coppia email+IP): la vittima accede', async () => {
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await ver('v@x.it', wrongOf(code), '6.6.6.6')).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
    const ok = await ver('v@x.it', code, '2.2.2.2', 'dv');
    expect(ok.status).toBe(200); // il codice della vittima non è stato bruciato né il suo budget esaurito
  });

  it('il backoff cresce (esponenziale) e scade da solo', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    for (let i = 0; i < 3; i++) await ver('v@x.it', wrongOf(code), '6.6.6.6');
    const r4 = await ver('v@x.it', wrongOf(code), '6.6.6.6');
    expect(r4.status).toBe(429);
    expect(Number(r4.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    t += 61_000;
    expect((await ver('v@x.it', wrongOf(code), '6.6.6.6')).status).toBe(401); // sbloccato: un altro errore...
    const r5 = await ver('v@x.it', wrongOf(code), '6.6.6.6');
    expect(r5.status).toBe(429); // ...e il blocco successivo è più lungo (120 s)
    expect(Number(r5.headers.get('retry-after'))).toBeGreaterThan(60);
  });

  it('chi è già bloccato non consuma il budget per email della vittima', async () => {
    await reqOtp('v@x.it', '2.2.2.2');
    for (let i = 0; i < 40; i++) await ver('v@x.it', wrongOf(sent[0].code), '6.6.6.6');
    const used = one<{ count: number }>("SELECT count FROM rate_limits WHERE key LIKE 'otpver:email:%'")!.count;
    expect(used).toBeLessThanOrEqual(3); // solo i tentativi effettivamente valutati
  });

  it('richieste OTP: l\'attaccante esaurisce il proprio budget (coppia), la vittima può comunque richiedere e usare il codice', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) expect((await reqOtp('v@x.it', '6.6.6.6')).status).toBe(204);
    expect((await reqOtp('v@x.it', '6.6.6.6')).status).toBe(429);
    expect((await reqOtp('v@x.it', '2.2.2.2')).status).toBe(204); // la vittima, da un altro IP
    codes.push(sent[sent.length - 1].code);
    expect((await ver('v@x.it', codes[0], '2.2.2.2')).status).toBe(200);
  });

  it('limite residuo documentato: molti IP distinti possono esaurire il tetto per email (finestra 10 min, nessun blocco permanente)', async () => {
    let t = 1_800_000_000_000;
    setClock(() => t);
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    for (let i = 0; i < 15; i++) await ver('v@x.it', wrongOf(code), `7.7.7.${i}`);
    expect((await ver('v@x.it', code, '2.2.2.2')).status).toBe(429);
    t += 10 * 60_000 + 1;
    await reqOtp('v@x.it', '2.2.2.2');
    expect((await ver('v@x.it', sent[sent.length - 1].code, '2.2.2.2')).status).toBe(200);
  });

  it('successo azzera il backoff della coppia', async () => {
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    await ver('v@x.it', wrongOf(code), '2.2.2.2');
    await ver('v@x.it', wrongOf(code), '2.2.2.2');
    expect((await ver('v@x.it', code, '2.2.2.2')).status).toBe(200);
    expect(one("SELECT 1 AS x FROM auth_backoff")).toBeUndefined();
  });

  it('email con caratteri di controllo / header injection -> 400', async () => {
    for (const email of ['a@x.it\r\nBcc: evil@x.it', 'a\u0000@x.it', 'a b@x.it', 'a@x.it,b@x.it', '<a@x.it>']) {
      expect((await call('POST', '/v1/auth/request', { body: { email } })).status).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });
});

describe('IP del client e TRUST_PROXY', () => {
  const ctx = (xff: string | undefined, peer: string | undefined) => ({
    req: { header: (n: string) => (n.toLowerCase() === 'x-forwarded-for' ? xff : undefined) },
    env: peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
  }) as any;

  it('auto (default): XFF fidato solo da peer privato/loopback', () => {
    expect(clientIp(ctx('1.2.3.4', '10.0.0.2'))).toBe('1.2.3.4');
    expect(clientIp(ctx('1.2.3.4', '127.0.0.1'))).toBe('1.2.3.4');
    expect(clientIp(ctx('1.2.3.4', '172.20.0.9'))).toBe('1.2.3.4');
    expect(clientIp(ctx('1.2.3.4', '8.8.8.8'))).toBe('8.8.8.8'); // peer pubblico: XFF falsificabile, ignorato
    expect(clientIp(ctx('1.2.3.4', undefined))).toBe('unknown');
  });
  it('auto: si usa il valore più a destra (aggiunto dal nostro proxy), non quello scelto dal client', () => {
    expect(clientIp(ctx('6.6.6.6, 1.2.3.4', '10.0.0.2'))).toBe('1.2.3.4');
  });
  it('TRUST_PROXY=0: XFF mai usato', () => {
    process.env.TRUST_PROXY = '0';
    expect(clientIp(ctx('1.2.3.4', '10.0.0.2'))).toBe('10.0.0.2');
  });
  it('TRUST_PROXY=N: N-esimo valore da destra, anche con peer pubblico', () => {
    process.env.TRUST_PROXY = '1';
    expect(clientIp(ctx('9.9.9.9, 1.2.3.4', '8.8.8.8'))).toBe('1.2.3.4');
    process.env.TRUST_PROXY = '2';
    expect(clientIp(ctx('9.9.9.9, 1.2.3.4, 5.5.5.5', '8.8.8.8'))).toBe('1.2.3.4');
    expect(clientIp(ctx('5.5.5.5', '8.8.8.8'))).toBe('8.8.8.8'); // catena più corta del previsto: non si inventa
  });
  it('valori non-IP in XFF sono ignorati', () => {
    expect(clientIp(ctx('non-un-ip', '10.0.0.2'))).toBe('10.0.0.2');
  });
  it('ipKey: IPv4 mappato e prefisso /64 per IPv6; isPrivateAddress', () => {
    expect(ipKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(ipKey('2001:db8:1:2::1'));
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
    for (const p of ['10.1.1.1', '192.168.0.1', '172.16.0.1', '127.0.0.1', '::1', 'fd00::1', 'fe80::1', '169.254.169.254']) expect(isPrivateAddress(p)).toBe(true);
    for (const p of ['8.8.8.8', '172.32.0.1', '2001:db8::1']) expect(isPrivateAddress(p)).toBe(false);
  });
  it('limite OTP per IP: IP diversi dietro il proxy non si condividono il budget', async () => {
    for (let i = 0; i < 25; i++) expect((await reqOtp(`u${i}@x.it`, `3.3.3.${i}`)).status).toBe(204); // > RL_OTP_REQUEST_IP_HOUR se fossero tutti "il proxy"
  });
});

describe('rate-limit generale (a)', () => {
  it('per tenant: 429 + Retry-After, un altro tenant non è toccato', async () => {
    const A = await login('a@x.it'); const B = await login('b@x.it');
    process.env.RL_TENANT_PER_MIN = '5';
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await call('GET', '/v1/me', { token: A.token })).status;
    expect(last).toBe(200);
    const r = await call('GET', '/v1/me', { token: A.token });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('rate_limited');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.headers.get('ratelimit-limit')).toBe('5');
    expect((await call('GET', '/v1/me', { token: B.token })).status).toBe(200);
  });
  it('le scritture hanno un tetto proprio più basso', async () => {
    const A = await login('a@x.it');
    process.env.RL_TENANT_WRITES_PER_MIN = '3';
    const st: number[] = [];
    for (let i = 0; i < 5; i++) st.push((await push(A.token, [])).status);
    expect(st).toEqual([200, 200, 200, 429, 429]);
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(200); // le letture non sono toccate
  });
  it('per IP prima dell\'autenticazione; /health esente', async () => {
    process.env.RL_IP_PER_MIN = '4';
    const st: number[] = [];
    for (let i = 0; i < 6; i++) st.push((await call('GET', '/v1/me', { ip: '5.5.5.5', peer: PROXY })).status);
    expect(st).toEqual([401, 401, 401, 401, 429, 429]);
    expect((await call('GET', '/v1/me', { ip: '5.5.5.6', peer: PROXY })).status).toBe(401); // altro IP
    for (let i = 0; i < 10; i++) expect((await call('GET', '/health', { ip: '5.5.5.5', peer: PROXY })).status).toBe(200);
  });
  it('la finestra si riapre dopo il periodo', async () => {
    let t = 1_800_000_000_000; setClock(() => t);
    const A = await login('a@x.it');
    process.env.RL_TENANT_PER_MIN = '2';
    await call('GET', '/v1/me', { token: A.token }); await call('GET', '/v1/me', { token: A.token });
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(429);
    t += 60_001;
    expect((await call('GET', '/v1/me', { token: A.token })).status).toBe(200);
  });
  it('RATE_LIMIT_STORE=db persiste i contatori nella tabella rate_limits', async () => {
    process.env.RATE_LIMIT_STORE = 'db';
    const A = await login('a@x.it');
    await call('GET', '/v1/me', { token: A.token });
    expect(all("SELECT key FROM rate_limits WHERE key LIKE 'tn:%'").length).toBe(1);
  });
  it('budget orario di operazioni di sync', async () => {
    const A = await login('a@x.it');
    process.env.RL_SYNC_OPS_HOUR = '3';
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ opId: opId(), entity: 'catalog', entityId: `c${i}`, op: 'delete', clientTs: 1 })) as any;
    expect((await push(A.token, mk(2))).status).toBe(200);
    expect((await push(A.token, mk(2))).status).toBe(429);
    expect((await push(A.token, mk(1))).status).toBe(200);
  });

  for (const [name, mk] of [['Db', () => new DbRateLimitStore()], ['Memory', () => new MemoryRateLimitStore()]] as const) {
    it(`interfaccia RateLimitStore (${name}): finestra fissa, peek, cost, retryAfter`, () => {
      let t = 1_000_000; setClock(() => t);
      const s = mk();
      expect(s.hit('k', 2, 1000).ok).toBe(true);
      expect(s.peek('k', 2, 1000)).toMatchObject({ ok: true, remaining: 1 });
      expect(s.hit('k', 2, 1000).ok).toBe(true);
      const d = s.hit('k', 2, 1000);
      expect(d).toMatchObject({ ok: false, remaining: 0 });
      expect(d.retryAfterSec).toBe(1);
      expect(s.hit('k2', 5, 1000, 6).ok).toBe(false); // cost > limit
      expect(s.hit('k2', 5, 1000, 5).ok).toBe(true);
      t += 1000;
      expect(s.hit('k', 2, 1000).ok).toBe(true);
    });
  }
  it('MemoryRateLimitStore non cresce senza limite', () => {
    const s = new MemoryRateLimitStore(100);
    for (let i = 0; i < 1000; i++) s.hit(`k${i}`, 5, 60_000);
    expect((s as any).buckets.size).toBeLessThanOrEqual(101);
  });
});

describe('Termini e DPA al primo accesso (f)', () => {
  const acc = { termsVersion: '2026-11', dpaVersion: '2026-11', acceptedAt: 1700000000000 };
  it('senza REQUIRE_TERMS: campo opzionale, retro-compatibile; se presente viene registrato', async () => {
    await login('a@x.it');
    expect(all('SELECT * FROM legal_acceptances')).toHaveLength(0);
    await call('POST', '/v1/auth/request', { body: { email: 'b@x.it' } });
    const r = await call('POST', '/v1/auth/verify', { body: { email: 'b@x.it', code: sent[sent.length - 1].code, deviceId: 'd', acceptedTerms: acc } });
    expect(r.status).toBe(200);
    const rows = all<any>('SELECT * FROM legal_acceptances ORDER BY id');
    expect(rows.map((x) => [x.kind, x.version])).toEqual([['terms', '2026-11'], ['dpa', '2026-11']]);
    expect(rows[0].tenant_id).toBe(r.json.tenantId);
    expect(rows[0].accepted_at).toBeGreaterThan(1700000000000); // orologio del server, non quello dichiarato
    expect(rows[0].client_accepted_at).toBe(1700000000000);
    expect(rows[0].ip_hash).toBeNull();
    expect(one<any>("SELECT action FROM audit_log WHERE action='legal.accept'")).toBeTruthy();
  });
  it('REQUIRE_TERMS=1: primo accesso senza acceptedTerms -> 400 chiaro e il codice NON viene bruciato', async () => {
    process.env.REQUIRE_TERMS = '1';
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    const code = sent[0].code;
    const r = await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code, deviceId: 'd' } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('terms_required');
    expect(r.json.error.message).toMatch(/Termini.*DPA/);
    expect(one('SELECT 1 AS x FROM users')).toBeUndefined(); // nessun account creato
    // solo i Termini senza DPA: ancora incompleto
    expect((await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code, deviceId: 'd', acceptedTerms: { termsVersion: 'v1' } } })).json.error.code).toBe('terms_required');
    // stesso codice, ora con l'accettazione
    const ok = await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code, deviceId: 'd', acceptedTerms: acc } });
    expect(ok.status).toBe(200);
    expect(all('SELECT 1 FROM legal_acceptances')).toHaveLength(2);
  });
  it('REQUIRE_TERMS=1 non permette di scoprire se un\'email è registrata (serve un codice valido)', async () => {
    process.env.REQUIRE_TERMS = '1';
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    const r = await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: wrongOf(sent[0].code), deviceId: 'd' } });
    expect(r.status).toBe(401); // come per qualunque email
  });
  it('REQUIRE_TERMS=1 non blocca gli utenti già esistenti', async () => {
    await login('old@x.it');
    process.env.REQUIRE_TERMS = '1';
    expect((await login('old@x.it', 'd2')).token).toBeTruthy();
  });
  it('versioni correnti configurate: una versione diversa -> 400 terms_version_mismatch', async () => {
    process.env.TERMS_CURRENT_VERSION = '2026-11';
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    const r = await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[0].code, deviceId: 'd', acceptedTerms: { ...acc, termsVersion: '2025-01' } } });
    expect(r.json.error.code).toBe('terms_version_mismatch');
  });
  it('formato versione validato; hash IP solo se richiesto; nuova versione registrata al login successivo', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    expect((await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[0].code, deviceId: 'd', acceptedTerms: { termsVersion: "x'; DROP TABLE users;--" } } })).status).toBe(400);
    process.env.TERMS_STORE_IP_HASH = '1';
    const l1 = await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[0].code, deviceId: 'd', acceptedTerms: acc }, ip: '8.8.4.4', peer: PROXY });
    expect(l1.status).toBe(200);
    const h = one<any>('SELECT ip_hash FROM legal_acceptances')!.ip_hash;
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain('8.8.4.4');
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[sent.length - 1].code, deviceId: 'd', acceptedTerms: acc } });
    expect(all('SELECT 1 FROM legal_acceptances')).toHaveLength(2); // stessa versione: non si duplica
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[sent.length - 1].code, deviceId: 'd', acceptedTerms: { ...acc, termsVersion: '2027-01' } } });
    expect(all<any>("SELECT version FROM legal_acceptances WHERE kind='terms' ORDER BY id").map((x) => x.version)).toEqual(['2026-11', '2027-01']);
  });
  it('le prove di accettazione sono append-only', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'n@x.it' } });
    await call('POST', '/v1/auth/verify', { body: { email: 'n@x.it', code: sent[0].code, deviceId: 'd', acceptedTerms: acc } });
    expect(() => run('UPDATE legal_acceptances SET version=?', 'x')).toThrow(/append-only/);
    expect(() => run('DELETE FROM legal_acceptances')).toThrow(/append-only/);
  });
});

describe('getPlan coerente con billing: periodo di grazia e currentPeriodEnd (g)', () => {
  const DAY = 86_400_000;
  it('effectivePlan (pura)', () => {
    const T = 10 * DAY;
    expect(effectivePlan({ plan: 'free', status: 'active', currentPeriodEnd: null, graceUntil: null }, T)).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'active', currentPeriodEnd: null, graceUntil: null }, T)).toBe('pro');
    expect(effectivePlan({ plan: 'pro', status: 'trialing', currentPeriodEnd: T + DAY, graceUntil: null }, T)).toBe('pro');
    // periodo scaduto: 3 giorni di tolleranza per il webhook di rinnovo
    expect(effectivePlan({ plan: 'pro', status: 'active', currentPeriodEnd: T - 2 * DAY, graceUntil: null }, T)).toBe('pro');
    expect(effectivePlan({ plan: 'pro', status: 'active', currentPeriodEnd: T - 4 * DAY, graceUntil: null }, T)).toBe('free');
    // pagamento fallito: Pro fino alla fine della grazia
    expect(effectivePlan({ plan: 'pro', status: 'past_due', currentPeriodEnd: T - DAY, graceUntil: T + DAY }, T)).toBe('pro');
    expect(effectivePlan({ plan: 'pro', status: 'past_due', currentPeriodEnd: T - DAY, graceUntil: T - 1 }, T)).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'past_due', currentPeriodEnd: null, graceUntil: null }, T)).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'canceled', currentPeriodEnd: null, graceUntil: null }, T)).toBe('free');
  });
  it('getPlan nel tempo, con orologio simulato; BILLING_PERIOD_SLACK_DAYS configurabile', async () => {
    const { tenantId } = await login('a@x.it');
    const t0 = 1_800_000_000_000;
    setClock(() => t0);
    setEntitlement(tenantId, { plan: 'pro', status: 'past_due', graceUntil: t0 + 2 * DAY, currentPeriodEnd: t0 - DAY });
    expect(getPlan(tenantId)).toBe('pro');
    setClock(() => t0 + 2 * DAY + 1);
    expect(getPlan(tenantId)).toBe('free'); // grazia finita senza nessun nuovo evento Stripe
    setEntitlement(tenantId, { plan: 'pro', status: 'active', currentPeriodEnd: t0 });
    setClock(() => t0 + 3 * DAY + 1);
    expect(getPlan(tenantId)).toBe('free');
    process.env.BILLING_PERIOD_SLACK_DAYS = '10';
    expect(getPlan(tenantId)).toBe('pro');
    delete process.env.BILLING_PERIOD_SLACK_DAYS;
  });
  it('end-to-end: lo specchio di billing (past_due + grazia) e la quota del sync seguono il tempo', async () => {
    const { token, tenantId } = await login('a@x.it');
    const t0 = 1_800_000_000_000;
    setClock(() => t0);
    await new SqliteBillingStore().saveSubscription({ tenantId, status: 'past_due', graceUntil: t0 + DAY, currentPeriodEnd: t0 - DAY, updatedAt: t0 });
    expect((await call('GET', '/v1/me', { token })).json.plan).toBe('pro');
    for (let i = 0; i < 4; i++) expect((await push(token, [docOp(quote(`q${i}`, { createdAt: t0, updatedAt: t0 }))])).json.conflicts).toEqual([]); // Pro: oltre i 3 del Free
    setClock(() => t0 + DAY + 1);
    expect((await call('GET', '/v1/me', { token })).json.plan).toBe('free');
    expect((await push(token, [docOp(quote('q-nuovo', { createdAt: t0 + DAY, updatedAt: t0 + DAY + 5 }))])).json.conflicts[0].reason).toBe('quota_exceeded');
  });
});

describe('orologi dei client (d) e payload ostili', () => {
  it('updatedAt nel futuro viene riportato a now+tolleranza: non blocca per sempre gli altri dispositivi; serverTime in risposta', async () => {
    let t = 1_800_000_000_000; setClock(() => t);
    const { token } = await login('a@x.it');
    const far = t + 365 * 86_400_000;
    const r = await push(token, [docOp(quote('q1', { notes: 'dal dispositivo A (ora sbagliata)', updatedAt: far }))], 'A');
    expect(r.json.conflicts).toEqual([]);
    expect(r.json.serverTime).toBe(t);
    const stored = one<{ updated_at: number }>('SELECT updated_at FROM documents')!.updated_at;
    expect(stored).toBe(t + 10 * 60_000);
    // il dispositivo B (ora giusta) subito dopo è in conflitto "stale", ma solo finché non passa la tolleranza
    expect((await push(token, [docOp(quote('q1', { notes: 'da B', updatedAt: t + 1000 }))], 'B')).json.conflicts[0].reason).toBe('stale');
    t += 10 * 60_000 + 5000;
    expect((await push(token, [docOp(quote('q1', { notes: 'da B', updatedAt: t }))], 'B')).json.conflicts).toEqual([]);
    expect(JSON.parse(one<{ data: string }>('SELECT data FROM documents')!.data).notes).toBe('da B');
  });
  it('anche clientTs di catalogo/profilo/cancellazione è limitato', async () => {
    const t = 1_800_000_000_000; setClock(() => t);
    const { token } = await login('a@x.it');
    const far = t + 9e12;
    await push(token, [{ opId: opId(), entity: 'profile', entityId: 'profile', op: 'upsert', payload: { businessName: 'X', vatNumber: '1' }, clientTs: far } as any]);
    expect(one<{ updated_at: number }>('SELECT updated_at FROM profiles')!.updated_at).toBe(t + 10 * 60_000);
  });
  it('tooComplex: nidificazione e nodi', () => {
    let deep: any = {}; for (let i = 0; i < 100; i++) deep = { a: deep };
    expect(tooComplex(deep)).toBe(true);
    expect(tooComplex({ a: [1, 2, { b: 3 }] })).toBe(false);
    expect(tooComplex(Array.from({ length: 200_000 }, () => ({})))).toBe(true);
  });
  it('bomba di annidamento nel payload -> conflitto invalid, nessun 500, le altre op passano', async () => {
    const { token } = await login('a@x.it');
    const depth = 30_000;
    const nested = '['.repeat(depth) + ']'.repeat(depth);
    const body = `{"deviceId":"d","ops":[{"opId":"bomb","entity":"document","entityId":"q1","op":"upsert","clientTs":5,"payload":{"id":"q1","type":"preventivo","number":"1","date":"2026-01-01","customer":{"name":"x","extra":${nested}},"lines":[],"status":"bozza","createdAt":1,"updatedAt":5}},${JSON.stringify(docOp(quote('q2')))}]}`;
    const res = await app.request('/v1/sync/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.conflicts.map((c: any) => [c.opId, c.reason])).toEqual([['bomb', 'invalid']]);
    expect(j.accepted).toHaveLength(1);
  });
  it('documento troppo grande e catalogo pieno -> invalid', async () => {
    const { token } = await login('a@x.it');
    process.env.MAX_DOC_BYTES = '2000';
    const r = await push(token, [docOp(quote('q1', { notes: 'x'.repeat(5000) }))]);
    expect(r.json.conflicts[0]).toMatchObject({ reason: 'invalid', message: expect.stringMatching(/troppo grande/) });
    process.env.MAX_CATALOG_ITEMS = '2';
    const mk = (id: string) => ({ opId: opId(), entity: 'catalog', entityId: id, op: 'upsert', clientTs: 1, payload: { id, name: id, aliases: [], unit: 'm', price: 1, vat: 22, kind: 'materiale', createdAt: 1, updatedAt: 1 } }) as any;
    const r2 = await push(token, [mk('a'), mk('b'), mk('c'), mk('a')]);
    expect(r2.json.conflicts.map((c: any) => c.reason)).toEqual(['invalid']);
    expect(r2.json.accepted).toHaveLength(3);
  });
  it('proprietà __proto__ nel payload non inquina nulla', async () => {
    const { token } = await login('a@x.it');
    const body = `{"deviceId":"d","ops":[{"opId":"p1","entity":"document","entityId":"q1","op":"upsert","clientTs":5,"payload":{"id":"q1","type":"preventivo","number":"1","date":"2026-01-01","customer":{"name":"x","__proto__":{"polluted":true}},"lines":[],"status":"bozza","createdAt":1,"updatedAt":5,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}}]}`;
    const res = await app.request('/v1/sync/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    expect(res.status).toBe(200);
    expect(({} as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });
  it('pull con tetto di byte: pagine più piccole ma nessuna entità persa', async () => {
    const { token, tenantId } = await login('a@x.it');
    setEntitlement(tenantId, { plan: 'pro' });
    const big = (id: string, seq: number) => invoice(id, seq, { updatedAt: 10 + seq, createdAt: 1 });
    for (const [id, seq] of [['f1', 1], ['f2', 2], ['f3', 3]] as const) {
      const d: any = big(id, seq); d.invoice.xml = 'x'.repeat(300_000);
      expect((await push(token, [docOp(d)])).json.conflicts).toEqual([]);
    }
    process.env.SYNC_PULL_MAX_BYTES = '500000';
    const seen: string[] = [];
    let cursor = '0', pages = 0;
    for (;;) {
      const p = await call('GET', `/v1/sync/pull?cursor=${cursor}&limit=100`, { token });
      pages++;
      seen.push(...p.json.ops.map((o: any) => o.entityId));
      cursor = p.json.cursor;
      if (!p.json.hasMore) break;
      expect(pages).toBeLessThan(10);
    }
    expect(seen.sort()).toEqual(['f1', 'f2', 'f3']);
    expect(pages).toBeGreaterThanOrEqual(3);
  });
  it('il log di sync è compattato (una riga per entità) e il pull restituisce l\'ultima versione', async () => {
    const { token } = await login('a@x.it');
    for (let i = 1; i <= 3; i++) await push(token, [docOp(quote('q1', { notes: `v${i}`, updatedAt: 1000 + i }))]);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM changes WHERE entity_id='q1'")!.n).toBe(1);
    expect((await call('GET', '/v1/sync/pull', { token })).json.ops[0].payload.notes).toBe('v3');
  });
  it('cancellazione di una bozza: il contenuto è azzerato nel DB; il tombstone non espone dati', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1', { notes: 'DATO-PERSONALE', updatedAt: 1000 }))]);
    await push(token, [{ opId: opId(), entity: 'document', entityId: 'q1', op: 'delete', clientTs: 2000 }]);
    const row = one<{ data: string; deleted_at: number }>('SELECT data, deleted_at FROM documents')!;
    expect(row.data).not.toContain('DATO-PERSONALE');
    expect(row.deleted_at).toBe(2000);
    expect(JSON.stringify(all('SELECT payload FROM changes'))).not.toContain('DATO-PERSONALE');
    const stale = await push(token, [docOp(quote('q1', { updatedAt: 1500 }))]);
    expect(stale.json.conflicts[0].reason).toBe('stale');
    expect(stale.json.conflicts[0].serverVersion).toBeUndefined();
  });
});

describe('quota Free non aggirabile', () => {
  it('cancellare e ricreare lo stesso id conta come documento nuovo', async () => {
    const { token } = await login('a@x.it');
    for (const id of ['a', 'b', 'c']) await push(token, [docOp(quote(id, { updatedAt: 1000 }))]);
    await push(token, [{ opId: opId(), entity: 'document', entityId: 'a', op: 'delete', clientTs: 2000 }]);
    const again = await push(token, [docOp(quote('a', { updatedAt: 3000 }))]);
    expect(again.json.conflicts[0].reason).toBe('quota_exceeded');
    expect((await call('GET', '/v1/me', { token })).json.quota.docsThisMonth).toBe(3);
  });
  it('housekeeping elimina sessioni scadute, OTP vecchi e contatori; non tocca i dati attivi', async () => {
    let t = 1_800_000_000_000; setClock(() => t);
    const A = await login('a@x.it');
    await push(A.token, [docOp(quote('q1'))]);
    t += 125 * 86_400_000;
    const { housekeeping } = await import('../../src/db/housekeeping');
    const r = housekeeping();
    expect(r.sessions).toBe(1); // scaduta da oltre 30 giorni (90 gg di vita)
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM documents')!.n).toBe(1);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM rate_limits')!.n).toBe(0);
  });
});

describe('intestazioni e input', () => {
  it('errori interni non rivelano dettagli e portano X-Request-Id', async () => {
    const r = await call('GET', '/v1/documents/%E0%A4%A', { token: 'x'.repeat(43) });
    expect([401, 400, 404]).toContain(r.status);
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });
  it('deviceId con caratteri strani -> 400', async () => {
    await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    expect((await call('POST', '/v1/auth/verify', { body: { email: 'a@x.it', code: sent[0].code, deviceId: "d'; DROP TABLE users;--" } })).status).toBe(400);
  });
  it('SQL injection: id e query come testo, mai concatenati', async () => {
    const { token } = await login('a@x.it');
    await push(token, [docOp(quote('q1'))]);
    for (const id of ["q1' OR '1'='1", 'q1%27%20OR%20%271%27=%271', '1; DROP TABLE documents']) {
      expect((await call('GET', `/v1/documents/${id}`, { token })).status).toBe(404);
    }
    expect((await call('GET', '/v1/documents?limit=1;DROP%20TABLE%20documents&offset=-5', { token })).status).toBe(200);
    expect((await call('GET', "/v1/sync/pull?cursor=0'%20OR%201=1", { token })).status).toBe(400);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM documents')!.n).toBe(1);
  });
});

describe('GET /v1/me: stato abbonamento coerente con getPlan', () => {
  it('billingStatus / currentPeriodEnd / graceUntil / cancelAtPeriodEnd', async () => {
    const { token, tenantId } = await login('a@x.it');
    const t0 = 1_800_000_000_000; setClock(() => t0);
    const me = async () => (await call('GET', '/v1/me', { token })).json;
    expect(await me()).toMatchObject({ plan: 'free', billingStatus: 'none', currentPeriodEnd: null, graceUntil: null, cancelAtPeriodEnd: false });
    setEntitlement(tenantId, { plan: 'pro', status: 'active', currentPeriodEnd: t0 + 5 * 86_400_000, cancelAtPeriodEnd: true, stripeCustomerId: 'cus_1' });
    expect(await me()).toMatchObject({ plan: 'pro', billingStatus: 'active', currentPeriodEnd: t0 + 5 * 86_400_000, cancelAtPeriodEnd: true, quota: { docsLimit: null } });
    setEntitlement(tenantId, { plan: 'pro', status: 'past_due', currentPeriodEnd: t0 - 1000, graceUntil: t0 + 86_400_000, stripeCustomerId: 'cus_1' });
    expect(await me()).toMatchObject({ plan: 'pro', billingStatus: 'past_due', graceUntil: t0 + 86_400_000 });
    setClock(() => t0 + 2 * 86_400_000);
    expect(await me()).toMatchObject({ plan: 'free', billingStatus: 'canceled', graceUntil: null, quota: { docsLimit: 3 } });
  });
});
