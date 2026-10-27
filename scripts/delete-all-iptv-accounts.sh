#!/bin/bash
# ============================================================
# delete-all-iptv-accounts.sh
# Supprime TOUS les comptes IPTV (Xtream) enregistrés + leurs
# contenus importés, via l'API du CMS (même sémantique que
# DELETE /api/iptv/xtream sans id). Les playlists M3U publiques
# (kind = playlist) ne sont PAS touchées.
# Arrête d'abord les flux actifs (hubs) pour libérer les
# connexions fournisseurs.
# ============================================================
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0

code() { curl -s -o /tmp/del-out.json -w '%{http_code}' "$@"; }
ok()   { PASS=$((PASS+1)); echo "PASS - $1"; }
ko()   { FAIL=$((FAIL+1)); echo "FAIL - $1"; }

# --- 1. Connexion admin ---
HTTP=$(code -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/del-out.json')).get('token',''))" 2>/dev/null)
if [ "$HTTP" = "200" ] && [ -n "$TOKEN" ]; then ok "Connexion admin (token Bearer obtenu)"; else ko "Connexion admin (HTTP=$HTTP)"; exit 1; fi
AUTH="Authorization: Bearer $TOKEN"

# --- 2. État AVANT ---
HTTP=$(code -X GET $BASE/api/iptv/xtream -H "$AUTH")
PROV_BEFORE=$(python3 -c "import json;d=json.load(open('/tmp/del-out.json'));print(len(d.get('providers',[])))" 2>/dev/null)
[ "$HTTP" = "200" ] && ok "GET /api/iptv/xtream avant : $PROV_BEFORE compte(s)" || ko "GET /api/iptv/xtream (HTTP=$HTTP)"

# --- 3. Arrêt des flux actifs ---
HTTP=$(code -X GET $BASE/api/iptv/connections -H "$AUTH")
if [ "$HTTP" = "200" ]; then
  HUB_URLS=$(python3 -c "
import json
d = json.load(open('/tmp/del-out.json'))
for h in d.get('hubs', []):
    print(h.get('url') or h.get('source') or '')" 2>/dev/null)
  N=0
  for U in $HUB_URLS; do
    [ -z "$U" ] && continue
    curl -s -X POST $BASE/api/iptv/connections -H "$AUTH" -H 'Content-Type: application/json' -d "{\"url\":\"$U\"}" >/dev/null
    N=$((N+1))
  done
  ok "Flux actifs arrêtés : $N hub(s)"
else
  ko "GET /api/iptv/connections (HTTP=$HTTP)"
fi

# --- 4. Suppression de TOUS les comptes ---
HTTP=$(code -X DELETE "$BASE/api/iptv/xtream" -H "$AUTH")
if [ "$HTTP" = "200" ]; then ok "DELETE /api/iptv/xtream (tous comptes) -> HTTP 200"; else ko "DELETE /api/iptv/xtream (HTTP=$HTTP): $(cat /tmp/del-out.json)"; fi

# --- 5. Vérification API ---
HTTP=$(code -X GET $BASE/api/iptv/xtream -H "$AUTH")
PROV_AFTER=$(python3 -c "import json;d=json.load(open('/tmp/del-out.json'));print(len(d.get('providers',[])))" 2>/dev/null)
if [ "$HTTP" = "200" ] && [ "$PROV_AFTER" = "0" ]; then ok "API : 0 compte restant"; else ko "API comptes restants = $PROV_AFTER (HTTP=$HTTP)"; fi

# --- 6. Vérification base SQLite ---
python3 - <<'PYEOF'
import sqlite3, sys
con = sqlite3.connect('/home/z/my-project/db/custom.db')
cur = con.cursor()
p = cur.execute('SELECT COUNT(*) FROM IptvProvider').fetchone()[0]
imp = cur.execute("SELECT COUNT(*) FROM IptvChannel WHERE kind != 'playlist'").fetchone()[0]
pl  = cur.execute("SELECT COUNT(*) FROM IptvChannel WHERE kind = 'playlist'").fetchone()[0]
pls = cur.execute('SELECT COUNT(*) FROM IptvPlaylist').fetchone()[0]
con.close()
errors = []
if p != 0:   errors.append(f'{p} compte(s) IptvProvider restant(s)')
if imp != 0: errors.append(f'{imp} chaîne(s) importée(s) de comptes restante(s)')
print(f'BASE: comptes={p} | chaines_importees={imp} | chaines_playlist_m3u={pl} | playlists={pls}')
if errors:
    print('FAIL - Base: ' + '; '.join(errors)); sys.exit(1)
print('PASS - Base vide de comptes IPTV')
PYEOF
[ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo "==============================="
echo "RESULTAT: $PASS PASS / $FAIL FAIL"
[ $FAIL -eq 0 ]
