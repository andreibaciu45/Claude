#!/usr/bin/env bash
# Deploy SENZA Docker, con releases/ + symlink "current" e rollback automatico.
#
# Uso (come utente di deploy, NON root):
#   /opt/vocepreventivo/releases/<tag>/infra/scripts/deploy-nodocker.sh <tag>
#   oppure, dalla copia git sul server:  SOURCE_DIR=~/vocepreventivo-src ./infra/scripts/deploy-nodocker.sh
#
# Due modi di fornire il codice:
#   A) la GitHub Action ha gia' caricato in $APP_DIR/releases/<tag>/ le cartelle server/, shared/, infra/
#      e dist/ (frontend gia' compilato in CI): lo script non compila nulla;
#   B) SOURCE_DIR = clone git sul server: lo script fa `git pull --ff-only`, copia il codice nella nuova
#      release e compila il frontend con Vite (richiede ~1 GB RAM liberi; con poca RAM usa il modo A).
#
# Poi: `npm ci --omit=dev` in server/, backup pre-deploy, cambio del symlink, riavvio del servizio,
# healthcheck su http://127.0.0.1:8787/health; se fallisce, torna alla release precedente.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/vocepreventivo}"
SVC_USER="${SVC_USER:-vocepreventivo}"
SERVICE="vocepreventivo-server"
PORT="${PORT:-8787}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SOURCE_DIR="${SOURCE_DIR:-}"
TAG="${1:-$(date -u +%Y%m%d-%H%M%S)}"

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "ATTENZIONE: $*" >&2; }
die()  { log "ERRORE: $*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "non eseguire come root: usa l'utente di deploy"
umask 022
command -v node >/dev/null || die "Node non installato (esegui prima setup-vps.sh)"
[ -d "$APP_DIR/releases" ] || die "$APP_DIR/releases non esiste (esegui prima setup-vps.sh)"

# un solo deploy alla volta
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || die "un altro deploy e' in corso"

REL="$APP_DIR/releases/$TAG"
PREV="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

# --- 1. codice ---
if [ -n "$SOURCE_DIR" ]; then
  [ -d "$SOURCE_DIR/.git" ] || die "SOURCE_DIR non e' un clone git"
  log "aggiorno il codice da git"
  git -C "$SOURCE_DIR" pull --ff-only
  mkdir -p "$REL"
  rsync -a --delete --exclude node_modules --exclude '*.sqlite*' --exclude '.env*' \
    "$SOURCE_DIR/server/" "$REL/server/"
  rsync -a --delete "$SOURCE_DIR/shared/" "$REL/shared/"
  rsync -a --delete --exclude '.env' --exclude backups "$SOURCE_DIR/infra/" "$REL/infra/"
  if [ ! -f "$REL/dist/index.html" ]; then
    log "compilo il frontend con Vite"
    rsync -a --exclude node_modules --exclude dist --exclude server --exclude .git \
      --exclude e2e --exclude docs --exclude infra --exclude .github "$SOURCE_DIR/" "$REL/.web-src/"
    (cd "$REL/.web-src" && npm ci --no-audit --no-fund && npx vite build)
    mv "$REL/.web-src/dist" "$REL/dist"
    rm -rf "$REL/.web-src"
  fi
else
  [ -d "$REL/server" ] && [ -d "$REL/shared" ] || die "release $REL incompleta (mancano server/ o shared/)"
fi
[ -f "$REL/dist/index.html" ] || die "manca $REL/dist/index.html (frontend non compilato)"
[ -f "$REL/server/src/index.ts" ] || die "manca server/src/index.ts nella release"

# --- 2. dipendenze di produzione (nessuna build del server: parte con tsx) ---
log "installo le dipendenze del server"
(cd "$REL/server" && npm ci --omit=dev --no-audit --no-fund)
# fa trovare le dipendenze anche al codice in shared/
ln -sfn "$REL/server/node_modules" "$REL/node_modules"
chmod +x "$REL"/infra/scripts/*.sh 2>/dev/null || true

# --- 3. backup pre-deploy (solo se il servizio gira gia') ---
if sudo -n /usr/bin/systemctl is-active "$SERVICE" >/dev/null 2>&1 && [ -x "$REL/infra/scripts/backup.sh" ]; then
  log "backup pre-deploy"
  sudo -n -u "$SVC_USER" "$REL/infra/scripts/backup.sh" || warn "backup pre-deploy fallito (la replica Litestream resta attiva)"
fi

# --- 4. cambio release + riavvio ---
switch_to() {
  ln -sfn "$1" "$APP_DIR/current.new"
  mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
  sudo -n /usr/bin/systemctl restart "$SERVICE"
}
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

log "attivo la release $TAG (precedente: ${PREV:-nessuna})"
switch_to "$REL"
if ! wait_healthy; then
  warn "healthcheck fallito"
  sudo -n /usr/bin/journalctl -u "$SERVICE" -n 40 --no-pager 2>/dev/null || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    warn "rollback a $PREV"
    switch_to "$PREV"
    if wait_healthy; then log "rollback riuscito"; else warn "anche la release precedente non risponde: controlla i log"; fi
  else
    warn "nessuna release precedente per il rollback"
  fi
  exit 1
fi
log "healthcheck locale OK"

# --- 5. pulizia: tieni le ultime N release (mai la corrente e la precedente) ---
CUR="$(readlink -f "$APP_DIR/current")"
# shellcheck disable=SC2012
ls -1dt "$APP_DIR"/releases/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r d; do
  d="${d%/}"
  [ "$d" = "$CUR" ] || [ "$d" = "$PREV" ] || rm -rf "$d"
done
log "deploy completato: release $TAG"
