#!/bin/bash
# ============================================================
# build-test-power360.sh — Test E2E du compte IPTV « 1 connexion »
# (carte Power360 : 000000000000 / portail-xtream.example:8000)
# Le portail réel bloque les IP datacenter → portail Xtream SIMULÉ
# au profil identique (mock-power360.mjs, max_connections=1).
# Tout-en-un : pkill → portail simulé → build → CMS → test multi-écrans.
# ============================================================
set -u
cd /home/z/my-project

echo "=== 1. Arrêt des serveurs existants ==="
pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null
pkill -f "next dev" 2>/dev/null; pkill -f "mock-iptv-upstream" 2>/dev/null; pkill -f "mock-power360" 2>/dev/null
sleep 1

echo "=== 2. Démarrage du portail Xtream simulé Power360 (port 8998) ==="
(node scripts/mock-power360.mjs > /tmp/power360-mock.log 2>&1 &)
sleep 1.5
cat /tmp/power360-mock.log

echo "=== 3. Build production ==="
if ! bun run build 2>&1 | tail -5; then
  echo "BUILD ÉCHOUÉ"
  pkill -f mock-power360 2>/dev/null
  exit 1
fi

echo "=== 4. Démarrage du CMS (standalone) ==="
(bun .next/standalone/server.js > /tmp/cms-start.log 2>&1 &)

echo "=== 5. Attente du CMS ==="
code=000
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/auth/me 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "CMS /api/auth/me → $code"
if [ "$code" != "200" ]; then
  echo "CMS NON DÉMARRÉ — logs :"
  tail -20 /tmp/cms-start.log
  pkill -f mock-power360 2>/dev/null
  exit 1
fi

echo "=== 6. Vérification préalable du portail RÉEL (documentaire) ==="
REAL=$(curl -s -m 8 -o /dev/null -w '%{http_code}' \
  "http://portail-xtream.example:8000/player_api.php?username=000000000000&password=000000000000" 2>/dev/null || echo 000)
echo "Portail réel portail-xtream.example:8000 → HTTP $REAL (000 = injoignable depuis IP datacenter — attendu)"

echo "=== 7. Test E2E multi-écrans du compte 1 connexion ==="
python3 scripts/test-power360.py
RESULT=$?

pkill -f mock-power360 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
echo "=== Terminé (power360: $RESULT) ==="
exit $RESULT
