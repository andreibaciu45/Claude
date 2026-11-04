// Catena di hash per tenant sulle EMISSIONI di fatture (tamper-evidence).
//
// PROBLEMA: il server non puo' verificare i fatti fiscali dichiarati dal client (lockedAt, esiti SDI registrati a mano). Quello che PUO' fare e'
// attestare COSA ha ricevuto e QUANDO (orologio del server) e rendere evidente ogni manomissione successiva a DB spento:
// ogni emissione accettata aggiunge una riga (tenant, n progressivo senza buchi, doc, serie/anno/seq/numero, lockedAt dichiarato, ricevuta alle)
// con hash = SHA-256(hash precedente | campi). Cancellare, rinumerare o riordinare una fattura emessa rompe la catena; `integrity-check` la verifica.
// Sigillo periodico: l'ultimo hash di ogni tenant (e il digest complessivo) si copia FUORI dal DB (`admin.ts integrity-check --json`, backup,
// una email a se stessi): una catena riscritta per intero e' rilevabile confrontandola con un sigillo esterno.
// NON dimostra che l'emissione sia fiscalmente vera (lo SDI resta la fonte): attesta solo cosa il server ha ricevuto e quando.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { all, one, run, transaction } from './index';
import { now } from './clock';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const genesisHash = (tenantId: string): string => sha(`vp-chain-genesis:${tenantId}`);

export interface ChainRow {
  tenant_id: string; n: number; doc_id: string; sectional: string; year: number; seq: number; number: string | null;
  client_locked_at: number; received_at: number; legacy: number; prev_hash: string; hash: string;
}
export const chainHash = (r: Omit<ChainRow, 'hash' | 'legacy'> & { legacy?: number }): string =>
  sha([r.prev_hash, r.tenant_id, r.n, r.doc_id, r.sectional, r.year, r.seq, r.number ?? '', r.client_locked_at, r.received_at].join('|'));

export interface Emission { docId: string; sectional: string; year: number; seq: number; number?: string | null; lockedAt: number }

/** Aggiunge l'emissione alla catena del tenant (idempotente per documento). Da chiamare nella stessa transazione che salva la fattura. */
export function appendEmission(tenantId: string, e: Emission, legacy = false): boolean {
  return transaction(() => {
    if (one('SELECT 1 AS x FROM fiscal_chain WHERE tenant_id=? AND doc_id=?', tenantId, e.docId)) return false;
    const last = one<{ n: number; hash: string }>('SELECT n, hash FROM fiscal_chain WHERE tenant_id=? ORDER BY n DESC LIMIT 1', tenantId);
    const row = {
      tenant_id: tenantId, n: (last?.n ?? 0) + 1, doc_id: e.docId, sectional: e.sectional, year: e.year, seq: e.seq, number: e.number ?? null,
      client_locked_at: e.lockedAt, received_at: now(), prev_hash: last?.hash ?? genesisHash(tenantId),
    };
    run('INSERT INTO fiscal_chain(tenant_id, n, doc_id, sectional, year, seq, number, client_locked_at, received_at, legacy, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      row.tenant_id, row.n, row.doc_id, row.sectional, row.year, row.seq, row.number, row.client_locked_at, row.received_at, legacy ? 1 : 0, row.prev_hash, chainHash(row));
    return true;
  });
}

/** Aggancia (a posteriori, marcate `legacy`) le fatture emesse prima dell'introduzione della catena o fuori dal percorso di sync. Chiamata dalla manutenzione. */
export function backfillChain(limit = 5000): number {
  const rows = all<{ tenant_id: string; id: string; inv_sectional: string; inv_year: number; inv_seq: number; number: string | null; locked_at: number }>(
    `SELECT d.tenant_id, d.id, d.inv_sectional, d.inv_year, d.inv_seq, d.number, d.locked_at FROM documents d
     WHERE d.locked_at IS NOT NULL AND d.inv_seq IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fiscal_chain c WHERE c.tenant_id=d.tenant_id AND c.doc_id=d.id)
     ORDER BY d.tenant_id, d.locked_at, d.inv_seq LIMIT ?`, limit);
  let n = 0;
  for (const d of rows) if (appendEmission(d.tenant_id, { docId: d.id, sectional: d.inv_sectional, year: d.inv_year, seq: d.inv_seq, number: d.number, lockedAt: d.locked_at }, true)) n++;
  return n;
}

export interface ChainReport { rows: number; tenants: number; digest: string; heads: { tenant: string; n: number; hash: string }[]; errors: string[]; warnings: string[] }

/** Verifica la catena su qualunque connessione (anche in sola lettura): continuita', hash, corrispondenza con i documenti. `digest` = sigillo complessivo. */
export function verifyChain(db: DatabaseSync): ChainReport {
  const errors: string[] = [], warnings: string[] = [];
  const q = <T>(sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as unknown as T[];
  const short = (s: string) => s.slice(0, 8);
  const heads: ChainReport['heads'] = [];
  let rows = 0;
  for (const t of q<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM fiscal_chain ORDER BY tenant_id')) {
    let prev = genesisHash(t.tenant_id), expect = 1, head = { n: 0, hash: prev };
    for (const r of q<ChainRow>('SELECT * FROM fiscal_chain WHERE tenant_id=? ORDER BY n', t.tenant_id)) {
      rows++;
      if (r.n !== expect) { errors.push(`catena fiscale: tenant ${short(t.tenant_id)} manca la voce ${expect} (trovata ${r.n}): una emissione e' stata rimossa?`); expect = r.n; }
      if (r.prev_hash !== prev) errors.push(`catena fiscale: tenant ${short(t.tenant_id)} voce ${r.n}: hash precedente non coerente`);
      if (chainHash(r) !== r.hash) errors.push(`catena fiscale: tenant ${short(t.tenant_id)} voce ${r.n}: contenuto manomesso (hash non corrisponde)`);
      const d = q<{ inv_sectional: string; inv_year: number; inv_seq: number; number: string | null; locked_at: number | null }>(
        'SELECT inv_sectional, inv_year, inv_seq, number, locked_at FROM documents WHERE tenant_id=? AND id=?', t.tenant_id, r.doc_id)[0];
      if (!d || d.locked_at === null) errors.push(`catena fiscale: tenant ${short(t.tenant_id)} voce ${r.n}: la fattura ${r.sectional} ${r.year}/${r.seq} non risulta piu' emessa nel database`);
      else if (d.inv_sectional !== r.sectional || d.inv_year !== r.year || d.inv_seq !== r.seq || d.locked_at !== r.client_locked_at || (d.number ?? null) !== (r.number ?? null)) {
        errors.push(`catena fiscale: tenant ${short(t.tenant_id)} voce ${r.n}: numero/data della fattura ${r.sectional} ${r.year}/${r.seq} diversi da quanto attestato`);
      }
      prev = r.hash; expect = r.n + 1; head = { n: r.n, hash: r.hash };
    }
    heads.push({ tenant: t.tenant_id, n: head.n, hash: head.hash });
  }
  const missing = q<{ n: number }>(`SELECT COUNT(*) AS n FROM documents d WHERE d.locked_at IS NOT NULL AND d.inv_seq IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM fiscal_chain c WHERE c.tenant_id=d.tenant_id AND c.doc_id=d.id)`)[0]?.n ?? 0;
  if (missing) warnings.push(`${missing} fatture emesse non ancora agganciate alla catena fiscale (la manutenzione oraria le aggancia)`);
  const digest = sha(heads.map((h) => `${h.tenant}:${h.n}:${h.hash}`).join('\n'));
  return { rows, tenants: heads.length, digest, heads, errors, warnings };
}
