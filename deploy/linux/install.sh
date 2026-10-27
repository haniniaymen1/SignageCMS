#!/usr/bin/env bash
# ============================================================
#  SignageCMS v3.11.12 — INSTALLATION COMPLETE SOUS LINUX
#  ------------------------------------------------------------
#  Ce script automatise l'integralite de l'installation :
#    1. Utilitaires de base (curl, unzip, ca-certificates)
#    2. Node.js 20 LTS (depot officiel NodeSource)
#    3. LibreOffice + Poppler (conversion PowerPoint/PDF)
#    4. Depot de l'archive serveur dans /opt/signagecms
#    5. Fichier .env (base SQLite, port, options)
#    6. npm install + Prisma + build production
#    7. Service systemd (demarrage auto, restart apres crash)
#    8. Pare-feu (port 3000) + verification finale
#
#  Usage :
#    sudo bash install.sh
#    sudo bash install.sh --zip /chemin/SignageCMS-Serveur-v3.11.12.zip
#    sudo bash install.sh --port 8080
#    sudo bash install.sh --no-service    (sans systemd)
#    sudo bash install.sh --no-firewall   (ne touche pas au pare-feu)
#
#  Idempotent : reexecutable sans risque, ne reinstalle rien
#  qui est deja present. Compatible Ubuntu / Debian (apt),
#  RHEL / Fedora / Rocky / Alma (dnf/yum), openSUSE (zypper),
#  Arch (pacman), Alpine (apk).
# ============================================================
set -u

APP_DIR="/opt/signagecms"
CMS_PORT="3000"
ZIP_PATH=""
WITH_SERVICE=1
WITH_FIREWALL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --zip)        ZIP_PATH="$2"; shift 2 ;;
    --port)       CMS_PORT="$2"; shift 2 ;;
    --dir)        APP_DIR="$2"; shift 2 ;;
    --no-service) WITH_SERVICE=0; shift ;;
    --no-firewall) WITH_FIREWALL=0; shift ;;
    *)
      echo "Option inconnue : $1"
      echo "Options : --zip FICHIER --port N --dir CHEMIN --no-service --no-firewall"
      exit 1 ;;
  esac
done

# ---------- affichage ------------------------------------------------
ok()   { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[ERREUR]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[..]\033[0m %s\n' "$*"; }
hr()   { printf '\033[2m------------------------------------------------\033[0m\n'; }

echo "============================================================"
echo "  SignageCMS v3.11.12 - installation complete sous Linux"
echo "============================================================"
echo "  Dossier cible : $APP_DIR"
echo "  Port du CMS   : $CMS_PORT"
hr

# ---------- droits administrateur ------------------------------------
# SUDO_USABLE=1 seulement si root, sudo sans mot de passe, ou terminal
# interactif (l'utilisateur pourra saisir son mot de passe). Sinon, le
# script continue en mode non privilegie : les etapes systeme (paquets,
# systemd, pare-feu) sont degradees proprement, et l'installation est
# possible des que le dossier cible est inscriptible par l'utilisateur.
SUDO=""
SUDO_USABLE=0
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  SUDO_USABLE=1
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
  if sudo -n true 2>/dev/null || [ -t 0 ]; then
    SUDO_USABLE=1
    info "Execution en tant qu'utilisateur courant via sudo."
  else
    warn "sudo demande un mot de passe (session non interactive)."
    warn "Etapes paquets/systemd/pare-feu limitees."
    warn "Installation directe tentee si le dossier est inscriptible."
  fi
else
  warn "sudo absent - installation non privilegiee si possible."
fi

# ---------- gestionnaire de paquets ----------------------------------
PKG=""
for m in apt-get dnf yum zypper pacman apk; do
  command -v "$m" >/dev/null 2>&1 && { PKG="$m"; break; }
done
if [ -z "$PKG" ]; then
  err "Aucun gestionnaire de paquets connu (apt/dnf/yum/zypper/pacman/apk)."
  exit 1
fi
ok "Gestionnaire de paquets : $PKG"

pkg_install() {
  if [ "$SUDO_USABLE" -eq 0 ]; then
    warn "Paquets non installes (root requis) : $* - installez-les manuellement."
    return 0
  fi
  case "$PKG" in
    apt-get) $SUDO apt-get install -y "$@" ;;
    dnf)     $SUDO dnf install -y "$@" ;;
    yum)     $SUDO yum install -y "$@" ;;
    zypper)  $SUDO zypper --non-interactive install "$@" ;;
    pacman)  $SUDO pacman -S --noconfirm "$@" ;;
    apk)     $SUDO apk add "$@" ;;
  esac
}
pkg_refresh() {
  [ "$SUDO_USABLE" -eq 1 ] || return 0
  case "$PKG" in
    apt-get) $SUDO apt-get update ;;
    dnf)     $SUDO dnf makecache --refresh >/dev/null 2>&1 || true ;;
    yum)     $SUDO yum makecache >/dev/null 2>&1 || true ;;
    apk)     $SUDO apk update >/dev/null 2>&1 || true ;;
  esac
}

