// OTP: attacco DISTRIBUITO (molti IP) e relative difese. Prima delle correzioni: nessun limite globale nel tempo (15 verifiche ogni 10 minuti per email = ~2000 al giorno),
// codice a 6 cifre fisso, nessun avviso al proprietario, nessuna corsia per i dispositivi noti.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, freshEnv, login, sent } from '../core/helpers';
import { setMailer, type Mailer } from '../../src/auth/mailer';
import { setClock } from '../../src/db/clock';
import { all, one, run } from '../../src/db';
import { housekeeping } from '../../src/db/housekeeping';
import { deleteAccount } from '../../src/account/service';

const T0 = 1_800_000_000_000;
const PROXY = '172.18.0.2';
const KEYS = ['OTP_DIGITS', 'OTP_MAX_ATTEMPTS', 'OTP_GUARD_FREE_FAILS', 'OTP_GUARD_BASE_MIN', 'OTP_GUARD_MAX_MIN', 'OTP_ALERT_FAILS', 'RL_OTP_REQUEST_EMAIL_HOUR', 'RL_OTP_REQUEST_IP_HOUR', 'RL_OTP_VERIFY_EMAIL_10MIN', 'RL_OTP_VERIFY_IP_10MIN'];
beforeEach(() => { freshEnv(); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) delete process.env[k]; setClock(null); });

const reqOtp = (email: string, ip: string) => call('POST', '/v1/auth/request', { body: { email }, ip, peer: PROXY });
const ver = (email: string, code: string, ip: string, deviceId = 'd1') => call('POST', '/v1/auth/verify', { body: { email, code, deviceId }, ip, peer: PROXY });
const wrongOf = (code: string) => (code.startsWith('0') ? code.replace(/^0/, '1') : code.replace(/^./, '0'));
const ipN = (i: number) => `${20 + (i % 200)}.${(i >> 8) & 255}.${i & 255}.9`; // un IP diverso (e una rete diversa) per ogni tentativo

describe('codice: cifre configurabili', () => {
  it('default 8 cifre', async () => {
    await reqOtp('a@x.it', '1.1.1.1');
    expect(sent[0].code).toMatch(/^\d{8}$/);
    expect((await ver('a@x.it', sent[0].code, '1.1.1.1')).status).toBe(200);
  });
  it('OTP_DIGITS=6: codici a 6 cifre, compatibili con i client che ne inviano 6', async () => {
    process.env.OTP_DIGITS = '6';
    await reqOtp('a@x.it', '1.1.1.1');
    expect(sent[0].code).toMatch(/^\d{6}$/);
    expect((await ver('a@x.it', sent[0].code, '1.1.1.1')).status).toBe(200);
  });
  it('valori fuori range tornano al default; un codice di 6 cifre contro un codice a 8 è semplicemente errato (401, non 500)', async () => {
    process.env.OTP_DIGITS = '3';
    await reqOtp('a@x.it', '1.1.1.1');
    expect(sent[0].code).toHaveLength(8);
    expect((await ver('a@x.it', '123456', '1.1.1.1')).status).toBe(401);
    expect((await ver('a@x.it', '12345', '1.1.1.1')).status).toBe(400); // formato
  });
});

describe('tentativi per codice', () => {
  it('default 5 (somma di tutti gli IP): il sesto tentativo trova il codice già bruciato anche se corretto', async () => {
    await reqOtp('a@x.it', '1.1.1.1');
    const code = sent[0].code;
    for (let i = 0; i < 5; i++) expect((await ver('a@x.it', wrongOf(code), ipN(i))).status).toBe(401);
    expect((await ver('a@x.it', code, ipN(99))).status).toBe(401);
  });
  it('OTP_MAX_ATTEMPTS configurabile', async () => {
    process.env.OTP_MAX_ATTEMPTS = '2';
    await reqOtp('a@x.it', '1.1.1.1');
    const code = sent[0].code;
    for (let i = 0; i < 2; i++) await ver('a@x.it', wrongOf(code), ipN(i));
    expect((await ver('a@x.it', code, ipN(99))).status).toBe(401);
  });
});

