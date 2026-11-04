#!/usr/bin/env bash
# Snapshot consistente del DB SQLite (comando .backup di SQLite, sicuro a server acceso),
# compresso, facoltativamente cifrato con age (AGE_RECIPIENT = chiave PUBBLICA), con rotazione.
# La replica continua e' fatta da Litestream: questo e' un secondo livello (snapshot a punti fissi).
#
# Uso: infra/scripts/backup.sh        (consigliato da cron ogni notte, vedi docs/DEPLOY.md)
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_env
check_no_placeholders DB_PATH

BACKUP_DIR="$(default_backup_dir)"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$INFRA_DIR/$BACKUP_DIR" ;; esac
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/vocepreventivo-$stamp.sqlite.gz"

log "snapshot del DB"
if is_native; then
  require_cmd sqlite3
  tmp_in="$(mktemp --suffix=.sqlite)"
  trap 'rm -f "$tmp_in"' EXIT
  rm -f "$tmp_in"
  sqlite3 "$DB_PATH" ".backup '$tmp_in'"
  sqlite3 "$tmp_in" "PRAGMA integrity_check;" | grep -qx ok || die "lo snapshot non supera integrity_check"
  gzip -c "$tmp_in" > "$out"
else
  require_cmd docker
  [ -n "$(dc ps -q server || true)" ] || die "il container 'server' non e' in esecuzione"
  tmp_in="/tmp/snapshot-$stamp.sqlite"
  dc exec -T server sqlite3 "$DB_PATH" ".backup '$tmp_in'"
  dc exec -T server sqlite3 "$tmp_in" "PRAGMA integrity_check;" | grep -qx ok \
    || { dc exec -T server rm -f "$tmp_in"; die "lo snapshot non supera integrity_check"; }
  dc exec -T server gzip -c "$tmp_in" > "$out"
  dc exec -T server rm -f "$tmp_in"
fi

if [ -n "${AGE_RECIPIENT:-}" ]; then
  require_cmd age
  age -r "$AGE_RECIPIENT" -o "$out.age" "$out"
  rm -f "$out"
  out="$out.age"
fi
chmod 600 "$out"
log "backup creato: $out ($(du -h "$out" | cut -f1))"

# rotazione
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'vocepreventivo-*.sqlite.gz*' -mtime +"$KEEP_DAYS" -print -delete \
  | sed 's/^/rimosso vecchio backup: /' || true
