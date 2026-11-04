// Processo figlio dei test multi-processo: applica le stesse operazioni di sync di un altro processo sullo STESSO file DB.
// uso: DB_PATH=... tsx push-child.ts <file-ops.json> <startAtMs>
import { readFileSync } from 'node:fs';
import { getDb } from '../../src/db';
import { pushOps } from '../../src/sync/service';

const { ctx, ops } = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const startAt = Number(process.argv[3]);
getDb();
while (Date.now() < startAt) { /* barriera: i due processi partono insieme */ }
let accepted = 0, errors = 0;
for (const op of ops) {
  try { accepted += pushOps(ctx, [op]).accepted.length; } catch { errors++; }
}
console.log(JSON.stringify({ accepted, errors }));