# ---------- 1. utilitaires de base -----------------------------------
hr
info "1/8 - Utilitaires de base (curl, unzip, ca-certificates)"
pkg_refresh
pkg_install curl unzip ca-certificates
ok "Utilitaires de base prets."

# ---------- 2. Node.js 20 LTS ----------------------------------------
hr
info "2/8 - Node.js 20 LTS"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "${NODE_V:-0}" -ge 18 ] 2>/dev/null; then
    NODE_OK=1
    ok "Node.js $(node -v) deja present (>= 18 requis)."
  fi
fi
if [ "$NODE_OK" -eq 0 ]; then
  case "$PKG" in
    apt-get)
      info "Installation depuis le depot NodeSource..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - ;;
    dnf|yum)
      info "Installation depuis le depot NodeSource..."
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - ;;
    zypper)  info "Installation nodejs20 depuis les depots openSUSE..." ;;
    pacman)  info "Installation nodejs/npm depuis les depots Arch..." ;;
    apk)     info "Installation nodejs/npm depuis les depots Alpine..." ;;
  esac
  case "$PKG" in
    zypper)          pkg_install nodejs20 ;;
    pacman)          pkg_install nodejs npm ;;
    apk)             pkg_install nodejs npm ;;
    *)               pkg_install nodejs ;;
  esac
  command -v node >/dev/null 2>&1 \
    || { err "Node.js absent apres installation - verifiez le depot."; exit 1; }
  ok "Node.js $(node -v) installe."
fi
command -v npm >/dev/null 2>&1 || pkg_install npm

# ---------- 3. LibreOffice + Poppler ---------------------------------
hr
info "3/8 - LibreOffice + Poppler (conversion PowerPoint/PDF)"
LO_PKG=""; PP_PKG=""
case "$PKG" in
  apt-get)      LO_PKG="libreoffice-impress";  PP_PKG="poppler-utils" ;;
  dnf|yum)      LO_PKG="libreoffice-impress";  PP_PKG="poppler-utils" ;;
  zypper)       LO_PKG="libreoffice-impress";  PP_PKG="poppler-tools" ;;
  pacman)       LO_PKG="libreoffice-still";    PP_PKG="poppler" ;;
  apk)          LO_PKG="libreoffice";          PP_PKG="poppler-utils" ;;
esac
if command -v soffice >/dev/null 2>&1; then
  ok "LibreOffice deja installe : \
    $(timeout 10 soffice --version 2>/dev/null | head -1 || echo soffice)"
else
  info "Installation de LibreOffice ($LO_PKG) - plusieurs minutes..."
  pkg_install $LO_PKG
  if command -v soffice >/dev/null 2>&1; then
    ok "LibreOffice installe."
  else
    warn "soffice introuvable - les PowerPoint ne seront pas convertis."
  fi
fi
if command -v pdftoppm >/dev/null 2>&1; then
  ok "Poppler deja installe : $(timeout 5 pdftoppm -v 2>&1 | head -1)"
else
  info "Installation de Poppler ($PP_PKG)..."
  pkg_install $PP_PKG
  if command -v pdftoppm >/dev/null 2>&1; then
    ok "Poppler installe."
  else
    warn "pdftoppm introuvable - les PDF ne seront pas decoupes."
  fi
fi

