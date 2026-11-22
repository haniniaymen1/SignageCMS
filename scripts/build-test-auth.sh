#!/bin/bash
# =============================================================
# build-test-auth.sh — Build + démarrage + tests E2E connexion
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
echo "Build OK : $(grep -c 'Generating static' /tmp/cms-build.log 2>/dev/null || echo '?')"

echo "=== [3] Démarrage serveur standalone ==="
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

echo "=== [4] Tests E2E connexion ==="
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

# T1 : identifiants par défaut exacts
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
check "T1 admin/admin123" 200 "$R"

# T2 : majuscule automatique sur l'identifiant (clavier mobile)
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"Admin","password":"admin123"}')
check "T2 Admin/admin123 (casse)" 200 "$R"

# T3 : espaces accidentels en fin de mot de passe
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123  "}')
check "T3 admin/'admin123  ' (espaces)" 200 "$R"

# T4 : mot de passe erroné
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"mauvais"}')
check "T4 mauvais mot de passe" 401 "$R"

# T5 : identifiant inconnu
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"inconnu","password":"xyz"}')
check "T5 identifiant inconnu" 401 "$R"

# T6 : champs vides
R=$(code -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"","password":""}')
check "T6 champs vides" 400 "$R"

# T7 : session reconnue après connexion
rm -f /tmp/cj-auth.txt
curl -s -c /tmp/cj-auth.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' > /dev/null
R=$(code -b /tmp/cj-auth.txt http://localhost:3000/api/auth/me)
check "T7 /api/auth/me avec cookie" 200 "$R"

# T8 : page d'accueil accessible avec session
R=$(code -b /tmp/cj-auth.txt -o /dev/null http://localhost:3000/)
check "T8 GET / avec session" 200 "$R"

# T9 : sans cookie, l'accueil redirige vers /login
R=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -m 10 http://localhost:3000/)
echo "  [INFO] GET / sans session -> $R"

echo "=== [4b] Tests jeton Bearer (cookies bloqués) ==="

# T9 : login renvoie un jeton exploitable sans cookie
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
if [ -n "$TOKEN" ]; then
  echo "  [OK]   T9  jeton présent dans la réponse login"
  PASS=$((PASS+1))
else
  echo "  [FAIL] T9  jeton ABSENT de la réponse login"
  FAIL=$((FAIL+1))
fi

# T10 : ressource protégée (/api/resource/users) accepte le Bearer sans cookie
R=$(code -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/resource/users)
check "T10 users avec Bearer (sans cookie)" 200 "$R"

# T10b : /api/auth/me avec Bearer renvoie bien l'utilisateur (pas user:null)
B=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/auth/me)
if echo "$B" | grep -q '"username":"admin"'; then
  echo "  [OK]   T10b me avec Bearer -> utilisateur identifié"
  PASS=$((PASS+1))
else
  echo "  [FAIL] T10b me avec Bearer -> $B"
  FAIL=$((FAIL+1))
fi

# T11 : /api/auth/me SANS auth renvoie 200 mais user:null (comportement attendu)
B=$(curl -s http://localhost:3000/api/auth/me)
if echo "$B" | grep -q '"user":null'; then
  echo "  [OK]   T11 me sans auth -> user:null"
  PASS=$((PASS+1))
else
  echo "  [FAIL] T11 me sans auth -> $B"
  FAIL=$((FAIL+1))
fi

# T12 : ressource protégée sans aucune authentification -> 401
R=$(code http://localhost:3000/api/resource/users)
check "T12 users sans auth" 401 "$R"

# T13 : Bearer invalide -> 401
R=$(code -H "Authorization: Bearer jeton.bidon.inexistant" http://localhost:3000/api/resource/users)
check "T13 Bearer invalide" 401 "$R"

# T14 : logout via Bearer révoque le jeton
R=$(code -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/auth/logout)
check "T14 logout avec Bearer" 200 "$R"
R=$(code -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/resource/users)
check "T15 users après logout (jeton révoqué)" 401 "$R"

echo "=== [5] Bilan ==="
echo "Réussis: $PASS / Échoués: $FAIL"
[ $FAIL -eq 0 ] && echo "TOUS LES TESTS PASSENT" || exit 1
