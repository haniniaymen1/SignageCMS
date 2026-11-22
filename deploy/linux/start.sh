#!/usr/bin/env bash
# ============================================================
#  SignageCMS — Lancement du serveur (build production standalone)
#  ------------------------------------------------------------
#  Usage :
#    bash start.sh              # arriere-plan (service.log + server.pid) - par defaut
#    bash start.sh --foreground # premier plan (Ctrl+C pour arreter)
#    bash start.sh --stop       # arret propre (delegue a deploy/linux/stop.sh)
#    bash start.sh --restart    # redemarre l'instance en arriere-plan
#    bash start.sh --status     # etat du processus + version API
#    Option : --no-build        # ne construit JAMAIS le build automatiquement
#
#  v3.11.25 - le demarrage est SILENCIEUX et ne bloque pas le terminal :
#  le serveur tourne en arriere-plan (nohup) et continue apres la fermeture
#  du terminal. Anti-demarrage multiple : server.pid + detection par API et
#  par ligne de commande ; conflit de port signale dans service.log.
#
#  Le script verifie Node.js, le fichier .env et le build
#  production — si le build est absent, il est construit
#  automatiquement (npm install, Prisma, build ; journal
#  build.log) sauf si --no-build — puis demarre
#  .next/standalone/server.js.
#  Au demarrage, le compte admin est cree s'il n'existe pas deja et son
#  mot de passe aleatoire est ecrit dans db/admin-credentials.txt (des
#  l'installation avec install.sh, sinon au premier demarrage).
# ============================================================
set -u

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR" || { echo "Dossier introuvable : $APP_DIR"; exit 1; }

MODE=""
AUTO_BUILD=1
for a in "$@"; do
  case "$a" in
    --no-build) AUTO_BUILD=0 ;;
    *) [ -z "$MODE" ] && MODE="$a" ;;
  esac
done

ok()   { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[ERREUR]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[..]\033[0m %s\n' "$*"; }

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

if [ ! -f .next/standalone/server.js ] && [ "$AUTO_BUILD" -eq 1 ]; then
  # v3.11.22 — construction automatique : une seule commande suffit depuis
  # l'archive extraite (npm install, Prisma, build production). La sortie
  # complète est conservée dans build.log ; en cas d'échec, la fin du
  # journal est affichée pour voir la vraie erreur.
  BUILD_LOG="$APP_DIR/build.log"
  info "Build production absent - construction automatique (2 a 6 minutes)..."
  info "Journal complet : $BUILD_LOG"
  mkdir -p public public/uploads public/downloads 2>/dev/null || true
  BUILD_FAILED=0
  npm install --no-audit --no-fund >"$BUILD_LOG" 2>&1 \
    || BUILD_FAILED=1
  if [ "$BUILD_FAILED" -eq 0 ]; then
    npx prisma db push >>"$BUILD_LOG" 2>&1 || BUILD_FAILED=1
  fi
  if [ "$BUILD_FAILED" -eq 0 ]; then
    npx prisma generate >>"$BUILD_LOG" 2>&1 || BUILD_FAILED=1
  fi
  if [ "$BUILD_FAILED" -eq 0 ]; then
    info "Compilation production en cours..."
    NODE_OPTIONS="--max-old-space-size=2048" npm run build >>"$BUILD_LOG" 2>&1 \
      || BUILD_FAILED=1
  fi
  if [ "$BUILD_FAILED" -eq 1 ]; then
    err "Construction automatique impossible - fin du journal ($BUILD_LOG) :"
    tail -n 30 "$BUILD_LOG" 2>/dev/null | sed 's/^/    /'
    echo "    ----"
    echo "    Journal complet : $BUILD_LOG"
    echo "    Ou installation complete : sudo bash deploy/linux/install.sh"
    exit 1
  fi
  ok "Build production pret (.next/standalone)."
fi

if [ ! -f .next/standalone/server.js ]; then
  err "Build production absent (.next/standalone/server.js)."
  echo "  Lancez : npm install && npx prisma db push && npm run build"
  echo "  Ou directement : sudo bash deploy/linux/install.sh"
  echo "  (ou relancez sans --no-build pour construire automatiquement)"
  exit 1
fi

# v3.11.23 — compte admin + db/admin-credentials.txt créés dès l'installation
# (install.sh) ou au démarrage si le compte n'existe pas encore. En cas
# d'échec (client Prisma absent, base injoignable), la route de connexion
# garde son auto-réparation : rien ne bloque le démarrage.
ensure_admin() {
  if [ -f scripts/ensure-admin.mjs ] && command -v node >/dev/null 2>&1; then
    node scripts/ensure-admin.mjs \
      || warn "Compte admin non cree maintenant (il sera cree au 1er essai de connexion)."
  fi
}

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
    # v3.11.25 - arret propre delegue a stop.sh (TERM, attente 10 s,
    # KILL, replis pidfile/pgrep/port, gestion du service systemd)
    if [ -f "$APP_DIR/deploy/linux/stop.sh" ]; then
      exec bash "$APP_DIR/deploy/linux/stop.sh"
    fi
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
    # v3.11.25 - garde-fous anti demarrage multiple : une instance peut
    # tourner sans pidfile (ancienne version, terminal ferme). Si l'API
    # repond deja, on reparite server.pid au lieu de lancer un doublon
    # qui echouerait en conflit de port.
    if [ -n "$(api_version)" ]; then
      OTHER="$(pgrep -f 'next-server|node .*\.next/standalone/server\.js' | head -1)"
      if [ -n "$OTHER" ]; then
        echo "$OTHER" > "$PID_FILE"
        warn "Deja actif (pid $OTHER, server.pid repare) - utilisez --restart pour relancer."
      else
        warn "Une application ecoute deja sur le port $PORT - rien a lancer."
      fi
      exit 0
    fi
    ensure_admin
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
      echo "  Identifiants admin   : $APP_DIR/db/admin-credentials.txt"
      echo "  Journaux        : tail -f $LOG_FILE"
      echo "  Arret           : bash $0 --stop"
    else
      err "Echec du demarrage - consultez $LOG_FILE"
      tail -n 20 "$LOG_FILE" 2>/dev/null
      exit 1
    fi
    exit 0 ;;

  --foreground)
    ensure_admin
    echo "SignageCMS - lancement au premier plan (Ctrl+C pour arreter)"
    echo "  Port : $PORT   Journal : console"
    echo
    exec env NODE_ENV=production PORT="$PORT" node .next/standalone/server.js ;;

  *)
    # v3.11.25 - par defaut : arriere-plan (ne bloque pas le terminal)
    exec "$0" --daemon ;;
esac
