// Lancio privato: INVITE_ONLY=1, codici monouso per creare l'account.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, cli, freshEnv, login, sent } from './helpers';
import { one, run } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { createInvite, normalizeInvite } from '../../src/auth/invites';

beforeEach(() => { freshEnv(); process.env.INVITE_ONLY = '1'; });
afterEach(() => { delete process.env.INVITE_ONLY; });

async function otp(email: string, ip = '10.0.0.1'): Promise<string> {
  await call('POST', '/v1/auth/request', { body: { email }, ip });
  return [...sent].reverse().find((m) => m.email === email.toLowerCase())!.code;
}
const verify = (email: string, code: string, inviteCode?: string, deviceId = 'd1', ip = '10.0.0.1') =>
  call('POST', '/v1/auth/verify', { body: { email, code, deviceId, ...(inviteCode !== undefined ? { inviteCode } : {}) }, ip });

describe('INVITE_ONLY=1', () => {
  it('senza codice: 403 invite_required e l\'OTP NON viene bruciato; col codice giusto si entra; monouso', async () => {
    const { code: inv } = createInvite({ days: 7, note: 'beta' });
    const code = await otp('nuovo@x.it');
    let r = await verify('nuovo@x.it', code);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('invite_required');
    r = await verify('nuovo@x.it', code, 'VP-0000-0000-0000');
    expect(r).toMatchObject({ status: 403 });
    expect(r.json.error.code).toBe('invite_invalid');
    expect(one('SELECT 1 AS x FROM users WHERE email=?', 'nuovo@x.it')).toBeUndefined();
    r = await verify('nuovo@x.it', code, inv.toLowerCase().replace(/-/g, ' ')); // tollerante a maiuscole e separatori
    expect(r.status).toBe(200);
    const used = one<any>('SELECT used_at, used_by_tenant FROM invite_codes');
    expect(used.used_at).toBeGreaterThan(0);
    expect(used.used_by_tenant).toBe(r.json.tenantId);

    // secondo utente con lo stesso codice: rifiutato
    const code2 = await otp('altro@x.it', '10.0.0.2');
    r = await verify('altro@x.it', code2, inv, 'd2', '10.0.0.2');
    expect(r.status).toBe(403);
    expect(r.json.error.message).toContain('già utilizzato');
  });

  it('chi ha gia\' un account entra SENZA codice', async () => {
    delete process.env.INVITE_ONLY;
    await login('vecchio@x.it');
    process.env.INVITE_ONLY = '1';
    const code = await otp('vecchio@x.it');
    expect((await verify('vecchio@x.it', code)).status).toBe(200);
  });

  it('codice scaduto, vincolato a un\'altra email, annullato', async () => {
    const exp = createInvite({ days: 1 }).code;
    const bound = createInvite({ email: 'solo.lei@x.it' }).code;
    const code = await otp('lui@x.it');
    setClock(() => Date.now() + 2 * 86_400_000);
    let r = await verify('lui@x.it', code, exp);
    // l'OTP e' scaduto? no: dura 10 minuti -> con l'orologio avanti di 2 giorni il codice OTP e' scaduto: si rigenera
    expect(r.status).toBe(401);
    setClock(null);
    const code2 = await otp('lui@x.it');
    setClock(() => Date.now() + 5 * 60_000); // OTP ancora valido, invito (1 giorno) pure
    expect((await verify('lui@x.it', code2, bound)).json.error.message).toContain('altro indirizzo');
    run('UPDATE invite_codes SET expires_at = ?', Date.now() - 1000);
    r = await verify('lui@x.it', code2, exp);
    expect(r.json.error.message).toContain('scaduto');
    setClock(null);
    run('UPDATE invite_codes SET expires_at = NULL');
    expect((await cli(['revoke-invite', exp])).code).toBe(0);
    r = await verify('lui@x.it', code2, exp);
    expect(r.json.error.code).toBe('invite_invalid');
    r = await verify('lui@x.it', code2, bound);
    expect(r.json.error.message).toContain('altro indirizzo');
  });

  it('il codice vincolato all\'email vale per quell\'email', async () => {
    const bound = createInvite({ email: 'Solo.Lei@x.it' }).code;
    const code = await otp('solo.lei@x.it');
    expect((await verify('solo.lei@x.it', code, bound)).status).toBe(200);
  });

  it('tentativi di indovinare i codici: tetto per IP (429)', async () => {
    process.env.RL_INVITE_FAIL_HOUR = '3';
    try {
      const code = await otp('x@x.it');
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await verify('x@x.it', code, `VP-AAAA-AAAA-AAA${i}`)).status);
      expect(statuses).toEqual([403, 403, 403, 429, 429]);
    } finally { delete process.env.RL_INVITE_FAIL_HOUR; }
  });

  it('senza INVITE_ONLY il campo inviteCode e\' ignorato e nessun codice viene consumato', async () => {
    delete process.env.INVITE_ONLY;
    createInvite();
    const code = await otp('libero@x.it');
    expect((await verify('libero@x.it', code, 'qualunque')).status).toBe(200);
    expect(one<any>('SELECT used_at FROM invite_codes').used_at).toBeNull();
  });
});

describe('normalizzazione', () => {
  it('maiuscole, separatori e errori di battitura O/0 I/L/1', () => {
    expect(normalizeInvite('vp-7k2m-9qxd-4tbn')).toBe('7K2M9QXD4TBN');
    expect(normalizeInvite('VP 7K2M 9QXD 4TBN')).toBe('7K2M9QXD4TBN');
    expect(normalizeInvite('VP-OIL0-0000-0000')).toBe('011000000000');
  });
});
