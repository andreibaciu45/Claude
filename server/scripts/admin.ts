// CLI amministrativa di VocePreventivo: pensata per UNA persona non-DevOps.
//
//   npx tsx server/scripts/admin.ts <comando> [opzioni]          (dalla radice del repository)
//   server/scripts/admin.sh <comando> ...                         (sul VPS: carica da solo /etc/vocepreventivo/server.env)
//
// Legge DB_PATH (e APP_ENCRYPTION_KEY, ecc.) dall'ambiente. Con `--db <file>` si indica un altro database.
// Il testo di ogni comando e' in italiano; `--json` (dove previsto) produce JSON per script e monitoraggio.
// Codici di uscita: 0 ok · 1 errore/problema grave · 2 solo avvisi (integrity-check) · 64 uso errato.
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { all, closeDb, getDb, one, openDb } from '../src/db';
import '../src/billing/sqlite-store'; // registra le migrazioni 100+ (billing)
import '../src/sdi/sqlite';          // ... e 101 (SDI)
import { monthKey, now } from '../src/db/clock';
import { getEntitlement, stripePlan } from '../src/db/entitlements';
import { grantPro, logAdminAction, manualGrantUntil, MAX_GRANT_DAYS, revokePro, type AdminActionRow } from '../src/db/grants';
import { normalizeEmail } from '../src/auth/service';
import { buildExport, deleteAccount, hasActiveSubscription } from '../src/account/service';
import { createInvite, listInvites, revokeInvite } from '../src/auth/invites';
import { checkIntegrity, type IntegrityReport } from '../src/ops/integrity';
import { collectStats } from '../src/ops/stats';
import { getKeyRing } from '../src/db/seal';
import { backupDatabase, verifyDatabase } from './backup';
import { rotate } from './rotate-encryption-key';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Domanda interattiva (conferme). Assente = non interattivo. */
  ask?: (question: string) => Promise<string>;
}

const OK = 0, FAIL = 1, WARN = 2, USAGE = 64;
const DAY = 86_400_000;

const HELP = `VocePreventivo — amministrazione (npx tsx server/scripts/admin.ts <comando>)

UTENTI E LICENZE
  tenants [--cerca testo] [--limit N] [--json]   elenco clienti: piano, ultimo accesso, uso del mese
  info <email>                                   dettaglio di un cliente e storico delle azioni admin
  grant-pro <email> --giorni N | --fino-al AAAA-MM-GG [--nota "motivo"]
                                                 concede Pro a mano (scade da sola). Non tocca Stripe
  revoke-pro <email> [--nota "motivo"]           toglie la concessione manuale (un abbonamento Stripe resta valido)
INVITI (lancio privato, con INVITE_ONLY=1)
  create-invite-code [--email e] [--giorni N] [--quanti N] [--nota testo]
  invite-codes                                   elenco codici (disponibili/usati/scaduti)
  revoke-invite <codice>                         annulla un codice non ancora usato
DATI PERSONALI (GDPR)
  export-tenant <email> [--out file|-]           esporta tutti i dati del cliente in JSON
  delete-tenant <email> [--conferma <email>] [--ack-subscription]
                                                 cancella l'account (le fatture emesse restano per legge: tenant anonimizzato)
CONTROLLO E MANUTENZIONE
  stats [--json]                                 utenti attivi, documenti, fatture, conflitti di sync, errori
  integrity-check [--file db] [--rapido] [--json]  integrita' DB, trigger, buchi/duplicati nella numerazione, cifratura
  backup [destinazione]                          copia consistente del DB (anche a server acceso)
  restore-test [file.sqlite|.gz]                 prova di ripristino su copia temporanea (non tocca la produzione)
  rotate-key [--report] [--include-locked] [--no-backup]
                                                 ricifra i dati con la nuova APP_ENCRYPTION_KEY (vedi docs/OPERAZIONI.md)

Opzione globale: --db <file> (altrimenti DB_PATH). Le date sono in UTC.`;

