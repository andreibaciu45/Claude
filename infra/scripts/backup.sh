#!/usr/bin/env bash
# Snapshot consistente del DB SQLite (comando .backup di SQLite, sicuro a server acceso),
# compresso, facoltativamente cifrato con age (AGE_RECIPIENT = chiave PUBBLICA), con rotazione.
# La replica continua e' fatta da Litestream: questo e' un secondo livello (snapshot a punti fissi).
#
# Uso: infra/scripts/backup.sh        (consigliato da cron ogni notte, vedi docs/DEPLOY.md)
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_cmd docker
load_env
check_no_placeholders DB_PATH

BACKUP_DIR="${BACKUP_DIR:-$INFRA_DIR/backups}"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$INFRA_DIR/$BACKUP_DIR" ;; esac
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

cid="$(dc ps -q server || true)"
[ -n "$cid" ] || die "il container 'server' non e' in esecuzione"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp_in="/tmp/snapshot-$stamp.sqlite"
out="$BACKUP_DIR/vocepreventivo-$stamp.sqlite.gz"

log "snapshot del DB"
dc exec -T server sqlite3 "$DB_PATH" ".backup '$tmp_in'"
dc exec -T server sqlite3 "$tmp_in" "PRAGMA integrity_check;" | grep -qx ok \
  || { dc exec -T server rm -f "$tmp_in"; die "lo snapshot non supera integrity_check"; }
dc exec -T server gzip -c "$tmp_in" > "$out"
dc exec -T server rm -f "$tmp_in"

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
