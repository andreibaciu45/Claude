// Configurazione sicura di default: .env.example, NODE_ENV non impostato.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { call, freshEnv } from '../core/helpers';
import { providerFromEnv } from '../../src/sdi/routes';
import { sttFromEnv } from '../../src/voice/stt';
import { llmFromEnv } from '../../src/voice/interpret';

const SRC = join(__dirname, '..', '..', 'src');
const ENV_EXAMPLE = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));

describe('.env.example', () => {
  it('SMTP_REQUIRE_TLS e\' 1 (attivo, non commentato) e il file ne spiega il motivo', () => {
    expect(ENV_EXAMPLE).toMatch(/^SMTP_REQUIRE_TLS=1\s*$/m);
    expect(ENV_EXAMPLE).not.toMatch(/^SMTP_REQUIRE_TLS=0/m);
    expect(ENV_EXAMPLE).toMatch(/VALORE CONSIGLIATO: 1/);
  });

  it('ogni parametro OTP_*, AUDIT_*, HEALTH_* letto dal codice e\' documentato (con valore di default) in .env.example', () => {
    const names = new Set<string>();
    for (const f of walk(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/['"`.]((?:OTP|AUDIT|HEALTH|RL_HEALTH|RL_AUDIT)_[A-Z][A-Z0-9_]+)/g)) names.add(m[1]!);
    for (const n of ['OTP_DIGITS', 'OTP_MAX_ATTEMPTS', 'OTP_GUARD_FREE_FAILS', 'OTP_ALERT_FAILS', 'AUDIT_RETENTION_DAYS', 'AUDIT_MAX_ROWS_PER_TENANT', 'HEALTH_CACHE_MS']) expect(names.has(n), n).toBe(true);
    for (const n of names) expect(ENV_EXAMPLE, n).toMatch(new RegExp(`^#?\\s*${n}=\\S`, 'm'));
  });

  it('OTP_DIGITS=8 documentato come default e con l\'avvertenza sui client a 6 cifre', () => {
    expect(ENV_EXAMPLE).toMatch(/OTP_DIGITS=8/);
    expect(ENV_EXAMPLE).toMatch(/OTP_DIGITS=6/);
  });

  it('nessun segreto: valori vuoti o segnaposto', () => {
    expect(ENV_EXAMPLE).not.toMatch(/(SECRET|TOKEN|KEY|PASSWORD)=\S{8,}/);
  });
});

describe('NODE_ENV non impostato = produzione per le scorciatoie di sviluppo', () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = saved; delete process.env.AUTH_DEV_RETURN_CODE; });

  it('AUTH_DEV_RETURN_CODE=1 senza NODE_ENV NON restituisce il codice; con NODE_ENV=test sì', async () => {
    freshEnv();
    process.env.AUTH_DEV_RETURN_CODE = '1';
    delete process.env.NODE_ENV;
    const r = await call('POST', '/v1/auth/request', { body: { email: 'a@x.it' } });
    expect(r.status).toBe(204);
    expect(r.json).toBeUndefined();
    process.env.NODE_ENV = 'test';
    const d = await call('POST', '/v1/auth/request', { body: { email: 'b@x.it' } });
    expect(d.json.devCode).toMatch(/^\d{8}$/);
  });

  it('i provider mock (SDI, STT, LLM) non partono senza NODE_ENV esplicito', () => {
    expect(providerFromEnv({ SDI_PROVIDER: 'mock' })).toBeNull();
    expect(providerFromEnv({ SDI_PROVIDER: 'mock', NODE_ENV: 'production' })).toBeNull();
    expect(providerFromEnv({ SDI_PROVIDER: 'mock', NODE_ENV: 'development' })?.id).toBe('mock');
    expect(sttFromEnv({ STT_PROVIDER: 'mock' })).toBeNull();
    expect(sttFromEnv({ STT_PROVIDER: 'mock', NODE_ENV: 'test' })).not.toBeNull();
    expect(llmFromEnv({ LLM_PROVIDER: 'mock' })).toBeNull();
    expect(llmFromEnv({ LLM_PROVIDER: 'mock', NODE_ENV: 'test' })).not.toBeNull();
  });
});
