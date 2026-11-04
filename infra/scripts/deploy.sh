#!/usr/bin/env bash
# Deploy idempotente con rollback automatico.
#
# Uso (sul server, da qualunque cartella):  infra/scripts/deploy.sh [TAG]
#   TAG = etichetta delle immagini (default: data e ora UTC).
#
# Cosa fa:
#   1. controlla .env e Docker
#   2. usa le immagini gia' presenti con quel TAG (es. caricate dalla GitHub Action)
#      oppure le costruisce dal codice presente in questa macchina
#   3. backup di sicurezza pre-deploy del DB
#   4. docker compose up -d
#   5. (opzionale) migrazioni: MIGRATE_CMD="npm run migrate" -- di norma il server
#      applica le migrazioni da solo all'avvio
#   6. healthcheck; se fallisce, torna alla versione precedente
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_cmd docker
load_env
check_no_placeholders DOMAIN ACME_EMAIL DB_PATH LITESTREAM_BUCKET LITESTREAM_ENDPOINT \
  LITESTREAM_REGION LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY

STATE_DIR="$INFRA_DIR/.deploy"
mkdir -p "$STATE_DIR"
NEW_TAG="${1:-${APP_TAG_OVERRIDE:-$(date -u +%Y%m%d-%H%M%S)}}"
PREV_TAG="$(cat "$STATE_DIR/current" 2>/dev/null || true)"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
MIGRATE_CMD="${MIGRATE_CMD:-}"

have_images() {
  docker image inspect "vocepreventivo-server:$1" >/dev/null 2>&1 &&
  docker image inspect "vocepreventivo-web:$1" >/dev/null 2>&1
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) cid status
  while [ "$SECONDS" -lt "$deadline" ]; do
    cid="$(APP_TAG="$1" dc ps -q server 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 3
  done
  return 1
}

rollback() {
  if [ -n "$PREV_TAG" ] && have_images "$PREV_TAG"; then
    warn "rollback alla versione precedente ($PREV_TAG)"
    APP_TAG="$PREV_TAG" dc up -d --remove-orphans || true
    if wait_healthy "$PREV_TAG"; then
      log "rollback riuscito: in esecuzione $PREV_TAG"
    else
      warn "anche la versione precedente non risulta sana: controlla 'docker compose logs server'"
    fi
  else
    warn "nessuna versione precedente disponibile per il rollback"
  fi
}

log "deploy della versione '$NEW_TAG' (precedente: '${PREV_TAG:-nessuna}')"

# 2. immagini
if have_images "$NEW_TAG"; then
  log "immagini gia' presenti per '$NEW_TAG'"
else
  [ -f ../server/Dockerfile ] || die "immagini '$NEW_TAG' assenti e sorgenti non trovati in $INFRA_DIR/.."
  log "costruzione immagini dal codice sorgente (puo' richiedere qualche minuto)"
  APP_TAG="$NEW_TAG" dc build
fi

# 3. backup di sicurezza (salta se il DB non esiste ancora: primo deploy)
if [ -n "$(APP_TAG="${PREV_TAG:-$NEW_TAG}" dc ps -q server 2>/dev/null || true)" ]; then
  log "backup pre-deploy"
  "$INFRA_DIR/scripts/backup.sh" || warn "backup pre-deploy fallito (continuo: la replica Litestream resta attiva)"
else
  log "nessun server in esecuzione: salto il backup pre-deploy"
fi

# 4. avvio
export APP_TAG="$NEW_TAG"
if ! dc up -d --remove-orphans; then
  warn "docker compose up fallito"; rollback; exit 1
fi

# 5. migrazioni opzionali
if [ -n "$MIGRATE_CMD" ]; then
  log "migrazioni: $MIGRATE_CMD"
  if ! dc exec -T server sh -c "$MIGRATE_CMD"; then
    warn "migrazioni fallite"; rollback; exit 1
  fi
fi

# 6. healthcheck
log "attendo che il server sia sano (max ${HEALTH_TIMEOUT}s)"
if ! wait_healthy "$NEW_TAG"; then
  warn "healthcheck fallito"
  dc logs --tail 50 server || true
  rollback
  exit 1
fi

# controllo esterno (solo avviso: al primo avvio il certificato HTTPS puo' richiedere un minuto)
if command -v curl >/dev/null 2>&1; then
  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 10 "https://${DOMAIN}/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 6
  done
  if [ "$ok" -eq 1 ]; then
    log "controllo esterno https://${DOMAIN}/health OK"
  else
    warn "https://${DOMAIN}/health non risponde ancora: verifica DNS e porte 80/443"
  fi
fi

printf '%s\n' "$NEW_TAG" > "$STATE_DIR/current"
[ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ] && printf '%s\n' "$PREV_TAG" > "$STATE_DIR/previous"

# pulizia: solo immagini senza etichetta e versioni vecchie oltre le ultime 3
docker image prune -f >/dev/null 2>&1 || true
for img in vocepreventivo-server vocepreventivo-web; do
  docker images --format '{{.Tag}}' "$img" | grep -v '^latest$' | sort -r | tail -n +4 | while read -r t; do
    [ "$t" = "$NEW_TAG" ] || [ "$t" = "$PREV_TAG" ] || docker rmi "$img:$t" >/dev/null 2>&1 || true
  done
done

log "deploy completato: versione $NEW_TAG"