// ---------- utilita' ----------
const fmt = (ts: number | null | undefined): string => (ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '—');
const fmtDay = (ts: number): string => new Date(ts).toISOString().slice(0, 10);
const mb = (n: number): string => `${(n / 1048576).toFixed(1)} MB`;
const actor = (): string => (process.env.ADMIN_ACTOR || process.env.SUDO_USER || process.env.USER || 'cli').slice(0, 60);

function table(rows: string[][]): string {
  if (!rows.length) return '';
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => (c ?? '').padEnd(w[i]!)).join('  ').trimEnd()).join('\n');
}

class CliError extends Error { constructor(msg: string, public code = FAIL) { super(msg); } }

function requireDbFile(): string {
  const p = process.env.DB_PATH || './data/app.sqlite';
  if (p !== ':memory:' && !existsSync(p)) {
    throw new CliError(`Database non trovato: ${resolve(p)}\nImposta DB_PATH (o usa --db <file>). Sul VPS usa server/scripts/admin.sh, che carica da solo la configurazione.`);
  }
  return p;
}

interface UserRow { id: string; email: string; tenant_id: string; created_at: number; last_login_at: number | null }
function userByEmail(raw: string | undefined): UserRow {
  if (!raw) throw new CliError('Manca l\'email del cliente.', USAGE);
  const email = normalizeEmail(raw);
  const u = one<UserRow>('SELECT id, email, tenant_id, created_at, last_login_at FROM users WHERE email=?', email);
  if (!u) throw new CliError(`Nessun utente con email ${email}. (La licenza si concede dopo il primo accesso del cliente.)`);
  return u;
}
const tenantStatus = (tenantId: string): string => one<{ status: string }>('SELECT status FROM tenants WHERE id=?', tenantId)?.status ?? 'sconosciuto';

function planLabel(tenantId: string): { label: string; plan: 'free' | 'pro'; source: string } {
  const t = now(), e = getEntitlement(tenantId);
  const sp = stripePlan(e, t), grant = e.manualGrantUntil ?? null;
  if (sp === 'pro' && grant) return { label: `pro (stripe + manuale fino al ${fmtDay(grant - 1)})`, plan: 'pro', source: 'stripe+manuale' };
  if (sp === 'pro') return { label: e.status === 'past_due' ? 'pro (stripe, pagamento in ritardo)' : 'pro (stripe)', plan: 'pro', source: 'stripe' };
  if (grant) return { label: `pro (manuale fino al ${fmtDay(grant - 1)})`, plan: 'pro', source: 'manuale' };
  return { label: e.plan === 'pro' ? 'free (abbonamento scaduto)' : 'free', plan: 'free', source: 'nessuna' };
}

function lastAccess(userId: string, lastLogin: number | null): number | null {
  const s = one<{ m: number | null }>('SELECT MAX(last_seen_at) AS m FROM sessions WHERE user_id=?', userId)?.m ?? null;
  return Math.max(lastLogin ?? 0, s ?? 0) || null;
}

// ---------- comandi ----------
type Flags = Record<string, string | boolean | undefined>;
type Cmd = (pos: string[], f: Flags, io: CliIO) => Promise<number> | number;