# ---------- 4. depot de l'archive serveur ----------------------------
hr
info "4/8 - Depot de l'archive serveur dans $APP_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -z "$ZIP_PATH" ]; then
  if [ -n "$SCRIPT_DIR" ]; then
    ZIP_PATH="$(ls "$SCRIPT_DIR"/../../SignageCMS-Serveur-*.zip \
                "$SCRIPT_DIR"/SignageCMS-Serveur-*.zip 2>/dev/null | head -1)"
  fi
  [ -n "$ZIP_PATH" ] \
    || ZIP_PATH="$(ls "$PWD"/SignageCMS-Serveur-*.zip 2>/dev/null | head -1)"
fi
if [ -d "$APP_DIR/.next" ]; then
  if [ -z "$ZIP_PATH" ]; then
    ok "Installation existante detectee : $APP_DIR (archive non requise)."
  else
    info "Archive fournie : re-extraction ecrasante dans $APP_DIR..."
    PARENT="$(dirname "$APP_DIR")"
    $SUDO unzip -oq "$ZIP_PATH" -d "$PARENT" 2>/dev/null \
      || unzip -oq "$ZIP_PATH" -d "$PARENT" \
      || { err "Extraction impossible (droits sur $PARENT ?)."; exit 1; }
    [ "$PARENT/signagecms" = "$APP_DIR" ] \
      || $SUDO mv -T "$PARENT/signagecms" "$APP_DIR" 2>/dev/null \
      || mv -T "$PARENT/signagecms" "$APP_DIR"
    [ -d "$APP_DIR/src" ] \
      || { err "Re-extraction douteuse : $APP_DIR/src absent."; exit 1; }
    ok "Archive re-extraite."
  fi
else
  if [ -z "$ZIP_PATH" ]; then
    err "Archive zip introuvable."
    echo "  Utilisez : --zip /chemin/SignageCMS-Serveur-v3.11.12.zip"
    exit 1
  fi
  ok "Archive : $ZIP_PATH"
  PARENT="$(dirname "$APP_DIR")"
  $SUDO mkdir -p "$PARENT" 2>/dev/null || mkdir -p "$PARENT" \
    || { err "Creation de $PARENT impossible (droits ?)."; exit 1; }
  $SUDO unzip -oq "$ZIP_PATH" -d "$PARENT" 2>/dev/null \
    || unzip -oq "$ZIP_PATH" -d "$PARENT" \
    || { err "Extraction impossible (droits sur $PARENT ?)."; exit 1; }
  [ "$PARENT/signagecms" = "$APP_DIR" ] \
    || { $SUDO mv -T "$PARENT/signagecms" "$APP_DIR" 2>/dev/null \
         || mv -T "$PARENT/signagecms" "$APP_DIR"; }
  [ -d "$APP_DIR/src" ] || {
    err "Archive extraite mais $APP_DIR/src absent."
    echo "  Verifiez les droits ou l'integrite de l'archive."
    exit 1
  }
  ok "Archive extraite dans $APP_DIR."
fi

# ---------- 5. fichier .env ------------------------------------------
hr
info "5/8 - Fichier .env (base SQLite, port)"
cd "$APP_DIR" || { err "Acces a $APP_DIR impossible."; exit 1; }
mkdir -p db uploads-tmp 2>/dev/null || $SUDO mkdir -p db uploads-tmp
if [ -f .env ]; then
  warn ".env existant conserve (port et base inchanges)."
else
  ENV_CONTENT="DATABASE_URL=file:$APP_DIR/db/custom.db
PORT=$CMS_PORT
# MAX_UPLOAD_MB=500
# SOFFICE_PATH=/chemin/vers/soffice
# ALLOW_FRAME_EMBED=1   (si integration dans une iframe externe)"
  printf '%s\n' "$ENV_CONTENT" | $SUDO tee .env >/dev/null 2>/dev/null \
    || printf '%s\n' "$ENV_CONTENT" > .env \
    || { err "Ecriture de .env impossible (droits ?)."; exit 1; }
  ok ".env cree (DATABASE_URL + PORT=$CMS_PORT)."
fi

# ---------- 6. dependances + Prisma + build --------------------------
hr
info "6/8 - Dependances npm, schema Prisma, build production"
$SUDO npm install --no-audit --no-fund 2>/dev/null \
  || npm install --no-audit --no-fund \
  || { err "npm install impossible."; exit 1; }
