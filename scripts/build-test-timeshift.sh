#!/bin/bash
# ============================================================
# build-test-timeshift.sh — E2E timeshift (enregistrement + rediffusion
# décalée, dont un décalage RÉEL de 60 s) — tout-en-un :
# pkill → mocks IPTV (8997 + 8998) → build → CMS → test → nettoyage.
# ============================================================
set -u
cd /home/z/my-project

echo "=== 1. Arrêt des serveurs existants ==="
pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null
pkill -f "next dev" 2>/dev/null; pkill -f "mock-iptv-upstream" 2>/dev/null; pkill -f "mock-power360" 2>/dev/null
rm -rf /tmp/cms-timeshift 2>/dev/null
sleep 1

echo "=== 2. Démarrage des portails IPTV simulés (8997 + 8998) ==="
(node scripts/mock-iptv-upstream.mjs > /tmp/iptv-mock.log 2>&1 &)
(node scripts/mock-power360.mjs > /tmp/power360-mock.log 2>&1 &)
sleep 1.5
cat /tmp/iptv-mock.log /tmp/power360-mock.log

echo "=== 3. Build production ==="
if ! bun run build 2>&1 | tail -5; then
  echo "BUILD ÉCHOUÉ"
  pkill -f mock-iptv-upstream 2>/dev/null; pkill -f mock-power360 2>/dev/null
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
  pkill -f mock-iptv-upstream 2>/dev/null; pkill -f mock-power360 2>/dev/null
  exit 1
fi

echo "=== 6. Tests E2E timeshift (dont décalage réel 60 s) ==="
python3 scripts/test-timeshift.py
RESULT=$?

pkill -f mock-iptv-upstream 2>/dev/null; pkill -f mock-power360 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
rm -rf /tmp/cms-timeshift 2>/dev/null
echo "=== Terminé (timeshift: $RESULT) ==="
exit $RESULT