const cmdTenants: Cmd = (_pos, f, io) => {
  requireDbFile();
  const q = typeof f.cerca === 'string' ? `%${f.cerca.toLowerCase()}%` : '%';
  const limit = Math.min(Math.max(Number(f.limit) || 500, 1), 5000);
  const rows = all<UserRow & { tid: string; tstatus: string; tcreated: number }>(
    `SELECT u.id, COALESCE(u.email, '(cancellato)') AS email, t.id AS tid, t.status AS tstatus, t.created_at AS tcreated, u.last_login_at, u.created_at, u.tenant_id
     FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id WHERE COALESCE(u.email, '(cancellato)') LIKE ? ORDER BY t.created_at DESC LIMIT ?`, q, limit);
  const month = monthKey();
  const data = rows.map((r) => {
    const p = planLabel(r.tid);
    const use = one<{ d: number; s: number; l: number }>('SELECT docs_created AS d, stt_seconds AS s, llm_calls AS l FROM usage WHERE tenant_id=? AND month=?', r.tid, month);
    return {
      email: r.email, tenantId: r.tid, stato: r.tstatus, piano: p.plan, pianoDettaglio: p.label, creato: r.tcreated,
      ultimoAccesso: r.id ? lastAccess(r.id, r.last_login_at) : null,
      usoMese: { documenti: use?.d ?? 0, voceSecondi: use?.s ?? 0, chiamateLlm: use?.l ?? 0 },
      fattureEmesse: one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND locked_at IS NOT NULL', r.tid)?.n ?? 0,
    };
  });
  if (f.json) { io.out(JSON.stringify(data, null, 2)); return OK; }
  if (!data.length) { io.out('Nessun cliente.'); return OK; }
  io.out(table([['EMAIL', 'TENANT', 'STATO', 'PIANO', 'ULTIMO ACCESSO (UTC)', `DOC ${month}`, 'FATTURE'],
    ...data.map((d) => [d.email, d.tenantId.slice(0, 8), d.stato, d.pianoDettaglio, fmt(d.ultimoAccesso), String(d.usoMese.documenti), String(d.fattureEmesse)])]));
  io.out(`\n${data.length} clienti (${data.filter((d) => d.piano === 'pro').length} Pro).`);
  return OK;
};

const cmdInfo: Cmd = (pos, _f, io) => {
  requireDbFile();
  const u = userByEmail(pos[0]);
  const p = planLabel(u.tenant_id);
  const use = one<{ d: number; s: number; l: number }>('SELECT docs_created AS d, stt_seconds AS s, llm_calls AS l FROM usage WHERE tenant_id=? AND month=?', u.tenant_id, monthKey());
  io.out(`Cliente:        ${u.email}\nTenant:         ${u.tenant_id} (${tenantStatus(u.tenant_id)})\nCreato il:      ${fmt(u.created_at)}\nUltimo accesso: ${fmt(lastAccess(u.id, u.last_login_at))}\nPiano:          ${p.label}\nUso ${monthKey()}:   ${use?.d ?? 0} documenti, ${use?.s ?? 0} s di voce, ${use?.l ?? 0} chiamate LLM`);
  const hist = all<AdminActionRow>('SELECT * FROM admin_actions WHERE tenant_id=? ORDER BY id DESC LIMIT 20', u.tenant_id);
  if (hist.length) io.out('\nAzioni amministrative:\n' + table(hist.map((h) => [fmt(h.at), h.action, h.until_at ? `fino al ${fmtDay(h.until_at - 1)}` : '', h.actor, h.note ?? ''])));
  return OK;
};

/** Fine (esclusa) del giorno AAAA-MM-GG indicato in UTC: "fino al 31/12" vale tutto il 31/12. */
export function untilFromDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new CliError('Data non valida: usa AAAA-MM-GG (es. 2026-12-31).', USAGE);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) throw new CliError(`Data inesistente: ${s}`, USAGE);
  return Date.UTC(y, mo - 1, d + 1);
}