describe('attacco distribuito: tetto GLOBALE nel tempo per email', () => {
  /** Un attaccante con un IP nuovo a ogni tentativo, che ogni 10 minuti fa il massimo consentito dal vecchio tetto (15), per 24 ore. */
  async function attackFor24h(email: string) {
    process.env.OTP_MAX_ATTEMPTS = '1000'; // isola il tetto globale da quello per codice
    process.env.RL_OTP_VERIFY_IP_10MIN = '100000';
    let t = T0; setClock(() => t);
    let evaluated = 0, locked = 0, i = 0, sentCodes = 0;
    for (let step = 0; step < 144; step++) {
      const r = await reqOtp(email, ipN(i++));
      if (r.status === 204) sentCodes++;
      for (let k = 0; k < 15; k++) {
        const code = sent.filter((m) => m.email === email).at(-1)?.code ?? '00000000';
        const s = (await ver(email, wrongOf(code), ipN(i++))).status;
        if (s === 401) evaluated++; else if (s === 429) locked++;
      }
      t += 10 * 60_000;
    }
    return { evaluated, locked, sentCodes };
  }

  it('le verifiche VALUTATE in 24 ore sono poche decine (prima: ~2000), il resto è respinto senza valutare il codice', async () => {
    await reqOtp('v@x.it', '2.2.2.2');
    const r = await attackFor24h('v@x.it');
    expect(r.evaluated).toBeLessThanOrEqual(10 + 20); // 10 gratuite + una per scadenza del cooldown crescente
    expect(r.locked).toBeGreaterThan(2000);
  });

  it('l\'INVIO dei codici non è mai bloccato dal cooldown: la vittima riceve sempre il codice', async () => {
    await reqOtp('v@x.it', '2.2.2.2');
    process.env.OTP_MAX_ATTEMPTS = '1000';
    const code = sent[0].code;
    for (let i = 0; i < 40; i++) await ver('v@x.it', wrongOf(code), ipN(i));
    expect((await ver('v@x.it', code, ipN(500))).status).toBe(429); // cooldown in corso: nemmeno il codice giusto viene valutato da una rete sconosciuta
    sent.length = 0;
    expect((await reqOtp('v@x.it', '3.3.3.3')).status).toBe(204);
    expect(sent).toHaveLength(1);
  });

  it('il cooldown cresce (raddoppia) fino al massimo e scade da solo', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000'; process.env.OTP_GUARD_FREE_FAILS = '2'; process.env.OTP_GUARD_BASE_MIN = '2'; process.env.OTP_GUARD_MAX_MIN = '8';
    let t = T0; setClock(() => t);
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    const retry: number[] = [];
    for (let i = 0; i < 6; i++) {
      await ver('v@x.it', wrongOf(code), ipN(i));          // errore (conta se non in cooldown)
      const r = await ver('v@x.it', wrongOf(code), ipN(100 + i));
      if (r.status === 429) { retry.push(Number(r.headers.get('retry-after'))); t += Number(r.headers.get('retry-after')) * 1000 + 1; }
    }
    // dopo le 2 gratuite: 2 min, poi 4, poi 8 (tetto), 8...
    expect(retry.slice(0, 3).map((s) => Math.round(s / 60))).toEqual([2, 4, 8]);
    expect(Math.max(...retry)).toBeLessThanOrEqual(8 * 60);
  });

  it('24 ore senza errori azzerano il contatore', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000'; process.env.OTP_GUARD_FREE_FAILS = '2';
    let t = T0; setClock(() => t);
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent[0].code;
    for (let i = 0; i < 4; i++) await ver('v@x.it', wrongOf(code), ipN(i));
    expect((await ver('v@x.it', wrongOf(code), ipN(50))).status).toBe(429);
    t += 25 * 3600_000;
    await reqOtp('v@x.it', '2.2.2.2');
    expect((await ver('v@x.it', wrongOf(sent.at(-1)!.code), ipN(51))).status).toBe(401); // di nuovo valutata
  });

  it('email senza codici in corso: nessuna riga creata (niente crescita della tabella con email inventate)', async () => {
    for (let i = 0; i < 20; i++) await ver(`nessuno${i}@x.it`, '12345678', ipN(i));
    expect(all('SELECT 1 FROM otp_guard')).toHaveLength(0);
  });
});

