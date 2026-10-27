#!/bin/bash
# ============================================================
# build-test-multi-ecrans.sh — E2E « plusieurs chaînes sur plusieurs
# écrans avec 1 compte / 1 connexion » (+ timeshift) — tout-en-un :
# pkill → portail simulé (8998) → build → CMS → test → nettoyage.
# ============================================================
set -u
cd /home/z/my-project

echo "=== 1. Arrêt des serveurs existants ==="
pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null
pkill -f "next dev" 2>/dev/null; pkill -f "mock-iptv-upstream" 2>/dev/null; pkill -f "mock-power360" 2>/dev/null
rm -rf /tmp/cms-timeshift 2>/dev/null
sleep 1

echo "=== 2. Démarrage du portail Xtream simulé (8998, profil carte 1 connexion) ==="
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

echo "=== 6. Tests E2E multi-écrans / 1 connexion ==="
python3 scripts/test-multi-ecrans-1connexion.py
RESULT=$?

pkill -f mock-power360 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
rm -rf /tmp/cms-timeshift 2>/dev/null
echo "=== Terminé (multi-écrans: $RESULT) ==="
exit $RESULT