const cmdGrant: Cmd = (pos, f, io) => {
  requireDbFile();
  const u = userByEmail(pos[0]);
  if (tenantStatus(u.tenant_id) !== 'active') throw new CliError('Il tenant non e\' attivo (account cancellato): nessuna licenza da concedere.');
  const hasDays = f.giorni !== undefined, hasDate = f['fino-al'] !== undefined;
  if (hasDays === hasDate) throw new CliError('Indica ESATTAMENTE una scadenza: --giorni N oppure --fino-al AAAA-MM-GG.', USAGE);
  let until: number;
  if (hasDays) {
    const n = Number(f.giorni);
    if (!Number.isInteger(n) || n < 1 || n > MAX_GRANT_DAYS) throw new CliError(`--giorni deve essere un intero tra 1 e ${MAX_GRANT_DAYS}.`, USAGE);
    until = now() + n * DAY;
  } else {
    until = untilFromDate(String(f['fino-al']));
    if (until <= now()) throw new CliError('La data e\' nel passato: la concessione sarebbe gia\' scaduta.', USAGE);
    if (until - now() > MAX_GRANT_DAYS * DAY) throw new CliError(`La scadenza supera ${MAX_GRANT_DAYS} giorni.`, USAGE);
  }
  const prev = manualGrantUntil(u.tenant_id);
  const note = typeof f.nota === 'string' ? f.nota : undefined;
  grantPro(u.tenant_id, until, note, actor());
  const p = planLabel(u.tenant_id);
  io.out(`OK: licenza Pro concessa a ${u.email} fino al ${fmtDay(until - 1)} (incluso).${prev ? ` Sostituisce la concessione precedente (scadenza ${fmtDay(prev - 1)}).` : ''}\nPiano effettivo ora: ${p.label}.`);
  if (p.source === 'stripe+manuale') io.out('Nota: il cliente ha anche un abbonamento Stripe attivo; le due fonti sono indipendenti (vale la piu\' favorevole).');
  return OK;
};

const cmdRevoke: Cmd = (pos, f, io) => {
  requireDbFile();
  const u = userByEmail(pos[0]);
  const prev = manualGrantUntil(u.tenant_id);
  if (prev === null) { io.out(`Nessuna concessione manuale attiva per ${u.email}: niente da revocare. Piano: ${planLabel(u.tenant_id).label}.`); return OK; }
  revokePro(u.tenant_id, typeof f.nota === 'string' ? f.nota : undefined, actor());
  const p = planLabel(u.tenant_id);
  io.out(`OK: concessione manuale revocata per ${u.email}. Piano effettivo ora: ${p.label}.`);
  if (p.plan === 'pro') io.out('Nota: resta Pro perche\' ha un abbonamento Stripe attivo (la revoca riguarda solo la concessione manuale).');
  return OK;
};

const cmdExport: Cmd = (pos, f, io) => {
  requireDbFile();
  const u = userByEmail(pos[0]);
  const data = buildExport(u.tenant_id, u.id);
  const json = JSON.stringify(data, null, 2);
  logAdminAction('export_tenant', { tenantId: u.tenant_id, actor: actor() });
  if (f.out === '-') { io.out(json); return OK; }
  const out = resolve(typeof f.out === 'string' ? f.out : `export-${u.tenant_id.slice(0, 8)}-${fmtDay(now()).replace(/-/g, '')}.json`);
  writeFileSync(out, json, { mode: 0o600 });
  io.out(`OK: esportati i dati di ${u.email} in ${out} (${data.documents.length} documenti, ${data.catalog.length} voci di catalogo).\nIl file contiene dati personali: consegnalo al cliente con un canale sicuro e poi cancellalo.`);
  return OK;
};

