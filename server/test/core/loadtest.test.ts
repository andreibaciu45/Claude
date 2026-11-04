// Fumo dello script di carico (server/scripts/loadtest.ts): pochi secondi, nessun 5xx, nessuna richiesta persa.
import { describe, expect, it } from 'vitest';
import { runLoadTest } from '../../scripts/loadtest';

describe('script di carico', () => {
  it('2 s, 8 connessioni, 2 tenant: nessun errore 5xx e throughput sensato', async () => {
    const r = await runLoadTest({ durationSec: 2, concurrency: 8, tenants: 2 });
    expect(r.errors5xx).toBe(0);
    expect(r.networkErrors).toBe(0);
    expect(r.requests).toBeGreaterThan(100);
    expect(Object.keys(r.byStatus)).toEqual(['200']);
    expect(r.p95).toBeLessThan(2000);
  }, 30_000);
});
