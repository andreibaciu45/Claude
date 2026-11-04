#!/bin/sh
# Lancia la CLI amministrativa caricando la configurazione del server (DB_PATH, chiavi, ...).
#   sudo -u vocepreventivo /opt/vocepreventivo/current/server/scripts/admin.sh stats
# Variabili: VP_ENV_FILE (default /etc/vocepreventivo/server.env).
set -eu
ENV_FILE="${VP_ENV_FILE:-/etc/vocepreventivo/server.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/tsx scripts/admin.ts "$@"
