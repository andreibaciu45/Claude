// Schema operativo (SERVER-OPS): licenze concesse a mano, codici invito, contatori giornalieri, errori recenti, stato di manutenzione.
// Versioni 200+ (core 1..99, extra 100..199). Registrato da db/index.ts: ogni apertura del DB le applica.
import { registerMigration } from './migrations';

registerMigration(200, 'ops_admin', `
-- Registro APPEND-ONLY delle azioni amministrative (CLI). Stato di una licenza manuale = ultima riga grant_pro/revoke_pro del tenant.
-- Nessun FK e nessuna email: la traccia sopravvive alla cancellazione del tenant ed e' pseudonima (solo tenant_id).
CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,        -- grant_pro | revoke_pro | export_tenant | delete_tenant | create_invite | rotate_key | ...
  tenant_id TEXT,
  until_at INTEGER,            -- grant_pro: fine della concessione (ms, esclusa)
  note TEXT
);
CREATE INDEX idx_admin_actions_tenant ON admin_actions(tenant_id, id);
CREATE TRIGGER trg_admin_actions_no_update BEFORE UPDATE ON admin_actions
BEGIN SELECT RAISE(ABORT, 'admin_actions append-only: UPDATE vietato'); END;
CREATE TRIGGER trg_admin_actions_no_delete BEFORE DELETE ON admin_actions
BEGIN SELECT RAISE(ABORT, 'admin_actions append-only: DELETE vietato'); END;

-- Stato chiave/valore (ultima manutenzione, ultimo VACUUM, sonda di scrittura di /health/deep).
CREATE TABLE ops_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Contatori giornalieri persistenti (conflitti di sync per motivo, errori): sopravvivono ai riavvii, niente dati personali.
CREATE TABLE ops_daily (day TEXT NOT NULL, metric TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, metric));

-- Errori 5xx recenti: solo rotta (pattern), nome dell'errore e orario. Mai messaggi, body, utenti.
CREATE TABLE ops_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, route TEXT, name TEXT);
CREATE INDEX idx_ops_errors_at ON ops_errors(at);
`);

registerMigration(201, 'ops_invites', `
-- Codici invito monouso per un lancio privato (INVITE_ONLY=1). Si salva solo l'hash del codice (e dell'email, se vincolato).
CREATE TABLE invite_codes (
  code_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  email_hash TEXT,
  note TEXT,
  used_at INTEGER,
  used_by_tenant TEXT
);
`);