describe('corsia dei dispositivi noti: la vittima non resta chiusa fuori', () => {
  it('chi ha già completato un accesso da questa rete accede anche durante un attacco distribuito (cooldown e tetto dei 10 minuti)', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    const ipHome = '88.88.88.88';
    await reqOtp('v@x.it', ipHome);
    expect((await ver('v@x.it', sent[0].code, ipHome)).status).toBe(200); // rete di casa ricordata
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent.at(-1)!.code;
    for (let i = 0; i < 60; i++) await ver('v@x.it', wrongOf(code), ipN(i)); // botnet: cooldown + tetto per email esauriti
    expect((await ver('v@x.it', wrongOf(code), ipN(999))).status).toBe(429);
    const ok = await ver('v@x.it', code, ipHome, 'phone');
    expect(ok.status).toBe(200);
  });

  it('la corsia non è un lasciapassare: gli errori da rete nota restano limitati dal backoff per coppia email+IP', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    const ipHome = '88.88.88.88';
    await reqOtp('v@x.it', ipHome);
    await ver('v@x.it', sent[0].code, ipHome);
    await reqOtp('v@x.it', ipHome);
    const code = sent.at(-1)!.code;
    const st: number[] = [];
    for (let i = 0; i < 8; i++) st.push((await ver('v@x.it', wrongOf(code), ipHome)).status);
    expect(st.slice(0, 3)).toEqual([401, 401, 401]);
    expect(st.slice(3).every((s) => s === 429)).toBe(true);
  });

  it('al massimo 5 reti per email; la cancellazione dell\'account elimina reti e contatori', async () => {
    for (let i = 0; i < 7; i++) { await reqOtp('v@x.it', `5.5.5.${i}`); await ver('v@x.it', sent.at(-1)!.code, `5.5.5.${i}`, `d${i}`); }
    expect(all('SELECT 1 FROM otp_trusted_ips')).toHaveLength(5);
    const u = one<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM users')!;
    run("INSERT INTO otp_guard(email_hash, fails, level, locked_until, updated_at) SELECT email_hash, 3, 0, 0, 1 FROM otp_trusted_ips LIMIT 1");
    deleteAccount(u.tenant_id, u.id);
    expect(all('SELECT 1 FROM otp_trusted_ips')).toHaveLength(0);
    expect(all('SELECT 1 FROM otp_guard')).toHaveLength(0);
  });

  it('le righe di difesa scadute le toglie la manutenzione', async () => {
    run("INSERT INTO otp_guard(email_hash, fails, level, locked_until, updated_at) VALUES ('x', 3, 0, 0, 1)");
    run("INSERT INTO otp_trusted_ips(email_hash, ip_hash, last_ok_at) VALUES ('x','y', 1)");
    housekeeping();
    expect(all('SELECT 1 FROM otp_guard')).toHaveLength(0);
    expect(all('SELECT 1 FROM otp_trusted_ips')).toHaveLength(0);
  });

  it('nessuna email o IP in chiaro nelle tabelle di difesa', async () => {
    await reqOtp('v@x.it', '88.88.88.88');
    await ver('v@x.it', sent[0].code, '88.88.88.88');
    const dump = JSON.stringify([...all('SELECT * FROM otp_guard'), ...all('SELECT * FROM otp_trusted_ips')]);
    expect(dump).not.toContain('v@x.it');
    expect(dump).not.toContain('88.88.88.88');
  });
});

