// Migrazioni versionate in codice (nessun file da localizzare a runtime).
// Core: versioni 1..99. SERVER-EXTRA può aggiungere le sue con registerMigration(100+, ...) PRIMA della prima apertura del DB.
import type { DatabaseSync } from 'node:sqlite';

export interface Migration { version: number; name: string; sql: string }

const migrations: Migration[] = [];

export function registerMigration(version: number, name: string, sql: string): void {
  if (migrations.some((m) => m.version === version)) throw new Error(`migrazione duplicata: ${version}`);
  migrations.push({ version, name, sql });
}

/** Solo test: toglie una migrazione registrata (es. una volutamente rotta). */
export function unregisterMigration(version: number): void {
  const i = migrations.findIndex((m) => m.version === version);
  if (i >= 0) migrations.splice(i, 1);
}

/** Campi di una fattura emessa che restano modificabili (eventi SDI, pagamenti, stato). */
const LOCKED_ALLOWED_PATHS = `'$.status','$.updatedAt','$.invoice.sdiEvents','$.invoice.payments','$.invoice.paymentStatus'`;

registerMigration(1, 'core', `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE TABLE devices (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX idx_otp_email ON otp_codes(email, id);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE documents (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  number TEXT,
  inv_year INTEGER,
  inv_sectional TEXT,
  inv_seq INTEGER,
  locked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
-- Numero fattura emessa unico per (tenant, sezionale, anno, seq). Le bozze non hanno seq indicizzato.
CREATE UNIQUE INDEX uq_documents_invoice_number ON documents(tenant_id, inv_sectional, inv_year, inv_seq) WHERE inv_seq IS NOT NULL;
CREATE INDEX idx_documents_tenant_updated ON documents(tenant_id, updated_at);
CREATE INDEX idx_documents_tenant_type_status ON documents(tenant_id, type, status);

CREATE TABLE catalog_items (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Registro append-only (nessun FK verso tenants: non deve poter sparire a cascata).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ref_id TEXT,
  payload TEXT
);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, id);
CREATE UNIQUE INDEX uq_audit_ref ON audit_log(tenant_id, ref_id) WHERE ref_id IS NOT NULL;

-- Log delle modifiche: seq = cursore monotono (per tenant e globale).
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_changes_tenant_seq ON changes(tenant_id, seq);
CREATE INDEX idx_changes_entity ON changes(tenant_id, entity, entity_id, seq);
CREATE TABLE sync_ops (
  tenant_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  device_id TEXT,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, op_id)
);

CREATE TABLE entitlements (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE usage (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,
  docs_created INTEGER NOT NULL DEFAULT 0,
  stt_seconds INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month)
);
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT,
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_jobs_due ON jobs(state, run_at);

-- IMMUTABILITA' -----------------------------------------------------------
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log append-only: UPDATE vietato'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log append-only: DELETE vietato'); END;

CREATE TRIGGER trg_documents_no_delete_locked BEFORE DELETE ON documents
WHEN OLD.locked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'documento_bloccato: eliminazione vietata'); END;

CREATE TRIGGER trg_documents_locked_update BEFORE UPDATE ON documents
WHEN OLD.locked_at IS NOT NULL AND NOT (
  NEW.tenant_id IS OLD.tenant_id AND NEW.id IS OLD.id AND NEW.type IS OLD.type
  AND NEW.number IS OLD.number AND NEW.inv_year IS OLD.inv_year
  AND NEW.inv_sectional IS OLD.inv_sectional AND NEW.inv_seq IS OLD.inv_seq
  AND NEW.locked_at IS OLD.locked_at AND NEW.created_at IS OLD.created_at
  AND NEW.deleted_at IS OLD.deleted_at AND NEW.status <> 'bozza'
  AND json_remove(NEW.data, ${LOCKED_ALLOWED_PATHS}) IS json_remove(OLD.data, ${LOCKED_ALLOWED_PATHS})
)
BEGIN SELECT RAISE(ABORT, 'documento_bloccato: modifica vietata'); END;
`);

