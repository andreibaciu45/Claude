#!/usr/bin/env bash
# Funzioni comuni agli script di infra. Da includere con: source "$(dirname "$0")/lib.sh"
# Nessun segreto qui: le variabili arrivano da infra/.env sul server.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$INFRA_DIR" || exit 1

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "ATTENZIONE: $*" >&2; }
die()  { log "ERRORE: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando '$1' non trovato"; }

# Carica infra/.env (solo per leggere variabili negli script; docker compose lo legge da solo)
load_env() {
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
      *CHANGE_ME*|"") warn "variabile $var mancante o ancora a CHANGE_ME in infra/.env"; bad=1 ;;
    esac
  done
  [ "$bad" -eq 0 ] || die "completa infra/.env prima di continuare"
}

dc() { docker compose "$@"; }

# sqlite3 dentro l'immagine del server (non richiede sqlite3 sull'host).
# Uso: sqlite_in_container <cartella-host> <file-db> <sql...>   (apre in sola lettura)
sqlite_ro() {
  local dir="$1" file="$2"; shift 2
  dc run --rm --no-deps -T -v "$dir:/check:ro" --entrypoint sqlite3 server -readonly "/check/$file" "$@"
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
