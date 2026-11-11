#!/usr/bin/env bash
# ============================================================
#  SignageCMS — Lancement du serveur (build production standalone)
#  ------------------------------------------------------------
#  Usage :
#    bash start.sh              # premier plan (Ctrl+C pour arreter)
#    bash start.sh --daemon     # arriere-plan (service.log + server.pid)
#    bash start.sh --stop       # arrete l'instance en arriere-plan
#    bash start.sh --restart    # redemarre l'instance en arriere-plan
#    bash start.sh --status     # etat du processus + version API
#
#  Le script verifie Node.js, le fichier .env et le build
#  production, puis demarre .next/standalone/server.js.
#  Au premier demarrage, le compte admin est cree et son mot de
#  passe aleatoire est ecrit dans db/admin-credentials.txt.
# ============================================================
set -u

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR" || { echo "Dossier introuvable : $APP_DIR"; exit 1; }

MODE="${1:-}"

ok()   { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[ERREUR]\033[0m %s\n' "$*"; }

PID_FILE="$APP_DIR/server.pid"
LOG_FILE="$APP_DIR/service.log"

# ---------- verification de l'environnement --------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js absent. Installez-le d'abord (voir deploy/linux/install.sh)."
  exit 1
fi

if [ ! -f .env ]; then
  warn "Fichier .env absent - creation minimale (DATABASE_URL local)."
  mkdir -p db
  echo "DATABASE_URL=file:$APP_DIR/db/custom.db" > .env
fi
# charge DATABASE_URL et PORT definis dans .env (sans ecraser l'env existant)
set -a; . ./.env; set +a

if [ ! -f .next/standalone/server.js ]; then
  err "Build production absent (.next/standalone/server.js)."
  echo "  Lancez : npm install && npx prisma db push && npm run build"
  echo "  Ou directement : sudo bash deploy/linux/install.sh"
  exit 1
fi

# port : .env puis variable PORT puis 3000
PORT="${PORT:-3000}"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

api_version() {
  curl -s --max-time 2 "http://127.0.0.1:$PORT/api/version" 2>/dev/null | tr -d '"'
}

# ---------- commandes ------------------------------------------------
case "$MODE" in
  --stop)
    if is_running; then
      PID="$(cat "$PID_FILE")"
      kill "$PID" && rm -f "$PID_FILE"
      ok "Serveur arrete (pid $PID)."
    else
      warn "Aucune instance en arriere-plan (server.pid absent)."
    fi
    exit 0 ;;

  --status)
    if is_running; then
      ok "Processus actif : pid $(cat "$PID_FILE") - port $PORT"
    else
      warn "Aucune instance en arriere-plan."
    fi
    V="$(api_version)"
    if [ -n "$V" ]; then
      ok "API repond : version $V sur http://127.0.0.1:$PORT"
    else
      warn "API sans reponse sur le port $PORT."
    fi
    exit 0 ;;

  --restart)
    "$0" --stop
    sleep 2
    exec "$0" --daemon ;;

  --daemon)
    if is_running; then
      warn "Deja actif : pid $(cat "$PID_FILE") - utilisez --restart pour relancer."
      exit 0
    fi
    echo "Demarrage en arriere-plan : service.log + server.pid"
    nohup env NODE_ENV=production PORT="$PORT" \
      node .next/standalone/server.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3
    if is_running; then
      ok "Serveur demarre : pid $(cat "$PID_FILE") - port $PORT"
      V="$(api_version)"
      [ -n "$V" ] && ok "Version API : $V"
      echo "  Interface CMS   : http://ADRESSE-IP-DU-SERVEUR:$PORT"
      echo "  Admin (1er lancement) : $APP_DIR/db/admin-credentials.txt"
      echo "  Journaux        : tail -f $LOG_FILE"
      echo "  Arret           : bash $0 --stop"
    else
      err "Echec du demarrage - consultez $LOG_FILE"
      tail -n 20 "$LOG_FILE" 2>/dev/null
      exit 1
    fi
    exit 0 ;;

  *)
    echo "SignageCMS - lancement au premier plan (Ctrl+C pour arreter)"
    echo "  Port : $PORT   Journal : console"
    echo
    exec env NODE_ENV=production PORT="$PORT" node .next/standalone/server.js ;;
esac
