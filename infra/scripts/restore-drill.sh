#!/usr/bin/env bash
# Prova di ripristino (da fare ogni MESE, anche da cron): ripristina l'ultima replica
# Litestream in una cartella temporanea, verifica PRAGMA integrity_check e confronta i
# conteggi con il DB vivo. Esce con codice != 0 se qualcosa non torna.
# Non modifica nulla in produzione.
#
# Uso: infra/scripts/restore-drill.sh
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_env
check_no_placeholders DB_PATH

BACKUP_DIR="$(default_backup_dir)"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$INFRA_DIR/$BACKUP_DIR" ;; esac
mkdir -p "$BACKUP_DIR"
LOG_FILE="$BACKUP_DIR/drill.log"
TOLERANCE_PCT="${DRILL_TOLERANCE_PCT:-5}"   # scarto massimo ammesso tra replica e DB vivo

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0
note() { log "$*" | tee -a "$LOG_FILE"; }

note "=== restore drill ==="
litestream_restore "$WORK" drill.sqlite \
  || { note "FALLITO: ripristino da Litestream non riuscito"; exit 1; }

res="$(integrity_check "$WORK" drill.sqlite)"
if [ "$res" = "ok" ]; then note "integrity_check: ok"; else note "FALLITO integrity_check: $res"; exit 1; fi

# DB vivo, in sola lettura
live_cnt() { live_sql "SELECT count(*) FROM \"$1\";"; }

total_r=0; total_l=0
while IFS='|' read -r t rc; do
  [ -n "$t" ] || continue
  lc="$(live_cnt "$t" 2>/dev/null || echo "?")"
  note "tabella $t: ripristinata=$rc viva=$lc"
  total_r=$((total_r + rc))
  if [ "$lc" = "?" ]; then fail=1; note "  tabella non leggibile nel DB vivo"; else total_l=$((total_l + lc)); fi
done < <(table_counts "$WORK" drill.sqlite)

if [ "$total_l" -gt 0 ]; then
  min=$(( total_l * (100 - TOLERANCE_PCT) / 100 ))
  if [ "$total_r" -lt "$min" ]; then
    fail=1; note "FALLITO: righe ripristinate ($total_r) molto inferiori a quelle vive ($total_l)"
  fi
fi
[ "$total_r" -gt 0 ] || [ "$total_l" -eq 0 ] || { fail=1; note "FALLITO: DB ripristinato vuoto"; }

if [ "$fail" -eq 0 ]; then note "ESITO: OK (righe ripristinate $total_r / vive $total_l)"; else note "ESITO: FALLITO"; fi
exit "$fail"
