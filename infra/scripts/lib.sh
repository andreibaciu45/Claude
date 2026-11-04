#!/usr/bin/env bash
# Funzioni comuni agli script di infra. Da includere con: source "$(dirname "$0")/lib.sh"
# Nessun segreto qui: le variabili arrivano da file .env / server.env sul server.
#
# Due modalita' (rilevate da sole, forzabili con INFRA_MODE=native|docker):
#   native : installazione senza Docker (systemd). Env in /etc/vocepreventivo/server.env
#   docker : installazione con docker compose. Env in infra/.env

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$INFRA_DIR" || exit 1

SVC_USER="${SVC_USER:-vocepreventivo}"
NATIVE_ENV_FILE="${NATIVE_ENV_FILE:-/etc/vocepreventivo/server.env}"

if [ -z "${INFRA_MODE:-}" ]; then
  if [ -f "$NATIVE_ENV_FILE" ] || { [ -n "${DB_PATH:-}" ] && ! [ -f "$INFRA_DIR/.env" ]; }; then
    INFRA_MODE=native
  else
    INFRA_MODE=docker
  fi
fi
is_native() { [ "$INFRA_MODE" = "native" ]; }
if is_native; then LS_CONFIG="/etc/vocepreventivo/litestream.yml"; else LS_CONFIG="/etc/litestream.yml"; fi

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "ATTENZIONE: $*" >&2; }
die()  { log "ERRORE: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando '$1' non trovato"; }

# Esegue un comando come utente di servizio (se siamo root); altrimenti cosi' com'e'
as_svc() {
  if [ "$(id -u)" -eq 0 ] && [ "$(id -un)" != "$SVC_USER" ]; then
    runuser -u "$SVC_USER" -- "$@"
  else
    "$@"
  fi
}

# Carica le variabili (solo per leggerle negli script)
load_env() {
  if is_native; then
    # sotto systemd le variabili ci sono gia' (EnvironmentFile)
    if [ -z "${DB_PATH:-}" ]; then
      [ -r "$NATIVE_ENV_FILE" ] || die "non posso leggere $NATIVE_ENV_FILE (esegui con: sudo -u $SVC_USER ... oppure sudo)"
      set -a
      # shellcheck disable=SC1090
      . "$NATIVE_ENV_FILE"
      set +a
    fi
    return 0
  fi
  [ -f .env ] || die "manca infra/.env (copia .env.example in .env e compilalo)"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

# Rifiuta valori ancora a segnaposto
check_no_placeholders() {
  local var bad=0
  for var in "$@"; do
    case "${!var:-CHANGE_ME}" in
      *CHANGE_ME*|"") warn "variabile $var mancante o ancora a CHANGE_ME"; bad=1 ;;
    esac
  done
  [ "$bad" -eq 0 ] || die "completa il file di configurazione prima di continuare"
}

dc() { docker compose "$@"; }

# Cartella predefinita dei backup
default_backup_dir() {
  if is_native; then echo "${BACKUP_DIR:-/var/lib/vocepreventivo/backups}"; else echo "${BACKUP_DIR:-$INFRA_DIR/backups}"; fi
}

# sqlite3 in sola lettura. Uso: sqlite_ro <cartella> <file-db> <sql...>
sqlite_ro() {
  local dir="$1" file="$2"; shift 2
  if is_native; then
    sqlite3 -readonly "$dir/$file" "$@"
  else
    dc run --rm --no-deps -T -v "$dir:/check:ro" --entrypoint sqlite3 server -readonly "/check/$file" "$@"
  fi
}

# SQL in sola lettura sul DB VIVO
live_sql() {
  if is_native; then
    as_svc sqlite3 -readonly "$DB_PATH" "$@"
  else
    dc exec -T server sqlite3 -readonly "$DB_PATH" "$@"
  fi
}

# Ripristino Litestream in <cartella>/<nome>. Uso: litestream_restore <cartella> <nome> [opzioni litestream...]
litestream_restore() {
  local dir="$1" name="$2"; shift 2
  chmod 777 "$dir"
  if is_native; then
    require_cmd litestream
    as_svc litestream restore -config "$LS_CONFIG" -o "$dir/$name" "$@" "$DB_PATH"
  else
    dc run --rm --no-deps -T -v "$dir:/restore" --entrypoint litestream litestream \
      restore -config "$LS_CONFIG" -o "/restore/$name" "$@" "$DB_PATH"
  fi
  chmod 755 "$dir"
}

# Stampa "tabella|righe" per ogni tabella utente del DB
table_counts() {
  local dir="$1" file="$2" t
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    printf '%s|%s\n' "$t" "$(sqlite_ro "$dir" "$file" "SELECT count(*) FROM \"$t\";")"
  done < <(sqlite_ro "$dir" "$file" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
}

integrity_check() { sqlite_ro "$1" "$2" "PRAGMA integrity_check;"; }
