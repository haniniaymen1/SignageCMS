#!/bin/bash
# =============================================================
# build-test-heure24.sh — Build + démarrage + tests E2E format 24h
# Exécution monolithique : pkill AVANT build, démarrage, tests.
# =============================================================
set -u
cd /home/z/my-project

echo "=== [1] Arrêt serveur (avant build) ==="
pkill -f 'server.js' 2>/dev/null && echo "serveur arrêté" || echo "aucun serveur actif"
sleep 1

echo "=== [2] Build Next.js ==="
bun run build > /tmp/cms-build.log 2>&1
BUILD_RC=$?
if [ $BUILD_RC -ne 0 ]; then
  echo "BUILD ÉCHOUÉ (rc=$BUILD_RC) — extrait :"
  tail -30 /tmp/cms-build.log
  exit 1
fi
echo "Build OK"

echo "=== [3] Vérification composant 24h dans le bundle ==="
if grep -rl "format 24h" .next/static/chunks/ >/dev/null 2>&1 || grep -rl "format 24h" .next/standalone/.next/static/chunks/ >/dev/null 2>&1; then
  echo "  [OK]   Marqueur « format 24h » présent dans les chunks client"
else
  echo "  [WARN] Marqueur « format 24h » non trouvé dans les chunks (vérif manuelle requise)"
fi

echo "=== [4] Démarrage serveur standalone ==="
(bun .next/standalone/server.js > /tmp/cms-start.log 2>&1 &)
for i in $(seq 1 30); do
  sleep 1
  if curl -s -o /dev/null -m 2 http://localhost:3000/login; then
    echo "Serveur prêt après ${i}s"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "SERVEUR INJOIGNABLE — log :"
    tail -20 /tmp/cms-start.log
    exit 1
  fi
done

echo "=== [5] Tests E2E ==="
PASS=0; FAIL=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  [OK]   $label -> $actual"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $label -> attendu $expected, obtenu $actual"
    FAIL=$((FAIL+1))
  fi
}

code() {
  curl -s -o /dev/null -w '%{http_code}' -m 10 "$@"
}

# T1 : connexion admin (pré-requis pour les tests d'API)
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "T1 connexion admin/admin123" 200 "$R"

# Extraction du jeton Bearer + cookie de session
LOGIN_JSON=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
AUTH="Authorization: Bearer $TOKEN"

# T2 : page d'accueil
R=$(code http://localhost:3000/)
check "T2 GET / accessible" 200 "$R"

# T3 : création d'un événement avec heures 24h (14:30 → 18:45)
START_ISO="2026-10-21T14:30:00.000Z"
END_ISO="2026-10-21T18:45:00.000Z"
EV_JSON=$(curl -s -X POST http://localhost:3000/api/resource/events \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"TEST-24H\",\"type\":\"layout\",\"targetType\":\"all\",\"start\":\"$START_ISO\",\"end\":\"$END_ISO\",\"isPriority\":false,\"color\":\"#f97316\"}")
EV_ID=$(echo "$EV_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id",""))' 2>/dev/null)
if [ -n "$EV_ID" ]; then
  echo "  [OK]   T3 création événement (id=$EV_ID)"
  PASS=$((PASS+1))
else
  echo "  [FAIL] T3 création événement -> réponse : $(echo "$EV_JSON" | head -c 200)"
  FAIL=$((FAIL+1))
fi

# T4 : vérification des heures stockées (format ISO préservé)
STORED_START=$(curl -s http://localhost:3000/api/resource/events -H "$AUTH" | python3 -c "
import sys,json
evs=json.load(sys.stdin)
ev=next((e for e in evs if e.get('id')=='$EV_ID'),{})
print(ev.get('start',''))" 2>/dev/null)
check "T4 heure début stockée" "$START_ISO" "$STORED_START"

# T5 : suppression de l'événement de test (nettoyage)
R=$(code -X DELETE "http://localhost:3000/api/resource/events/$EV_ID" -H "$AUTH")
check "T5 suppression événement test" 200 "$R"

# T6 : les chunks client embarquent bien le nouveau sélecteur (DateTime24)
if grep -rl "Heure (24h)" .next/standalone/.next/static/chunks/ >/dev/null 2>&1; then
  echo "  [OK]   T6 sélecteur 24h présent dans le bundle client"
  PASS=$((PASS+1))
else
  echo "  [FAIL] T6 sélecteur 24h absent du bundle client"
  FAIL=$((FAIL+1))
fi

echo ""
echo "Résultat : $PASS OK / $FAIL FAIL"
[ $FAIL -eq 0 ] && echo "TOUS LES TESTS PASSENT" || exit 1