$SUDO npx prisma db push 2>/dev/null || npx prisma db push \
  || { err "prisma db push impossible."; exit 1; }
$SUDO npx prisma generate 2>/dev/null || npx prisma generate \
  || { err "prisma generate impossible."; exit 1; }
info "Compilation production (2 a 6 minutes)..."
$SUDO env NODE_OPTIONS="--max-old-space-size=2048" npm run build 2>/dev/null \
  || env NODE_OPTIONS="--max-old-space-size=2048" npm run build \
  || { err "Build impossible."; exit 1; }
[ -f .next/standalone/server.js ] \
  || { err "Build incomplet : .next/standalone/server.js absent."; exit 1; }
ok "Build production pret (.next/standalone)."

# ---------- 7. service systemd ---------------------------------------
hr
if [ "$WITH_SERVICE" -eq 1 ] && [ "$SUDO_USABLE" -eq 0 ]; then
  info "7/8 - Service systemd ignore : privileges root indisponibles."
  warn "Relancez avec sudo pour installer le service, ou lancez a la main :"
  warn "  bash $APP_DIR/deploy/linux/start.sh"
elif [ "$WITH_SERVICE" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
  info "7/8 - Service systemd (demarrage automatique)"
  SVC_USER="signage"
  if ! id "$SVC_USER" >/dev/null 2>&1; then
    $SUDO useradd --system --create-home --shell /usr/sbin/nologin "$SVC_USER"
    ok "Utilisateur systeme '$SVC_USER' cree."
  fi
  NODE_BIN="$($SUDO sh -c 'command -v node')"
  $SUDO chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
  $SUDO tee /etc/systemd/system/signagecms.service >/dev/null <<EOF
[Unit]
Description=SignageCMS - Serveur d'affichage dynamique
After=network.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/.next/standalone/server.js
Environment=NODE_ENV=production
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now signagecms
  ok "Service signagecms active (demarrage au boot + restart)."
else
  info "7/8 - Service systemd ignore (--no-service ou systemctl absent)."
  warn "Lancement manuel : bash $APP_DIR/deploy/linux/start.sh"
fi

# ---------- 8. pare-feu + verification -------------------------------
hr
if [ "$WITH_FIREWALL" -eq 1 ]; then
  info "8/8 - Pare-feu : ouverture du port $CMS_PORT/tcp"
  if command -v ufw >/dev/null 2>&1 \
     && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow "$CMS_PORT/tcp" && ok "UFW : port $CMS_PORT ouvert."
  elif command -v firewall-cmd >/dev/null 2>&1 \
     && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    $SUDO firewall-cmd --permanent --add-port="$CMS_PORT/tcp"
    $SUDO firewall-cmd --reload
    ok "firewalld : port $CMS_PORT ouvert."
  else
    warn "Aucun pare-feu actif detecte (ou firewalld/ufw absent) - rien a faire."
  fi
else
  info "8/8 - Pare-feu ignore (--no-firewall)."
fi

# ---------- verification finale --------------------------------------
hr
info "Verification finale : http://127.0.0.1:$CMS_PORT/api/version"
API_OK=0
for _ in $(seq 1 15); do
  API_V="$(curl -s --max-time 2 "http://127.0.0.1:$CMS_PORT/api/version" \
           2>/dev/null | tr -d '"')"
  [ -n "$API_V" ] && { API_OK=1; break; }
  sleep 2
done
hr
if [ "$API_OK" -eq 1 ]; then
  ok "Serveur CMS v$API_V en ligne sur le port $CMS_PORT."
else
  warn "Le serveur ne repond pas encore (build/service recents)."
  if [ "$WITH_SERVICE" -eq 1 ]; then
    warn "Consultez : journalctl -u signagecms -f"
  else
    warn "Demarrage : bash $APP_DIR/deploy/linux/start.sh"
  fi
fi
echo "  Adresse CMS        : http://ADRESSE-IP-DU-SERVEUR:$CMS_PORT"
echo "  Identifiants admin : $APP_DIR/db/admin-credentials.txt (1re connexion)"
echo "  Journaux service   : journalctl -u signagecms -f"
echo "  Arret/relance      : bash $APP_DIR/deploy/linux/start.sh --stop | --restart"
hr
