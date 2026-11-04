#!/usr/bin/env bash
# Preparazione del VPS SENZA Docker (Ubuntu LTS). Idempotente: si puo' rilanciare.
#
# Uso (come amministratore, dalla cartella infra/ del repository copiata sul server):
#   sudo DEPLOY_USER=deploy ./scripts/setup-vps.sh
#
# Cosa fa:
#   - utente di servizio "vocepreventivo" (senza login) e cartelle /opt/vocepreventivo, /etc/vocepreventivo
#   - installa Node 22 (repository apt NodeSource), Caddy (repository apt ufficiale), Litestream (.deb ufficiale),
#     sqlite3, rsync, git, ufw, fail2ban, aggiornamenti di sicurezza automatici
#   - installa unit e timer systemd, Caddyfile, regola sudo minima per l'utente di deploy
#   - crea i file di configurazione da compilare (con CHANGE_ME) e avvia i servizi SOLO quando sono compilati
#
# Variabili (tutte facoltative tranne DEPLOY_USER):
#   DEPLOY_USER            utente SSH non-root che esegue i deploy (deve gia' esistere)
#   SSH_PORT               porta SSH da lasciare aperta in ufw (default 22)
#   LITESTREAM_VERSION     default 0.3.13
#   LITESTREAM_DEB_SHA256  se impostato, verifica l'hash SHA-256 del .deb scaricato
# Nessun segreto in questo script.
set -Eeuo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC_USER="vocepreventivo"
APP_DIR="/opt/vocepreventivo"
CONF_DIR="/etc/vocepreventivo"
SSH_PORT="${SSH_PORT:-22}"
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"

log() { printf '[setup] %s\n' "$*"; }
die() { printf '[setup] ERRORE: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "esegui con sudo"
[ -n "${DEPLOY_USER:-}" ] || die "imposta DEPLOY_USER (es. sudo DEPLOY_USER=deploy ./scripts/setup-vps.sh)"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "l'utente $DEPLOY_USER non esiste (vedi docs/DEPLOY.md, sezione hardening)"
[ "$DEPLOY_USER" != "root" ] || die "DEPLOY_USER non puo' essere root"
[ -d "$INFRA_DIR/systemd" ] || die "cartella $INFRA_DIR/systemd non trovata: lancia lo script dal repository"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || log "ATTENZIONE: pensato per Ubuntu LTS, trovato ${ID:-?}"

export DEBIAN_FRONTEND=noninteractive
install -d -m 755 /etc/apt/keyrings

log "pacchetti di base"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg apt-transport-https sqlite3 rsync git ufw fail2ban \
  unattended-upgrades age >/dev/null

# --- Node 22 (NodeSource) ---
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  log "installo Node 22 da NodeSource"
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){process.exit(1)}' \
  || die "serve Node >= 22.13 (node:sqlite); trovato $(node -v)"
log "Node $(node -v)"

# --- Caddy (repository apt ufficiale) ---
if ! command -v caddy >/dev/null 2>&1; then
  log "installo Caddy dal repository ufficiale"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# --- Litestream (.deb ufficiale) ---
if ! command -v litestream >/dev/null 2>&1 || ! litestream version 2>/dev/null | grep -q "$LITESTREAM_VERSION"; then
  case "$(dpkg --print-architecture)" in
    amd64) ls_arch=amd64 ;; arm64) ls_arch=arm64 ;; *) die "architettura non supportata" ;;
  esac
  log "installo Litestream $LITESTREAM_VERSION ($ls_arch)"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/litestream.deb" \
    "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${ls_arch}.deb"
  if [ -n "${LITESTREAM_DEB_SHA256:-}" ]; then
    echo "${LITESTREAM_DEB_SHA256}  $tmp/litestream.deb" | sha256sum -c - || die "hash di Litestream non corrisponde"
  else
    log "ATTENZIONE: LITESTREAM_DEB_SHA256 non impostato, il .deb non e' verificato con un hash"
  fi
  dpkg -i "$tmp/litestream.deb" >/dev/null
  rm -rf "$tmp"
fi
# l'unit del pacchetto gira come root: usiamo la nostra
systemctl disable --now litestream.service >/dev/null 2>&1 || true

