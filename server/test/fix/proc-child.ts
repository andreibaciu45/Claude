// Processo figlio dei test a DUE processi sullo stesso file SQLite.
// uso: DB_PATH=... tsx proc-child.ts <modo> <startAtMs> <idx>
import { getDb } from '../../src/db';
import { setClock } from '../../src/db/clock';
import { guardFail } from '../../src/auth/guard';
import { verifyOtp } from '../../src/auth/service';
import { appendEmission } from '../../src/db/chain';
import { pruneAudit } from '../../src/db/audit';

const [mode, startAt, idx] = [process.argv[2]!, Number(process.argv[3]), Number(process.argv[4])];
getDb();
if (mode === 'prune') setClock(() => Date.now() + 400 * 86_400_000); // 400 giorni nel futuro: tutto è «vecchio»
while (Date.now() < startAt) { /* barriera */ }
const out: Record<string, number> = { errors: 0, ok: 0 };
const tryIt = (fn: () => unknown) => { try { fn(); out.ok!++; } catch { out.errors!++; } };
if (mode === 'otp') {
  for (let i = 0; i < 15; i++) { tryIt(() => guardFail('v@x.it')); tryIt(() => verifyOtp('v@x.it', '00000000')); }
} else if (mode === 'chain') {
  for (let i = 0; i < 20; i++) tryIt(() => appendEmission('t1', { docId: `p${idx}-d${i}`, sectional: 'FT', year: 2026, seq: idx * 100 + i + 1, number: `${i}/2026`, lockedAt: 5000 }));
} else if (mode === 'prune') {
  tryIt(() => pruneAudit());
}
console.log(JSON.stringify(out));