registerMigration(2, 'hardening', `
-- Periodo di grazia di billing (getPlan lo rispetta) e soft-delete dell'account (GDPR).
ALTER TABLE entitlements ADD COLUMN grace_until INTEGER;
ALTER TABLE tenants ADD COLUMN deleted_at INTEGER;

-- Accettazione di Termini/DPA (prova del consenso). Nessun FK: la prova sopravvive alla cancellazione dell'account.
CREATE TABLE legal_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL,            -- 'terms' | 'dpa'
  version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,  -- orologio del SERVER
  client_accepted_at INTEGER,    -- dichiarato dal client (solo informativo)
  ip_hash TEXT                   -- HMAC(AUTH_SECRET, ip), solo se TERMS_STORE_IP_HASH=1
);
CREATE INDEX idx_legal_tenant ON legal_acceptances(tenant_id, id);
CREATE TRIGGER trg_legal_no_update BEFORE UPDATE ON legal_acceptances
BEGIN SELECT RAISE(ABORT, 'legal_acceptances append-only: UPDATE vietato'); END;
CREATE TRIGGER trg_legal_no_delete BEFORE DELETE ON legal_acceptances
BEGIN SELECT RAISE(ABORT, 'legal_acceptances append-only: DELETE vietato'); END;

-- Backoff esponenziale per coppia (email+IP) sulle verifiche OTP: non blocca mai la vittima, solo chi sbaglia.
CREATE TABLE auth_backoff (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

registerMigration(3, 'entitlements_cancel_flag', `ALTER TABLE entitlements ADD COLUMN cancel_at_period_end INTEGER;`);

registerMigration(4, 'resend_rejected_invoice', `
-- Una fattura scartata dallo SDI (stato 'scartata') puo' essere corretta e rinviata con STESSO numero/data/sezionale/anno/seq/lockedAt:
-- in quel solo caso il contenuto puo' cambiare, purche' invoice.xmlHistory (XML archiviati) si allunghi.
DROP TRIGGER trg_documents_locked_update;
CREATE TRIGGER trg_documents_locked_update BEFORE UPDATE ON documents
WHEN OLD.locked_at IS NOT NULL AND NOT (
  NEW.tenant_id IS OLD.tenant_id AND NEW.id IS OLD.id AND NEW.type IS OLD.type
  AND NEW.number IS OLD.number AND NEW.inv_year IS OLD.inv_year
  AND NEW.inv_sectional IS OLD.inv_sectional AND NEW.inv_seq IS OLD.inv_seq
  AND NEW.locked_at IS OLD.locked_at AND NEW.created_at IS OLD.created_at
  AND NEW.deleted_at IS OLD.deleted_at AND NEW.status <> 'bozza'
  AND (
    json_remove(NEW.data, ${LOCKED_ALLOWED_PATHS}) IS json_remove(OLD.data, ${LOCKED_ALLOWED_PATHS})
    OR (
      OLD.status = 'scartata'
      AND json_extract(NEW.data, '$.date') IS json_extract(OLD.data, '$.date')
      AND json_extract(NEW.data, '$.number') IS json_extract(OLD.data, '$.number')
      AND json_extract(NEW.data, '$.invoice.number') IS json_extract(OLD.data, '$.invoice.number')
      AND json_extract(NEW.data, '$.invoice.seq') IS json_extract(OLD.data, '$.invoice.seq')
      AND json_extract(NEW.data, '$.invoice.year') IS json_extract(OLD.data, '$.invoice.year')
      AND json_extract(NEW.data, '$.invoice.sectional') IS json_extract(OLD.data, '$.invoice.sectional')
      AND json_extract(NEW.data, '$.invoice.lockedAt') IS json_extract(OLD.data, '$.invoice.lockedAt')
      AND COALESCE(json_array_length(NEW.data, '$.invoice.xmlHistory'), 0) > COALESCE(json_array_length(OLD.data, '$.invoice.xmlHistory'), 0)
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'documento_bloccato: modifica vietata'); END;
`);

registerMigration(5, 'issued_number_index', `
-- Ricerca del numero (testo) tra le fatture emesse di un tenant: senza indice ogni emissione scandirebbe tutte le emesse (O(n) per operazione).
CREATE INDEX idx_documents_issued_number ON documents(tenant_id, number) WHERE locked_at IS NOT NULL;
`);

registerMigration(6, 'audit_retention', `
-- Retention dell'audit. Ogni voce ha una CLASSE: retain=1 (fiscale: fatture emesse, SDI, consensi, account) non si elimina mai;
-- retain=0 (voice_command, bozze, accessi, catalogo, profilo) si puo' aggregare in audit_daily e potare dopo AUDIT_RETENTION_DAYS.
-- recorded_at = orologio del SERVER all'inserimento (l'\`at\` delle voci del client e' dichiarato dal client e non fa fede per la potatura).
-- I trigger append-only restano: UPDATE sempre vietato; DELETE ammesso SOLO per righe retain=0 piu' vecchie del limite scritto in audit_prune_ctl,
-- che esiste soltanto DENTRO la transazione di potatura (se la transazione fallisce, sparisce con lei).
DROP TRIGGER trg_audit_no_update;
DROP TRIGGER trg_audit_no_delete;
ALTER TABLE audit_log ADD COLUMN retain INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_log ADD COLUMN recorded_at INTEGER NOT NULL DEFAULT 0;
UPDATE audit_log SET recorded_at = at;
UPDATE audit_log SET retain = 0 WHERE action LIKE 'auth.%' OR action LIKE 'sync.catalog.%' OR action LIKE 'sync.profile.%'
  OR action LIKE 'sync.audit.%' OR action = 'client.voice_command';
UPDATE audit_log SET retain = 0 WHERE retain = 1 AND (action LIKE 'sync.document.%' OR action LIKE 'client.%')
  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = audit_log.tenant_id AND d.id = audit_log.entity_id AND d.locked_at IS NOT NULL);
CREATE INDEX idx_audit_prunable ON audit_log(tenant_id, id) WHERE retain = 0;
CREATE INDEX idx_audit_prunable_at ON audit_log(recorded_at) WHERE retain = 0;
CREATE INDEX idx_audit_fiscal_entity ON audit_log(tenant_id, entity_id) WHERE retain = 1 AND entity_id IS NOT NULL;

CREATE TABLE audit_prune_ctl (id INTEGER PRIMARY KEY CHECK (id = 1), cutoff_at INTEGER NOT NULL);
-- Conteggi delle voci potate (nessun contenuto): tenant, giorno, azione.
CREATE TABLE audit_daily (
  tenant_id TEXT NOT NULL, day TEXT NOT NULL, action TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, day, action)
);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log append-only: UPDATE vietato'); END;
-- COALESCE: senza riga di controllo il confronto sarebbe NULL e NOT(NULL) disattiverebbe il trigger (vedi CODE-REVIEW-SERVER).
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
WHEN NOT (OLD.retain = 0 AND OLD.recorded_at < COALESCE((SELECT cutoff_at FROM audit_prune_ctl WHERE id = 1), 0))
BEGIN SELECT RAISE(ABORT, 'audit_log append-only: DELETE vietato'); END;
`);

registerMigration(7, 'fiscal_chain', `
-- Catena di hash per tenant sulle EMISSIONI (rilevazione di manomissioni a DB spento: righe cancellate, rinumerate o riordinate).
-- received_at = orologio del SERVER alla prima ricezione della fattura emessa (il lockedAt del client e' solo dichiarato).
CREATE TABLE fiscal_chain (
  tenant_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  doc_id TEXT NOT NULL,
  sectional TEXT NOT NULL,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  number TEXT,
  client_locked_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0,   -- 1 = agganciata a posteriori (fattura emessa prima dell'introduzione della catena)
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, n)
);
CREATE UNIQUE INDEX uq_fiscal_chain_doc ON fiscal_chain(tenant_id, doc_id);
CREATE TRIGGER trg_fiscal_chain_no_update BEFORE UPDATE ON fiscal_chain
BEGIN SELECT RAISE(ABORT, 'fiscal_chain append-only: UPDATE vietato'); END;
CREATE TRIGGER trg_fiscal_chain_no_delete BEFORE DELETE ON fiscal_chain
BEGIN SELECT RAISE(ABORT, 'fiscal_chain append-only: DELETE vietato'); END;
`);

registerMigration(8, 'otp_guard', `
-- Difesa globale per email contro l'indovinare l'OTP da molti IP: cooldown crescente sulle sole VERIFICHE (mai sull'invio dei codici).
-- email_hash = HMAC(AUTH_SECRET, email): non invertibile con un dizionario.
CREATE TABLE otp_guard (
  email_hash TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  alerted_at INTEGER,
  updated_at INTEGER NOT NULL
);
-- Reti da cui l'utente ha gia' completato un accesso (HMAC di email e IP/rete, max 5 per email, 30 giorni): corsia privilegiata
-- che non subisce il cooldown globale, cosi' un attacco distribuito non puo' chiudere fuori il legittimo proprietario.
CREATE TABLE otp_trusted_ips (
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  last_ok_at INTEGER NOT NULL,
  PRIMARY KEY (email_hash, ip_hash)
);
`);

registerMigration(9, 'sync_tombstone_floor', `
-- Convergenza del sync: i tombstone (bozze e catalogo) sono conservati per TOMBSTONE_RETENTION_DAYS, poi eliminati dalla pulizia periodica.
-- 'tombstone_floor' = confine (epoch ms, solo crescente) sotto il quale i tombstone possono essere stati eliminati: un'upsert con timestamp
-- <= confine su una voce assente NON si applica (risposta 'resync_required'), altrimenti una cancellazione gia' purgata verrebbe "risuscitata".
CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

/** Elenco (ordinato) delle migrazioni registrate: serve ai test di upgrade e a /health/deep. */
export const listMigrations = (): Migration[] => [...migrations].sort((a, b) => a.version - b.version);

/** `upTo`: applica solo le migrazioni con version <= upTo (test di upgrade da DB vecchi). */
export function runMigrations(db: DatabaseSync, upTo = Infinity): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  for (const m of listMigrations()) {
    if (done.has(m.version) || m.version > upTo) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Un altro processo (deploy con due istanze, CLI mentre il server parte) può aver applicato la migrazione tra la lettura di `done`
      // e questo lock: rieseguirla fallirebbe ("table already exists") e il servizio non partirebbe.
      if (db.prepare('SELECT 1 AS x FROM schema_migrations WHERE version = ?').get(m.version)) { db.exec('COMMIT'); continue; }
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
