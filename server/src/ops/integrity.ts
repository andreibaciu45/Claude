// Controlli di integrita' del database (comando `integrity-check` e `restore-test` della CLI). Accetta una connessione qualsiasi (anche di sola lettura).
//   ERRORI (gravi, uscita 1): integrity_check/foreign_key_check, trigger di immutabilita' mancanti, duplicati, indici incoerenti con i dati, dati non decifrabili.
//   AVVISI (da guardare, uscita 2): buchi nella numerazione delle fatture emesse (possono essere solo un dispositivo non ancora sincronizzato), job SDI "dead".
import type { DatabaseSync } from 'node:sqlite';
import { verifyChain } from '../db/chain';
import { documentKeyIds, getKeyRing, openDocument, aadProfile, open } from '../db/seal';

export const CORE_TRIGGERS = [
  'trg_audit_no_update', 'trg_audit_no_delete', 'trg_documents_no_delete_locked', 'trg_documents_locked_update',
  'trg_legal_no_update', 'trg_legal_no_delete',
];
export const CHAIN_TRIGGERS = ['trg_fiscal_chain_no_update', 'trg_fiscal_chain_no_delete'];
export const OPS_TRIGGERS = ['trg_admin_actions_no_update', 'trg_admin_actions_no_delete'];

export interface NumberingGroup { tenant: string; sectional: string; year: number; min: number; max: number; count: number; gaps: number[] }
export interface IntegrityReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  numbering: NumberingGroup[]; // tutti i gruppi (tenant abbreviato), con i buchi trovati
  /** Catena di hash delle emissioni: `digest` e' il sigillo da copiare FUORI dal database (vedi db/chain.ts). */
  chain?: { rows: number; tenants: number; digest: string; heads: { tenant: string; n: number; hash: string }[] };
  checked: { integrity: string; foreignKeyViolations: number; issuedInvoices: number; numberingGroups: number; encryptionSample: number };
}

