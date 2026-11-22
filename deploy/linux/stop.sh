#!/usr/bin/env bash
# ============================================================
#  SignageCMS - Arret propre du serveur (v3.11.25)
#  ------------------------------------------------------------
#  Usage :
#    bash stop.sh
#
#  Arret fiable et propre, sans jamais tuer un autre processus :
#    1. service systemd signagecms s'il est actif (install.sh)
#    2. server.pid (reference principale) - le processus est
#       verifie (cmdline contient server.js) avant tout kill
#    3. SIGTERM puis attente 10 s puis SIGKILL si necessaire
#    4. repli : recherche par ligne de commande (pgrep)
#    5. repli : processus du port d'ecoute (ss, lu dans .env)
#  Codes de sortie : 0 dans tous les cas nominaux.
# ============================================================
set -u

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR" || exit 1
PID_FILE="$APP_DIR/server.pid"

ok()   { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }

# port de repli : .env puis variable PORT puis 3000
PORT="${PORT:-3000}"
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
PORT="${PORT:-3000}"

is_server_pid() {
  [ -r "/proc/$1/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -Eq 'server\.js|next-server'
}

# TERM puis attente 10 s puis KILL si necessaire
graceful_kill() {
  local PID="$1" WHAT="$2"
  kill -TERM "$PID" 2>/dev/null || return 1
  for _ in $(seq 1 20); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$PID" 2>/dev/null; then
    warn "Arret demande apres 10 s - arret force (SIGKILL) : pid $PID"
    kill -KILL "$PID" 2>/dev/null
    sleep 1
  fi
  ok "Serveur arrete ($WHAT : pid $PID)."
  return 0
}

# ---------- 1. service systemd (si installe par install.sh) ----------
if command -v systemctl >/dev/null 2>&1 \
   && systemctl is-active --quiet signagecms 2>/dev/null; then
  if systemctl stop signagecms; then
    ok "Service systemd signagecms arrete."
    rm -f "$PID_FILE"
    exit 0
  fi
  warn "Impossible d'arreter le service systemd - tentative manuelle ci-dessous."
fi

stopped=0

# ---------- 2. server.pid ----------
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    if is_server_pid "$PID"; then
      if graceful_kill "$PID" "server.pid"; then stopped=1; fi
    else
      warn "server.pid pointe vers un processus qui n'est pas le serveur (pid $PID) - ignore."
    fi
  fi
  rm -f "$PID_FILE"
fi
[ "$stopped" -eq 1 ] && exit 0

# ---------- 3. repli : ligne de commande ----------
PIDS="$(pgrep -f 'next-server|node .*\.next/standalone/server\.js' 2>/dev/null || true)"
for P in $PIDS; do
  if graceful_kill "$P" "trouve par ligne de commande"; then stopped=1; fi
done
if [ "$stopped" -eq 1 ]; then
  rm -f "$PID_FILE"
  exit 0
fi

# ---------- 4. repli : port d'ecoute ----------
if command -v ss >/dev/null 2>&1; then
  PIDS="$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
  for P in $PIDS; do
    is_server_pid "$P" || continue   # jamais un autre programme
    if graceful_kill "$P" "port $PORT"; then stopped=1; fi
  done
fi

if [ "$stopped" -eq 0 ]; then
  warn "Aucun serveur SignageCMS en cours d'execution."
fi
exit 0
