// Processo figlio del test a DUE processi sullo stesso file SQLite (convergenza del sync).
// uso: DB_PATH=... tsx sync-conv-child.ts <fileOps.json> <tenantId> <userId> <seed> <startAtMs>
import { readFileSync } from 'node:fs';
import { getDb } from '../../src/db';
import { pushOps } from '../../src/sync/service';
import { deliveryPlan, rng } from './convergence-model';
import type { SyncOp } from '../../../shared/api';

const [file, tenantId, userId, seed, startAt] = [process.argv[2]!, process.argv[3]!, process.argv[4]!, Number(process.argv[5]), Number(process.argv[6])];
getDb();
const ops = JSON.parse(readFileSync(file, 'utf8')) as SyncOp[];
const plan = deliveryPlan(rng(seed), ops); // ogni processo consegna TUTTE le op, in ordine/lotti/duplicati propri
while (Date.now() < startAt) { /* barriera: i due processi partono insieme */ }
const out = { errors: 0, accepted: 0, conflicts: {} as Record<string, number> };
for (const batch of plan) {
  try {
    const r = pushOps({ tenantId, userId, deviceId: `proc-${seed}` }, batch);
    out.accepted += r.accepted.length;
    for (const c of r.conflicts) out.conflicts[c.reason] = (out.conflicts[c.reason] ?? 0) + 1;
  } catch { out.errors++; }
}
console.log(JSON.stringify(out));