const all = <T>(db: DatabaseSync, sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as unknown as T[];
const one = <T>(db: DatabaseSync, sql: string, ...p: (string | number)[]) => db.prepare(sql).get(...p) as unknown as T | undefined;
const short = (id: string) => id.slice(0, 8);

export function checkIntegrity(db: DatabaseSync, opts: { encryptionSample?: number; deep?: boolean } = {}): IntegrityReport {
  const errors: string[] = [], warnings: string[] = [];
  const integrity = opts.deep === false
    ? (all<{ quick_check: string }>(db, 'PRAGMA quick_check').map((r) => r.quick_check).join('; '))
    : all<{ integrity_check: string }>(db, 'PRAGMA integrity_check').map((r) => r.integrity_check).join('; ');
  if (integrity !== 'ok') errors.push(`integrity_check: ${integrity.slice(0, 500)}`);
  const fk = all(db, 'PRAGMA foreign_key_check').length;
  if (fk > 0) errors.push(`foreign_key_check: ${fk} violazioni`);

  // Trigger di immutabilita' (fatture emesse, audit, accettazioni, azioni admin): senza, le garanzie fiscali cadono.
  const names = new Set(all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='trigger'").map((r) => r.name));
  const hasOps = !!one(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='admin_actions'");
  const hasChain = !!one(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='fiscal_chain'");
  for (const t of [...CORE_TRIGGERS, ...(hasOps ? OPS_TRIGGERS : []), ...(hasChain ? CHAIN_TRIGGERS : [])]) if (!names.has(t)) errors.push(`trigger mancante: ${t}`);

  // Numerazione: per tenant/sezionale/anno le fatture emesse devono avere seq consecutivi (nessun buco) e nessun duplicato.
  const groups = all<{ tenant_id: string; s: string; y: number; mn: number; mx: number; c: number; d: number }>(db,
    `SELECT tenant_id, inv_sectional AS s, inv_year AS y, MIN(inv_seq) AS mn, MAX(inv_seq) AS mx, COUNT(*) AS c, COUNT(DISTINCT inv_seq) AS d
     FROM documents WHERE locked_at IS NOT NULL AND inv_seq IS NOT NULL GROUP BY tenant_id, inv_sectional, inv_year ORDER BY tenant_id, inv_sectional, inv_year`);
  const numbering: NumberingGroup[] = [];
  for (const g of groups) {
    const label = `${short(g.tenant_id)} ${g.s} ${g.y}`;
    if (g.c !== g.d) errors.push(`numerazione duplicata: ${label} (${g.c - g.d} seq ripetuti)`);
    let gaps: number[] = [];
    if (g.mx - g.mn + 1 !== g.d) {
      const have = new Set(all<{ q: number }>(db, 'SELECT inv_seq AS q FROM documents WHERE tenant_id=? AND inv_sectional=? AND inv_year=? AND locked_at IS NOT NULL AND inv_seq IS NOT NULL', g.tenant_id, g.s, g.y).map((r) => r.q));
      for (let q = g.mn; q <= g.mx && gaps.length < 50; q++) if (!have.has(q)) gaps.push(q);
      warnings.push(`buco nella numerazione: tenant ${short(g.tenant_id)} sezionale ${g.s} anno ${g.y}: mancano ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '…' : ''} (tra ${g.mn} e ${g.mx})`);
    }
    numbering.push({ tenant: short(g.tenant_id), sectional: g.s, year: g.y, min: g.mn, max: g.mx, count: g.d, gaps });
  }
  // Stesso numero testuale su due fatture emesse dello stesso tenant e sezionale (l'indice unico guarda solo seq).
  for (const d of all<{ tenant_id: string; s: string; number: string; c: number }>(db,
    `SELECT tenant_id, inv_sectional AS s, number, COUNT(*) AS c FROM documents WHERE locked_at IS NOT NULL AND number IS NOT NULL AND type='fattura'
     GROUP BY tenant_id, inv_sectional, number HAVING c > 1`)) errors.push(`numero fattura duplicato: tenant ${short(d.tenant_id)} sezionale ${d.s} numero ${d.number} (${d.c} documenti)`);
  // Colonne indicizzate coerenti con il documento.
  const mismatch = one<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL AND (
       json_extract(data,'$.invoice.seq') IS NOT inv_seq OR json_extract(data,'$.invoice.year') IS NOT inv_year OR json_extract(data,'$.invoice.sectional') IS NOT inv_sectional)`)?.n ?? 0;
  if (mismatch) errors.push(`${mismatch} fatture emesse con indici (seq/anno/sezionale) diversi dal contenuto`);
  const badState = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL AND (deleted_at IS NOT NULL OR status='bozza')")?.n ?? 0;
  if (badState) errors.push(`${badState} fatture emesse risultano eliminate o in bozza`);

  try {
    const dead = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sdi_jobs WHERE status='dead'")?.n ?? 0;
    if (dead) warnings.push(`${dead} job SDI falliti definitivamente (dead): controllare e rinviare le fatture`);
  } catch { /* modulo SDI non presente in questo DB */ }

  // Catena di hash delle emissioni (tamper-evidence): cancellazioni/rinumerazioni di fatture emesse a DB spento la rompono.
  let chain: IntegrityReport['chain'];
  if (hasChain) {
    const c = verifyChain(db);
    errors.push(...c.errors); warnings.push(...c.warnings);
    chain = { rows: c.rows, tenants: c.tenants, digest: c.digest, heads: c.heads.map((h) => ({ ...h, tenant: short(h.tenant) })) };
  }

  // Cifratura: un campione di righe deve essere leggibile con le chiavi configurate (chiave sbagliata o persa = dati persi).
  const sample = opts.encryptionSample ?? 40;
  let tested = 0;
  if (sample > 0) {
    const ring = getKeyRing();
    const bad: string[] = [];
    for (const r of all<{ tenant_id: string; data: string }>(db, 'SELECT tenant_id, data FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?', sample)) {
      const raw = JSON.parse(r.data) as Record<string, any>;
      const ids = documentKeyIds(raw);
      if (!ids.length) continue;
      tested++;
      try { openDocument(r.tenant_id, raw); } catch { bad.push(ids.join('/')); }
    }
    for (const r of all<{ tenant_id: string; data: string }>(db, 'SELECT tenant_id, data FROM profiles LIMIT ?', Math.max(5, Math.floor(sample / 4)))) {
      if (!r.data.startsWith('enc:v1:')) continue;
      tested++;
      try { open(r.data, aadProfile(r.tenant_id)); } catch { bad.push('profilo'); }
    }
    if (bad.length) errors.push(`${bad.length} righe cifrate NON leggibili con le chiavi configurate${ring ? '' : ' (APP_ENCRYPTION_KEY non impostata)'}: controllare APP_ENCRYPTION_KEY / APP_ENCRYPTION_OLD_KEYS`);
  }

  return {
    ok: errors.length === 0, errors, warnings, numbering, ...(chain ? { chain } : {}),
    checked: { integrity, foreignKeyViolations: fk, issuedInvoices: groups.reduce((a, g) => a + g.d, 0), numberingGroups: groups.length, encryptionSample: tested },
  };
}
