#!/usr/bin/env bash
# Ripristino del DB da Litestream o da snapshot.
#
# Uso:
#   restore.sh litestream [--at <ISO8601>] [--test]        da replica S3 (anche a un istante preciso)
#   restore.sh snapshot <file> [--test]                    da snapshot (.sqlite.gz oppure .sqlite.gz.age)
#   Con --test (modalita' di PROVA): ripristina in una cartella temporanea, verifica integrita'
#   e conteggi, poi cancella. Non tocca il DB vivo. E' il default se manca --live.
#   Con --live --yes: SOSTITUISCE il DB di produzione (il vecchio viene tenuto come .before-restore-*).
#
# Per --age-identity <file> (snapshot cifrati) serve la chiave PRIVATA age, che NON sta sul server:
# copiala temporaneamente e cancellala dopo l'uso.
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_cmd docker
load_env
check_no_placeholders DB_PATH

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

MODE="${1:-}"; [ -n "$MODE" ] || usage; shift
SNAP_FILE=""; AT=""; LIVE=0; YES=0; AGE_ID=""
if [ "$MODE" = "snapshot" ]; then SNAP_FILE="${1:-}"; [ -n "$SNAP_FILE" ] || usage; shift; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="${2:?--at richiede un valore}"; shift 2 ;;
    --test) LIVE=0; shift ;;
    --live) LIVE=1; shift ;;
    --yes) YES=1; shift ;;
    --age-identity) AGE_ID="${2:?}"; shift 2 ;;
    *) usage ;;
  esac
done
case "$MODE" in litestream|snapshot) ;; *) usage ;; esac

WORK="$(mktemp -d)"
chmod 755 "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
OUT_NAME="restored.sqlite"

# --- 1. produce $WORK/restored.sqlite ---
if [ "$MODE" = "litestream" ]; then
  args=(restore -config /etc/litestream.yml -o "/restore/$OUT_NAME")
  [ -n "$AT" ] && args+=(-timestamp "$AT")
  args+=("$DB_PATH")
  log "ripristino da Litestream${AT:+ allo stato di $AT}"
  chmod 777 "$WORK"
  dc run --rm --no-deps -T -v "$WORK:/restore" --entrypoint litestream litestream "${args[@]}"
  chmod 755 "$WORK"
else
  [ -f "$SNAP_FILE" ] || die "file non trovato: $SNAP_FILE"
  src="$SNAP_FILE"
  case "$src" in
    *.age)
      require_cmd age
      [ -n "$AGE_ID" ] || die "snapshot cifrato: indica --age-identity <file-chiave-privata>"
      age -d -i "$AGE_ID" -o "$WORK/snap.gz" "$src"; src="$WORK/snap.gz" ;;
  esac
  gzip -dc "$src" > "$WORK/$OUT_NAME"
fi
[ -s "$WORK/$OUT_NAME" ] || die "ripristino non riuscito: file vuoto"

# --- 2. verifica ---
log "verifica di integrita'"
res="$(integrity_check "$WORK" "$OUT_NAME")"
[ "$res" = "ok" ] || die "integrity_check FALLITO: $res"
log "integrity_check: ok"
log "conteggio righe per tabella:"
table_counts "$WORK" "$OUT_NAME" | sed 's/|/ = /; s/^/   /'

if [ "$LIVE" -eq 0 ]; then
  log "PROVA completata: il DB di produzione NON e' stato toccato"
  exit 0
fi

# --- 3. sostituzione del DB vivo ---
[ "$YES" -eq 1 ] || die "per sostituire il DB di produzione aggiungi --yes (dopo aver letto docs/DEPLOY.md)"
log "ATTENZIONE: sostituisco il DB di produzione"
dc stop server litestream
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dbfile="$(basename "$DB_PATH")"
dc run --rm --no-deps -T -v "$WORK:/restore:ro" --entrypoint sh litestream -c "
  set -e
  d=\$(dirname '$DB_PATH')
  [ -f '$DB_PATH' ] && mv '$DB_PATH' '$DB_PATH.before-restore-$stamp'
  rm -f '$DB_PATH-wal' '$DB_PATH-shm'
  rm -rf \"\$d/.$dbfile-litestream\"
  cp /restore/$OUT_NAME '$DB_PATH'
  chown 1000:1000 '$DB_PATH'
"
dc up -d
log "ripristino completato. Il vecchio DB e' in $DB_PATH.before-restore-$stamp (nel volume dati)."
log "Dopo un ripristino da snapshot Litestream ricomincia una nuova generazione di replica: e' normale."