describe('assistenza: otp-unlock', () => {
  it('toglie il cooldown di un indirizzo e il tetto dei 10 minuti; il codice giusto torna verificabile', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent.at(-1)!.code;
    for (let i = 0; i < 40; i++) await ver('v@x.it', wrongOf(code), ipN(i));
    expect((await ver('v@x.it', code, ipN(900))).status).toBe(429);
    const { runCli } = await import('../../scripts/admin');
    const out: string[] = [];
    const rc = await runCli(['otp-unlock', 'V@x.it'], { out: (s) => out.push(s), err: (s) => out.push(s) });
    expect(rc, out.join('\n')).toBe(0);
    expect((await ver('v@x.it', code, ipN(901))).status).toBe(200);
    expect(one("SELECT 1 AS x FROM admin_actions WHERE action='otp_unlock'")).toBeTruthy();
  });
});

describe('avviso «qualcuno sta tentando di accedere»', () => {
  const alerts: string[] = [];
  const mailer: Mailer = {
    async sendOtp(email, code) { sent.push({ email, code }); },
    async sendSecurityAlert(email) { alerts.push(email); },
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  beforeEach(() => { alerts.length = 0; setMailer(mailer); });

  it('una sola email al proprietario (account esistente) alla soglia, senza codici, non ripetuta per 24 ore', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    let t = T0; setClock(() => t);
    await login('v@x.it');
    await reqOtp('v@x.it', '2.2.2.2');
    const code = sent.at(-1)!.code;
    for (let i = 0; i < 7; i++) await ver('v@x.it', wrongOf(code), ipN(i));
    await settle();
    expect(alerts).toHaveLength(0); // soglia 8 non ancora raggiunta
    await ver('v@x.it', wrongOf(code), ipN(8));
    await settle();
    expect(alerts).toEqual(['v@x.it']);
    t += 3 * 3600_000;
    for (let i = 10; i < 20; i++) await ver('v@x.it', wrongOf(code), ipN(i));
    await settle();
    expect(alerts).toHaveLength(1);
    t += 25 * 3600_000;
    await reqOtp('v@x.it', '2.2.2.2');
    const c2 = sent.at(-1)!.code;
    for (let i = 30; i < 45; i++) await ver('v@x.it', wrongOf(c2), ipN(i));
    await settle();
    expect(alerts).toHaveLength(2);
  });

  it('nessun avviso per indirizzi senza account (non si usa il servizio per mandare email a terzi)', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000';
    await reqOtp('nuovo@x.it', '2.2.2.2');
    for (let i = 0; i < 30; i++) await ver('nuovo@x.it', wrongOf(sent.at(-1)!.code), ipN(i));
    await settle();
    expect(alerts).toHaveLength(0);
  });

  it('se l\'invio dell\'avviso fallisce la verifica risponde comunque normalmente', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000'; process.env.OTP_ALERT_FAILS = '1';
    setMailer({ async sendOtp(email, code) { sent.push({ email, code }); }, async sendSecurityAlert() { throw new Error('smtp giu'); } });
    await login('v@x.it');
    await reqOtp('v@x.it', '2.2.2.2');
    expect((await ver('v@x.it', wrongOf(sent.at(-1)!.code), ipN(1))).status).toBe(401);
    await settle();
  });

  it('un Mailer senza sendSecurityAlert (implementazione vecchia) non rompe nulla', async () => {
    process.env.OTP_MAX_ATTEMPTS = '1000'; process.env.OTP_ALERT_FAILS = '1';
    setMailer({ async sendOtp(email, code) { sent.push({ email, code }); } });
    await login('v@x.it');
    await reqOtp('v@x.it', '2.2.2.2');
    expect((await ver('v@x.it', wrongOf(sent.at(-1)!.code), ipN(1))).status).toBe(401);
  });
});