const cmdDelete: Cmd = async (pos, f, io) => {
  requireDbFile();
  const u = userByEmail(pos[0]);
  if (tenantStatus(u.tenant_id) !== 'active') throw new CliError('Account gia\' cancellato.');
  const retained = one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND locked_at IS NOT NULL', u.tenant_id)?.n ?? 0;
  const drafts = one<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND locked_at IS NULL AND deleted_at IS NULL', u.tenant_id)?.n ?? 0;
  io.out(`Stai per cancellare ${u.email} (tenant ${u.tenant_id.slice(0, 8)}).\n- bozze e preventivi che verranno eliminati: ${drafts}\n- fatture emesse: ${retained}${retained ? ' -> restano per obbligo di conservazione (10 anni, da verificare col commercialista); il tenant viene ANONIMIZZATO (nessun login, nessun nome)' : ' -> nessuna: il tenant viene ELIMINATO del tutto'}\n- restano comunque: registro audit e prove di accettazione Termini/DPA; i backup contengono i dati fino alla scadenza della retention.`);
  if (hasActiveSubscription(u.tenant_id) && f['ack-subscription'] !== true) {
    throw new CliError('Il cliente ha un abbonamento Stripe ATTIVO. Annullalo prima dal pannello Stripe, oppure ripeti il comando con --ack-subscription (poi annulla a mano l\'abbonamento su Stripe).');
  }
  let typed = typeof f.conferma === 'string' ? f.conferma : undefined;
  if (typed === undefined) {
    if (!io.ask) throw new CliError('Servono conferma interattiva o --conferma <email>.', USAGE);
    typed = await io.ask(`Per confermare riscrivi l'email del cliente (${u.email}): `);
  }
  if (normalizeEmail(typed) !== u.email) throw new CliError('Conferma non corrispondente: nessuna modifica.');
  const res = deleteAccount(u.tenant_id, u.id);
  logAdminAction('delete_tenant', { tenantId: u.tenant_id, note: `${res.mode}; fatture conservate: ${res.retainedInvoices}`, actor: actor() });
  io.out(`OK: account cancellato (${res.mode === 'purged' ? 'eliminazione completa' : `anonimizzato, ${res.retainedInvoices} fatture conservate`}).${f['ack-subscription'] === true ? '\nRicorda: annulla a mano l\'abbonamento su Stripe.' : ''}`);
  return OK;
};