# --- Utenti e cartelle ---
if ! id "$SVC_USER" >/dev/null 2>&1; then
  log "creo l'utente di servizio $SVC_USER"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin --user-group "$SVC_USER"
fi
install -d -m 755 -o "$DEPLOY_USER" -g "$SVC_USER" "$APP_DIR" "$APP_DIR/releases"
install -d -m 755 -o root -g root "$CONF_DIR"

# --- Configurazione (non sovrascrive mai file esistenti) ---
if [ ! -f "$CONF_DIR/server.env" ]; then
  install -m 600 -o "$SVC_USER" -g "$SVC_USER" "$INFRA_DIR/server.env.example" "$CONF_DIR/server.env"
  log "creato $CONF_DIR/server.env: DA COMPILARE"
fi
chown "$SVC_USER:$SVC_USER" "$CONF_DIR/server.env"; chmod 600 "$CONF_DIR/server.env"
if [ ! -f "$CONF_DIR/caddy.env" ]; then
  install -m 644 -o root -g root "$INFRA_DIR/caddy.env.example" "$CONF_DIR/caddy.env"
  log "creato $CONF_DIR/caddy.env: DA COMPILARE"
fi
install -m 644 "$INFRA_DIR/litestream.yml" "$CONF_DIR/litestream.yml"

# --- systemd, Caddy, sudo ---
log "installo unit systemd e Caddyfile"
install -m 644 "$INFRA_DIR"/systemd/*.service "$INFRA_DIR"/systemd/*.timer /etc/systemd/system/
install -d /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=%s/caddy.env\n' "$CONF_DIR" > /etc/systemd/system/caddy.service.d/vocepreventivo.conf
install -m 644 "$INFRA_DIR/Caddyfile.nodocker" /etc/caddy/Caddyfile

# Regola sudo minima: l'utente di deploy puo' solo riavviare/leggere i nostri servizi
sudoers_tmp="$(mktemp)"
cat > "$sudoers_tmp" <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart vocepreventivo-server, /usr/bin/systemctl start vocepreventivo-server, /usr/bin/systemctl stop vocepreventivo-server, /usr/bin/systemctl is-active vocepreventivo-server, /usr/bin/systemctl reload caddy
$DEPLOY_USER ALL=($SVC_USER) NOPASSWD: ALL
SUDO
visudo -cf "$sudoers_tmp" >/dev/null || die "regola sudo non valida"
install -m 440 -o root -g root "$sudoers_tmp" /etc/sudoers.d/vocepreventivo-deploy
rm -f "$sudoers_tmp"
systemctl daemon-reload

# --- Sicurezza: aggiornamenti automatici, fail2ban, ufw ---
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
printf '[sshd]\nenabled = true\nport = %s\nmaxretry = 5\nbantime = 1h\nfindtime = 10m\n' "$SSH_PORT" > /etc/fail2ban/jail.d/vocepreventivo-sshd.local
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl restart fail2ban

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null     # prima SSH, per non chiuderti fuori
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
log "ufw attivo (porte: ${SSH_PORT}, 80, 443)"

# --- Abilitazione servizi ---
systemctl enable vocepreventivo-backup.timer vocepreventivo-restore-drill.timer >/dev/null 2>&1
systemctl start vocepreventivo-backup.timer vocepreventivo-restore-drill.timer
if grep -q CHANGE_ME "$CONF_DIR/server.env" "$CONF_DIR/caddy.env"; then
  log "File di configurazione ancora con CHANGE_ME: servizi abilitati ma NON avviati."
  systemctl enable vocepreventivo-server vocepreventivo-litestream caddy >/dev/null 2>&1
  systemctl stop caddy >/dev/null 2>&1 || true
  log "1) sudo nano $CONF_DIR/server.env   2) sudo nano $CONF_DIR/caddy.env   3) rilancia questo script"
else
  systemctl enable vocepreventivo-server vocepreventivo-litestream caddy >/dev/null 2>&1
  if [ -e "$APP_DIR/current/server/src/index.ts" ]; then
    systemctl restart vocepreventivo-server vocepreventivo-litestream
  else
    log "Nessuna release installata: avvia il primo deploy (deploy-nodocker.sh o GitHub Action)."
  fi
  systemctl restart caddy
fi
log "fatto."