const cmdStats: Cmd = (_pos, f, io) => {
  requireDbFile();
  const s = collectStats();
  if (f.json) { io.out(JSON.stringify(s, null, 2)); return OK; }
  const kv = (o: Record<string, number>) => (Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ') : 'nessuno');
  io.out([
    `Statistiche al ${s.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
    `Clienti:     ${s.tenants.active} attivi (${s.tenants.deleted} cancellati) · Pro Stripe ${s.plans.proStripe} · Pro manuale ${s.plans.proManual} · Free ${s.plans.free}`,
    `Utenti:      ${s.users.total} registrati · attivi 7 giorni ${s.users.active7d} · attivi 30 giorni ${s.users.active30d} · nuovi 7g ${s.users.newLast7d} / 30g ${s.users.newLast30d}`,
    `Documenti:   ${s.documents.total} totali · creati questo mese ${s.documents.createdThisMonth} · preventivi ${s.documents.quotes} · bozze fattura ${s.documents.drafts}`,
    `Fatture:     ${s.invoices.issued} emesse (${s.invoices.issuedLast30d} negli ultimi 30 giorni) · ${s.invoices.rejected} scartate dallo SDI`,
    `Conflitti sync 7g:  ${kv(s.syncConflicts.last7d)}`,
    `Conflitti sync 30g: ${kv(s.syncConflicts.last30d)}`,
    `Job SDI:     ${kv(s.sdiJobs)}`,
    `Errori:      ${s.errors.last24h} nelle ultime 24 ore · ${s.errors.last7d} negli ultimi 7 giorni`,
    ...s.errors.recent.slice(0, 5).map((e) => `   ${e.at.slice(0, 16).replace('T', ' ')}  ${e.kind}  ${e.route ?? ''}  ${e.name ?? ''}`),
    `Database:    ${mb(s.db.sizeBytes)} (di cui ${mb(s.db.freeBytes)} liberi)`,
  ].join('\n'));
  return OK;
};

function printIntegrity(r: IntegrityReport, io: CliIO): number {
  io.out(`Controllo integrita': ${r.checked.integrity === 'ok' ? 'OK' : 'PROBLEMI'} · ${r.checked.issuedInvoices} fatture emesse in ${r.checked.numberingGroups} serie · cifratura: ${r.checked.encryptionSample} righe campionate`);
  for (const e of r.errors) io.out(`ERRORE  ${e}`);
  for (const w of r.warnings) io.out(`AVVISO  ${w}`);
  if (!r.errors.length && !r.warnings.length) io.out('Tutto in ordine: nessun errore, nessun buco di numerazione.');
  return r.errors.length ? FAIL : r.warnings.length ? WARN : OK;
}

const cmdIntegrity: Cmd = (_pos, f, io) => {
  let db: DatabaseSync;
  let close = () => {};
  if (typeof f.file === 'string') {
    if (!existsSync(f.file)) throw new CliError(`File non trovato: ${f.file}`);
    db = new DatabaseSync(f.file, { readOnly: true }); close = () => db.close();
  } else if ((process.env.DB_PATH || './data/app.sqlite') === ':memory:') {
    db = getDb();
  } else {
    db = new DatabaseSync(requireDbFile(), { readOnly: true }); close = () => db.close(); // sola lettura: sicuro anche a server acceso
    db.exec('PRAGMA busy_timeout = 10000');
  }
  try {
    const r = checkIntegrity(db, { deep: f.rapido !== true });
    if (f.json) { io.out(JSON.stringify(r, null, 2)); return r.errors.length ? FAIL : r.warnings.length ? WARN : OK; }
    return printIntegrity(r, io);
  } finally { close(); }
};

function defaultBackupDir(): string {
  return process.env.BACKUP_DIR || join(dirname(resolve(process.env.DB_PATH || './data/app.sqlite')), 'backups');
}
const stamp = (): string => new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

async function makeBackup(dest?: string): Promise<string> {
  const src = requireDbFile();
  if (src === ':memory:') throw new CliError('Il backup richiede un database su file (DB_PATH).');
  const out = resolve(dest ?? join(defaultBackupDir(), `vocepreventivo-${stamp()}.sqlite`));
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  await backupDatabase(src, out);
  chmodSync(out, 0o600);
  return out;
}

const cmdBackup: Cmd = async (pos, _f, io) => {
  const out = await makeBackup(pos[0]);
  const rep = verifyDatabase(out);
  if (!rep.ok) { io.err(`Backup creato ma NON valido: ${rep.problems.join('; ')}`); return FAIL; }
  try { logAdminAction('backup', { note: out.split('/').pop(), actor: actor() }); } catch { /* DB in sola lettura: il backup e' comunque fatto */ }
  io.out(`OK: backup in ${out} (${mb(statSync(out).size)}, ${rep.tables.tenants ?? 0} tenant, ${rep.tables.documents ?? 0} documenti). Verificato: integrity_check e trigger presenti.\nIl file contiene dati personali: tienilo in un posto protetto e copia anche altrove (vedi docs/OPERAZIONI.md).`);
  return OK;
};

const cmdRestoreTest: Cmd = async (pos, _f, io) => {
  const tmp = mkdtempSync(join(tmpdir(), 'vp-restore-test-'));
  try {
    const restored = join(tmp, 'restored.sqlite');
    let live: Record<string, number> | null = null;
    let origin: string;
    if (pos[0]) {
      origin = resolve(pos[0]);
      if (!existsSync(origin)) throw new CliError(`File non trovato: ${origin}`);
      if (/\.age$/i.test(origin)) throw new CliError('Backup cifrato con age: decifralo prima con la tua chiave privata, poi ripeti il test sul file .sqlite.');
      if (/\.gz$/i.test(origin)) await pipeline(createReadStream(origin), createGunzip(), createWriteStream(restored));
      else copyFileSync(origin, restored);
    } else {
      const src = requireDbFile();
      if (src === ':memory:') throw new CliError('Serve un database su file (DB_PATH) oppure indica un file di backup.');
      origin = 'copia fresca del database in uso';
      await backupDatabase(src, restored);
      const d = new DatabaseSync(src, { readOnly: true });
      try { live = {}; for (const t of ['tenants', 'users', 'documents', 'audit_log']) live[t] = (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n; } finally { d.close(); }
    }
    const problems: string[] = [];
    const v = verifyDatabase(restored);
    problems.push(...v.problems.filter((p) => !/trigger mancante: trg_admin/.test(p)));
    // Apertura "come produzione": applica le migrazioni mancanti (prova l'upgrade di un backup vecchio) e ricontrolla tutto.
    const db = openDb(restored);
    let rep: IntegrityReport;
    try { rep = checkIntegrity(db, { deep: true }); } finally { db.close(); }
    problems.push(...rep.errors);
    if (live) for (const [t, n] of Object.entries(live)) {
      const got = v.tables[t];
      if (got !== undefined && Math.abs(got - n) > Math.max(2, n * 0.01)) problems.push(`conteggio ${t}: ripristinato ${got}, originale ${n}`);
    }
    io.out(`Prova di ripristino su ${origin}\n  migrazioni: versione ${v.schemaVersion ?? '?'} · tenant ${v.tables.tenants ?? 0} · utenti ${v.tables.users ?? '?'} · documenti ${v.tables.documents ?? 0} · audit ${v.tables.audit_log ?? 0}`);
    for (const p of problems) io.out(`ERRORE  ${p}`);
    for (const w of rep.warnings) io.out(`AVVISO  ${w}`);
    io.out(problems.length ? 'ESITO: PROVA NON SUPERATA — il backup NON e\' affidabile.' : 'ESITO: OK — il backup si apre, e\' integro e i dati ci sono. (Copia temporanea eliminata, produzione intatta.)');
    return problems.length ? FAIL : OK;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
};

const cmdRotate: Cmd = async (_pos, f, io) => {
  requireDbFile();
  if (!getKeyRing()) throw new CliError('APP_ENCRYPTION_KEY non impostata: niente da ruotare. Procedura in docs/OPERAZIONI.md (sezione "Rotazione della chiave").');
  const report = f.report === true || f['dry-run'] === true;
  if (!report && f['no-backup'] !== true) {
    if ((process.env.DB_PATH || '') === ':memory:') io.out('(DB in memoria: backup saltato)');
    else io.out(`Backup di sicurezza prima della rotazione: ${await makeBackup()}`);
  }
  const rep = rotate({ includeLocked: f['include-locked'] === true, dryRun: report });
  io.out(`${report ? 'SIMULAZIONE — ' : ''}Rotazione chiave (${getKeyRing()!.current.id}): documenti ${rep.documents}, profili ${rep.profiles}, log di sync ${rep.changes}, fatture emesse saltate ${rep.lockedSkipped}`);
  const old = Object.entries(rep.remainingOldKey);
  io.out(old.length ? `Ancora cifrati con chiavi vecchie: ${old.map(([k, n]) => `${k}=${n}`).join(', ')} -> NON rimuovere quelle chiavi da APP_ENCRYPTION_OLD_KEYS.` : 'Nessun dato con chiavi vecchie: la vecchia chiave puo\' essere rimossa da APP_ENCRYPTION_OLD_KEYS (dopo aver archiviato i backup che ne dipendono).');
  if (!report) logAdminAction('rotate_key', { note: `kid ${getKeyRing()!.current.id}`, actor: actor() });
  return OK;
};

const cmdCreateInvite: Cmd = (_pos, f, io) => {
  requireDbFile();
  const n = Math.min(Math.max(Number(f.quanti) || 1, 1), 200);
  const days = f.giorni !== undefined ? Number(f.giorni) : 30;
  if (!Number.isFinite(days) || days < 0 || days > 3650) throw new CliError('--giorni non valido (0 = senza scadenza).', USAGE);
  if (n > 1 && f.email) throw new CliError('--email e --quanti > 1 non si combinano (un codice vincolato vale per una sola email).', USAGE);
  const note = typeof f.nota === 'string' ? f.nota : undefined;
  for (let i = 0; i < n; i++) {
    const c = createInvite({ email: typeof f.email === 'string' ? f.email : undefined, days: days || undefined, note });
    io.out(`${c.code}${c.expiresAt ? `  (scade ${fmtDay(c.expiresAt - 1)})` : '  (senza scadenza)'}${f.email ? `  riservato a ${normalizeEmail(String(f.email))}` : ''}`);
  }
  logAdminAction('create_invite', { note: `${n} codici${note ? `: ${note}` : ''}`, actor: actor() });
  if (process.env.INVITE_ONLY !== '1') io.out('\nNota: INVITE_ONLY=1 non e\' impostato in questo ambiente. Per limitare le registrazioni ai soli invitati impostalo in server.env e riavvia il server.');
  io.out('I codici sono mostrati UNA volta sola (nel database resta solo l\'hash): conservali ora.');
  return OK;
};
const cmdInviteList: Cmd = (_pos, _f, io) => {
  requireDbFile();
  const l = listInvites();
  if (!l.length) { io.out('Nessun codice invito.'); return OK; }
  io.out(table([['ID', 'STATO', 'CREATO', 'SCADE', 'EMAIL', 'NOTA'], ...l.map((i) => [i.codeHashPrefix, i.status, fmt(i.createdAt), i.expiresAt ? fmtDay(i.expiresAt - 1) : 'mai', i.boundToEmail ? 'vincolato' : '—', i.note ?? ''])]));
  return OK;
};
const cmdInviteRevoke: Cmd = (pos, _f, io) => {
  requireDbFile();
  if (!pos[0]) throw new CliError('Indica il codice da annullare.', USAGE);
  const ok = revokeInvite(pos[0]);
  io.out(ok ? 'OK: codice annullato.' : 'Codice non trovato o gia\' usato.');
  return ok ? OK : FAIL;
};

const COMMANDS: Record<string, Cmd> = {
  tenants: cmdTenants, utenti: cmdTenants, info: cmdInfo, 'grant-pro': cmdGrant, 'revoke-pro': cmdRevoke,
  'export-tenant': cmdExport, 'delete-tenant': cmdDelete, stats: cmdStats, 'integrity-check': cmdIntegrity,
  backup: cmdBackup, 'restore-test': cmdRestoreTest, 'rotate-key': cmdRotate,
  'create-invite-code': cmdCreateInvite, 'invite-codes': cmdInviteList, 'revoke-invite': cmdInviteRevoke,
};

const OPTIONS = {
  json: { type: 'boolean' }, cerca: { type: 'string' }, limit: { type: 'string' }, giorni: { type: 'string' }, 'fino-al': { type: 'string' }, nota: { type: 'string' },
  out: { type: 'string' }, conferma: { type: 'string' }, 'ack-subscription': { type: 'boolean' }, file: { type: 'string' }, rapido: { type: 'boolean' },
  report: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'include-locked': { type: 'boolean' }, 'no-backup': { type: 'boolean' },
  email: { type: 'string' }, quanti: { type: 'string' }, db: { type: 'string' }, help: { type: 'boolean', short: 'h' },
} as const;

/** Esegue un comando e ritorna il codice di uscita. Non chiude il DB (lo fa chi chiama). */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }); }
  catch (e) { io.err(`${(e as Error).message}\nUsa "admin.ts help" per l'elenco dei comandi.`); return USAGE; }
  const [cmd, ...pos] = parsed.positionals;
  if (!cmd || cmd === 'help' || parsed.values.help) { io.out(HELP); return cmd || parsed.values.help ? OK : USAGE; }
  const fn = COMMANDS[cmd];
  if (!fn) { io.err(`Comando sconosciuto: ${cmd}\n\n${HELP}`); return USAGE; }
  if (typeof parsed.values.db === 'string') process.env.DB_PATH = parsed.values.db;
  try {
    return await fn(pos, parsed.values as Flags, io);
  } catch (e) {
    if (e instanceof CliError) { io.err(`Errore: ${e.message}`); return e.code; }
    io.err(`Errore inatteso: ${e instanceof Error ? `${e.name}: ${e.message}` : 'sconosciuto'}`);
    return FAIL;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const io: CliIO = { out: (s) => console.log(s), err: (s) => console.error(s), ask: rl ? (q) => rl.question(q) : undefined };
  runCli(process.argv.slice(2), io).then((code) => { rl?.close(); try { closeDb(); } catch { /* gia' chiuso */ } process.exit(code); });
}
